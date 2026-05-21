// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Allocation Service
// Implements PRD Part 3 §4 (BR-REC-001 through BR-REC-003)
// ============================================================================

import { SupabaseClient } from 'supabase';
import {
  getAdminClient,
  callRpc,
  fetchById,
  getConfigValue,
  getGLAccountId,
} from '../_shared/db.ts';
import {
  BusinessError,
  NotFoundError,
  BRErrors,
} from '../_shared/errors.ts';
import { CONFIG_KEYS } from '../_shared/constants.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { requireRole, requireCustomerAccess } from '../_shared/auth.ts';
import { validateUUID } from '../_shared/validators.ts';
import type {
  Receipt,
  Invoice,
  Customer,
  AllocationDetail,
  InvoiceStatus,
  PaginationParams,
} from '../_shared/types.ts';
import { roundTo2 } from '../invoices/calculator.ts';
import { allocateFIFO, allocateAmountMatch, calculateForexGainLoss } from './algorithms.ts';
import type { AllocationCandidate, AllocationProposal } from './algorithms.ts';
import { JournalEntryService } from '../journal-entries/service.ts';
import { ReceiptService } from '../receipts/service.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ManualAllocationInput {
  receipt_id: string;
  allocations: Array<{
    invoice_id: string;
    amount: number;
    discount_amount?: number;
  }>;
}

export interface AutoAllocationInput {
  receipt_id: string;
  method: 'FIFO' | 'AmountMatch';
}

export interface ReverseAllocationInput {
  allocation_id: string;
  reason: string;
}

// ─── Allocation Service ─────────────────────────────────────────────────────

export class AllocationService {
  private client: SupabaseClient;
  private jeService: JournalEntryService;
  private receiptService: ReceiptService;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
    this.jeService = new JournalEntryService(this.client);
    this.receiptService = new ReceiptService(this.client);
  }

  // ════════════════════════════════════════════════════════════════════════
  // MANUAL ALLOCATION
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Manually allocate a receipt to one or more invoices (PRD §4.1).
   *
   * Pre-checks (BR-REC-001):
   * - Receipt must be Posted
   * - Receipt must have unallocated balance
   * - Invoice must be Open/Overdue/Partially Paid
   * - Total allocation ≤ receipt unallocated amount
   * - Each allocation ≤ invoice outstanding
   * - Same customer
   *
   * For each allocation:
   * - Create allocation_detail record
   * - Update invoice outstanding and status
   * - Calculate forex gain/loss
   * - Update receipt allocated/unallocated amounts
   */
  async manualAllocate(
    auth: AuthContext,
    input: ManualAllocationInput,
  ): Promise<AllocationDetail[]> {
    requireRole(auth, 'AR Clerk');
    validateUUID(input.receipt_id, 'receipt_id');

    const receipt = await fetchById<Receipt>(this.client, 'receipts', input.receipt_id);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', input.receipt_id);
    await requireCustomerAccess(auth, receipt.customer_id);

    const startedAt = new Date(Date.now() - 1000).toISOString();
    for (const alloc of input.allocations) {
      validateUUID(alloc.invoice_id, 'invoice_id');
    }

    await callRpc(this.client, 'allocate_receipt', {
      p_receipt_id: input.receipt_id,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
      p_allocations: input.allocations.map(a => ({
        invoice_id: a.invoice_id,
        amount: a.amount,
        discount_amount: a.discount_amount ?? 0,
      })),
    });

    const invoiceIds = input.allocations.map(a => a.invoice_id);
    const { data: created, error: createdErr } = await this.client
      .from('allocation_details')
      .select('*')
      .eq('receipt_id', input.receipt_id)
      .in('invoice_id', invoiceIds)
      .eq('allocated_by', auth.userId)
      .eq('status', 'Active')
      .gte('created_at', startedAt)
      .order('created_at', { ascending: true })
      .limit(input.allocations.length);

    if (createdErr) throw new Error(`Failed to fetch created allocations: ${createdErr.message}`);
    return (created ?? []) as AllocationDetail[];
  }

  // ════════════════════════════════════════════════════════════════════════
  // AUTO ALLOCATION (FIFO / Amount Match)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Automatically allocate a receipt using FIFO or Amount Match algorithm.
   * Returns the proposed allocations, then executes them via manualAllocate.
   */
  async autoAllocate(
    auth: AuthContext,
    input: AutoAllocationInput,
  ): Promise<AllocationDetail[]> {
    requireRole(auth, 'AR Clerk');
    validateUUID(input.receipt_id, 'receipt_id');

    const receipt = await fetchById<Receipt>(this.client, 'receipts', input.receipt_id);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', input.receipt_id);

    if (receipt.unallocated_amount <= 0) {
      throw new BusinessError('BR-REC-001', 'Receipt has no unallocated balance.', 400);
    }

    // Fetch outstanding invoices for this customer + same currency
    const candidates = await this.getOutstandingInvoices(
      auth.companyId,
      receipt.customer_id,
      receipt.currency,
    );

    if (candidates.length === 0) {
      throw new BusinessError('BR-REC-001', 'No outstanding invoices found for this customer.', 400);
    }

    // Apply algorithm
    let proposals: AllocationProposal[];
    if (input.method === 'FIFO') {
      proposals = allocateFIFO(candidates, receipt.unallocated_amount, receipt.exchange_rate);
    } else {
      proposals = allocateAmountMatch(candidates, receipt.unallocated_amount, receipt.exchange_rate);
    }

    if (proposals.length === 0) {
      throw new BusinessError('BR-REC-001', 'Auto-allocation algorithm found no suitable matches.', 400);
    }

    // Execute allocations via manualAllocate (reuse all validation logic)
    return this.manualAllocate(auth, {
      receipt_id: input.receipt_id,
      allocations: proposals.map(p => ({
        invoice_id: p.invoice_id,
        amount: p.allocated_amount,
      })),
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PREVIEW AUTO ALLOCATION (Dry run — no changes)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Preview what an auto-allocation would look like without executing it.
   * Useful for user confirmation before committing.
   */
  async previewAutoAllocation(
    auth: AuthContext,
    receiptId: string,
    method: 'FIFO' | 'AmountMatch',
  ): Promise<AllocationProposal[]> {
    validateUUID(receiptId, 'receipt_id');

    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);

    const candidates = await this.getOutstandingInvoices(
      auth.companyId,
      receipt.customer_id,
      receipt.currency,
    );

    if (method === 'FIFO') {
      return allocateFIFO(candidates, receipt.unallocated_amount, receipt.exchange_rate);
    } else {
      return allocateAmountMatch(candidates, receipt.unallocated_amount, receipt.exchange_rate);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // REVERSE ALLOCATION
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Reverse a single allocation record (PRD Part 3 §4.7).
   *
   * Actions:
   * 1. Mark allocation as Reversed
   * 2. Restore invoice outstanding (with version lock — VULN-S04)
   * 3. Decrease receipt allocated_amount
   * 4. Reverse Forex gain/loss JE if any (VULN-C02 — IFRS compliance)
   * 5. Reverse Discount JE if any (VULN-C02 — IFRS compliance)
   */
  async previewAllocation(
    auth: AuthContext,
    receiptId: string,
    method: string,
  ): Promise<AllocationProposal[]> {
    if (method !== 'FIFO' && method !== 'AmountMatch') {
      throw new BusinessError('BR-REC-001', 'Allocation preview method must be FIFO or AmountMatch.', 400);
    }
    return this.previewAutoAllocation(auth, receiptId, method);
  }

  async reverseAllocation(
    auth: AuthContext,
    input: ReverseAllocationInput,
  ): Promise<void> {
    requireRole(auth, 'AR Supervisor');
    validateUUID(input.allocation_id, 'allocation_id');

    const alloc = await fetchById<AllocationDetail>(
      this.client, 'allocation_details', input.allocation_id
    );

    const receipt = await fetchById<Receipt>(this.client, 'receipts', alloc.receipt_id);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Allocation', input.allocation_id);
    await requireCustomerAccess(auth, receipt.customer_id);

    await callRpc(this.client, 'reverse_allocation', {
      p_allocation_id: input.allocation_id,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
      p_reason: input.reason,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // LIST ALLOCATIONS
  // ════════════════════════════════════════════════════════════════════════

  async listAllocations(
    _auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<{ allocations: AllocationDetail[]; total: number }> {
    let query = this.client
      .from('allocation_details')
      .select('*', { count: 'exact' });

    if (filters.receipt_id) query = query.eq('receipt_id', filters.receipt_id);
    if (filters.invoice_id) query = query.eq('invoice_id', filters.invoice_id);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.method) query = query.eq('allocation_method', filters.method);

    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;
    query = query.order('allocation_date', { ascending: false }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list allocations: ${error.message}`);
    return { allocations: (data ?? []) as AllocationDetail[], total: count ?? 0 };
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get outstanding invoices for a customer as allocation candidates.
   */
  private async getOutstandingInvoices(
    companyId: string,
    customerId: string,
    currency: string,
  ): Promise<AllocationCandidate[]> {
    const { data, error } = await this.client
      .from('invoices')
      .select('id, invoice_no, doc_type, due_date, outstanding, currency, exchange_rate')
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('currency', currency)
      .in('status', ['Open', 'Overdue', 'Partially Paid'])
      .in('doc_type', ['Invoice', 'Debit Note'])
      .gt('outstanding', 0)
      .order('due_date', { ascending: true });

    if (error) throw new Error(`Failed to fetch outstanding invoices: ${error.message}`);

    return (data ?? []).map(inv => ({
      invoice_id: inv.id,
      invoice_no: inv.invoice_no,
      doc_type: inv.doc_type,
      due_date: inv.due_date,
      outstanding: Number(inv.outstanding),
      currency: inv.currency,
      exchange_rate: Number(inv.exchange_rate),
    }));
  }

  /**
   * Determine the correct invoice status after allocation changes.
   */
  private determineInvoiceStatus(
    outstanding: number,
    totalAmount: number,
    dueDate: string | null,
  ): InvoiceStatus {
    if (outstanding <= 0.005) return 'Paid';

    if (outstanding < totalAmount - 0.005) {
      // Check if overdue
      if (dueDate && new Date(dueDate) < new Date()) return 'Overdue';
      return 'Partially Paid';
    }

    // Full outstanding — back to Open or Overdue
    if (dueDate && new Date(dueDate) < new Date()) return 'Overdue';
    return 'Open';
  }

  /**
   * Generate JE for realized forex gain/loss (PRD Part 5 §2.5).
   *
   * If forexGL > 0 (gain):
   *   Dr. AR Control         forexGL
   *     Cr. Forex Gain       forexGL
   *
   * If forexGL < 0 (loss):
   *   Dr. Forex Loss         |forexGL|
   *     Cr. AR Control       |forexGL|
   */
  private async createForexJE(
    auth: AuthContext,
    receipt: Receipt,
    invoice: Invoice,
    allocAmount: number,
    forexGL: number,
  ): Promise<void> {
    const customer = await fetchById<Customer>(this.client, 'customers', receipt.customer_id);
    const arAcctId = customer.ar_control_acct_id
      ?? await getGLAccountId(this.client, auth.companyId,
        await getConfigValue(this.client, auth.companyId, CONFIG_KEYS.DEFAULT_AR_CONTROL_ACCT) ?? '1100-001');

    const absGL = Math.abs(forexGL);

    if (forexGL > 0) {
      // Gain
      const gainAcctId = customer.forex_gain_acct_id
        ?? await getGLAccountId(this.client, auth.companyId,
          await getConfigValue(this.client, auth.companyId, CONFIG_KEYS.DEFAULT_FOREX_GAIN_ACCT) ?? '4900-001');

      if (arAcctId && gainAcctId) {
        await this.jeService.createJournalEntry({
          company_id: auth.companyId,
          je_date: new Date().toISOString().slice(0, 10),
          posting_period: new Date().toISOString().slice(0, 7),
          source_type: 'ADJ',
          source_doc_no: receipt.receipt_no,
          source_doc_id: receipt.id,
          description: `Forex Gain: ${receipt.receipt_no} ↔ ${invoice.invoice_no}, amount ${allocAmount}`,
          lines: [
            { gl_account_id: arAcctId, description: `Forex gain AR adj`, debit_amount: absGL, credit_amount: 0 },
            { gl_account_id: gainAcctId, description: `Forex gain`, debit_amount: 0, credit_amount: absGL },
          ],
          created_by: auth.userId,
        });
      }
    } else {
      // Loss
      const lossAcctId = customer.forex_loss_acct_id
        ?? await getGLAccountId(this.client, auth.companyId,
          await getConfigValue(this.client, auth.companyId, CONFIG_KEYS.DEFAULT_FOREX_LOSS_ACCT) ?? '5900-001');

      if (arAcctId && lossAcctId) {
        await this.jeService.createJournalEntry({
          company_id: auth.companyId,
          je_date: new Date().toISOString().slice(0, 10),
          posting_period: new Date().toISOString().slice(0, 7),
          source_type: 'ADJ',
          source_doc_no: receipt.receipt_no,
          source_doc_id: receipt.id,
          description: `Forex Loss: ${receipt.receipt_no} ↔ ${invoice.invoice_no}, amount ${allocAmount}`,
          lines: [
            { gl_account_id: lossAcctId, description: `Forex loss`, debit_amount: absGL, credit_amount: 0 },
            { gl_account_id: arAcctId, description: `Forex loss AR adj`, debit_amount: 0, credit_amount: absGL },
          ],
          created_by: auth.userId,
        });
      }
    }
  }

  /**
   * Generate JE for early payment discount (PRD Part 5 §2.6).
   *   Dr. Discount Allowed    discount_amt
   *     Cr. AR Control         discount_amt
   */
  private async createDiscountJE(
    auth: AuthContext,
    receipt: Receipt,
    invoice: Invoice,
    discountAmt: number,
  ): Promise<void> {
    const customer = await fetchById<Customer>(this.client, 'customers', receipt.customer_id);
    const arAcctId = customer.ar_control_acct_id
      ?? await getGLAccountId(this.client, auth.companyId,
        await getConfigValue(this.client, auth.companyId, CONFIG_KEYS.DEFAULT_AR_CONTROL_ACCT) ?? '1100-001');
    const discountAcctId = customer.discount_acct_id
      ?? await getGLAccountId(this.client, auth.companyId,
        await getConfigValue(this.client, auth.companyId, CONFIG_KEYS.DEFAULT_DISCOUNT_ACCT) ?? '5100-001');

    if (arAcctId && discountAcctId) {
      await this.jeService.createJournalEntry({
        company_id: auth.companyId,
        je_date: new Date().toISOString().slice(0, 10),
        posting_period: new Date().toISOString().slice(0, 7),
        source_type: 'ADJ',
        source_doc_no: receipt.receipt_no,
        source_doc_id: receipt.id,
        description: `Early payment discount: ${receipt.receipt_no} ↔ ${invoice.invoice_no}`,
        lines: [
          { gl_account_id: discountAcctId, description: `Discount allowed`, debit_amount: discountAmt, credit_amount: 0 },
          { gl_account_id: arAcctId, description: `Discount AR adj`, debit_amount: 0, credit_amount: discountAmt },
        ],
        created_by: auth.userId,
      });
    }
  }
}

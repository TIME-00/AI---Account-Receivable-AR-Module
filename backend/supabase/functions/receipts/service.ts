// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Receipt Management Service
// Implements PRD Part 3 §2-3 (BR-RCT, 7 payment methods, CHQ 2-stage)
// ============================================================================

import { SupabaseClient } from 'supabase';
import {
  getAdminClient,
  callRpc,
  getNextSequence,
  fetchById,
  isFiscalPeriodOpen,
  getConfigValue,
  getGLAccountId,
} from '../_shared/db.ts';
import {
  BusinessError,
  NotFoundError,
  BRErrors,
  ValidationError,
} from '../_shared/errors.ts';
import { CONFIG_KEYS } from '../_shared/constants.ts';
import type { AuthContext } from '../_shared/auth.ts';
import {
  requireRole,
  requireOperationalReadRole,
  requireCustomerAccess,
  getCustomerAccessFilter,
} from '../_shared/auth.ts';
import { validateUUID } from '../_shared/validators.ts';
import type {
  Receipt,
  Customer,
  BankAccount,
  PaginationParams,
  ReceiptStatus,
} from '../_shared/types.ts';
import { roundTo2 } from '../invoices/calculator.ts';
import { JournalEntryService } from '../journal-entries/service.ts';
import type { CreateReceiptInput, PostReceiptInput, CancelReceiptInput, BounceReceiptInput } from './validators.ts';
import { assertCustomerVisible, getVisibleCustomerIds } from '../_shared/visibility.ts';

// ─── Receipt Service ────────────────────────────────────────────────────────

export class ReceiptService {
  private client: SupabaseClient;
  private jeService: JournalEntryService;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
    this.jeService = new JournalEntryService(this.client);
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREATE RECEIPT (Draft)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Create a new Draft receipt.
   * PRD Part 3 §2.1
   */
  async createReceipt(
    auth: AuthContext,
    data: CreateReceiptInput,
  ): Promise<Receipt> {
    requireRole(auth, 'AR Clerk');
    await requireCustomerAccess(auth, data.customer_id);

    // Validate customer
    const customer = await fetchById<Customer>(this.client, 'customers', data.customer_id);
    if (customer.company_id !== auth.companyId) throw new NotFoundError('Customer', data.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, customer.id);
    if (customer.is_deleted) throw new NotFoundError('Customer', data.customer_id);

    // Blocked customers: no new receipts either (BR-CUS-002)
    if (customer.status === 'Blocked') {
      throw BRErrors.CUS_002_BLOCKED(customer.customer_name);
    }

    // Validate bank account
    const bankAccount = await fetchById<BankAccount>(this.client, 'bank_accounts', data.bank_account_id);
    if (bankAccount.company_id !== auth.companyId) throw new NotFoundError('BankAccount', data.bank_account_id);
    if (!bankAccount.is_active) {
      throw new ValidationError('Selected bank account is inactive.', { bank_account_id: data.bank_account_id });
    }

    // Resolve exchange rate
    const exchangeRate = data.exchange_rate ?? await this.resolveExchangeRate(
      auth.companyId, data.currency, data.receipt_date,
    );

    // Get company base currency
    const company = await fetchById<{ base_currency: string }>(this.client, 'companies', auth.companyId);

    // Generate receipt number
    const receiptNo = await getNextSequence(this.client, auth.companyId, 'RCT');

    const insertData = {
      company_id: auth.companyId,
      receipt_no: receiptNo,
      receipt_date: data.receipt_date,
      value_date: data.value_date ?? data.receipt_date,
      customer_id: data.customer_id,
      customer_name: customer.customer_name,
      payment_method: data.payment_method,
      currency: data.currency,
      exchange_rate: exchangeRate,
      base_currency: company.base_currency,
      receipt_amount: data.receipt_amount,
      base_amount: roundTo2(data.receipt_amount * exchangeRate),
      allocated_amount: 0,
      unallocated_amount: data.receipt_amount,
      bank_account_id: data.bank_account_id,
      bank_account_name: `${bankAccount.bank_name} - ${bankAccount.account_no}`,
      reference_no: data.reference_no ?? null,
      cheque_date: data.cheque_date ?? null,
      status: 'Draft' as const,
      remarks: data.remarks ?? null,
      created_by: auth.userId,
    };

    const { data: receipt, error } = await this.client
      .from('receipts')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new BusinessError('DUPLICATE_RECEIPT', `Receipt number ${receiptNo} already exists. Please retry.`, 409);
      }
      throw new Error(`Failed to create receipt: ${error.message}`);
    }

    await this.recordBookingDecision(auth, receipt.id, data.exchange_rate !== undefined, data.fx_override_reason);

    return receipt as Receipt;
  }

  // ════════════════════════════════════════════════════════════════════════
  // POST RECEIPT (Draft → Posted)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Post a receipt (BR-RCT-001).
   *
   * Pre-posting checks:
   * 1. Status = Draft
   * 2. Amount > 0
   * 3. Customer is not Blocked
   * 4. Bank account is active
   * 5. Fiscal period is Open
   *
   * Journal Entry:
   * - Non-CHQ: Dr. Bank Account   Cr. AR Control
   * - CHQ:     Dr. Cheques on Hand Cr. AR Control (Stage 1 — PRD §3.2)
   *
   * After posting, receipt becomes available for allocation.
   */
  async postReceipt(
    auth: AuthContext,
    receiptId: string,
    input: PostReceiptInput = {},
  ): Promise<Receipt & { je_no?: string }> {
    requireRole(auth, 'AR Clerk');
    validateUUID(receiptId, 'id');
    void input;

    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);
    await requireCustomerAccess(auth, receipt.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, receipt.customer_id);

    const rpcResult = await callRpc<{ je_no?: string }>(this.client, 'post_receipt', {
      p_receipt_id: receiptId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
    });

    const postedReceipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    return { ...postedReceipt, je_no: rpcResult?.je_no };
  }

  // ════════════════════════════════════════════════════════════════════════

  // CHEQUE CLEARANCE (Stage 2 — CHQ only)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Clear a posted cheque receipt (PRD Part 3 §3.2).
   *
   * Stage 2 JE:
   *   Dr. Bank Account       receipt_amount
   *     Cr. Cheques on Hand   receipt_amount
   *
   * This moves funds from the clearing account to the actual bank account.
   * Called when the bank confirms cheque clearance.
   */
  async clearCheque(
    auth: AuthContext,
    receiptId: string,
    clearanceDate?: string,
  ): Promise<Receipt & { je_no?: string }> {
    requireRole(auth, 'AR Supervisor');
    validateUUID(receiptId, 'id');

    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);
    await requireCustomerAccess(auth, receipt.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, receipt.customer_id);

    // Validate: must be CHQ and Posted
    if (receipt.payment_method !== 'CHQ') {
      throw new ValidationError('Cheque clearance only applies to CHQ payment method.', { payment_method: receipt.payment_method });
    }
    if (receipt.status !== 'Posted' && receipt.status !== 'Fully Allocated') {
      throw new BusinessError('BR-RCT-CHQ',
        `Cheque clearance requires Posted or Fully Allocated status. Current: ${receipt.status}`, 400);
    }

    const bankAccount = await fetchById<BankAccount>(this.client, 'bank_accounts', receipt.bank_account_id);
    const chequeAcctCode = await getConfigValue(this.client, auth.companyId, CONFIG_KEYS.DEFAULT_CHEQUE_ACCT) ?? '1200-002';
    const chequeAcctId = await getGLAccountId(this.client, auth.companyId, chequeAcctCode);
    const bankAcctId = bankAccount.gl_account_id;

    let jeNo: string | undefined;
    if (chequeAcctId && bankAcctId) {
      const jeDate = clearanceDate ?? new Date().toISOString().slice(0, 10);
      const postingPeriod = jeDate.slice(0, 7);

      const periodOpen = await isFiscalPeriodOpen(this.client, auth.companyId, postingPeriod);
      if (!periodOpen) throw BRErrors.JE_007_PERIOD_CLOSED(postingPeriod);

      const jeResult = await this.jeService.createJournalEntry({
        company_id: auth.companyId,
        je_date: jeDate,
        posting_period: postingPeriod,
        source_type: 'RCT',
        source_doc_no: receipt.receipt_no,
        source_doc_id: receiptId,
        description: `Cheque clearance: ${receipt.receipt_no} — ${receipt.customer_name}`,
        currency: receipt.currency,
        exchange_rate: receipt.exchange_rate,
        base_currency: receipt.base_currency,
        lines: [
          {
            gl_account_id: bankAcctId,
            description: `Bank (cleared): ${receipt.receipt_no}`,
            debit_amount: receipt.receipt_amount,
            credit_amount: 0,
          },
          {
            gl_account_id: chequeAcctId,
            description: `Cheques on Hand (cleared): ${receipt.receipt_no}`,
            debit_amount: 0,
            credit_amount: receipt.receipt_amount,
          },
        ],
        created_by: auth.userId,
      });
      jeNo = jeResult.je_no;
    }

    // Update value_date to clearance date
    const { data: updated, error } = await this.client
      .from('receipts')
      .update({
        value_date: clearanceDate ?? new Date().toISOString().slice(0, 10),
      })
      .eq('id', receiptId)
      .select()
      .single();

    if (error) throw new Error(`Failed to clear cheque: ${error.message}`);
    return { ...(updated as Receipt), je_no: jeNo };
  }

  // ════════════════════════════════════════════════════════════════════════
  // CANCEL RECEIPT (Posted → Cancelled)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Cancel a receipt (BR-RCT-CANCEL).
   * Preconditions:
   * - Receipt must be Posted (no allocations)
   * - allocated_amount must be 0
   * - Creates a reversal JE
   */
  async cancelReceipt(
    auth: AuthContext,
    receiptId: string,
    input: CancelReceiptInput,
  ): Promise<Receipt> {
    requireRole(auth, 'AR Supervisor');
    validateUUID(receiptId, 'id');

    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);
    await requireCustomerAccess(auth, receipt.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, receipt.customer_id);

    if (receipt.status !== 'Posted') {
      throw new BusinessError('BR-RCT-CANCEL',
        `Only Posted receipts can be cancelled. Current status: ${receipt.status}`, 400);
    }

    if (receipt.allocated_amount > 0) {
      throw new BusinessError('BR-RCT-CANCEL-ALLOC',
        `Receipt ${receipt.receipt_no} has active allocations (allocated: ${receipt.allocated_amount}). Reverse allocations before cancelling.`,
        400, { allocated_amount: receipt.allocated_amount });
    }

    // Reverse JE
    const existingJEs = await this.jeService.findJEsBySourceDoc(receiptId, 'RCT');
    const activeJE = existingJEs.find(je => !je.is_reversed);
    if (activeJE) {
      const postingPeriod = receipt.posting_period ?? receipt.receipt_date.slice(0, 7);
      await this.jeService.createReversalJE({
        company_id: auth.companyId,
        original_je_id: activeJE.id,
        reversal_date: new Date().toISOString().slice(0, 10),
        posting_period: postingPeriod,
        reason: input.cancel_reason,
        created_by: auth.userId,
      });
    }

    const { data: cancelled, error } = await this.client
      .from('receipts')
      .update({
        status: 'Cancelled',
        unallocated_amount: 0,
      })
      .eq('id', receiptId)
      .select()
      .single();

    if (error) throw new Error(`Failed to cancel receipt: ${error.message}`);
    return cancelled as Receipt;
  }

  // ════════════════════════════════════════════════════════════════════════
  // BOUNCED CHEQUE (Posted/Fully Allocated → Bounced)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Handle a bounced cheque (PRD Part 3 §3.3).
   *
   * This is a CRITICAL multi-step operation:
   * 1. Reverse ALL allocation records linked to this receipt
   * 2. Restore outstanding amounts on affected invoices
   * 3. Generate reversal JEs for all affected entries
   * 4. Mark receipt as Bounced
   * 5. Log in credit_control_logs
   *
   * Called from AllocationService for the full allocation reversal.
   * This method handles the receipt-level state change.
   */
  async handleBouncedCheque(
    auth: AuthContext,
    receiptId: string,
    input: BounceReceiptInput,
  ): Promise<Receipt> {
    requireRole(auth, 'Finance Manager');
    validateUUID(receiptId, 'id');

    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);
    await requireCustomerAccess(auth, receipt.customer_id);

    await callRpc(this.client, 'handle_bounced_cheque', {
      p_receipt_id: receiptId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
      p_bounce_reason: input.bounce_reason,
      p_bounce_date: input.bounce_date ?? null,
    });

    return await fetchById<Receipt>(this.client, 'receipts', receiptId);
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET / LIST RECEIPTS
  // ════════════════════════════════════════════════════════════════════════

  async getReceiptById(auth: AuthContext, receiptId: string): Promise<Receipt> {
    requireOperationalReadRole(auth);
    validateUUID(receiptId, 'id');
    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);
    await requireCustomerAccess(auth, receipt.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, receipt.customer_id);
    return receipt;
  }

  async listReceipts(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<{ receipts: Receipt[]; total: number }> {
    requireOperationalReadRole(auth);
    const allowedIds = await getCustomerAccessFilter(auth);
    const visibleCustomerIds = await getVisibleCustomerIds(this.client, auth.companyId);
    if (visibleCustomerIds.length === 0) return { receipts: [], total: 0 };

    let query = this.client
      .from('receipts')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .in('customer_id', visibleCustomerIds);

    if (allowedIds !== null) {
      query = query.in('customer_id', allowedIds);
    }

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.customer_id) query = query.eq('customer_id', filters.customer_id);
    if (filters.payment_method) query = query.eq('payment_method', filters.payment_method);
    if (filters.posting_period) query = query.eq('posting_period', filters.posting_period);
    if (filters.date_from) query = query.gte('receipt_date', filters.date_from);
    if (filters.date_to) query = query.lte('receipt_date', filters.date_to);
    if (filters.search) {
      const s = `%${filters.search}%`;
      query = query.or(`receipt_no.ilike.${s},customer_name.ilike.${s},reference_no.ilike.${s}`);
    }

    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;
    query = query.order('receipt_date', { ascending: false }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list receipts: ${error.message}`);
    return { receipts: (data ?? []) as Receipt[], total: count ?? 0 };
  }

  /**
   * Get unallocated receipts for a customer (used by allocation module).
   */
  async getUnallocatedReceipts(
    auth: AuthContext,
    customerId: string,
  ): Promise<Receipt[]> {
    requireOperationalReadRole(auth);
    validateUUID(customerId, 'customer_id');
    await requireCustomerAccess(auth, customerId);
    await assertCustomerVisible(this.client, auth.companyId, customerId);

    const { data, error } = await this.client
      .from('receipts')
      .select('*')
      .eq('company_id', auth.companyId)
      .eq('customer_id', customerId)
      .in('status', ['Posted', 'Fully Allocated'])
      .gt('unallocated_amount', 0)
      .order('receipt_date', { ascending: true });

    if (error) throw new Error(`Failed to fetch unallocated receipts: ${error.message}`);
    return (data ?? []) as Receipt[];
  }

  // ════════════════════════════════════════════════════════════════════════
  // INTERNAL: Update receipt allocation amounts
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Called by AllocationService after each allocation to update the receipt's
   * allocated_amount, unallocated_amount, and status.
   */
  async updateAllocationAmounts(
    receiptId: string,
    allocatedDelta: number,
  ): Promise<void> {
    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);

    const newAllocated = roundTo2(receipt.allocated_amount + allocatedDelta);
    const newUnallocated = roundTo2(receipt.receipt_amount - newAllocated);

    let newStatus: ReceiptStatus = receipt.status;
    if (newUnallocated <= 0.005) {
      newStatus = 'Fully Allocated';
    } else if (newAllocated > 0 && receipt.status === 'Fully Allocated') {
      newStatus = 'Posted'; // De-allocation brought it back
    }

    await this.client
      .from('receipts')
      .update({
        allocated_amount: newAllocated,
        unallocated_amount: Math.max(0, newUnallocated),
        status: newStatus,
      })
      .eq('id', receiptId);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRIVATE: Exchange rate resolution
  // ════════════════════════════════════════════════════════════════════════

  private async resolveExchangeRate(
    companyId: string,
    currency: string,
    receiptDate: string,
  ): Promise<number> {
    const { data: company } = await this.client
      .from('companies')
      .select('base_currency')
      .eq('id', companyId)
      .single();

    if (company?.base_currency === currency) return 1.0;

    const { data: rate } = await this.client
      .from('exchange_rates')
      .select('rate')
      .eq('company_id', companyId)
      .eq('from_currency', currency)
      .eq('to_currency', company?.base_currency ?? 'MYR')
      .lte('effective_date', receiptDate)
      .order('effective_date', { ascending: false })
      .limit(1)
      .single();

    if (!rate) {
      throw new ValidationError(
        `Exchange rate not found for ${currency} → ${company?.base_currency} on ${receiptDate}.`,
        { from: currency, to: company?.base_currency, date: receiptDate },
      );
    }
    return Number(rate.rate);
  }

  private async recordBookingDecision(
    auth: AuthContext,
    receiptId: string,
    explicitRateSupplied: boolean,
    overrideReason?: string,
  ): Promise<void> {
    await callRpc<string>(getAdminClient(), 'fx_record_booking_decision', {
      p_company_id: auth.companyId,
      p_transaction_type: 'receipt',
      p_transaction_id: receiptId,
      p_actor_user_id: auth.userId,
      p_explicit_rate_supplied: explicitRateSupplied,
      p_source_category: null,
      p_fx_reference_rate_id: null,
      p_override_reason: overrideReason ?? null,
      p_import_origin: null,
    });
  }
}

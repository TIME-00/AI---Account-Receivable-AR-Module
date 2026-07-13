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
import {
  fxPostingEligibility,
  isBaseValueAvailable,
  withOptionalReadEnrichment,
} from '../_shared/fx-read-contracts.ts';
import type { MonetaryCollectionSummary } from '../reports/monetary-contracts.ts';

export interface CreateReceiptOptions {
  importOrigin?: Record<string, unknown>;
}

interface FxDecisionSummaryRow {
  id: string;
  source_category: string;
  approval_status: string;
  lifecycle_status: string;
  decision_version: number;
  root_decision_id: string;
  supersedes_decision_id: string | null;
  import_origin: Record<string, unknown> | null;
  booked_rate: number;
  deviation_pct: number | null;
  stale_reference: boolean;
}

// ─── Receipt Service ────────────────────────────────────────────────────────

export class ReceiptService {
  private client: SupabaseClient;
  private readClient: SupabaseClient | null;
  private jeService: JournalEntryService;

  /**
   * @param client Trusted mutation client.
   * @param readClient JWT-scoped authenticated client, or null for mutation-only composition.
   */
  constructor(client?: SupabaseClient, readClient: SupabaseClient | null = null) {
    this.client = client ?? getAdminClient();
    this.readClient = readClient;
    this.jeService = new JournalEntryService(this.client);
  }

  /** Require the caller's JWT-scoped client for every user-domain read. */
  private requireReadClient(): SupabaseClient {
    if (!this.readClient) {
      throw new Error('Authenticated read client is required for receipt user-domain reads.');
    }
    return this.readClient;
  }

  private readScopeMode(auth: AuthContext): 'company' | 'assigned' {
    return auth.roles.some(role => ['AR Supervisor', 'Finance Manager', 'Auditor'].includes(role))
      ? 'company'
      : 'assigned';
  }

  private collectionReadParams(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
  ): Record<string, unknown> {
    return {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_scope_mode: this.readScopeMode(auth),
      p_status: filters.status ?? null,
      p_customer_id: filters.customer_id ?? null,
      p_payment_method: filters.payment_method ?? null,
      p_posting_period: filters.posting_period ?? null,
      p_date_from: filters.date_from ?? null,
      p_date_to: filters.date_to ?? null,
      p_search: filters.search ?? null,
    };
  }

  private async getAuthoritativeCollection(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<{ rows: Receipt[]; total: number; summary: MonetaryCollectionSummary }> {
    const readClient = this.requireReadClient();
    const { data, error } = await readClient.rpc('ar_receipt_collection', {
      ...this.collectionReadParams(auth, filters),
      p_page: pagination.page,
      p_page_size: pagination.page_size,
    });
    if (error) throw new Error(`Failed to list receipts: ${error.message}`);
    if (!data || typeof data !== 'object') throw new Error('Failed to list receipts: invalid RPC response');
    const result = data as { rows?: Receipt[]; total?: number; summary?: MonetaryCollectionSummary };
    if (!result.summary || typeof result.summary !== 'object') {
      throw new Error('Failed to list receipts: missing authoritative summary');
    }
    return {
      rows: result.rows ?? [],
      total: Number(result.total ?? 0),
      summary: result.summary,
    };
  }

  private async getReadableCustomerIds(auth: AuthContext): Promise<string[]> {
    const visibleCustomerIds = await getVisibleCustomerIds(this.client, auth.companyId);
    if (visibleCustomerIds.length === 0) return [];

    const fullAccessRoles = ['AR Supervisor', 'Finance Manager', 'Auditor'];
    if (auth.roles.some(role => fullAccessRoles.includes(role))) {
      return visibleCustomerIds;
    }

    const { data, error } = await this.client
      .from('user_customer_assignments')
      .select('customer_id')
      .eq('user_id', auth.userId)
      .eq('company_id', auth.companyId)
      .eq('is_active', true)
      .in('customer_id', visibleCustomerIds);

    if (error) throw new Error(`Failed to fetch customer assignments: ${error.message}`);
    return (data ?? []).map((row: { customer_id: string }) => row.customer_id);
  }

  private async requireWritableCustomer(auth: AuthContext, customerId: string): Promise<void> {
    const readableCustomerIds = await this.getReadableCustomerIds(auth);
    if (!readableCustomerIds.includes(customerId)) {
      throw new NotFoundError('Customer', customerId);
    }
  }

  private async attachFxDecisionReadSummary<T extends Receipt>(
    companyId: string,
    receipts: T[],
  ): Promise<T[]> {
    const readClient = this.requireReadClient();
    const decisionIds = [...new Set(receipts.map(rct => rct.fx_decision_id).filter((id): id is string => Boolean(id)))];
    if (decisionIds.length === 0) {
      return receipts.map(rct => ({
        ...rct,
        base_available: isBaseValueAvailable(rct.base_amount),
        fx_posting_eligibility: { gate: 'fx_governance', eligible: false, reason: 'missing_decision' },
        fx_decision: null,
      }));
    }

    const { data, error } = await readClient
      .from('fx_booking_rate_decisions')
      .select('id, source_category, approval_status, lifecycle_status, decision_version, root_decision_id, supersedes_decision_id, import_origin, booked_rate, deviation_pct, stale_reference')
      .eq('company_id', companyId)
      .in('id', decisionIds);

    if (error) throw new Error(`Failed to fetch receipt FX decision summaries: ${error.message}`);

    const decisionRows = (data ?? []) as FxDecisionSummaryRow[];
    const decisions = new Map<string, FxDecisionSummaryRow>(
      decisionRows.map((decision: FxDecisionSummaryRow) => [String(decision.id), decision]),
    );

    return receipts.map(rct => {
      const decision = rct.fx_decision_id ? decisions.get(rct.fx_decision_id) : null;
      const fxGate = fxPostingEligibility(decision ? {
        source_category: String(decision.source_category),
        approval_status: String(decision.approval_status),
        lifecycle_status: String(decision.lifecycle_status),
        stale_reference: Boolean(decision.stale_reference),
      } : null);

      return {
        ...rct,
        base_available: isBaseValueAvailable(rct.base_amount),
        fx_posting_eligibility: fxGate,
        fx_decision: decision ? {
          id: String(decision.id),
          source_category: String(decision.source_category),
          approval_status: String(decision.approval_status),
          lifecycle_status: String(decision.lifecycle_status),
          decision_version: Number(decision.decision_version),
          root_decision_id: String(decision.root_decision_id),
          supersedes_decision_id: decision.supersedes_decision_id ? String(decision.supersedes_decision_id) : null,
          import_origin: (decision.import_origin ?? null) as Record<string, unknown> | null,
          booked_rate: Number(decision.booked_rate),
          deviation_pct: decision.deviation_pct === null ? null : Number(decision.deviation_pct),
          stale_reference: Boolean(decision.stale_reference),
          fx_posting_eligible: fxGate.eligible,
        } : null,
      };
    });
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
    options: CreateReceiptOptions = {},
  ): Promise<Receipt> {
    requireRole(auth, 'AR Clerk');
    await this.requireWritableCustomer(auth, data.customer_id);

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

    const receiptPayload = {
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
      remarks: data.remarks ?? null,
    };

    let receiptId: string;
    try {
      const rpcArgs: Record<string, unknown> = {
        p_company_id: auth.companyId,
        p_actor_user_id: auth.userId,
        p_receipt: receiptPayload,
        p_explicit_rate_supplied: data.exchange_rate !== undefined,
        p_override_reason: data.fx_override_reason ?? null,
      };
      if (options.importOrigin !== undefined) {
        rpcArgs.p_import_origin = options.importOrigin;
      }
      receiptId = await callRpc<string>(this.client, 'fx_create_governed_receipt_draft', rpcArgs);
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        throw new BusinessError('DUPLICATE_RECEIPT', `Receipt number ${receiptNo} already exists. Please retry.`, 409);
      }
      throw error;
    }

    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    if (!this.readClient) return receipt;
    return await withOptionalReadEnrichment(
      receipt,
      async () => {
        const [enriched] = await this.attachFxDecisionReadSummary(auth.companyId, [receipt]);
        return enriched;
      },
    );
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
    const readClient = this.requireReadClient();
    const receipt = await fetchById<Receipt>(readClient, 'receipts', receiptId);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);
    await assertCustomerVisible(readClient, auth.companyId, receipt.customer_id);
    const [enriched] = await this.attachFxDecisionReadSummary(auth.companyId, [receipt]);
    return enriched;
  }

  async listReceipts(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<{ receipts: Receipt[]; total: number; summary: MonetaryCollectionSummary }> {
    requireOperationalReadRole(auth);
    const collection = await this.getAuthoritativeCollection(auth, filters, pagination);

    const receipts = await this.attachFxDecisionReadSummary(auth.companyId, collection.rows);
    return { receipts, total: collection.total, summary: collection.summary };
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
    const readClient = this.requireReadClient();
    await assertCustomerVisible(readClient, auth.companyId, customerId);

    const { data, error } = await readClient
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

  async updateDraftReceiptFx(
    auth: AuthContext,
    receiptId: string,
    input: {
      currency?: string;
      receipt_date?: string;
      exchange_rate?: number;
      fx_override_reason?: string;
    },
  ): Promise<Receipt> {
    requireRole(auth, 'AR Clerk');
    validateUUID(receiptId, 'id');
    const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
    if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);
    if (receipt.status !== 'Draft') {
      throw new ValidationError('Only Draft receipts can have governed FX edits.', {
        receipt_id: receiptId,
        status: receipt.status,
      });
    }
    await requireCustomerAccess(auth, receipt.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, receipt.customer_id);

    const nextCurrency = input.currency ?? receipt.currency;
    const nextDate = input.receipt_date ?? receipt.receipt_date;
    const nextRate = input.exchange_rate ?? await this.resolveExchangeRate(auth.companyId, nextCurrency, nextDate);

    await callRpc<string>(getAdminClient(), 'fx_update_governed_receipt_fx', {
      p_company_id: auth.companyId,
      p_receipt_id: receiptId,
      p_actor_user_id: auth.userId,
      p_currency: nextCurrency,
      p_receipt_date: nextDate,
      p_exchange_rate: nextRate,
      p_explicit_rate_supplied: input.exchange_rate !== undefined,
      p_override_reason: input.fx_override_reason ?? null,
    });

    return await fetchById<Receipt>(this.client, 'receipts', receiptId);
  }
}

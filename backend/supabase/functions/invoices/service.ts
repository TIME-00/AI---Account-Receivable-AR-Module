// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Invoice Management Service
// Implements ALL business rules from PRD Part 2 (BR-INV, BR-TAX, etc.)
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
import { validateMaxLength, validateUUID } from '../_shared/validators.ts';
import type {
  Invoice,
  InvoiceLine,
  Customer,
  InvoiceStatus,
  PaginationParams,
} from '../_shared/types.ts';
import { calculateLineAmount, calculateInvoiceTotals, roundTo2 } from './calculator.ts';
import type { CreateInvoiceInput, CreateInvoiceLineInput, PostInvoiceInput, CancelInvoiceInput } from './validators.ts';
import { CustomerService } from '../customers/service.ts';
import { assertCustomerVisible, getVisibleCustomerIds } from '../_shared/visibility.ts';
import {
  fxPostingEligibility,
  isBaseValueAvailable,
  withOptionalReadEnrichment,
} from '../_shared/fx-read-contracts.ts';
import type { MonetaryCollectionSummary } from '../reports/monetary-contracts.ts';

export interface CreateInvoiceOptions {
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

const LINKED_CREDIT_NOTE_REFERENCE_STATUSES: InvoiceStatus[] = [
  'Open',
  'Overdue',
  'Partially Paid',
];

// ─── Invoice Service ────────────────────────────────────────────────────────

export class InvoiceService {
  private client: SupabaseClient;
  private readClient: SupabaseClient | null;
  private customerService: CustomerService;

  /**
   * @param client Trusted mutation client.
   * @param readClient JWT-scoped authenticated client, or null for mutation-only composition.
   */
  constructor(client?: SupabaseClient, readClient: SupabaseClient | null = null) {
    this.client = client ?? getAdminClient();
    this.readClient = readClient;
    this.customerService = new CustomerService(this.client);
  }

  /**
   * User-domain reads must execute with the caller's authenticated client so
   * auth.uid(), RLS, and migration-027 EXECUTE privileges remain authoritative.
   * The trusted mutation client is deliberately never used as a fallback.
   */
  private requireReadClient(): SupabaseClient {
    if (!this.readClient) {
      throw new Error('Authenticated read client is required for invoice user-domain reads.');
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
      p_doc_type: filters.doc_type ?? null,
      p_status: filters.status ?? null,
      p_customer_id: filters.customer_id ?? null,
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
  ): Promise<{ rows: Invoice[]; total: number; summary: MonetaryCollectionSummary }> {
    const readClient = this.requireReadClient();
    const { data, error } = await readClient.rpc('ar_invoice_collection', {
      ...this.collectionReadParams(auth, filters),
      p_page: pagination.page,
      p_page_size: pagination.page_size,
    });
    if (error) throw new Error(`Failed to list invoices: ${error.message}`);
    if (!data || typeof data !== 'object') throw new Error('Failed to list invoices: invalid RPC response');
    const result = data as { rows?: Invoice[]; total?: number; summary?: MonetaryCollectionSummary };
    if (!result.summary || typeof result.summary !== 'object') {
      throw new Error('Failed to list invoices: missing authoritative summary');
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

  /**
   * Defense-in-depth validation for Credit/Debit Note creation and Draft FX
   * edits. Migration 028 remains the authoritative all-write-path boundary.
   * Invalid references deliberately share one non-disclosing public contract.
   */
  private async validateLinkedCreditNoteReference(
    data: Pick<CreateInvoiceInput, 'doc_type' | 'cn_type' | 'ref_invoice_id' | 'customer_id' | 'currency'>,
    companyId: string,
    documentId?: string,
  ): Promise<void> {
    if (data.doc_type === 'Debit Note') {
      if (data.cn_type || data.ref_invoice_id === documentId) {
        throw new BusinessError(
          'BR-DN-REF',
          'Debit Note reference is invalid or unavailable.',
          400,
          { field: 'ref_invoice_id' },
        );
      }
      if (!data.ref_invoice_id) return;

      const { data: referenceData, error } = await this.client
        .from('invoices')
        .select('id, company_id, customer_id, currency, doc_type, status')
        .eq('id', data.ref_invoice_id)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to validate Debit Note reference: ${error.message}`);
      }
      const reference = referenceData as Pick<
        Invoice,
        'id' | 'company_id' | 'customer_id' | 'currency' | 'doc_type' | 'status'
      > | null;
      const valid = reference !== null
        && ['Invoice', 'Credit Note'].includes(reference.doc_type)
        && reference.company_id === companyId
        && reference.customer_id === data.customer_id
        && reference.currency === data.currency
        && ['Open', 'Overdue', 'Partially Paid', 'Paid'].includes(reference.status);
      if (!valid) {
        throw new BusinessError(
          'BR-DN-REF',
          'Debit Note reference is invalid or unavailable.',
          400,
          { field: 'ref_invoice_id' },
        );
      }
      return;
    }

    if (data.doc_type !== 'Credit Note') {
      if (data.cn_type || data.ref_invoice_id) {
        throw new BusinessError(
          'BR-DOC-REF',
          'Financial document reference is invalid or unavailable.',
          400,
          { field: 'ref_invoice_id' },
        );
      }
      return;
    }

    if (data.cn_type !== 'Linked') {
      if (data.ref_invoice_id) {
        throw new BusinessError(
          'BR-CN-REF',
          'ref_invoice_id is only permitted for Linked Credit Notes.',
          400,
          { field: 'ref_invoice_id' },
        );
      }
      return;
    }

    if (!data.ref_invoice_id || data.ref_invoice_id === documentId) {
      throw new BusinessError(
        'BR-CN-REF',
        'Linked Credit Note reference is invalid or unavailable.',
        400,
        { field: 'ref_invoice_id' },
      );
    }

    const { data: referenceData, error } = await this.client
      .from('invoices')
      .select('id, company_id, customer_id, currency, doc_type, status')
      .eq('id', data.ref_invoice_id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to validate Linked Credit Note reference: ${error.message}`);
    }

    const reference = referenceData as Pick<
      Invoice,
      'id' | 'company_id' | 'customer_id' | 'currency' | 'doc_type' | 'status'
    > | null;
    const valid = reference !== null
      && reference.doc_type === 'Invoice'
      && reference.company_id === companyId
      && reference.customer_id === data.customer_id
      && reference.currency === data.currency
      && LINKED_CREDIT_NOTE_REFERENCE_STATUSES.includes(reference.status);

    if (!valid) {
      throw new BusinessError(
        'BR-CN-REF',
        'Linked Credit Note reference is invalid or unavailable.',
        400,
        { field: 'ref_invoice_id' },
      );
    }
  }

  private async attachFxDecisionReadSummary<T extends Invoice>(
    companyId: string,
    invoices: T[],
  ): Promise<T[]> {
    const readClient = this.requireReadClient();
    const decisionIds = [...new Set(invoices.map(inv => inv.fx_decision_id).filter((id): id is string => Boolean(id)))];
    if (decisionIds.length === 0) {
      return invoices.map(inv => ({
        ...inv,
        base_available: isBaseValueAvailable(inv.base_total),
        fx_posting_eligibility: { gate: 'fx_governance', eligible: false, reason: 'missing_decision' },
        fx_decision: null,
      }));
    }

    const { data, error } = await readClient
      .from('fx_booking_rate_decisions')
      .select('id, source_category, approval_status, lifecycle_status, decision_version, root_decision_id, supersedes_decision_id, import_origin, booked_rate, deviation_pct, stale_reference')
      .eq('company_id', companyId)
      .in('id', decisionIds);

    if (error) throw new Error(`Failed to fetch invoice FX decision summaries: ${error.message}`);

    const decisionRows = (data ?? []) as FxDecisionSummaryRow[];
    const decisions = new Map<string, FxDecisionSummaryRow>(
      decisionRows.map((decision: FxDecisionSummaryRow) => [String(decision.id), decision]),
    );

    return invoices.map(inv => {
      const decision = inv.fx_decision_id ? decisions.get(inv.fx_decision_id) : null;
      const fxGate = fxPostingEligibility(decision ? {
        source_category: String(decision.source_category),
        approval_status: String(decision.approval_status),
        lifecycle_status: String(decision.lifecycle_status),
        stale_reference: Boolean(decision.stale_reference),
      } : null);

      return {
        ...inv,
        base_available: isBaseValueAvailable(inv.base_total),
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

  private async resolveTaxRateForInvoiceLine(
    companyId: string,
    taxCodeId: string,
    invoiceDate: string,
  ): Promise<number> {
    const { data: taxCode, error } = await this.client
      .from('tax_codes')
      .select('rate')
      .eq('id', taxCodeId)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .lte('effective_from', invoiceDate)
      .or(`effective_to.is.null,effective_to.gte.${invoiceDate}`)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to validate tax code: ${error.message}`);
    }

    if (!taxCode) {
      throw new ValidationError('tax_code_id is not active, effective, or available for this company.', {
        field: 'tax_code_id',
      });
    }

    return Number(taxCode.rate);
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREATE INVOICE (Draft)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Create a new Draft invoice/CN/DN with optional line items.
   * PRD Part 2 §2.1-2.2
   */
  async createInvoice(
    auth: AuthContext,
    data: CreateInvoiceInput,
    lines?: CreateInvoiceLineInput[],
    options: CreateInvoiceOptions = {},
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    requireRole(auth, 'AR Clerk');
    await this.requireWritableCustomer(auth, data.customer_id);

    // Fetch customer for validation and snapshot
    const customer = await fetchById<Customer>(this.client, 'customers', data.customer_id);
    if (customer.company_id !== auth.companyId) throw new NotFoundError('Customer', data.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, customer.id);
    if (customer.is_deleted) throw new NotFoundError('Customer', data.customer_id);

    // BR-CUS-002: Blocked = no new transactions
    if (customer.status === 'Blocked') {
      throw BRErrors.CUS_002_BLOCKED(customer.customer_name);
    }

    // BR-CM-003: Rating D = frozen
    if (customer.credit_rating === 'D' && data.doc_type !== 'Credit Note') {
      throw BRErrors.CM_003_RATING_D_BLOCKED(customer.customer_name);
    }

    // BR-CUS-001: Inactive = no new invoices (but allow CN)
    if (customer.status === 'Inactive' && data.doc_type !== 'Credit Note') {
      throw BRErrors.CUS_001_INACTIVE(customer.customer_name);
    }

    await this.validateLinkedCreditNoteReference(data, auth.companyId);

    // Determine document sequence type
    const seqType = data.doc_type === 'Invoice' ? 'INV'
      : data.doc_type === 'Credit Note' ? 'CN' : 'DN';

    // Get company base currency
    const company = await fetchById<{ base_currency: string }>(this.client, 'companies', auth.companyId);
    const isBaseParity = data.currency === company.base_currency;

    if (isBaseParity && data.fx_reference_rate_id !== undefined) {
      throw new ValidationError(
        'Base-currency documents must not select an FX reference rate.',
        {
          field: 'fx_reference_rate_id',
          currency: data.currency,
          base_currency: company.base_currency,
        },
      );
    }
    if (isBaseParity && data.exchange_rate !== undefined && data.exchange_rate !== 1) {
      throw new ValidationError(
        'Base-currency documents require an exchange rate of exactly 1.',
        { field: 'exchange_rate', expected: 1 },
      );
    }

    // Reference-selected booking is resolved and snapshotted atomically by the
    // database wrapper. Rate 1 is only a transient payload placeholder and is
    // never committed for a valid foreign reference selection.
    const exchangeRate = isBaseParity
      ? 1
      : data.fx_reference_rate_id !== undefined
      ? 1
      : data.exchange_rate ?? await this.resolveExchangeRate(
        auth.companyId,
        data.currency,
        data.invoice_date,
      );

    // Consume the governed sequence only after all request-side FX checks pass.
    const invoiceNo = await getNextSequence(this.client, auth.companyId, seqType);

    const lineRows: Record<string, unknown>[] = [];
    if (lines && lines.length > 0) {
      let nextLineNo = 10;
      for (const line of lines) {
        let taxRate = 0;
        if (line.tax_code_id) {
          taxRate = await this.resolveTaxRateForInvoiceLine(
            auth.companyId,
            line.tax_code_id,
            data.invoice_date,
          );
        }

        const calc = calculateLineAmount({
          quantity: line.quantity,
          unit_price: line.unit_price,
          discount_pct: line.discount_pct ?? 0,
          discount_amt: line.discount_amt ?? 0,
          tax_rate: taxRate,
        });

        lineRows.push({
          line_no: nextLineNo,
          description: line.description,
          item_code: line.item_code ?? null,
          product_id: line.product_id ?? null,
          quantity: line.quantity,
          uom: line.uom ?? null,
          unit_price: line.unit_price,
          discount_pct: line.discount_pct ?? 0,
          discount_amt: line.discount_amt ?? 0,
          line_amount: calc.line_amount,
          tax_code_id: line.tax_code_id ?? null,
          tax_rate: taxRate,
          tax_amount: calc.tax_amount,
          line_total: calc.line_total,
          gl_account_id: line.gl_account_id ?? null,
          cost_center: line.cost_center ?? null,
          line_remarks: line.line_remarks ?? null,
        });

        nextLineNo += 10;
      }
    }

    const totals = calculateInvoiceTotals(
      lineRows as Array<{ line_amount: number; tax_amount: number }>,
      exchangeRate,
    );

    const invoicePayload: Record<string, unknown> = {
      invoice_no: invoiceNo,
      doc_type: data.doc_type,
      invoice_date: data.invoice_date,
      customer_id: data.customer_id,
      customer_name: customer.customer_name,  // Snapshot (BR-INV-SNAPSHOT)
      currency: data.currency,
      exchange_rate: exchangeRate,
      base_currency: company.base_currency,
      subtotal: totals.subtotal,
      tax_total: totals.tax_total,
      total_amount: totals.total_amount,
      base_total: totals.base_total,
      reference_no: data.reference_no ?? null,
      internal_remarks: data.internal_remarks ?? null,
      invoice_remarks: data.invoice_remarks ?? null,
      // CN-specific
      ref_invoice_id: data.ref_invoice_id ?? null,
      cn_type: data.cn_type ?? null,
      reason_code: data.reason_code ?? null,
      reason_desc: data.reason_desc ?? null,
    };

    let invoiceId: string;
    try {
      const rpcArgs: Record<string, unknown> = {
        p_company_id: auth.companyId,
        p_actor_user_id: auth.userId,
        p_invoice: invoicePayload,
        p_import_origin: options.importOrigin ?? null,
        p_lines: lineRows,
        p_explicit_rate_supplied: data.exchange_rate !== undefined,
        p_override_reason: data.fx_override_reason ?? null,
        p_fx_reference_rate_id: data.fx_reference_rate_id ?? null,
      };
      invoiceId = await callRpc<string>(this.client, 'fx_create_governed_invoice_draft', rpcArgs);
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        throw new BusinessError('DUPLICATE_INVOICE', `Invoice number ${invoiceNo} already exists. Please retry.`, 409);
      }
      throw error;
    }

    const result = await fetchById<Invoice>(this.client, 'invoices', invoiceId);
    const { data: createdLines, error: linesError } = await this.client
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('line_no');
    if (linesError) throw new Error(`Failed to fetch created invoice lines: ${linesError.message}`);

    const committed = { ...result, lines: (createdLines ?? []) as InvoiceLine[] };
    if (!this.readClient) return committed;
    return await withOptionalReadEnrichment(
      committed,
      async () => {
        const [enriched] = await this.attachFxDecisionReadSummary(auth.companyId, [result]);
        return { ...enriched, lines: (createdLines ?? []) as InvoiceLine[] };
      },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // ADD / UPDATE / DELETE LINE ITEMS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Add line items to a Draft invoice.
   */
  async addLines(
    auth: AuthContext,
    invoiceId: string,
    lines: CreateInvoiceLineInput[],
    exchangeRate?: number,
  ): Promise<InvoiceLine[]> {
    requireRole(auth, 'AR Clerk');
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);
    const rate = exchangeRate ?? invoice.exchange_rate;

    const insertRows: Record<string, unknown>[] = [];

    for (const line of lines) {
      // Resolve tax rate from tax_code_id
      let taxRate = 0;
      if (line.tax_code_id) {
        taxRate = await this.resolveTaxRateForInvoiceLine(
          auth.companyId,
          line.tax_code_id,
          invoice.invoice_date,
        );
      }

      // Calculate amounts (BR-INV-CALC-001/002/003)
      const calc = calculateLineAmount({
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount_pct: line.discount_pct ?? 0,
        discount_amt: line.discount_amt ?? 0,
        tax_rate: taxRate,
      });

      insertRows.push({
        invoice_id: invoiceId,
        description: line.description,
        item_code: line.item_code ?? null,
        product_id: line.product_id ?? null,
        quantity: line.quantity,
        uom: line.uom ?? null,
        unit_price: line.unit_price,
        discount_pct: line.discount_pct ?? 0,
        discount_amt: line.discount_amt ?? 0,
        line_amount: calc.line_amount,
        tax_code_id: line.tax_code_id ?? null,
        tax_rate: taxRate,
        tax_amount: calc.tax_amount,
        line_total: calc.line_total,
        gl_account_id: line.gl_account_id ?? null,
        cost_center: line.cost_center ?? null,
        line_remarks: line.line_remarks ?? null,
      });
    }

    void rate;
    return await callRpc<InvoiceLine[]>(this.client, 'add_draft_invoice_lines', {
      p_invoice_id: invoiceId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
      p_lines: insertRows,
    });
  }

  /**
   * Update a single line item.
   */
  async updateLine(
    auth: AuthContext,
    invoiceId: string,
    lineId: string,
    data: Partial<CreateInvoiceLineInput>,
  ): Promise<InvoiceLine> {
    requireRole(auth, 'AR Clerk');
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);

    const line = await this.fetchInvoiceLineOrThrow(lineId);
    if (line.invoice_id !== invoiceId) throw new NotFoundError('InvoiceLine', lineId);

    // Build update payload with recalculation
    const newQuantity = data.quantity ?? line.quantity;
    const newUnitPrice = data.unit_price ?? line.unit_price;
    const newDiscPct = data.discount_pct ?? line.discount_pct;
    const newDiscAmt = data.discount_amt ?? line.discount_amt;

    // Resolve tax rate
    let taxRate = line.tax_rate;
    if (data.tax_code_id !== undefined) {
      if (data.tax_code_id) {
        taxRate = await this.resolveTaxRateForInvoiceLine(
          auth.companyId,
          data.tax_code_id,
          invoice.invoice_date,
        );
      } else {
        taxRate = 0;
      }
    }

    const calc = calculateLineAmount({
      quantity: newQuantity,
      unit_price: newUnitPrice,
      discount_pct: newDiscPct,
      discount_amt: newDiscAmt,
      tax_rate: taxRate,
    });

    const updatePayload: Record<string, unknown> = {
      ...data,
      line_amount: calc.line_amount,
      tax_rate: taxRate,
      tax_amount: calc.tax_amount,
      line_total: calc.line_total,
    };

    // Remove undefined keys
    Object.keys(updatePayload).forEach(key => {
      if (updatePayload[key] === undefined) delete updatePayload[key];
    });

    return await callRpc<InvoiceLine>(this.client, 'update_draft_invoice_line', {
      p_invoice_id: invoiceId,
      p_line_id: lineId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
      p_changes: updatePayload,
    });
  }

  /**
   * Delete a line item from a Draft invoice.
   */
  async deleteLine(auth: AuthContext, invoiceId: string, lineId: string): Promise<void> {
    requireRole(auth, 'AR Clerk');
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);

    const line = await this.fetchInvoiceLineOrThrow(lineId);
    if (line.invoice_id !== invoiceId) throw new NotFoundError('InvoiceLine', lineId);

    await callRpc(this.client, 'delete_draft_invoice_line', {
      p_invoice_id: invoiceId,
      p_line_id: lineId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // POST INVOICE (Core Business Logic)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Post a Draft invoice to Open status (BR-INV-002).
   * This is the most critical function — implements ALL pre-posting checks.
   *
   * Pre-posting checklist:
   * 1. Invoice must be in Draft status
   * 2. At least 1 line item required
   * 3. Customer must be Active or On Hold
   * 4. Customer credit check (BR-CM-001)
   * 5. Fiscal period must be Open (BR-JE-007)
   * 6. Invoice date validation (BR-INV-002)
   * 7. Tax codes must be valid and effective (BR-TAX-003)
   * 8. Total amounts must be consistent
   *
   * On success:
   * - Status → Open
   * - due_date calculated from payment terms
   * - Posting timestamp recorded
   * - Journal entry generated (Dr. AR, Cr. Revenue + Tax)
   * - outstanding = total_amount
   */
  async postInvoice(
    auth: AuthContext,
    invoiceId: string,
    input: PostInvoiceInput = {},
  ): Promise<Invoice & { je_no?: string }> {
    requireRole(auth, 'AR Clerk');
    validateUUID(invoiceId, 'id');
    void input;

    const adminClient = getAdminClient();
    const { data: invoice, error: invoiceFetchError } = await adminClient
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();

    if (invoiceFetchError) {
      throw new Error(`Failed to fetch invoices(${invoiceId}): ${invoiceFetchError.message}`);
    }
    if (!invoice) {
      throw new NotFoundError('Invoice', invoiceId);
    }

    if (invoice.company_id !== auth.companyId) throw new NotFoundError('Invoice', invoiceId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);

    const rpcResult = await callRpc<{ je_no?: string }>(adminClient, 'post_invoice', {
      p_invoice_id: invoiceId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
    });

    const postedInvoice = await fetchById<Invoice>(adminClient, 'invoices', invoiceId);
    return { ...postedInvoice, je_no: rpcResult?.je_no };
  }

  // ════════════════════════════════════════════════════════════════════════

  // CANCEL INVOICE (BR-INV-003)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Cancel an invoice.
   * Requirements:
   * - Must be Open status (BR-INV-003)
   * - Cannot have allocation records
   * - outstanding must equal total_amount (no partial payments)
   * - Cancel reason required (min 10 chars)
   * - Generates a reversal journal entry
   * - Invoice number is NOT recycled
   */
  async cancelInvoice(
    auth: AuthContext,
    invoiceId: string,
    input: CancelInvoiceInput,
  ): Promise<Invoice> {
    requireRole(auth, 'AR Supervisor');
    validateUUID(invoiceId, 'id');

    const invoice = await this.fetchInvoiceOrThrow(invoiceId);
    if (invoice.company_id !== auth.companyId) throw new NotFoundError('Invoice', invoiceId);

    // Migration 028 keeps every cancellation precondition, reversal journal,
    // status mutation, caller authorization, assignment scope, and customer
    // visibility check in one PostgreSQL transaction. The governed RPC remains
    // the authoritative financial mutation boundary.
    return await callRpc<Invoice>(this.client, 'cancel_invoice', {
      p_invoice_id: invoiceId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
      p_cancel_reason: input.cancel_reason,
      p_expected_version: invoice.version,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET / LIST INVOICES
  // ════════════════════════════════════════════════════════════════════════

  async getInvoiceById(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    requireOperationalReadRole(auth);
    validateUUID(invoiceId, 'id');
    const readClient = this.requireReadClient();

    // A caller-scoped lookup intentionally makes a nonexistent invoice and an
    // RLS-hidden invoice indistinguishable. `maybeSingle()` returns a clean
    // null for both cases; genuine PostgREST/database errors remain failures.
    const { data: invoiceData, error: invoiceError } = await readClient
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();

    if (invoiceError) {
      throw new Error(`Failed to fetch invoice(${invoiceId}): ${invoiceError.message}`);
    }
    if (!invoiceData) throw new NotFoundError('Invoice', invoiceId);

    const invoice = invoiceData as Invoice;
    if (invoice.company_id !== auth.companyId) throw new NotFoundError('Invoice', invoiceId);

    await assertCustomerVisible(readClient, auth.companyId, invoice.customer_id);

    const { data: lines, error: linesError } = await readClient
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('line_no');

    if (linesError) {
      throw new Error(`Failed to fetch invoice lines for invoice(${invoiceId}): ${linesError.message}`);
    }

    const [enriched] = await this.attachFxDecisionReadSummary(auth.companyId, [invoice]);
    return { ...enriched, lines: (lines ?? []) as InvoiceLine[] };
  }

  async listInvoices(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<{ invoices: Invoice[]; total: number; summary: MonetaryCollectionSummary }> {
    requireOperationalReadRole(auth);
    const collection = await this.getAuthoritativeCollection(auth, filters, pagination);

    const invoices = await this.attachFxDecisionReadSummary(auth.companyId, collection.rows);
    return { invoices, total: collection.total, summary: collection.summary };
  }

  /**
   * Get a single Draft invoice, or throw.
   */
  async updateDraftInvoice(
    auth: AuthContext,
    invoiceId: string,
    data: Partial<CreateInvoiceInput>,
  ): Promise<Invoice> {
    requireRole(auth, 'AR Clerk');
    if ('base_total' in data) {
      throw new ValidationError(
        'base_total is server-calculated and must not be supplied.',
        { field: 'base_total' },
      );
    }
    if (
      data.fx_reference_rate_id !== undefined
      && (data.exchange_rate !== undefined || data.fx_override_reason !== undefined)
    ) {
      throw new ValidationError(
        'fx_reference_rate_id cannot be combined with exchange_rate or fx_override_reason.',
        {
          field: 'fx_reference_rate_id',
          conflicting_fields: ['exchange_rate', 'fx_override_reason'],
        },
      );
    }
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await this.requireWritableCustomer(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);

    const updatePayload: Record<string, unknown> = {};
    if (data.invoice_date !== undefined) updatePayload.invoice_date = data.invoice_date;
    if (data.reference_no !== undefined) updatePayload.reference_no = data.reference_no;
    if (data.internal_remarks !== undefined) updatePayload.internal_remarks = data.internal_remarks;
    if (data.invoice_remarks !== undefined) updatePayload.invoice_remarks = data.invoice_remarks;
    const nextCurrency = data.currency ?? invoice.currency;
    const nextDate = data.invoice_date ?? invoice.invoice_date;
    const isBaseParity = nextCurrency === invoice.base_currency;
    const fxMaterialChange = data.currency !== undefined
      || data.invoice_date !== undefined
      || data.exchange_rate !== undefined
      || data.fx_reference_rate_id !== undefined;

    if (isBaseParity && data.fx_reference_rate_id !== undefined) {
      throw new ValidationError(
        'Base-currency documents must not select an FX reference rate.',
        {
          field: 'fx_reference_rate_id',
          currency: nextCurrency,
          base_currency: invoice.base_currency,
        },
      );
    }
    if (isBaseParity && data.exchange_rate !== undefined && data.exchange_rate !== 1) {
      throw new ValidationError(
        'Base-currency documents require an exchange rate of exactly 1.',
        { field: 'exchange_rate', expected: 1 },
      );
    }

    if (data.currency !== undefined) updatePayload.currency = data.currency;
    if (data.exchange_rate !== undefined) {
      updatePayload.exchange_rate = data.exchange_rate;
    } else if (
      data.fx_reference_rate_id === undefined
      && (data.currency !== undefined || data.invoice_date !== undefined)
    ) {
      updatePayload.exchange_rate = await this.resolveExchangeRate(auth.companyId, nextCurrency, nextDate);
    }
    if (data.fx_reference_rate_id !== undefined) {
      updatePayload.fx_reference_rate_id = data.fx_reference_rate_id;
    }
    if (data.reason_code !== undefined) updatePayload.reason_code = data.reason_code;
    if (data.reason_desc !== undefined) updatePayload.reason_desc = data.reason_desc;

    if (
      data.currency !== undefined
      && (
        (invoice.doc_type === 'Credit Note' && invoice.cn_type === 'Linked')
        || (invoice.doc_type === 'Debit Note' && invoice.ref_invoice_id)
      )
    ) {
      await this.validateLinkedCreditNoteReference({
        doc_type: invoice.doc_type,
        cn_type: invoice.cn_type ?? undefined,
        ref_invoice_id: invoice.ref_invoice_id ?? undefined,
        customer_id: invoice.customer_id,
        currency: nextCurrency,
      }, auth.companyId, invoice.id);
    }

    if (fxMaterialChange) {
      updatePayload.fx_explicit_rate_supplied = data.exchange_rate !== undefined;
      updatePayload.fx_override_reason = data.fx_override_reason ?? null;
    }

    if (Object.keys(updatePayload).length === 0) return invoice;
    return await callRpc<Invoice>(this.client, 'update_draft_invoice', {
      p_invoice_id: invoiceId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
      p_changes: updatePayload,
    });
  }

  /**
   * Correct only the external reference of an already-posted Invoice-family
   * document. Migration 028 independently locks and authorizes the target and
   * writes immutable audit evidence; no trusted table UPDATE is composed here.
   */
  async correctPostedReference(
    auth: AuthContext,
    invoiceId: string,
    referenceNo: string | null,
  ): Promise<Invoice> {
    requireRole(auth, 'AR Clerk');
    validateUUID(invoiceId, 'id');
    if (referenceNo !== null) {
      if (referenceNo.trim().length === 0) {
        throw new ValidationError('reference_no must be non-blank or null');
      }
      validateMaxLength(referenceNo, 50, 'reference_no');
    }

    return await callRpc<Invoice>(this.client, 'correct_posted_invoice_reference', {
      p_invoice_id: invoiceId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
      p_reference_no: referenceNo,
    });
  }

  /**
   * Delete a Draft invoice and its lines.
   */
  async deleteDraftInvoice(auth: AuthContext, invoiceId: string): Promise<void> {
    requireRole(auth, 'AR Clerk');
    validateUUID(invoiceId, 'id');
    await callRpc(this.client, 'delete_draft_invoice', {
      p_invoice_id: invoiceId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Fetch and validate that invoice is in Draft status.
   */
  private async requireDraftInvoice(invoiceId: string, companyId: string): Promise<Invoice> {
    validateUUID(invoiceId, 'id');
    const invoice = await this.fetchInvoiceOrThrow(invoiceId);
    if (invoice.company_id !== companyId) throw new NotFoundError('Invoice', invoiceId);
    if (invoice.status !== 'Draft') {
      throw BRErrors.INV_001_IMMUTABLE('status');
    }
    return invoice;
  }

  /**
   * Fetch an invoice while preserving the distinction between an absent row
   * (404) and an unexpected database/query failure (500).
   */
  private async fetchInvoiceOrThrow(invoiceId: string): Promise<Invoice> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch invoices(${invoiceId}): ${error.message}`);
    }
    if (!data) {
      throw new NotFoundError('Invoice', invoiceId);
    }

    return data as Invoice;
  }

  /**
   * Fetch an invoice line with the same missing-row semantics as invoices.
   */
  private async fetchInvoiceLineOrThrow(lineId: string): Promise<InvoiceLine> {
    validateUUID(lineId, 'line_id');
    const { data, error } = await this.client
      .from('invoice_lines')
      .select('*')
      .eq('id', lineId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch invoice_lines(${lineId}): ${error.message}`);
    }
    if (!data) {
      throw new NotFoundError('InvoiceLine', lineId);
    }

    return data as InvoiceLine;
  }

  /**
   * Resolve exchange rate from the exchange_rates table.
   * Uses the most recent rate <= invoice_date (BR-INV-007).
   */
  private async resolveExchangeRate(
    companyId: string,
    currency: string,
    invoiceDate: string,
  ): Promise<number> {
    // Same currency = rate 1.0
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
      .lte('effective_date', invoiceDate)
      .order('effective_date', { ascending: false })
      .limit(1)
      .single();

    if (!rate) {
      throw new ValidationError(
        `Exchange rate not found for ${currency} → ${company?.base_currency} on ${invoiceDate}. Please maintain the exchange rate table.`,
        { from_currency: currency, to_currency: company?.base_currency, date: invoiceDate },
      );
    }

    return Number(rate.rate);
  }

  /**
   * Apply Linked Credit Note deduction to original invoice (BR-CN-003).
   * Called during CN posting.
   */
  private async applyLinkedCNDeduction(
    refInvoiceId: string,
    cnAmount: number,
    cnId: string,
    userId: string,
  ): Promise<void> {
    const refInvoice = await fetchById<Invoice>(this.client, 'invoices', refInvoiceId);

    // BR-CN-001: CN amount cannot exceed invoice outstanding
    if (cnAmount > refInvoice.outstanding) {
      throw BRErrors.CN_001_EXCEEDS_OUTSTANDING(cnAmount, refInvoice.outstanding, refInvoice.invoice_no);
    }

    // BR-CN-002: Check cumulative CN total
    const { data: existingCN } = await this.client
      .from('invoices')
      .select('total_amount')
      .eq('ref_invoice_id', refInvoiceId)
      .eq('doc_type', 'Credit Note')
      .eq('cn_type', 'Linked')
      .neq('status', 'Cancelled')
      .neq('id', cnId);  // Exclude current CN

    const cumulativeCN = (existingCN ?? []).reduce((s, c) => s + Number(c.total_amount), 0) + cnAmount;
    if (cumulativeCN > refInvoice.total_amount) {
      throw BRErrors.CN_002_CUMULATIVE_EXCEEDED(cumulativeCN, refInvoice.total_amount, refInvoice.invoice_no);
    }

    // Deduct from original invoice outstanding
    const newOutstanding = roundTo2(refInvoice.outstanding - cnAmount);
    let newStatus: InvoiceStatus = refInvoice.status;

    if (newOutstanding <= 0) {
      newStatus = 'Paid'; // Fully offset by CN
    } else if (newOutstanding < refInvoice.total_amount) {
      newStatus = 'Partially Paid';
    }

    await this.client
      .from('invoices')
      .update({
        outstanding: newOutstanding,
        status: newStatus,
        version: refInvoice.version + 1,
      })
      .eq('id', refInvoiceId)
      .eq('version', refInvoice.version);

    // Record CN allocation in cn_allocations table
    await this.client
      .from('cn_allocations')
      .insert({
        cn_id: cnId,
        invoice_id: refInvoiceId,
        allocated_amount: cnAmount,
        allocated_by: userId,
        status: 'Active',
      });
  }
}

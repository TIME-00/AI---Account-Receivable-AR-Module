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
  ConflictError,
  BRErrors,
  ValidationError,
} from '../_shared/errors.ts';
import { CONFIG_KEYS } from '../_shared/constants.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { requireRole, requireCustomerAccess, getCustomerAccessFilter } from '../_shared/auth.ts';
import { validateUUID } from '../_shared/validators.ts';
import type {
  Invoice,
  InvoiceLine,
  Customer,
  InvoiceStatus,
  PaginationParams,
} from '../_shared/types.ts';
import { calculateLineAmount, calculateInvoiceTotals, roundTo2 } from './calculator.ts';
import type { CreateInvoiceInput, CreateInvoiceLineInput, PostInvoiceInput, CancelInvoiceInput } from './validators.ts';
import { JournalEntryService } from '../journal-entries/service.ts';
import { CustomerService } from '../customers/service.ts';
import { assertCustomerVisible, getVisibleCustomerIds } from '../_shared/visibility.ts';

// ─── Invoice Service ────────────────────────────────────────────────────────

export class InvoiceService {
  private client: SupabaseClient;
  private jeService: JournalEntryService;
  private customerService: CustomerService;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
    this.jeService = new JournalEntryService(this.client);
    this.customerService = new CustomerService(this.client);
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
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    requireRole(auth, 'AR Clerk');
    await requireCustomerAccess(auth, data.customer_id);

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

    // Determine document sequence type
    const seqType = data.doc_type === 'Invoice' ? 'INV'
      : data.doc_type === 'Credit Note' ? 'CN' : 'DN';

    // Generate document number (BR-INV-006)
    const invoiceNo = await getNextSequence(this.client, auth.companyId, seqType);

    // Resolve exchange rate
    const exchangeRate = data.exchange_rate ?? await this.resolveExchangeRate(
      auth.companyId,
      data.currency,
      data.invoice_date,
    );

    // Get company base currency
    const company = await fetchById<{ base_currency: string }>(this.client, 'companies', auth.companyId);

    // Insert invoice header
    const insertData: Record<string, unknown> = {
      company_id: auth.companyId,
      invoice_no: invoiceNo,
      doc_type: data.doc_type,
      invoice_date: data.invoice_date,
      customer_id: data.customer_id,
      customer_name: customer.customer_name,  // Snapshot (BR-INV-SNAPSHOT)
      currency: data.currency,
      exchange_rate: exchangeRate,
      base_currency: company.base_currency,
      status: 'Draft',
      reference_no: data.reference_no ?? null,
      internal_remarks: data.internal_remarks ?? null,
      invoice_remarks: data.invoice_remarks ?? null,
      // CN-specific
      ref_invoice_id: data.ref_invoice_id ?? null,
      cn_type: data.cn_type ?? null,
      reason_code: data.reason_code ?? null,
      reason_desc: data.reason_desc ?? null,
      // Audit
      created_by: auth.userId,
      version: 1,
    };

    const { data: invoice, error } = await this.client
      .from('invoices')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new BusinessError('DUPLICATE_INVOICE', `Invoice number ${invoiceNo} already exists. Please retry.`, 409);
      }
      throw new Error(`Failed to create invoice: ${error.message}`);
    }

    try {
      // Insert lines if provided.
      let createdLines: InvoiceLine[] = [];
      if (lines && lines.length > 0) {
        createdLines = await this.addLines(auth, invoice.id, lines, exchangeRate);
        if (createdLines.length !== lines.length) {
          throw new Error(
            `Invoice line persistence mismatch: expected ${lines.length}, created ${createdLines.length}.`,
          );
        }
      }

      await this.recordBookingDecision(auth, invoice.id, data.exchange_rate !== undefined, data.fx_override_reason);

      // Re-fetch for updated totals.
      const result = await fetchById<Invoice>(this.client, 'invoices', invoice.id);
      return { ...result, lines: createdLines };
    } catch (error) {
      // The import row is linked only after this method returns. Clean up a
      // partially created draft here so callers cannot mark it Created.
      const { error: lineCleanupError } = await this.client
        .from('invoice_lines')
        .delete()
        .eq('invoice_id', invoice.id);
      const { error: invoiceCleanupError } = await this.client
        .from('invoices')
        .delete()
        .eq('id', invoice.id)
        .eq('status', 'Draft');

      if (lineCleanupError || invoiceCleanupError) {
        throw new Error(
          `Invoice creation failed and cleanup was incomplete: ${
            lineCleanupError?.message ?? invoiceCleanupError?.message
          }. Original error: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      throw error;
    }
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

    // Get current max line_no
    const { data: existingLines } = await this.client
      .from('invoice_lines')
      .select('line_no')
      .eq('invoice_id', invoiceId)
      .order('line_no', { ascending: false })
      .limit(1);

    let nextLineNo = (existingLines?.[0]?.line_no ?? 0) + 10;

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

    const { data: created, error } = await this.client
      .from('invoice_lines')
      .insert(insertRows)
      .select();

    if (error) throw new Error(`Failed to add invoice lines: ${error.message}`);

    // Recalculate header totals
    await this.recalculateTotals(invoiceId, rate);

    return (created ?? []) as InvoiceLine[];
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

    const { data: updated, error } = await this.client
      .from('invoice_lines')
      .update(updatePayload)
      .eq('id', lineId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update line: ${error.message}`);

    await this.recalculateTotals(invoiceId, invoice.exchange_rate);

    return updated as InvoiceLine;
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

    const { error } = await this.client
      .from('invoice_lines')
      .delete()
      .eq('id', lineId)
      .eq('invoice_id', invoiceId);

    if (error) throw new Error(`Failed to delete line: ${error.message}`);

    await this.recalculateTotals(invoiceId, invoice.exchange_rate);
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
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);

    // Only Open invoices can be cancelled
    if (invoice.status !== 'Open') {
      if (invoice.status === 'Partially Paid') {
        throw BRErrors.INV_004_PARTIALLY_PAID(invoice.invoice_no);
      }
      throw new BusinessError('BR-INV-003',
        `Only Open invoices can be cancelled. Current status: ${invoice.status}`, 400);
    }

    // Check no active allocations
    const { count: allocCount } = await this.client
      .from('allocation_details')
      .select('*', { count: 'exact', head: true })
      .eq('invoice_id', invoiceId)
      .eq('status', 'Active');

    if (allocCount && allocCount > 0) {
      throw BRErrors.INV_003_CANNOT_CANCEL(invoice.invoice_no);
    }

    // Check outstanding = total_amount (no partial payments via CN either)
    if (Math.abs(invoice.outstanding - invoice.total_amount) > 0.01) {
      throw BRErrors.INV_003_CANNOT_CANCEL(invoice.invoice_no);
    }

    // Generate reversal JE (BR-JE-004)
    const existingJEs = await this.jeService.findJEsBySourceDoc(invoiceId);
    const activeJE = existingJEs.find(je => !je.is_reversed);

    if (activeJE) {
      const postingPeriod = invoice.posting_period ?? invoice.invoice_date.slice(0, 7);
      await this.jeService.createReversalJE({
        company_id: auth.companyId,
        original_je_id: activeJE.id,
        reversal_date: new Date().toISOString().slice(0, 10),
        posting_period: postingPeriod,
        reason: input.cancel_reason,
        created_by: auth.userId,
      });
    }

    // Update invoice status
    const { data: cancelled, error } = await this.client
      .from('invoices')
      .update({
        status: 'Cancelled',
        outstanding: 0,
        cancelled_by: auth.userId,
        cancelled_at: new Date().toISOString(),
        cancel_reason: input.cancel_reason,
        version: invoice.version + 1,
      })
      .eq('id', invoiceId)
      .eq('version', invoice.version)
      .select()
      .single();

    if (error || !cancelled) {
      throw new ConflictError('Invoice was modified by another user during cancellation.');
    }

    return cancelled as Invoice;
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET / LIST INVOICES
  // ════════════════════════════════════════════════════════════════════════

  async getInvoiceById(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    validateUUID(invoiceId, 'id');

    const invoice = await this.fetchInvoiceOrThrow(invoiceId);
    if (invoice.company_id !== auth.companyId) throw new NotFoundError('Invoice', invoiceId);

    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);

    const { data: lines } = await this.client
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('line_no');

    return { ...invoice, lines: (lines ?? []) as InvoiceLine[] };
  }

  async listInvoices(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<{ invoices: Invoice[]; total: number }> {
    const visibleCustomerIds = await getVisibleCustomerIds(this.client, auth.companyId);
    const allowedCustomerIds = await getCustomerAccessFilter(auth);
    const scopedCustomerIds = allowedCustomerIds === null
      ? visibleCustomerIds
      : visibleCustomerIds.filter(id => allowedCustomerIds.includes(id));

    if (scopedCustomerIds.length === 0) return { invoices: [], total: 0 };

    let query = this.client
      .from('invoices')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .in('customer_id', scopedCustomerIds);

    // Apply filters
    if (filters.doc_type) query = query.eq('doc_type', filters.doc_type);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.customer_id) query = query.eq('customer_id', filters.customer_id);
    if (filters.posting_period) query = query.eq('posting_period', filters.posting_period);
    if (filters.date_from) query = query.gte('invoice_date', filters.date_from);
    if (filters.date_to) query = query.lte('invoice_date', filters.date_to);

    if (filters.search) {
      const s = `%${filters.search}%`;
      query = query.or(`invoice_no.ilike.${s},customer_name.ilike.${s},reference_no.ilike.${s}`);
    }

    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;
    query = query.order('invoice_date', { ascending: false }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list invoices: ${error.message}`);

    return { invoices: (data ?? []) as Invoice[], total: count ?? 0 };
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
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);

    const updatePayload: Record<string, unknown> = {};
    if (data.invoice_date !== undefined) updatePayload.invoice_date = data.invoice_date;
    if (data.reference_no !== undefined) updatePayload.reference_no = data.reference_no;
    if (data.internal_remarks !== undefined) updatePayload.internal_remarks = data.internal_remarks;
    if (data.invoice_remarks !== undefined) updatePayload.invoice_remarks = data.invoice_remarks;
    const nextCurrency = data.currency ?? invoice.currency;
    const nextDate = data.invoice_date ?? invoice.invoice_date;
    const fxMaterialChange = data.currency !== undefined
      || data.invoice_date !== undefined
      || data.exchange_rate !== undefined;

    if (data.currency !== undefined) updatePayload.currency = data.currency;
    if (data.exchange_rate !== undefined) {
      updatePayload.exchange_rate = data.exchange_rate;
    } else if (data.currency !== undefined || data.invoice_date !== undefined) {
      updatePayload.exchange_rate = await this.resolveExchangeRate(auth.companyId, nextCurrency, nextDate);
    }
    if (data.reason_code !== undefined) updatePayload.reason_code = data.reason_code;
    if (data.reason_desc !== undefined) updatePayload.reason_desc = data.reason_desc;

    if (fxMaterialChange) {
      const governedRate = Number(updatePayload.exchange_rate ?? invoice.exchange_rate);
      await callRpc<string>(getAdminClient(), 'fx_update_governed_invoice_fx', {
        p_company_id: auth.companyId,
        p_invoice_id: invoiceId,
        p_actor_user_id: auth.userId,
        p_currency: nextCurrency,
        p_invoice_date: nextDate,
        p_exchange_rate: governedRate,
        p_explicit_rate_supplied: data.exchange_rate !== undefined,
        p_override_reason: data.fx_override_reason ?? null,
      });

      const nonProtectedPayload = { ...updatePayload };
      delete nonProtectedPayload.currency;
      delete nonProtectedPayload.invoice_date;
      delete nonProtectedPayload.exchange_rate;
      if (Object.keys(nonProtectedPayload).length > 0) {
        const { error: nonProtectedError } = await this.client
          .from('invoices')
          .update(nonProtectedPayload)
          .eq('id', invoiceId);
        if (nonProtectedError) throw new Error(`Failed to update invoice: ${nonProtectedError.message}`);
      }
      return await this.fetchInvoiceOrThrow(invoiceId);
    }

    if (Object.keys(updatePayload).length === 0) return invoice;

    const { data: updated, error } = await this.client
      .from('invoices')
      .update(updatePayload)
      .eq('id', invoiceId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update invoice: ${error.message}`);

    return updated as Invoice;
  }

  /**
   * Delete a Draft invoice and its lines.
   */
  async deleteDraftInvoice(auth: AuthContext, invoiceId: string): Promise<void> {
    requireRole(auth, 'AR Clerk');
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(this.client, auth.companyId, invoice.customer_id);

    const { count: importReferenceCount, error: importReferenceError } = await this.client
      .from('import_rows')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_id', invoiceId);

    if (importReferenceError) {
      throw new Error(`Failed to check invoice import references: ${importReferenceError.message}`);
    }
    if ((importReferenceCount ?? 0) > 0) {
      throw new ConflictError(
        'Imported draft invoices are retained as import audit evidence and cannot be deleted. '
        + 'Post and cancel the invoice through the supported workflow when cleanup is required.',
      );
    }

    // Delete lines first (CASCADE should handle, but explicit is safer)
    await this.client.from('invoice_lines').delete().eq('invoice_id', invoiceId);
    const { error } = await this.client.from('invoices').delete().eq('id', invoiceId);
    if (error) throw new Error(`Failed to delete invoice: ${error.message}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Recalculate invoice header totals from line items.
   */
  private async recalculateTotals(invoiceId: string, exchangeRate: number): Promise<void> {
    const { data: lines } = await this.client
      .from('invoice_lines')
      .select('line_amount, tax_amount')
      .eq('invoice_id', invoiceId);

    const totals = calculateInvoiceTotals(lines ?? [], exchangeRate);

    await this.client
      .from('invoices')
      .update({
        subtotal: totals.subtotal,
        tax_total: totals.tax_total,
        total_amount: totals.total_amount,
        base_total: totals.base_total,
      })
      .eq('id', invoiceId);
  }

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

  private async recordBookingDecision(
    auth: AuthContext,
    invoiceId: string,
    explicitRateSupplied: boolean,
    overrideReason?: string,
  ): Promise<void> {
    await callRpc<string>(getAdminClient(), 'fx_record_booking_decision', {
      p_company_id: auth.companyId,
      p_transaction_type: 'invoice',
      p_transaction_id: invoiceId,
      p_actor_user_id: auth.userId,
      p_explicit_rate_supplied: explicitRateSupplied,
      p_source_category: null,
      p_fx_reference_rate_id: null,
      p_override_reason: overrideReason ?? null,
      p_import_origin: null,
    });
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

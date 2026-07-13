// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Credit Note Service
// Implements PRD Part 2 §3 (BR-CN-001 through BR-CN-003)
// ============================================================================

import { SupabaseClient } from 'supabase';
import {
  getAdminClient,
  fetchById,
} from '../_shared/db.ts';
import {
  BusinessError,
  NotFoundError,
  BRErrors,
  ValidationError,
} from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { validateUUID } from '../_shared/validators.ts';
import type {
  Invoice,
  InvoiceLine,
  PaginationParams,
} from '../_shared/types.ts';
import { InvoiceService } from '../invoices/service.ts';
import { JournalEntryService } from '../journal-entries/service.ts';
import type { CreateInvoiceInput, CreateInvoiceLineInput } from '../invoices/validators.ts';

// ─── Credit Note Service ────────────────────────────────────────────────────

export class CreditNoteService {
  private client: SupabaseClient;
  private readClient: SupabaseClient | null;
  private invoiceService: InvoiceService;
  private jeService: JournalEntryService;

  /** Trusted mutation client and optional JWT-scoped delegated read client. */
  constructor(client?: SupabaseClient, readClient: SupabaseClient | null = null) {
    this.client = client ?? getAdminClient();
    this.readClient = readClient;
    this.invoiceService = new InvoiceService(this.client, readClient);
    this.jeService = new JournalEntryService(this.client);
  }

  private requireReadClient(): SupabaseClient {
    if (!this.readClient) {
      throw new Error('Authenticated read client is required for credit-note user-domain reads.');
    }
    return this.readClient;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREATE CREDIT NOTE
  // ════════════════════════════════════════════════════════════════════════

  async createCreditNote(
    auth: AuthContext,
    data: CreateInvoiceInput,
    lines?: CreateInvoiceLineInput[],
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    // Ensure doc_type is Credit Note
    data.doc_type = 'Credit Note';

    // Validate Linked CN constraints
    if (data.cn_type === 'Linked') {
      if (!data.ref_invoice_id) {
        throw new ValidationError(
          'Linked Credit Note must specify ref_invoice_id (reference to original invoice).',
          { field: 'ref_invoice_id' },
        );
      }

      // Fetch and validate the referenced invoice
      const refInvoice = await fetchById<Invoice>(this.client, 'invoices', data.ref_invoice_id);

      // Validate ref invoice state
      if (refInvoice.doc_type !== 'Invoice' && refInvoice.doc_type !== 'Debit Note') {
        throw new ValidationError(
          'Linked CN can only reference an Invoice or Debit Note. Cannot reference another Credit Note.',
          { ref_doc_type: refInvoice.doc_type },
        );
      }

      if (!['Open', 'Overdue', 'Partially Paid'].includes(refInvoice.status)) {
        throw new BusinessError('BR-CN-REF',
          `Original invoice ${refInvoice.invoice_no} status is ${refInvoice.status}. Cannot issue Linked CN. Only Open/Overdue/Partially Paid are accepted.`,
          400, { ref_status: refInvoice.status });
      }

      // Customer must match
      if (refInvoice.customer_id !== data.customer_id) {
        throw new ValidationError(
          'Credit Note customer must match original invoice customer.',
          { cn_customer: data.customer_id, invoice_customer: refInvoice.customer_id },
        );
      }

      // Currency must match
      if (refInvoice.currency !== data.currency) {
        throw new ValidationError(
          'Linked Credit Note currency must match original invoice currency.',
          { cn_currency: data.currency, invoice_currency: refInvoice.currency },
        );
      }
    }

    // Delegate to InvoiceService for creation
    return this.invoiceService.createInvoice(auth, data, lines);
  }

  // ════════════════════════════════════════════════════════════════════════
  // POST CREDIT NOTE
  // ════════════════════════════════════════════════════════════════════════

  async postCreditNote(
    auth: AuthContext,
    cnId: string,
    input: { posting_period?: string } = {},
  ): Promise<Invoice & { je_no?: string }> {
    // Verify it's a CN
    const cn = await fetchById<Invoice>(this.client, 'invoices', cnId);
    if (cn.company_id !== auth.companyId) throw new NotFoundError('Credit Note', cnId);
    if (cn.doc_type !== 'Credit Note') {
      throw new ValidationError('This document is not a Credit Note.', { doc_type: cn.doc_type });
    }
    if (cn.status !== 'Draft') {
      throw new BusinessError('BR-CN-STATUS', `Only Draft Credit Notes can be posted. Current: ${cn.status}`, 400);
    }

    // ── Linked CN: Pre-posting amount validation ──
    if (cn.cn_type === 'Linked' && cn.ref_invoice_id) {
      const refInvoice = await fetchById<Invoice>(this.client, 'invoices', cn.ref_invoice_id);

      // Fetch lines to calculate total
      const { data: cnLines } = await this.client
        .from('invoice_lines')
        .select('line_amount, tax_amount')
        .eq('invoice_id', cnId);

      let cnTotal = 0;
      for (const line of (cnLines ?? [])) {
        cnTotal += Number(line.line_amount) + Number(line.tax_amount);
      }

      // BR-CN-001: Cannot exceed outstanding
      if (cnTotal > refInvoice.outstanding) {
        throw BRErrors.CN_001_EXCEEDS_OUTSTANDING(cnTotal, refInvoice.outstanding, refInvoice.invoice_no);
      }

      // BR-CN-002: Cumulative check
      const { data: existingCNs } = await this.client
        .from('invoices')
        .select('total_amount')
        .eq('ref_invoice_id', cn.ref_invoice_id)
        .eq('doc_type', 'Credit Note')
        .eq('cn_type', 'Linked')
        .neq('status', 'Cancelled')
        .neq('id', cnId);

      const cumulativeCN = (existingCNs ?? []).reduce((s, c) => s + Number(c.total_amount), 0) + cnTotal;
      if (cumulativeCN > refInvoice.total_amount) {
        throw BRErrors.CN_002_CUMULATIVE_EXCEEDED(cumulativeCN, refInvoice.total_amount, refInvoice.invoice_no);
      }
    }

    // Delegate to standard postInvoice (which generates JE, updates status, etc.)
    return this.invoiceService.postInvoice(auth, cnId, input);
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET CREDIT NOTE (with referenced invoice details)
  // ════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════
  // LIST CREDIT NOTES (with pagination & filters)
  // ════════════════════════════════════════════════════════════════════════

  async listCreditNotes(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<{ creditNotes: Invoice[]; total: number }> {
    // Force doc_type filter to 'Credit Note'
    const cnFilters = { ...filters, doc_type: 'Credit Note' };
    const { invoices, total } = await this.invoiceService.listInvoices(auth, cnFilters, pagination);
    return { creditNotes: invoices, total };
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET SINGLE CREDIT NOTE (alias for getCreditNoteDetails)
  // ════════════════════════════════════════════════════════════════════════

  public getCreditNote(
    auth: AuthContext,
    cnId: string,
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    return this.getCreditNoteDetails(auth, cnId);
  }

  async getCreditNoteDetails(
    auth: AuthContext,
    cnId: string,
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    const cn = await this.invoiceService.getInvoiceById(auth, cnId);

    if (cn.doc_type !== 'Credit Note') {
      throw new ValidationError('This document is not a Credit Note.', { doc_type: cn.doc_type });
    }

    // Fetch referenced invoice if linked
    if (cn.ref_invoice_id) {
      const refInvoice = await fetchById<Invoice>(this.requireReadClient(), 'invoices', cn.ref_invoice_id);
      return {
        ...cn,
        ref_invoice: refInvoice,
      } as Invoice & { lines: InvoiceLine[] };
    }

    return cn;
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET UNUSED CREDIT NOTES (for allocation)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Fetch posted (Open) Credit Notes for a customer that still have
   * remaining outstanding balance available for allocation.
   * Used by the Allocation module to let users pick CNs to offset invoices.
   */
  async getUnusedCreditNotes(
    auth: AuthContext,
    customerId: string,
  ): Promise<Invoice[]> {
    validateUUID(customerId, 'customer_id');
    const readClient = this.requireReadClient();

    const { data, error } = await readClient
      .from('invoices')
      .select('*')
      .eq('company_id', auth.companyId)
      .eq('customer_id', customerId)
      .eq('doc_type', 'Credit Note')
      .in('status', ['Open', 'Partially Paid'])
      .gt('outstanding', 0)
      .order('invoice_date', { ascending: false });

    if (error) throw new Error(`Failed to fetch unused credit notes: ${error.message}`);
    return (data ?? []) as Invoice[];
  }
}

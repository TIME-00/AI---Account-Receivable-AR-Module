// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Debit Note Service
// Implements PRD Part 2 §4
// ============================================================================

import { SupabaseClient } from 'supabase';
import {
  getAdminClient,
  fetchById,
} from '../_shared/db.ts';
import {
  NotFoundError,
  ValidationError,
} from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
import type {
  Invoice,
  InvoiceLine,
} from '../_shared/types.ts';
import { InvoiceService } from '../invoices/service.ts';
import type { CreateInvoiceInput, CreateInvoiceLineInput } from '../invoices/validators.ts';

// ─── Debit Note Service ─────────────────────────────────────────────────────

export class DebitNoteService {
  private client: SupabaseClient;
  private invoiceService: InvoiceService;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
    this.invoiceService = new InvoiceService(this.client);
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREATE DEBIT NOTE
  // ════════════════════════════════════════════════════════════════════════

  async createDebitNote(
    auth: AuthContext,
    data: CreateInvoiceInput,
    lines?: CreateInvoiceLineInput[],
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    data.doc_type = 'Debit Note';

    // If referencing an original invoice, validate customer consistency
    if (data.ref_invoice_id) {
      const refInvoice = await fetchById<Invoice>(this.client, 'invoices', data.ref_invoice_id);

      // Customer must match
      if (refInvoice.customer_id !== data.customer_id) {
        throw new ValidationError(
          'Debit Note customer must match original invoice customer.',
          { dn_customer: data.customer_id, invoice_customer: refInvoice.customer_id },
        );
      }
    }

    return this.invoiceService.createInvoice(auth, data, lines);
  }

  // ════════════════════════════════════════════════════════════════════════
  // POST DEBIT NOTE
  // ════════════════════════════════════════════════════════════════════════

  async postDebitNote(
    auth: AuthContext,
    dnId: string,
    input: { posting_period?: string } = {},
  ): Promise<Invoice & { je_no?: string }> {
    // Verify it's a DN
    const dn = await fetchById<Invoice>(this.client, 'invoices', dnId);
    if (dn.doc_type !== 'Debit Note') {
      throw new ValidationError('This document is not a Debit Note.', { doc_type: dn.doc_type });
    }

    // Delegate to standard postInvoice
    return this.invoiceService.postInvoice(auth, dnId, input);
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET DEBIT NOTE
  // ════════════════════════════════════════════════════════════════════════

  async getDebitNoteDetails(
    auth: AuthContext,
    dnId: string,
  ): Promise<Invoice & { lines: InvoiceLine[] }> {
    const dn = await this.invoiceService.getInvoiceById(auth, dnId);
    if (dn.doc_type !== 'Debit Note') {
      throw new ValidationError('This document is not a Debit Note.', { doc_type: dn.doc_type });
    }
    return dn;
  }
}

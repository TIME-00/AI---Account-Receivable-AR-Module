import { callRpc, fetchById, getAdminClient } from "../_shared/db.ts";
import { BRErrors, NotFoundError, ValidationError } from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import {
  requireCustomerAccess,
  requireOperationalReadRole,
  requireRole,
} from "../_shared/auth.ts";
import {
  validateMaxLength,
  validateOperationalCurrencyForWrite,
  validateUUID,
} from "../_shared/validators.ts";
import type {
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  PaginationParams,
} from "../_shared/types.ts";
import { roundTo2 } from "./calculator.ts";
import type {
  CancelInvoiceInput,
  CreateInvoiceInput,
  PostInvoiceInput,
} from "./validators.ts";
import { assertCustomerVisible } from "../_shared/visibility.ts";
import type { MonetaryCollectionSummary } from "../reports/monetary-contracts.ts";
import { resolveBookableReferenceRate } from "../_shared/fx-reference.ts";
import { InvoiceDraftService } from "./draft-service.ts";
export abstract class InvoiceLifecycleService extends InvoiceDraftService {
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
    requireRole(auth, "AR Clerk");
    validateUUID(invoiceId, "id");
    void input;

    const adminClient = getAdminClient();
    const { data: invoice, error: invoiceFetchError } = await adminClient
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceFetchError) {
      throw new Error(
        `Failed to fetch invoices(${invoiceId}): ${invoiceFetchError.message}`,
      );
    }
    if (!invoice) {
      throw new NotFoundError("Invoice", invoiceId);
    }

    if (invoice.company_id !== auth.companyId) {
      throw new NotFoundError("Invoice", invoiceId);
    }
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(
      this.client,
      auth.companyId,
      invoice.customer_id,
    );

    const rpcResult = await callRpc<{ je_no?: string }>(
      adminClient,
      "post_invoice",
      {
        p_invoice_id: invoiceId,
        p_user_id: auth.userId,
        p_company_id: auth.companyId,
      },
    );

    const postedInvoice = await fetchById<Invoice>(
      adminClient,
      "invoices",
      invoiceId,
    );
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
    requireRole(auth, "AR Supervisor");
    validateUUID(invoiceId, "id");

    const invoice = await this.fetchInvoiceOrThrow(invoiceId);
    if (invoice.company_id !== auth.companyId) {
      throw new NotFoundError("Invoice", invoiceId);
    }

    // Migration 028 keeps every cancellation precondition, reversal journal,
    // status mutation, caller authorization, assignment scope, and customer
    // visibility check in one PostgreSQL transaction. The governed RPC remains
    // the authoritative financial mutation boundary.
    return await callRpc<Invoice>(this.client, "cancel_invoice", {
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
    validateUUID(invoiceId, "id");
    const readClient = this.requireReadClient();

    // A caller-scoped lookup intentionally makes a nonexistent invoice and an
    // RLS-hidden invoice indistinguishable. `maybeSingle()` returns a clean
    // null for both cases; genuine PostgREST/database errors remain failures.
    const { data: invoiceData, error: invoiceError } = await readClient
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) {
      throw new Error(
        `Failed to fetch invoice(${invoiceId}): ${invoiceError.message}`,
      );
    }
    if (!invoiceData) throw new NotFoundError("Invoice", invoiceId);

    const invoice = invoiceData as Invoice;
    if (invoice.company_id !== auth.companyId) {
      throw new NotFoundError("Invoice", invoiceId);
    }

    await assertCustomerVisible(
      readClient,
      auth.companyId,
      invoice.customer_id,
    );

    const { data: lines, error: linesError } = await readClient
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("line_no");

    if (linesError) {
      throw new Error(
        `Failed to fetch invoice lines for invoice(${invoiceId}): ${linesError.message}`,
      );
    }

    const [enriched] = await this.attachFxDecisionReadSummary(auth.companyId, [
      invoice,
    ]);
    return { ...enriched, lines: (lines ?? []) as InvoiceLine[] };
  }

  async listInvoices(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<
    { invoices: Invoice[]; total: number; summary: MonetaryCollectionSummary }
  > {
    requireOperationalReadRole(auth);
    const collection = await this.getAuthoritativeCollection(
      auth,
      filters,
      pagination,
    );

    const invoices = await this.attachFxDecisionReadSummary(
      auth.companyId,
      collection.rows,
    );
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
    requireRole(auth, "AR Clerk");
    if ("base_total" in data) {
      throw new ValidationError(
        "base_total is server-calculated and must not be supplied.",
        { field: "base_total" },
      );
    }
    if (
      data.fx_reference_rate_id !== undefined &&
      (data.exchange_rate !== undefined ||
        data.fx_override_reason !== undefined)
    ) {
      throw new ValidationError(
        "fx_reference_rate_id cannot be combined with exchange_rate or fx_override_reason.",
        {
          field: "fx_reference_rate_id",
          conflicting_fields: ["exchange_rate", "fx_override_reason"],
        },
      );
    }
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await this.requireWritableCustomer(auth, invoice.customer_id);
    await assertCustomerVisible(
      this.client,
      auth.companyId,
      invoice.customer_id,
    );

    const updatePayload: Record<string, unknown> = {};
    if (data.invoice_date !== undefined) {
      updatePayload.invoice_date = data.invoice_date;
    }
    if (data.reference_no !== undefined) {
      updatePayload.reference_no = data.reference_no;
    }
    if (data.internal_remarks !== undefined) {
      updatePayload.internal_remarks = data.internal_remarks;
    }
    if (data.invoice_remarks !== undefined) {
      updatePayload.invoice_remarks = data.invoice_remarks;
    }
    const nextCurrency = data.currency ?? invoice.currency;
    const nextDate = data.invoice_date ?? invoice.invoice_date;
    if (data.currency !== undefined && data.currency !== invoice.currency) {
      validateOperationalCurrencyForWrite(nextCurrency);
    }
    const isBaseParity = nextCurrency === invoice.base_currency;
    const fxMaterialChange = data.currency !== undefined ||
      data.invoice_date !== undefined ||
      data.exchange_rate !== undefined ||
      data.fx_reference_rate_id !== undefined;

    if (isBaseParity && data.fx_reference_rate_id !== undefined) {
      throw new ValidationError(
        "Base-currency documents must not select an FX reference rate.",
        {
          field: "fx_reference_rate_id",
          currency: nextCurrency,
          base_currency: invoice.base_currency,
        },
      );
    }
    if (
      isBaseParity && data.exchange_rate !== undefined &&
      data.exchange_rate !== 1
    ) {
      throw new ValidationError(
        "Base-currency documents require an exchange rate of exactly 1.",
        { field: "exchange_rate", expected: 1 },
      );
    }

    if (data.currency !== undefined) updatePayload.currency = data.currency;
    if (data.exchange_rate !== undefined) {
      updatePayload.exchange_rate = data.exchange_rate;
    } else if (
      data.fx_reference_rate_id === undefined &&
      (data.currency !== undefined || data.invoice_date !== undefined)
    ) {
      if (isBaseParity) {
        updatePayload.exchange_rate = 1;
      } else {
        const reference = await resolveBookableReferenceRate(
          this.client,
          auth.companyId,
          nextCurrency,
          invoice.base_currency,
          nextDate,
        );
        updatePayload.fx_reference_rate_id = reference.id;
      }
    }
    if (data.fx_reference_rate_id !== undefined) {
      updatePayload.fx_reference_rate_id = data.fx_reference_rate_id;
    }
    if (data.reason_code !== undefined) {
      updatePayload.reason_code = data.reason_code;
    }
    if (data.reason_desc !== undefined) {
      updatePayload.reason_desc = data.reason_desc;
    }

    if (
      data.currency !== undefined &&
      (
        (invoice.doc_type === "Credit Note" && invoice.cn_type === "Linked") ||
        (invoice.doc_type === "Debit Note" && invoice.ref_invoice_id)
      )
    ) {
      await this.validateLinkedCreditNoteReference(
        {
          doc_type: invoice.doc_type,
          cn_type: invoice.cn_type ?? undefined,
          ref_invoice_id: invoice.ref_invoice_id ?? undefined,
          customer_id: invoice.customer_id,
          currency: nextCurrency,
        },
        auth.companyId,
        invoice.id,
      );
    }

    if (fxMaterialChange) {
      updatePayload.fx_explicit_rate_supplied =
        data.exchange_rate !== undefined;
      updatePayload.fx_override_reason = data.fx_override_reason ?? null;
    }

    if (Object.keys(updatePayload).length === 0) return invoice;
    return await callRpc<Invoice>(this.client, "update_draft_invoice", {
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
    requireRole(auth, "AR Clerk");
    validateUUID(invoiceId, "id");
    if (referenceNo !== null) {
      if (referenceNo.trim().length === 0) {
        throw new ValidationError("reference_no must be non-blank or null");
      }
      validateMaxLength(referenceNo, 50, "reference_no");
    }

    return await callRpc<Invoice>(
      this.client,
      "correct_posted_invoice_reference",
      {
        p_invoice_id: invoiceId,
        p_user_id: auth.userId,
        p_company_id: auth.companyId,
        p_reference_no: referenceNo,
      },
    );
  }

  /**
   * Delete a Draft invoice and its lines.
   */
  async deleteDraftInvoice(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<void> {
    requireRole(auth, "AR Clerk");
    validateUUID(invoiceId, "id");
    await callRpc(this.client, "delete_draft_invoice", {
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
  protected async requireDraftInvoice(
    invoiceId: string,
    companyId: string,
  ): Promise<Invoice> {
    validateUUID(invoiceId, "id");
    const invoice = await this.fetchInvoiceOrThrow(invoiceId);
    if (invoice.company_id !== companyId) {
      throw new NotFoundError("Invoice", invoiceId);
    }
    if (invoice.status !== "Draft") {
      throw BRErrors.INV_001_IMMUTABLE("status");
    }
    return invoice;
  }

  /**
   * Fetch an invoice while preserving the distinction between an absent row
   * (404) and an unexpected database/query failure (500).
   */
  protected async fetchInvoiceOrThrow(invoiceId: string): Promise<Invoice> {
    const { data, error } = await this.client
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to fetch invoices(${invoiceId}): ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundError("Invoice", invoiceId);
    }

    return data as Invoice;
  }

  /**
   * Fetch an invoice line with the same missing-row semantics as invoices.
   */
  protected async fetchInvoiceLineOrThrow(
    lineId: string,
  ): Promise<InvoiceLine> {
    validateUUID(lineId, "line_id");
    const { data, error } = await this.client
      .from("invoice_lines")
      .select("*")
      .eq("id", lineId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to fetch invoice_lines(${lineId}): ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundError("InvoiceLine", lineId);
    }

    return data as InvoiceLine;
  }

  /**
   * Apply Linked Credit Note deduction to original invoice (BR-CN-003).
   * Called during CN posting.
   */
  protected async applyLinkedCNDeduction(
    refInvoiceId: string,
    cnAmount: number,
    cnId: string,
    userId: string,
  ): Promise<void> {
    const refInvoice = await fetchById<Invoice>(
      this.client,
      "invoices",
      refInvoiceId,
    );

    // BR-CN-001: CN amount cannot exceed invoice outstanding
    if (cnAmount > refInvoice.outstanding) {
      throw BRErrors.CN_001_EXCEEDS_OUTSTANDING(
        cnAmount,
        refInvoice.outstanding,
        refInvoice.invoice_no,
      );
    }

    // BR-CN-002: Check cumulative CN total
    const { data: existingCN } = await this.client
      .from("invoices")
      .select("total_amount")
      .eq("ref_invoice_id", refInvoiceId)
      .eq("doc_type", "Credit Note")
      .eq("cn_type", "Linked")
      .neq("status", "Cancelled")
      .neq("id", cnId); // Exclude current CN

    const cumulativeCN =
      (existingCN ?? []).reduce((s, c) => s + Number(c.total_amount), 0) +
      cnAmount;
    if (cumulativeCN > refInvoice.total_amount) {
      throw BRErrors.CN_002_CUMULATIVE_EXCEEDED(
        cumulativeCN,
        refInvoice.total_amount,
        refInvoice.invoice_no,
      );
    }

    // Deduct from original invoice outstanding
    const newOutstanding = roundTo2(refInvoice.outstanding - cnAmount);
    let newStatus: InvoiceStatus = refInvoice.status;

    if (newOutstanding <= 0) {
      newStatus = "Paid"; // Fully offset by CN
    } else if (newOutstanding < refInvoice.total_amount) {
      newStatus = "Partially Paid";
    }

    await this.client
      .from("invoices")
      .update({
        outstanding: newOutstanding,
        status: newStatus,
        version: refInvoice.version + 1,
      })
      .eq("id", refInvoiceId)
      .eq("version", refInvoice.version);

    // Record CN allocation in cn_allocations table
    await this.client
      .from("cn_allocations")
      .insert({
        cn_id: cnId,
        invoice_id: refInvoiceId,
        allocated_amount: cnAmount,
        allocated_by: userId,
        status: "Active",
      });
  }
}

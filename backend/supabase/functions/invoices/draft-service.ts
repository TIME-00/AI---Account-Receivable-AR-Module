import { callRpc, fetchById, getNextSequence } from "../_shared/db.ts";
import {
  BRErrors,
  BusinessError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { requireCustomerAccess, requireRole } from "../_shared/auth.ts";
import type { Customer, Invoice, InvoiceLine } from "../_shared/types.ts";
import { calculateInvoiceTotals, calculateLineAmount } from "./calculator.ts";
import type {
  CreateInvoiceInput,
  CreateInvoiceLineInput,
} from "./validators.ts";
import { assertCustomerVisible } from "../_shared/visibility.ts";
import { withOptionalReadEnrichment } from "../_shared/fx-read-contracts.ts";
import { resolveBookableReferenceRate } from "../_shared/fx-reference.ts";
import { type CreateInvoiceOptions } from "./service-base.ts";
import { InvoiceAuthorityService } from "./authority-service.ts";
export abstract class InvoiceDraftService extends InvoiceAuthorityService {
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
    requireRole(auth, "AR Clerk");
    await this.requireWritableCustomer(auth, data.customer_id);

    // Fetch customer for validation and snapshot
    const customer = await fetchById<Customer>(
      this.client,
      "customers",
      data.customer_id,
    );
    if (customer.company_id !== auth.companyId) {
      throw new NotFoundError("Customer", data.customer_id);
    }
    await assertCustomerVisible(this.client, auth.companyId, customer.id);
    if (customer.is_deleted) {
      throw new NotFoundError("Customer", data.customer_id);
    }

    // BR-CUS-002: Blocked = no new transactions
    if (customer.status === "Blocked") {
      throw BRErrors.CUS_002_BLOCKED(customer.customer_name);
    }

    // BR-CM-003: Rating D = frozen
    if (customer.credit_rating === "D" && data.doc_type !== "Credit Note") {
      throw BRErrors.CM_003_RATING_D_BLOCKED(customer.customer_name);
    }

    // BR-CUS-001: Inactive = no new invoices (but allow CN)
    if (customer.status === "Inactive" && data.doc_type !== "Credit Note") {
      throw BRErrors.CUS_001_INACTIVE(customer.customer_name);
    }

    await this.validateLinkedCreditNoteReference(data, auth.companyId);

    // Determine document sequence type
    const seqType = data.doc_type === "Invoice"
      ? "INV"
      : data.doc_type === "Credit Note"
      ? "CN"
      : "DN";

    // Get company base currency
    const company = await fetchById<{ base_currency: string }>(
      this.client,
      "companies",
      auth.companyId,
    );
    const isBaseParity = data.currency === company.base_currency;

    if (isBaseParity && data.fx_reference_rate_id !== undefined) {
      throw new ValidationError(
        "Base-currency documents must not select an FX reference rate.",
        {
          field: "fx_reference_rate_id",
          currency: data.currency,
          base_currency: company.base_currency,
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

    const automaticReference = !isBaseParity &&
        data.fx_reference_rate_id === undefined &&
        data.exchange_rate === undefined
      ? await resolveBookableReferenceRate(
        this.client,
        auth.companyId,
        data.currency,
        company.base_currency,
        data.invoice_date,
      )
      : null;
    const selectedReferenceRateId = data.fx_reference_rate_id ??
      automaticReference?.id ?? null;

    // Reference-selected booking is resolved and snapshotted atomically by the
    // database wrapper. Rate 1 is only a transient payload placeholder and is
    // never committed for a valid foreign reference selection.
    const exchangeRate = isBaseParity
      ? 1
      : selectedReferenceRateId !== null
      ? 1
      : data.exchange_rate!;

    // Consume the governed sequence only after all request-side FX checks pass.
    const invoiceNo = await getNextSequence(
      this.client,
      auth.companyId,
      seqType,
    );

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
      customer_name: customer.customer_name, // Snapshot (BR-INV-SNAPSHOT)
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
        p_fx_reference_rate_id: selectedReferenceRateId,
      };
      if (options.postAtomically && !options.automationCommandId) {
        throw new BusinessError(
          "AUTOMATION_COMMAND_REQUIRED",
          "Atomic invoice posting requires an automation command.",
          409,
        );
      }
      if (options.automationCommandId) {
        rpcArgs.p_command_id = options.automationCommandId;
        rpcArgs.p_post = options.postAtomically === true;
      }
      invoiceId = await callRpc<string>(
        this.client,
        options.automationCommandId
          ? "automation_execute_invoice_command"
          : "fx_create_governed_invoice_draft",
        rpcArgs,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("duplicate key")) {
        throw new BusinessError(
          "DUPLICATE_INVOICE",
          `Invoice number ${invoiceNo} already exists. Please retry.`,
          409,
        );
      }
      throw error;
    }

    const result = await fetchById<Invoice>(this.client, "invoices", invoiceId);
    const { data: createdLines, error: linesError } = await this.client
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("line_no");
    if (linesError) {
      throw new Error(
        `Failed to fetch created invoice lines: ${linesError.message}`,
      );
    }

    const committed = {
      ...result,
      lines: (createdLines ?? []) as InvoiceLine[],
    };
    if (!this.readClient) return committed;
    return await withOptionalReadEnrichment(
      committed,
      async () => {
        const [enriched] = await this.attachFxDecisionReadSummary(
          auth.companyId,
          [result],
        );
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
    requireRole(auth, "AR Clerk");
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(
      this.client,
      auth.companyId,
      invoice.customer_id,
    );
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
    return await callRpc<InvoiceLine[]>(
      this.client,
      "add_draft_invoice_lines",
      {
        p_invoice_id: invoiceId,
        p_user_id: auth.userId,
        p_company_id: auth.companyId,
        p_lines: insertRows,
      },
    );
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
    requireRole(auth, "AR Clerk");
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(
      this.client,
      auth.companyId,
      invoice.customer_id,
    );

    const line = await this.fetchInvoiceLineOrThrow(lineId);
    if (line.invoice_id !== invoiceId) {
      throw new NotFoundError("InvoiceLine", lineId);
    }

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
    Object.keys(updatePayload).forEach((key) => {
      if (updatePayload[key] === undefined) delete updatePayload[key];
    });

    return await callRpc<InvoiceLine>(
      this.client,
      "update_draft_invoice_line",
      {
        p_invoice_id: invoiceId,
        p_line_id: lineId,
        p_user_id: auth.userId,
        p_company_id: auth.companyId,
        p_changes: updatePayload,
      },
    );
  }

  /**
   * Delete a line item from a Draft invoice.
   */
  async deleteLine(
    auth: AuthContext,
    invoiceId: string,
    lineId: string,
  ): Promise<void> {
    requireRole(auth, "AR Clerk");
    const invoice = await this.requireDraftInvoice(invoiceId, auth.companyId);
    await requireCustomerAccess(auth, invoice.customer_id);
    await assertCustomerVisible(
      this.client,
      auth.companyId,
      invoice.customer_id,
    );

    const line = await this.fetchInvoiceLineOrThrow(lineId);
    if (line.invoice_id !== invoiceId) {
      throw new NotFoundError("InvoiceLine", lineId);
    }

    await callRpc(this.client, "delete_draft_invoice_line", {
      p_invoice_id: invoiceId,
      p_line_id: lineId,
      p_user_id: auth.userId,
      p_company_id: auth.companyId,
    });
  }
}

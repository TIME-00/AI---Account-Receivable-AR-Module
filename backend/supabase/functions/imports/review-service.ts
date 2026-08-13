import { fetchById } from "../_shared/db.ts";
import { NotFoundError, ValidationError } from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { requireCustomerAccess } from "../_shared/auth.ts";
import { validateUUID } from "../_shared/validators.ts";
import type { Customer, Invoice } from "../_shared/types.ts";
import {
  asString,
  hasImportValue,
  type ImportBatch,
  type ImportRow,
  type ImportRowStatus,
  parseNumber,
  preserveReviewAuditFields,
  type ReviewAction,
  type ReviewRowResult,
} from "./service-base.ts";
import { ImportWorkflowService } from "./workflow-service.ts";
export abstract class ImportReviewService extends ImportWorkflowService {
  async reviewRow(
    auth: AuthContext,
    batchId: string,
    rowId: string,
    payload: Record<string, unknown>,
  ): Promise<ReviewRowResult> {
    const batch = await this.getWritableBatch(auth, batchId);
    const row = await this.fetchReviewableRow(batch.id, rowId);
    const action = this.parseReviewAction(payload.action);
    const reviewNote = this.reviewNote(payload.review_note);

    let result: ReviewRowResult;
    switch (action) {
      case "approve_suggestion":
        result = await this.applyApproveSuggestion(
          auth,
          batch,
          row,
          payload,
          reviewNote,
        );
        break;
      case "reject_suggestion":
        result = await this.applyRejectSuggestion(row, reviewNote);
        break;
      case "edit_customer":
        result = await this.applyEditCustomer(auth, row, payload, reviewNote);
        break;
      case "edit_invoice_reference":
        result = await this.applyEditInvoiceReference(
          auth,
          batch,
          row,
          payload,
          reviewNote,
        );
        break;
      case "retry_validation":
        result = await this.revalidateReviewRow(auth, batch, row);
        break;
    }

    await this.refreshBatchCounters(batch.id);
    return result;
  }

  protected async fetchReviewableRow(
    batchId: string,
    rowId: string,
  ): Promise<ImportRow> {
    validateUUID(rowId, "row_id");
    const { data, error } = await this.client
      .from("import_rows")
      .select("*")
      .eq("id", rowId)
      .eq("batch_id", batchId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch import row: ${error.message}`);
    if (!data) throw new NotFoundError("ImportRow", rowId);

    const row = data as ImportRow;
    if (["Created", "Posted", "Allocated"].includes(row.status)) {
      throw new ValidationError(
        "Created, posted, or allocated import rows cannot be reviewed.",
        {
          row_id: rowId,
          status: row.status,
        },
      );
    }
    return row;
  }

  protected parseReviewAction(action: unknown): ReviewAction {
    const value = typeof action === "string" ? action : "";
    const allowed: ReviewAction[] = [
      "approve_suggestion",
      "reject_suggestion",
      "edit_customer",
      "edit_invoice_reference",
      "retry_validation",
    ];
    if (!allowed.includes(value as ReviewAction)) {
      throw new ValidationError("Unsupported review action.", {
        action: value,
      });
    }
    return value as ReviewAction;
  }

  protected reviewNote(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      throw new ValidationError("review_note must be a string.", {
        field: "review_note",
      });
    }
    const note = value.trim();
    if (note.length > 500) {
      throw new ValidationError(
        "review_note must be 500 characters or fewer.",
        { field: "review_note" },
      );
    }
    return note || undefined;
  }

  protected reviewedFields(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ValidationError(
        "reviewed_fields must be an object of reviewed OCR/manual values.",
        {
          field: "reviewed_fields",
        },
      );
    }

    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).length === 0) {
      throw new ValidationError(
        "reviewed_fields must include at least one field.",
        {
          field: "reviewed_fields",
        },
      );
    }
    if (Object.keys(fields).length > 50) {
      throw new ValidationError(
        "reviewed_fields cannot include more than 50 fields.",
        {
          field: "reviewed_fields",
        },
      );
    }

    for (const key of Object.keys(fields)) {
      if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) {
        throw new ValidationError(
          "reviewed_fields contains an unsupported field key.",
          {
            field: "reviewed_fields",
            field_key: key,
          },
        );
      }
      const valueForKey = fields[key];
      if (
        valueForKey !== null &&
        typeof valueForKey !== "string" &&
        typeof valueForKey !== "number" &&
        typeof valueForKey !== "boolean"
      ) {
        throw new ValidationError(
          "reviewed_fields values must be scalar JSON values.",
          {
            field: "reviewed_fields",
            field_key: key,
          },
        );
      }
    }

    return fields;
  }

  protected async insertOcrReviewDecisions(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    fileId: string | null,
    reviewedFields: Record<string, unknown>,
    decision: "reviewed" | "approved_draft" | "rejected",
    note?: string,
  ): Promise<void> {
    const rawFields = row.raw_data?.ocr_fields;
    const rawValues =
      rawFields && typeof rawFields === "object" && !Array.isArray(rawFields)
        ? rawFields as Record<string, unknown>
        : row.raw_data;

    const rows = Object.entries(reviewedFields).map((
      [fieldKey, reviewedValue],
    ) => ({
      company_id: auth.companyId,
      batch_id: batch.id,
      file_id: fileId,
      row_id: row.id,
      field_key: fieldKey,
      raw_value: rawValues[fieldKey] === undefined ? null : rawValues[fieldKey],
      reviewed_value: reviewedValue === undefined ? null : reviewedValue,
      confidence: null,
      decision,
      decided_by: auth.userId,
      note: note ?? null,
    }));

    const { error } = await this.client
      .from("ocr_review_decisions")
      .insert(rows);

    if (error) {
      throw new Error(
        `Failed to record OCR review decisions: ${error.message}`,
      );
    }
  }

  protected async applyApproveSuggestion(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult> {
    const mappedData = row.mapped_data ?? {};
    if (mappedData.review_required !== true) {
      throw new ValidationError(
        "Only review_required rows can approve a suggestion.",
        {
          row_id: row.id,
        },
      );
    }

    const selectedCustomerId = this.optionalUUID(
      payload.suggested_customer_id,
      "suggested_customer_id",
    );
    const selectedInvoiceId = this.optionalUUID(
      payload.suggested_invoice_id,
      "suggested_invoice_id",
    );
    if (!selectedCustomerId && !selectedInvoiceId) {
      throw new ValidationError(
        "approve_suggestion requires suggested_customer_id or suggested_invoice_id.",
        {
          action: "approve_suggestion",
        },
      );
    }
    if (
      selectedCustomerId && selectedInvoiceId &&
      mappedData.review_kind !== "both"
    ) {
      throw new ValidationError(
        "Approving both customer and invoice suggestions is allowed only for review_kind=both.",
        {
          review_kind: mappedData.review_kind,
        },
      );
    }

    const nextRawData = { ...row.raw_data };
    const nextMappedData = { ...mappedData };
    const messages: string[] = [];

    if (selectedCustomerId) {
      const candidate = this.findCandidateById(
        mappedData,
        ["suggested_customers", "customer_candidates"],
        selectedCustomerId,
        "customer_id",
      );
      if (!candidate) {
        throw new ValidationError(
          "Selected customer suggestion is not present in this row.",
          {
            field: "suggested_customer_id",
            reason: "rejected_invalid_selection",
          },
        );
      }
      const customer = await this.resolveVisibleCustomerById(
        auth,
        selectedCustomerId,
      );
      nextRawData.customer_code = customer.customer_id;
      nextRawData.customer_name = customer.customer_name;
      nextMappedData.approved_customer_id = customer.id;
      nextMappedData.approved_customer_code = customer.customer_id;
      nextMappedData.approved_customer_name = customer.customer_name;
      messages.push(`Approved customer ${customer.customer_id}.`);
    }

    if (selectedInvoiceId) {
      const candidate = this.findCandidateById(
        mappedData,
        ["suggested_invoices", "invoice_candidates"],
        selectedInvoiceId,
        "invoice_id",
      );
      if (!candidate) {
        throw new ValidationError(
          "Selected invoice suggestion is not present in this row.",
          {
            field: "suggested_invoice_id",
            reason: "rejected_invalid_selection",
          },
        );
      }
      const invoice = await this.resolveReviewInvoice(
        auth,
        batch,
        row,
        nextRawData,
        selectedInvoiceId,
      );
      nextRawData.invoice_reference = invoice.invoice_no;
      nextMappedData.approved_invoice_id = invoice.id;
      nextMappedData.approved_invoice_no = invoice.invoice_no;
      messages.push(`Approved invoice ${invoice.invoice_no}.`);
    }

    const now = new Date().toISOString();
    nextMappedData.user_action = "approved";
    nextMappedData.review_result = "approved_pending_retry";
    nextMappedData.approved_by = auth.userId;
    nextMappedData.approved_at = now;
    if (reviewNote) nextMappedData.review_note = reviewNote;

    const updated = await this.updateReviewRow(row.id, {
      raw_data: nextRawData,
      mapped_data: nextMappedData,
    });

    return {
      row: updated,
      action: "approve_suggestion",
      review_result: "approved_pending_retry",
      revalidated: false,
      messages,
    };
  }

  protected async applyRejectSuggestion(
    row: ImportRow,
    reviewNote?: string,
  ): Promise<ReviewRowResult> {
    const nextMappedData = { ...(row.mapped_data ?? {}) };
    delete nextMappedData.approved_customer_id;
    delete nextMappedData.approved_customer_code;
    delete nextMappedData.approved_customer_name;
    delete nextMappedData.approved_invoice_id;
    delete nextMappedData.approved_invoice_no;
    nextMappedData.user_action = "rejected";
    nextMappedData.review_result = "rejected";
    nextMappedData.rejected_at = new Date().toISOString();
    if (reviewNote) nextMappedData.review_note = reviewNote;

    const updated = await this.updateReviewRow(row.id, {
      mapped_data: nextMappedData,
    });
    return {
      row: updated,
      action: "reject_suggestion",
      review_result: "rejected",
      revalidated: false,
      messages: ["Suggestion rejected."],
    };
  }

  protected async applyEditCustomer(
    auth: AuthContext,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult> {
    const nextRawData = { ...row.raw_data };
    const nextMappedData = { ...(row.mapped_data ?? {}) };
    const customerId = this.optionalUUID(payload.customer_id, "customer_id");
    const customerCode = typeof payload.customer_code === "string"
      ? payload.customer_code.trim()
      : "";
    const customerName = typeof payload.customer_name === "string"
      ? payload.customer_name.trim()
      : "";

    if (!customerId && !customerCode && !customerName) {
      throw new ValidationError(
        "edit_customer requires customer_id, customer_code, or customer_name.",
        {
          action: "edit_customer",
        },
      );
    }

    if (customerId) {
      const customer = await this.resolveVisibleCustomerById(auth, customerId);
      nextRawData.customer_code = customer.customer_id;
      nextRawData.customer_name = customer.customer_name;
      nextMappedData.edited_customer_id = customer.id;
      nextMappedData.edited_customer_code = customer.customer_id;
      nextMappedData.edited_customer_name = customer.customer_name;
    } else if (customerCode) {
      const customer = await this.resolveVisibleCustomerByCode(
        auth,
        customerCode,
      );
      nextRawData.customer_code = customer.customer_id;
      nextRawData.customer_name = customer.customer_name;
      nextMappedData.edited_customer_id = customer.id;
      nextMappedData.edited_customer_code = customer.customer_id;
      nextMappedData.edited_customer_name = customer.customer_name;
    } else {
      nextRawData.customer_code = "";
      nextRawData.customer_name = customerName;
      nextMappedData.edited_customer_name = customerName;
    }

    nextMappedData.user_action = "edited";
    nextMappedData.review_result = "edited_pending_retry";
    nextMappedData.edited_by = auth.userId;
    nextMappedData.edited_at = new Date().toISOString();
    if (reviewNote) nextMappedData.review_note = reviewNote;

    const updated = await this.updateReviewRow(row.id, {
      raw_data: nextRawData,
      mapped_data: nextMappedData,
    });
    return {
      row: updated,
      action: "edit_customer",
      review_result: "edited_pending_retry",
      revalidated: false,
      messages: [
        "Customer correction recorded. Run retry_validation to re-check the row.",
      ],
    };
  }

  protected async applyEditInvoiceReference(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult> {
    const invoiceReference = typeof payload.invoice_reference === "string"
      ? payload.invoice_reference.trim()
      : "";
    if (!invoiceReference) {
      throw new ValidationError(
        "edit_invoice_reference requires invoice_reference.",
        {
          field: "invoice_reference",
        },
      );
    }

    const review = await this.inspectEditedInvoiceReference(
      auth,
      batch,
      row,
      invoiceReference,
    );
    if (review.blocking) {
      throw new ValidationError(
        review.message ?? "Corrected invoice_reference is not allocatable.",
        {
          field: "invoice_reference",
          reason: review.reason,
        },
      );
    }

    const nextRawData = {
      ...row.raw_data,
      invoice_reference: invoiceReference,
    };
    const nextMappedData: Record<string, unknown> = {
      ...(row.mapped_data ?? {}),
      user_action: "edited",
      review_result: "edited_pending_retry",
      edited_invoice_reference: invoiceReference,
      edited_by: auth.userId,
      edited_at: new Date().toISOString(),
    };
    if (reviewNote) nextMappedData.review_note = reviewNote;

    const updated = await this.updateReviewRow(row.id, {
      raw_data: nextRawData,
      mapped_data: nextMappedData,
    });
    return {
      row: updated,
      action: "edit_invoice_reference",
      review_result: "edited_pending_retry",
      revalidated: false,
      messages: [
        "Invoice reference correction recorded. Run retry_validation to re-check the row.",
      ],
    };
  }

  protected async revalidateReviewRow(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
  ): Promise<ReviewRowResult> {
    const result = await this.validateRow(
      auth,
      batch.import_type,
      row.raw_data,
    );
    const status: ImportRowStatus = result.errors.length > 0
      ? "Error"
      : result.status ?? "Valid";
    const reviewResult = status === "Valid"
      ? "revalidated_valid"
      : "revalidation_failed";
    const validationMappedData = result.mappedData ?? {};
    const mappedData = {
      ...preserveReviewAuditFields(row.mapped_data, validationMappedData),
      review_result: reviewResult,
      revalidated_at: new Date().toISOString(),
      revalidated_by: auth.userId,
    };

    const updated = await this.updateReviewRow(row.id, {
      status,
      mapped_data: mappedData,
      validation_errors: result.errors.length > 0 ? result.errors : null,
    });

    return {
      row: updated,
      action: "retry_validation",
      review_result: reviewResult,
      revalidated: true,
      messages: [
        status === "Valid"
          ? "Row revalidated successfully."
          : "Row still requires review.",
      ],
    };
  }

  protected async updateReviewRow(
    rowId: string,
    patch: Record<string, unknown>,
  ): Promise<ImportRow> {
    const { data, error } = await this.client
      .from("import_rows")
      .update(patch)
      .eq("id", rowId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update import review row: ${error.message}`);
    }
    return data as ImportRow;
  }

  protected async refreshBatchCounters(batchId: string): Promise<void> {
    const rows = await this.listRowsInternal(batchId);
    await this.updateBatch(batchId, {
      total_rows: rows.length,
      valid_rows: rows.filter((row) =>
        row.status === "Valid" ||
        row.status === "Created" ||
        row.status === "Posted" ||
        row.status === "Allocated"
      ).length,
      error_rows: rows.filter((row) =>
        ["Error", "Unmatched", "Skipped"].includes(row.status)
      ).length,
      skipped_count: rows.filter((row) =>
        row.status === "Skipped"
      ).length,
      unmatched_count: rows.filter((row) => row.status === "Unmatched").length,
    });
  }

  protected optionalUUID(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") {
      throw new ValidationError(`${field} must be a UUID string.`, { field });
    }
    const trimmed = value.trim();
    validateUUID(trimmed, field);
    return trimmed;
  }

  protected findCandidateById(
    mappedData: Record<string, unknown>,
    keys: string[],
    id: string,
    idField: string,
  ): Record<string, unknown> | null {
    for (const key of keys) {
      const candidates = mappedData[key];
      if (!Array.isArray(candidates)) continue;
      const candidate = candidates.find((item) =>
        item &&
        typeof item === "object" &&
        String((item as Record<string, unknown>)[idField]) === id
      );
      if (candidate && typeof candidate === "object") {
        return candidate as Record<string, unknown>;
      }
    }
    return null;
  }

  protected async resolveVisibleCustomerById(
    auth: AuthContext,
    customerId: string,
  ): Promise<Customer> {
    const { data, error } = await this.client
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .eq("company_id", auth.companyId)
      .eq("is_deleted", false)
      .eq("is_hidden", false)
      .maybeSingle();

    if (error) throw new Error(`Failed to resolve customer: ${error.message}`);
    if (!data) throw new NotFoundError("Customer", customerId);

    const customer = data as Customer;
    await requireCustomerAccess(auth, customer.id);
    return customer;
  }

  protected async resolveVisibleCustomerByCode(
    auth: AuthContext,
    customerCode: string,
  ): Promise<Customer> {
    const { data, error } = await this.client
      .from("customers")
      .select("*")
      .eq("customer_id", customerCode)
      .eq("company_id", auth.companyId)
      .eq("is_deleted", false)
      .eq("is_hidden", false)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve customer_code: ${error.message}`);
    }
    if (!data) {
      throw new ValidationError(
        `Visible customer_code "${customerCode}" could not be resolved.`,
        {
          field: "customer_code",
        },
      );
    }

    const customer = data as Customer;
    await requireCustomerAccess(auth, customer.id);
    return customer;
  }

  protected async resolveReviewCustomerFromRaw(
    auth: AuthContext,
    rawData: Record<string, unknown>,
  ): Promise<Customer> {
    const classification = await this.customerService.classifyImportCustomer(
      auth,
      {
        customerCode: asString(rawData, "customer_code") || undefined,
        customerName: asString(rawData, "customer_name") || undefined,
        registrationNo: asString(rawData, "registration_no") || undefined,
      },
    );

    if (!classification.customer) {
      throw new ValidationError(
        "A visible exact customer must be resolved before approving an invoice suggestion.",
        {
          field: "customer_code",
          reason: "customer_context_unresolved",
        },
      );
    }
    await requireCustomerAccess(auth, classification.customer.id);
    return classification.customer;
  }

  protected async resolveReviewInvoice(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    rawData: Record<string, unknown>,
    invoiceId: string,
  ): Promise<Invoice> {
    if (batch.import_type !== "receipt") {
      throw new ValidationError(
        "Invoice suggestion approval is supported only for receipt import rows.",
        {
          import_type: batch.import_type,
        },
      );
    }

    const customer = await this.resolveReviewCustomerFromRaw(auth, rawData);
    const invoice = await fetchById<Invoice>(
      this.client,
      "invoices",
      invoiceId,
    );
    if (
      invoice.company_id !== auth.companyId ||
      invoice.customer_id !== customer.id
    ) {
      throw new NotFoundError("Invoice", invoiceId);
    }

    const currency = (
      asString(rawData, "currency") ||
      asString(row.mapped_data ?? {}, "currency") ||
      customer.default_currency ||
      "MYR"
    ).toUpperCase();
    if (invoice.currency !== currency) {
      throw new ValidationError(
        "Selected invoice currency does not match the import row currency.",
        {
          field: "suggested_invoice_id",
          reason: "currency_mismatch",
          invoice_currency: invoice.currency,
          receipt_currency: currency,
        },
      );
    }
    if (!this.isAllocatableInvoice(invoice)) {
      throw new ValidationError(
        "Selected invoice is not currently allocatable.",
        {
          field: "suggested_invoice_id",
          reason: Number(invoice.outstanding) <= 0
            ? "no_outstanding"
            : "invoice_not_open",
          invoice_status: invoice.status,
          outstanding: invoice.outstanding,
        },
      );
    }

    const mappedData = {
      ...(row.mapped_data ?? {}),
      currency,
      receipt_amount: hasImportValue(rawData, "amount")
        ? parseNumber(asString(rawData, "amount"), "amount")
        : row.mapped_data?.receipt_amount,
      allocation_amount: hasImportValue(rawData, "allocation_amount")
        ? parseNumber(
          asString(rawData, "allocation_amount"),
          "allocation_amount",
        )
        : row.mapped_data?.allocation_amount,
      discount_amount: hasImportValue(rawData, "discount_amount")
        ? parseNumber(asString(rawData, "discount_amount"), "discount_amount")
        : row.mapped_data?.discount_amount,
      invoice_reference: invoice.invoice_no,
    };

    const preflight = await this.preflightReceiptImportAllocation(
      auth,
      customer.id,
      mappedData,
    );
    if (preflight) {
      throw new ValidationError(
        String(
          preflight.mappedData.allocation_error ??
            preflight.mappedData.auto_post_block_reason ??
            "Selected invoice failed allocation preflight.",
        ),
        {
          field: "suggested_invoice_id",
          reason: preflight.mappedData.allocation_error_reason ??
            "allocation_preflight_failed",
        },
      );
    }

    return invoice;
  }

  protected async inspectEditedInvoiceReference(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    invoiceReference: string,
  ): Promise<{ blocking: boolean; reason?: string; message?: string }> {
    if (batch.import_type !== "receipt") return { blocking: false };

    let customer: Customer;
    try {
      customer = await this.resolveReviewCustomerFromRaw(auth, row.raw_data);
    } catch {
      return { blocking: false };
    }

    const currency = (
      asString(row.raw_data, "currency") ||
      asString(row.mapped_data ?? {}, "currency") ||
      customer.default_currency ||
      "MYR"
    ).toUpperCase();
    const diagnostics = await this.invoiceReferenceSuggestionDiagnostics(
      auth.companyId,
      customer.id,
      currency,
      invoiceReference,
      row.mapped_data ?? {},
    );

    if (!diagnostics) return { blocking: false };
    const reason = String(diagnostics.mappedData.allocation_error_reason ?? "");
    if (
      ["currency_mismatch", "no_outstanding", "invoice_not_open"].includes(
        reason,
      )
    ) {
      return {
        blocking: true,
        reason,
        message: String(
          diagnostics.mappedData.allocation_error ??
            "Corrected invoice_reference is not allocatable.",
        ),
      };
    }
    return { blocking: false };
  }
}

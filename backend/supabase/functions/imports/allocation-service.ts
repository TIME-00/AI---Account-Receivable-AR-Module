import { fetchById } from "../_shared/db.ts";
import { ValidationError } from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { validateUUID } from "../_shared/validators.ts";
import { roundMoney } from "../_shared/money.ts";
import type { Invoice, Receipt } from "../_shared/types.ts";
import {
  asString,
  type ImportRow,
  type ImportRowStatus,
  parseNumber,
} from "./service-base.ts";
import { ImportResolutionService } from "./resolution-service.ts";
export abstract class ImportAllocationService extends ImportResolutionService {
  protected importAllocationPreflightStatus(reason: string): ImportRowStatus {
    return ["invoice_not_open", "no_outstanding"].includes(reason)
      ? "Skipped"
      : "Unmatched";
  }

  protected async allocateReceiptImportRow(
    auth: AuthContext,
    importRowId: string,
    receiptId: string,
    mappedData: Record<string, unknown>,
  ): Promise<
    {
      status: ImportRowStatus;
      mappedData: Record<string, unknown>;
      allocated: boolean;
    }
  > {
    const invoiceReference = asString(mappedData, "invoice_reference");

    if (!invoiceReference) {
      return {
        status: "Posted",
        allocated: false,
        mappedData: {
          ...mappedData,
          allocation_status: "Skipped",
          allocation_error: "No invoice_reference provided.",
        },
      };
    }

    try {
      const receipt = await fetchById<Receipt>(
        this.client,
        "receipts",
        receiptId,
      );
      const invoice = await this.resolveAllocationInvoice(
        auth.companyId,
        receipt.customer_id,
        receipt.currency,
        invoiceReference,
      );
      const explicitAmount = mappedData.allocation_amount !== undefined
        ? Number(mappedData.allocation_amount)
        : undefined;
      const discountAmount = mappedData.discount_amount !== undefined
        ? Number(mappedData.discount_amount)
        : 0;
      const bankChargeAmount = mappedData.bank_charge_amount !== undefined
        ? Number(mappedData.bank_charge_amount)
        : undefined;
      const shortPaymentReason = asString(mappedData, "short_payment_reason");
      const allocationAmount = explicitAmount ??
        Math.min(
          Number(receipt.unallocated_amount),
          Number(invoice.outstanding),
        );
      const overpaymentDetected = explicitAmount === undefined &&
        Number(receipt.unallocated_amount) >
          Number(invoice.outstanding) + 0.005;
      const settlementAmount = allocationAmount + discountAmount;
      const shortPaymentDifference = roundMoney(
        Math.max(Number(invoice.outstanding) - settlementAmount, 0),
      );
      const bankChargeDetected = bankChargeAmount !== undefined ||
        shortPaymentReason === "bank_charge";
      const shortPaymentDetected = shortPaymentDifference > 0.005 ||
        bankChargeDetected;

      if (!Number.isFinite(allocationAmount) || allocationAmount <= 0) {
        throw new ValidationError("allocation_amount must be greater than 0.", {
          field: "allocation_amount",
          invoice_reference: invoiceReference,
        });
      }
      if (!Number.isFinite(discountAmount) || discountAmount < 0) {
        throw new ValidationError("discount_amount cannot be negative.", {
          field: "discount_amount",
          invoice_reference: invoiceReference,
        });
      }

      const allocations = await this.allocationService.manualAllocate(auth, {
        receipt_id: receiptId,
        allocations: [{
          invoice_id: invoice.id,
          amount: allocationAmount,
          ...(discountAmount > 0 ? { discount_amount: discountAmount } : {}),
        }],
      });

      const allocation = allocations[0];
      if (!allocation?.id) {
        throw new Error(
          "Allocation RPC completed but no allocation_details row was returned.",
        );
      }
      const updatedReceipt = await fetchById<Receipt>(
        this.client,
        "receipts",
        receiptId,
      );

      const allocatedMappedData: Record<string, unknown> = {
        ...mappedData,
        allocation_status: "Allocated",
        allocation_id: allocation.id,
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        allocated_amount: allocation.allocated_amount,
        ...(discountAmount > 0
          ? {
            discount_amount: discountAmount,
            discount_applied: true,
          }
          : {}),
        ...(shortPaymentDetected
          ? {
            short_payment_detected: true,
            difference_amount: shortPaymentDifference > 0.005
              ? shortPaymentDifference
              : roundMoney(bankChargeAmount ?? 0),
            suggested_reason: bankChargeDetected
              ? "bank_charge"
              : "underpayment",
            review_required: bankChargeDetected ? true : false,
          }
          : {}),
        ...(bankChargeDetected
          ? {
            bank_charge_amount: bankChargeAmount,
            bank_charge_posting_required: true,
            bank_charge_review_reason:
              "Bank charge accounting is not automated in Batch 5. The received amount was allocated only; classify and post bank charges through a future GL-safe flow.",
          }
          : {}),
        ...(overpaymentDetected
          ? {
            overpayment_detected: true,
            unapplied_amount: Number(updatedReceipt.unallocated_amount),
            allocation_suggestion: allocationAmount,
          }
          : {}),
      };

      const { error: auditError } = await this.client.from(
        "import_row_allocations",
      ).insert({
        import_row_id: importRowId,
        allocation_id: allocation.id,
        invoice_id: invoice.id,
        allocated_amount: allocation.allocated_amount,
      });
      if (auditError) {
        return {
          status: "Allocated",
          allocated: true,
          mappedData: {
            ...allocatedMappedData,
            allocation_evidence_status: "Error",
            allocation_evidence_error:
              `Failed to record import allocation evidence: ${auditError.message}`,
          },
        };
      }

      return {
        status: "Allocated",
        allocated: true,
        mappedData: {
          ...allocatedMappedData,
          allocation_evidence_status: "Recorded",
        },
      };
    } catch (error) {
      const details = error instanceof ValidationError ? error.details : {};
      return {
        status: "Unmatched",
        allocated: false,
        mappedData: {
          ...mappedData,
          allocation_status: "Error",
          allocation_error: this.errorMessage(error),
          allocation_error_reason: typeof details.reason === "string"
            ? details.reason
            : "allocation_failed",
        },
      };
    }
  }

  protected async resolveAllocationInvoice(
    companyId: string,
    customerId: string,
    currency: string,
    invoiceReference: string,
  ): Promise<Invoice> {
    const { data, error } = await this.client
      .from("invoices")
      .select("*")
      .eq("company_id", companyId)
      .eq("invoice_no", invoiceReference)
      .eq("customer_id", customerId)
      .limit(2);

    if (error) {
      throw new Error(`Failed to resolve invoice_reference: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new ValidationError(
        `No invoice found for invoice_reference "${invoiceReference}" for this customer.`,
        {
          field: "invoice_reference",
          invoice_reference: invoiceReference,
          reason: "invoice_not_found_for_customer",
        },
      );
    }
    if (data.length > 1) {
      throw new ValidationError(
        `Multiple invoices matched invoice_reference "${invoiceReference}".`,
        {
          field: "invoice_reference",
          invoice_reference: invoiceReference,
          reason: "multiple_matches",
        },
      );
    }

    const invoice = data[0] as Invoice;
    if (invoice.currency !== currency) {
      throw new ValidationError(
        `Invoice ${invoice.invoice_no} currency (${invoice.currency}) does not match receipt currency (${currency}).`,
        {
          field: "invoice_reference",
          invoice_reference: invoiceReference,
          reason: "currency_mismatch",
          invoice_currency: invoice.currency,
          receipt_currency: currency,
        },
      );
    }

    if (!["Open", "Overdue", "Partially Paid"].includes(invoice.status)) {
      throw new ValidationError(
        `Invoice ${invoice.invoice_no} status (${invoice.status}) does not allow allocation.`,
        {
          field: "invoice_reference",
          invoice_reference: invoiceReference,
          reason: "invoice_not_open",
          invoice_status: invoice.status,
        },
      );
    }

    if (Number(invoice.outstanding) <= 0) {
      throw new ValidationError(
        `Invoice ${invoice.invoice_no} has no outstanding balance to allocate.`,
        {
          field: "invoice_reference",
          invoice_reference: invoiceReference,
          reason: "no_outstanding",
          outstanding: invoice.outstanding,
        },
      );
    }

    return invoice;
  }

  protected errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }

  protected rowHasPostingError(row: ImportRow): boolean {
    return Boolean(
      row.mapped_data && row.mapped_data.posting_status === "Error",
    );
  }

  protected async assertNoDuplicateReference(
    companyId: string,
    customerId: string,
    referenceNo?: string,
  ): Promise<void> {
    if (!referenceNo) return;
    const { count, error } = await this.client
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .eq("reference_no", referenceNo)
      .neq("status", "Cancelled");

    if (error) {
      throw new Error(`Failed duplicate reference check: ${error.message}`);
    }
    if ((count ?? 0) > 0) {
      throw new ValidationError(
        `Duplicate invoice reference_no "${referenceNo}" for this customer.`,
        {
          field: "reference_no",
          reference_no: referenceNo,
        },
      );
    }
  }

  protected async resolveTaxCode(
    companyId: string,
    raw: Record<string, unknown>,
  ): Promise<string | undefined> {
    const explicitTaxCodeId = asString(raw, "tax_code_id");
    if (explicitTaxCodeId) {
      validateUUID(explicitTaxCodeId, "tax_code_id");
      return explicitTaxCodeId;
    }

    const taxRateText = asString(raw, "tax_rate");
    if (!taxRateText) return undefined;
    const taxRate = parseNumber(taxRateText, "tax_rate");
    if (taxRate <= 0) return undefined;

    const { data, error } = await this.client
      .from("tax_codes")
      .select("id")
      .eq("company_id", companyId)
      .eq("tax_type", "Output")
      .eq("is_active", true)
      .eq("rate", taxRate)
      .limit(2);

    if (error) throw new Error(`Failed to resolve tax code: ${error.message}`);
    if (!data || data.length === 0) {
      throw new ValidationError(
        `No active output tax code found for tax_rate ${taxRate}.`,
        { tax_rate: taxRate },
      );
    }
    if (data.length > 1) {
      throw new ValidationError(
        `Multiple output tax codes found for tax_rate ${taxRate}. Use tax_code_id.`,
        { tax_rate: taxRate },
      );
    }
    return data[0].id;
  }

  protected async listRowsInternal(batchId: string): Promise<ImportRow[]> {
    const { data, error } = await this.client
      .from("import_rows")
      .select("*")
      .eq("batch_id", batchId)
      .order("row_number");

    if (error) throw new Error(`Failed to list import rows: ${error.message}`);
    return (data ?? []) as ImportRow[];
  }

  protected async updateBatch(
    batchId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client
      .from("import_batches")
      .update(patch)
      .eq("id", batchId);
    if (error) {
      throw new Error(`Failed to update import batch: ${error.message}`);
    }
  }

  protected async markBatchFailed(
    batchId: string,
    errors: Array<Record<string, unknown>>,
  ): Promise<void> {
    await this.updateBatch(batchId, {
      status: "Failed",
      error_summary: errors,
      completed_at: new Date().toISOString(),
    });
  }
}

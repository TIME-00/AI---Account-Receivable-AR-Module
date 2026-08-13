import { fetchById } from "../_shared/db.ts";
import { NotFoundError, ValidationError } from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { requireCustomerAccess } from "../_shared/auth.ts";
import { validateUUID } from "../_shared/validators.ts";
import { roundMoney } from "../_shared/money.ts";
import type {
  BankAccount,
  CreateCustomerRequest,
  Invoice,
} from "../_shared/types.ts";
import { CustomerService } from "../customers/service.ts";
import { validateCreateCustomer } from "../customers/validators.ts";
import {
  FUZZY_CANDIDATE_LIMIT,
  FUZZY_INVOICE_REVIEW_THRESHOLD,
  normalizeIdentifier,
  topFuzzyCandidates,
} from "../_shared/fuzzy.ts";
import {
  asString,
  type BankAccountResolutionDetails,
  type CustomerResolutionDetails,
  type ImportRowStatus,
  type ResolvedImportCustomer,
} from "./service-base.ts";
import { ImportValidationService } from "./validation-service.ts";
export abstract class ImportResolutionService extends ImportValidationService {
  protected async resolveOrCreateImportCustomer(
    auth: AuthContext,
    raw: Record<string, unknown>,
    cache: Map<string, ResolvedImportCustomer>,
  ): Promise<ResolvedImportCustomer> {
    const cacheKey = this.importCustomerCacheKey(raw);
    const classification = await this.customerService.classifyImportCustomer(
      auth,
      {
        customerCode: asString(raw, "customer_code") || undefined,
        customerName: asString(raw, "customer_name") || undefined,
        registrationNo: asString(raw, "registration_no") || undefined,
      },
    );

    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        created: false,
        details: {
          ...cached.details,
          action: "Matched Existing",
          matched_by: cached.created
            ? "created_in_batch"
            : cached.details.matched_by,
        },
      };
    }

    if (classification.customer) {
      await requireCustomerAccess(auth, classification.customer.id);
      const resolved = {
        customer: classification.customer,
        created: false,
        details: this.toCustomerResolutionDetails(classification),
      };
      cache.set(cacheKey, resolved);
      return resolved;
    }

    if (classification.action === "Review Required") {
      throw new ValidationError(
        "Customer fuzzy match requires manual review before import execution.",
        {
          field: "customer_name",
          reason: "customer_suggestion_review_required",
          suggestions: classification.suggestions,
        },
      );
    }

    const customerInput = this.validateNewCustomerInput(raw);
    const result = await this.customerService.createInlineCustomer(
      auth,
      customerInput,
    );
    await requireCustomerAccess(auth, result.customer.id);
    const resolved = {
      customer: result.customer,
      created: result.created,
      details: {
        action: result.created
          ? "Create New" as const
          : "Matched Existing" as const,
        customer_id: result.customer.id,
        customer_code: result.customer.customer_id,
        customer_name: result.customer.customer_name,
        matched_by: result.created ? null : "normalized_name" as const,
      },
    };
    cache.set(cacheKey, resolved);
    return resolved;
  }

  protected validateNewCustomerInput(
    raw: Record<string, unknown>,
  ): CreateCustomerRequest {
    return validateCreateCustomer({
      customer_name: asString(raw, "customer_name"),
      customer_type: "Corporate",
      registration_no: asString(raw, "registration_no"),
      bill_addr_line1: asString(raw, "bill_addr_line1"),
      bill_city: asString(raw, "bill_city"),
      bill_state: asString(raw, "bill_state"),
      bill_postal: asString(raw, "bill_postal"),
      bill_country: asString(raw, "bill_country"),
      contact_name: asString(raw, "contact_name"),
      contact_phone: asString(raw, "contact_phone"),
      contact_email: asString(raw, "contact_email"),
    });
  }

  protected importCustomerCacheKey(raw: Record<string, unknown>): string {
    const code = asString(raw, "customer_code");
    if (code) return `code:${code.toLocaleUpperCase()}`;
    return `name:${
      asString(raw, "customer_name").trim().replace(/\s+/g, " ")
        .toLocaleLowerCase()
    }`;
  }

  protected toCustomerResolutionDetails(
    classification: Awaited<
      ReturnType<CustomerService["classifyImportCustomer"]>
    >,
  ): CustomerResolutionDetails {
    return {
      action: classification.action,
      customer_id: classification.customer?.id ?? null,
      customer_code: classification.customer?.customer_id ?? null,
      customer_name: classification.customer?.customer_name ??
        classification.normalizedCustomerName,
      matched_by: classification.matchedBy,
    };
  }

  protected customerSuggestionDiagnostics(
    classification: Awaited<
      ReturnType<CustomerService["classifyImportCustomer"]>
    >,
  ): Record<string, unknown> {
    const suggestions = classification.suggestions ?? [];
    if (suggestions.length === 0) return {};

    return {
      review_required: true,
      review_kind: "customer_suggestion",
      confidence: classification.confidence ?? suggestions[0].confidence,
      suggestion_reason: classification.suggestionReason ??
        suggestions[0].reason,
      match_confidence: classification.confidence ?? suggestions[0].confidence,
      match_reason_codes: [
        classification.suggestionReason ?? suggestions[0].reason,
      ],
      suggested_customer_id: suggestions[0].customer_id,
      suggested_customer_code: suggestions[0].customer_code,
      suggested_customer_name: suggestions[0].customer_name,
      suggested_customers: suggestions,
      customer_candidates: suggestions,
      user_action: "pending",
    };
  }

  protected async resolveBankAccount(
    companyId: string,
    raw: Record<string, unknown>,
  ): Promise<BankAccountResolutionDetails> {
    const bankAccountId = asString(raw, "bank_account_id");
    const bankAccountCode = asString(raw, "bank_account_code");

    if (!bankAccountId && !bankAccountCode) {
      throw new ValidationError(
        "Either bank_account_id or bank_account_code is required for receipt import.",
        {
          field: "bank_account_id",
        },
      );
    }

    let bankAccount: BankAccount | null = null;
    let matchedBy: BankAccountResolutionDetails["matched_by"] =
      "bank_account_code";

    if (bankAccountId) {
      validateUUID(bankAccountId, "bank_account_id");
      bankAccount = await fetchById<BankAccount>(
        this.client,
        "bank_accounts",
        bankAccountId,
      );
      matchedBy = "bank_account_id";
    } else {
      const { data, error } = await this.client
        .from("bank_accounts")
        .select("*")
        .eq("company_id", companyId)
        .eq("account_no", bankAccountCode)
        .limit(2);

      if (error) {
        throw new Error(
          `Failed to resolve bank_account_code: ${error.message}`,
        );
      }
      if (!data || data.length === 0) {
        throw new ValidationError(
          `Active bank_account_code "${bankAccountCode}" could not be resolved.`,
          {
            field: "bank_account_code",
            bank_account_code: bankAccountCode,
          },
        );
      }
      if (data.length > 1) {
        throw new ValidationError(
          `Multiple bank accounts found for bank_account_code "${bankAccountCode}". Use bank_account_id.`,
          {
            field: "bank_account_code",
            bank_account_code: bankAccountCode,
          },
        );
      }
      bankAccount = data[0] as BankAccount;
    }

    if (bankAccount.company_id !== companyId) {
      throw new NotFoundError("BankAccount", bankAccount.id);
    }
    if (!bankAccount.is_active) {
      throw new ValidationError("Selected bank account is inactive.", {
        field: "bank_account_id",
        bank_account_id: bankAccount.id,
      });
    }
    if (bankAccountCode && bankAccount.account_no !== bankAccountCode) {
      throw new ValidationError(
        "bank_account_code conflicts with resolved bank_account_id.",
        {
          field: "bank_account_code",
          bank_account_id: bankAccount.id,
          bank_account_code: bankAccountCode,
        },
      );
    }

    return {
      bank_account_id: bankAccount.id,
      account_no: bankAccount.account_no,
      bank_name: bankAccount.bank_name,
      matched_by: matchedBy,
    };
  }

  protected async invoiceReferenceSuggestionDiagnostics(
    companyId: string,
    customerId: string,
    currency: string,
    invoiceReference: string,
    mappedData: Record<string, unknown>,
  ): Promise<
    { status: ImportRowStatus; mappedData: Record<string, unknown> } | null
  > {
    const { data, error } = await this.client
      .from("invoices")
      .select("id, invoice_no, currency, status, outstanding")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .limit(250);

    if (error) {
      throw new Error(
        `Failed to inspect invoice_reference suggestions: ${error.message}`,
      );
    }

    const invoices = (data ?? []) as Array<
      Pick<Invoice, "id" | "invoice_no" | "currency" | "status" | "outstanding">
    >;
    const rawMatch = invoices.find((invoice) =>
      invoice.invoice_no === invoiceReference
    );
    if (rawMatch) {
      if (rawMatch.currency !== currency) {
        return {
          status: "Unmatched",
          mappedData: this.invoiceSuggestionMappedData(
            mappedData,
            "currency_mismatch",
            [{
              invoice_id: rawMatch.id,
              invoice_no: rawMatch.invoice_no,
              confidence: 1,
              reason: "exact_invoice_no_currency_mismatch",
              outstanding: Number(rawMatch.outstanding),
              currency: rawMatch.currency,
              status: rawMatch.status,
              allocatable: false,
            }],
            "Invoice reference matches an invoice, but its currency does not match the receipt currency.",
          ),
        };
      }
      if (!this.isAllocatableInvoice(rawMatch)) {
        return {
          status: "Skipped",
          mappedData: this.invoiceSuggestionMappedData(
            mappedData,
            Number(rawMatch.outstanding) <= 0
              ? "no_outstanding"
              : "invoice_not_open",
            [{
              invoice_id: rawMatch.id,
              invoice_no: rawMatch.invoice_no,
              confidence: 1,
              reason: Number(rawMatch.outstanding) <= 0
                ? "no_outstanding"
                : "invoice_not_open",
              outstanding: Number(rawMatch.outstanding),
              currency: rawMatch.currency,
              status: rawMatch.status,
              allocatable: false,
            }],
            "Invoice reference matches an invoice, but it is not currently allocatable.",
          ),
        };
      }
      return null;
    }

    const normalizedReference = normalizeIdentifier(invoiceReference);
    const normalizedMatches = invoices
      .filter((invoice) =>
        normalizeIdentifier(invoice.invoice_no) === normalizedReference
      )
      .slice(0, FUZZY_CANDIDATE_LIMIT)
      .map((invoice) =>
        this.invoiceCandidate(
          invoice,
          this.normalizedInvoiceSuggestionReason(invoice, currency),
          0.97,
          currency,
        )
      );

    if (normalizedMatches.length > 0) {
      return {
        status: normalizedMatches.some((candidate) => candidate.allocatable)
          ? "Unmatched"
          : this.nonAllocatableSuggestionStatus(normalizedMatches),
        mappedData: this.invoiceSuggestionMappedData(
          mappedData,
          "normalized_invoice_no",
          normalizedMatches,
          "Invoice reference differs from an existing invoice number only by spacing, case, or punctuation. Review is required before allocation.",
        ),
      };
    }

    const allocatableInvoices = invoices.filter((invoice) =>
      invoice.currency === currency && this.isAllocatableInvoice(invoice)
    );
    const fuzzyMatches = topFuzzyCandidates(
      invoiceReference,
      allocatableInvoices,
      (invoice) => invoice.invoice_no,
      FUZZY_INVOICE_REVIEW_THRESHOLD,
    ).map((candidate) =>
      this.invoiceCandidate(
        candidate.item,
        candidate.reason,
        candidate.confidence,
        currency,
      )
    );

    if (fuzzyMatches.length > 0) {
      return {
        status: "Unmatched",
        mappedData: this.invoiceSuggestionMappedData(
          mappedData,
          fuzzyMatches.length > 1
            ? "multiple_invoice_candidates"
            : String(fuzzyMatches[0].reason),
          fuzzyMatches,
          "Invoice reference did not match exactly. Review the suggested invoice before allocation.",
        ),
      };
    }

    return {
      status: "Unmatched",
      mappedData: this.invoiceSuggestionMappedData(
        mappedData,
        "invoice_not_found",
        [],
        "No invoice found for this invoice_reference. Review is required before posting/allocation.",
      ),
    };
  }

  protected invoiceCandidate(
    invoice: Pick<
      Invoice,
      "id" | "invoice_no" | "currency" | "status" | "outstanding"
    >,
    reason: string,
    confidence: number,
    receiptCurrency: string,
  ): Record<string, unknown> {
    return {
      invoice_id: invoice.id,
      invoice_no: invoice.invoice_no,
      confidence,
      reason,
      outstanding: Number(invoice.outstanding),
      currency: invoice.currency,
      status: invoice.status,
      allocatable: invoice.currency === receiptCurrency &&
        this.isAllocatableInvoice(invoice),
    };
  }

  protected normalizedInvoiceSuggestionReason(
    invoice: Pick<Invoice, "currency" | "status" | "outstanding">,
    receiptCurrency: string,
  ): string {
    if (invoice.currency !== receiptCurrency) return "currency_mismatch";
    if (Number(invoice.outstanding) <= 0) return "no_outstanding";
    if (!["Open", "Overdue", "Partially Paid"].includes(invoice.status)) {
      return "invoice_not_open";
    }
    return "normalized_invoice_no";
  }

  protected invoiceSuggestionMappedData(
    mappedData: Record<string, unknown>,
    reason: string,
    candidates: Array<Record<string, unknown>>,
    message: string,
  ): Record<string, unknown> {
    const top = candidates[0];
    const autoRejected = candidates.length === 0 &&
      reason === "invoice_not_found";
    return {
      ...mappedData,
      review_required: true,
      review_kind: mappedData.review_kind === "customer_suggestion"
        ? "both"
        : "invoice_suggestion",
      allocation_status: "Review Required",
      allocation_error: message,
      allocation_error_reason: reason,
      confidence: top?.confidence,
      suggestion_reason: reason,
      match_confidence: top?.confidence,
      match_reason_codes: [reason],
      suggested_invoice_id: top?.invoice_id ?? null,
      suggested_invoice_no: top?.invoice_no ?? null,
      suggested_invoices: candidates,
      invoice_candidates: candidates,
      user_action: autoRejected ? "auto_rejected" : "pending",
      ...(autoRejected
        ? {
          review_result: "rejected",
          rejected_at: new Date().toISOString(),
          auto_rejected: true,
          auto_reject_reason: reason,
        }
        : {}),
    };
  }

  protected nonAllocatableSuggestionStatus(
    candidates: Array<Record<string, unknown>>,
  ): ImportRowStatus {
    return candidates.some((candidate) =>
        candidate.reason === "no_outstanding" ||
        candidate.reason === "invoice_not_open"
      )
      ? "Skipped"
      : "Unmatched";
  }

  protected isAllocatableInvoice(
    invoice: Pick<Invoice, "status" | "outstanding">,
  ): boolean {
    return ["Open", "Overdue", "Partially Paid"].includes(invoice.status) &&
      Number(invoice.outstanding) > 0;
  }

  protected async preflightReceiptImportAllocation(
    auth: AuthContext,
    customerId: string,
    mappedData: Record<string, unknown>,
  ): Promise<
    { status: ImportRowStatus; mappedData: Record<string, unknown> } | null
  > {
    const invoiceReference = asString(mappedData, "invoice_reference");
    if (!invoiceReference) return null;

    const explicitAmount = mappedData.allocation_amount !== undefined
      ? Number(mappedData.allocation_amount)
      : undefined;
    const discountAmount = mappedData.discount_amount !== undefined
      ? Number(mappedData.discount_amount)
      : 0;
    if (
      explicitAmount !== undefined &&
      (!Number.isFinite(explicitAmount) || explicitAmount <= 0)
    ) {
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

    let invoice: Invoice;
    try {
      invoice = await this.resolveAllocationInvoice(
        auth.companyId,
        customerId,
        asString(mappedData, "currency"),
        invoiceReference,
      );
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      const reason = typeof error.details.reason === "string"
        ? error.details.reason
        : "allocation_preflight_failed";
      return {
        status: this.importAllocationPreflightStatus(reason),
        mappedData: {
          ...mappedData,
          allocation_status: reason === "invoice_not_found_for_customer" ||
              reason === "currency_mismatch" || reason === "multiple_matches"
            ? "Unmatched"
            : "Review Required",
          review_required: true,
          auto_post_eligible: false,
          auto_post_block_reason: error.message,
          allocation_error: error.message,
          allocation_error_reason: reason,
          invoice_status: error.details.invoice_status,
          invoice_currency: error.details.invoice_currency,
          receipt_currency: error.details.receipt_currency,
          outstanding: error.details.outstanding,
        },
      };
    }

    const invoiceOutstanding = Number(invoice.outstanding);
    const allocationAmount = explicitAmount ??
      Math.min(Number(mappedData.receipt_amount), invoiceOutstanding);
    const settlementAmount = allocationAmount + discountAmount;
    if (settlementAmount <= invoiceOutstanding + 0.01) return null;

    const receiptAmount = Number(mappedData.receipt_amount);
    const allocationSuggestion = roundMoney(
      Math.min(receiptAmount, invoiceOutstanding),
    );
    const unappliedAmount = roundMoney(
      Math.max(receiptAmount - allocationSuggestion, 0),
    );
    const reason = discountAmount > 0
      ? "allocation_amount plus discount_amount exceeds invoice outstanding"
      : "allocation_amount exceeds invoice outstanding";

    return {
      status: "Skipped",
      mappedData: {
        ...mappedData,
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        allocation_status: "Review Required",
        review_required: true,
        auto_post_eligible: false,
        auto_post_block_reason: reason,
        overpayment_detected: discountAmount === 0,
        discount_validation_error: discountAmount > 0 ? reason : undefined,
        excess_settlement_amount: discountAmount > 0
          ? roundMoney(settlementAmount - invoiceOutstanding)
          : undefined,
        suggested_reason: discountAmount > 0
          ? "discount"
          : mappedData.suggested_reason,
        unapplied_amount: unappliedAmount,
        allocation_suggestion: allocationSuggestion,
      },
    };
  }
}

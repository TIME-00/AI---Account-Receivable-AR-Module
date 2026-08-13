import { SupabaseClient } from "supabase";
import {
  AuthorizationError,
  BusinessError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import type { Invoice, PaginationParams } from "../_shared/types.ts";
import type { CreateInvoiceInput } from "./validators.ts";
import { getVisibleCustomerIds } from "../_shared/visibility.ts";
import {
  fxPostingEligibility,
  isBaseValueAvailable,
} from "../_shared/fx-read-contracts.ts";
import {
  CURRENT_OUTSTANDING_AMOUNT_BASIS,
  parseMonetaryCollectionSummary,
} from "../reports/monetary-contracts.ts";
import type { MonetaryCollectionSummary } from "../reports/monetary-contracts.ts";
import {
  type FxDecisionSummaryRow,
  LINKED_CREDIT_NOTE_REFERENCE_STATUSES,
} from "./service-base.ts";
import { InvoiceServiceBase } from "./service-base.ts";
export abstract class InvoiceAuthorityService extends InvoiceServiceBase {
  /**
   * User-domain reads must execute with the caller's authenticated client so
   * auth.uid(), RLS, and migration-027 EXECUTE privileges remain authoritative.
   * The trusted mutation client is deliberately never used as a fallback.
   */
  protected requireReadClient(): SupabaseClient {
    if (!this.readClient) {
      throw new Error(
        "Authenticated read client is required for invoice user-domain reads.",
      );
    }
    return this.readClient;
  }

  protected readScopeMode(auth: AuthContext): "company" | "assigned" {
    return auth.roles.some((role) =>
        ["AR Supervisor", "Finance Manager", "Auditor"].includes(role)
      )
      ? "company"
      : "assigned";
  }

  protected collectionReadParams(
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

  protected async getAuthoritativeCollection(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<
    { rows: Invoice[]; total: number; summary: MonetaryCollectionSummary }
  > {
    const readClient = this.requireReadClient();
    const { data, error } = await readClient.rpc("ar_invoice_collection", {
      ...this.collectionReadParams(auth, filters),
      p_page: pagination.page,
      p_page_size: pagination.page_size,
    });
    if (error) {
      if (error.code === "42501") {
        throw new AuthorizationError();
      }
      throw new BusinessError(
        "REPORT_QUERY_FAILED",
        "Unable to retrieve the requested collection.",
        500,
      );
    }
    if (!data || typeof data !== "object") {
      throw new BusinessError(
        "REPORT_CONTRACT_INVALID",
        "Failed to list invoices: invalid response.",
        500,
      );
    }
    const result = data as {
      rows?: unknown;
      total?: unknown;
      summary?: unknown;
    };
    if (
      !Array.isArray(result.rows) || !Number.isSafeInteger(result.total) ||
      Number(result.total) < 0
    ) {
      throw new BusinessError(
        "REPORT_CONTRACT_INVALID",
        "Failed to list invoices: invalid response.",
        500,
      );
    }
    let summary: MonetaryCollectionSummary;
    try {
      summary = parseMonetaryCollectionSummary(result.summary, {
        currentAmountBasis: CURRENT_OUTSTANDING_AMOUNT_BASIS,
      });
    } catch {
      throw new BusinessError(
        "REPORT_CONTRACT_INVALID",
        "Failed to list invoices: invalid monetary summary contract.",
        500,
      );
    }
    return {
      rows: result.rows as Invoice[],
      total: Number(result.total),
      summary,
    };
  }

  protected async getReadableCustomerIds(auth: AuthContext): Promise<string[]> {
    const visibleCustomerIds = await getVisibleCustomerIds(
      this.client,
      auth.companyId,
    );
    if (visibleCustomerIds.length === 0) return [];

    const fullAccessRoles = ["AR Supervisor", "Finance Manager", "Auditor"];
    if (auth.roles.some((role) => fullAccessRoles.includes(role))) {
      return visibleCustomerIds;
    }

    const { data, error } = await this.client
      .from("user_customer_assignments")
      .select("customer_id")
      .eq("user_id", auth.userId)
      .eq("company_id", auth.companyId)
      .eq("is_active", true)
      .in("customer_id", visibleCustomerIds);

    if (error) {
      throw new Error(`Failed to fetch customer assignments: ${error.message}`);
    }
    return (data ?? []).map((row: { customer_id: string }) => row.customer_id);
  }

  protected async requireWritableCustomer(
    auth: AuthContext,
    customerId: string,
  ): Promise<void> {
    const readableCustomerIds = await this.getReadableCustomerIds(auth);
    if (!readableCustomerIds.includes(customerId)) {
      throw new NotFoundError("Customer", customerId);
    }
  }

  /**
   * Defense-in-depth validation for Credit/Debit Note creation and Draft FX
   * edits. Migration 028 remains the authoritative all-write-path boundary.
   * Invalid references deliberately share one non-disclosing public contract.
   */
  protected async validateLinkedCreditNoteReference(
    data: Pick<
      CreateInvoiceInput,
      "doc_type" | "cn_type" | "ref_invoice_id" | "customer_id" | "currency"
    >,
    companyId: string,
    documentId?: string,
  ): Promise<void> {
    if (data.doc_type === "Debit Note") {
      if (data.cn_type || data.ref_invoice_id === documentId) {
        throw new BusinessError(
          "BR-DN-REF",
          "Debit Note reference is invalid or unavailable.",
          400,
          { field: "ref_invoice_id" },
        );
      }
      if (!data.ref_invoice_id) return;

      const { data: referenceData, error } = await this.client
        .from("invoices")
        .select("id, company_id, customer_id, currency, doc_type, status")
        .eq("id", data.ref_invoice_id)
        .maybeSingle();
      if (error) {
        throw new Error(
          `Failed to validate Debit Note reference: ${error.message}`,
        );
      }
      const reference = referenceData as
        | Pick<
          Invoice,
          | "id"
          | "company_id"
          | "customer_id"
          | "currency"
          | "doc_type"
          | "status"
        >
        | null;
      const valid = reference !== null &&
        ["Invoice", "Credit Note"].includes(reference.doc_type) &&
        reference.company_id === companyId &&
        reference.customer_id === data.customer_id &&
        reference.currency === data.currency &&
        ["Open", "Overdue", "Partially Paid", "Paid"].includes(
          reference.status,
        );
      if (!valid) {
        throw new BusinessError(
          "BR-DN-REF",
          "Debit Note reference is invalid or unavailable.",
          400,
          { field: "ref_invoice_id" },
        );
      }
      return;
    }

    if (data.doc_type !== "Credit Note") {
      if (data.cn_type || data.ref_invoice_id) {
        throw new BusinessError(
          "BR-DOC-REF",
          "Financial document reference is invalid or unavailable.",
          400,
          { field: "ref_invoice_id" },
        );
      }
      return;
    }

    if (data.cn_type !== "Linked") {
      if (data.ref_invoice_id) {
        throw new BusinessError(
          "BR-CN-REF",
          "ref_invoice_id is only permitted for Linked Credit Notes.",
          400,
          { field: "ref_invoice_id" },
        );
      }
      return;
    }

    if (!data.ref_invoice_id || data.ref_invoice_id === documentId) {
      throw new BusinessError(
        "BR-CN-REF",
        "Linked Credit Note reference is invalid or unavailable.",
        400,
        { field: "ref_invoice_id" },
      );
    }

    const { data: referenceData, error } = await this.client
      .from("invoices")
      .select("id, company_id, customer_id, currency, doc_type, status")
      .eq("id", data.ref_invoice_id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to validate Linked Credit Note reference: ${error.message}`,
      );
    }

    const reference = referenceData as
      | Pick<
        Invoice,
        "id" | "company_id" | "customer_id" | "currency" | "doc_type" | "status"
      >
      | null;
    const valid = reference !== null &&
      reference.doc_type === "Invoice" &&
      reference.company_id === companyId &&
      reference.customer_id === data.customer_id &&
      reference.currency === data.currency &&
      LINKED_CREDIT_NOTE_REFERENCE_STATUSES.includes(reference.status);

    if (!valid) {
      throw new BusinessError(
        "BR-CN-REF",
        "Linked Credit Note reference is invalid or unavailable.",
        400,
        { field: "ref_invoice_id" },
      );
    }
  }

  protected async attachFxDecisionReadSummary<T extends Invoice>(
    companyId: string,
    invoices: T[],
  ): Promise<T[]> {
    const readClient = this.requireReadClient();
    const decisionIds = [
      ...new Set(
        invoices.map((inv) => inv.fx_decision_id).filter((id): id is string =>
          Boolean(id)
        ),
      ),
    ];
    if (decisionIds.length === 0) {
      return invoices.map((inv) => ({
        ...inv,
        base_available: isBaseValueAvailable(inv.base_total),
        fx_posting_eligibility: {
          gate: "fx_governance",
          eligible: false,
          reason: "missing_decision",
        },
        fx_decision: null,
      }));
    }

    const { data, error } = await readClient
      .from("fx_booking_rate_decisions")
      .select(
        "id, source_category, approval_status, lifecycle_status, decision_version, root_decision_id, supersedes_decision_id, import_origin, booked_rate, deviation_pct, stale_reference",
      )
      .eq("company_id", companyId)
      .in("id", decisionIds);

    if (error) {
      throw new Error(
        `Failed to fetch invoice FX decision summaries: ${error.message}`,
      );
    }

    const decisionRows = (data ?? []) as FxDecisionSummaryRow[];
    const decisions = new Map<string, FxDecisionSummaryRow>(
      decisionRows.map((
        decision: FxDecisionSummaryRow,
      ) => [String(decision.id), decision]),
    );

    return invoices.map((inv) => {
      const decision = inv.fx_decision_id
        ? decisions.get(inv.fx_decision_id)
        : null;
      const fxGate = fxPostingEligibility(
        decision
          ? {
            source_category: String(decision.source_category),
            approval_status: String(decision.approval_status),
            lifecycle_status: String(decision.lifecycle_status),
            stale_reference: Boolean(decision.stale_reference),
          }
          : null,
      );

      return {
        ...inv,
        base_available: isBaseValueAvailable(inv.base_total),
        fx_posting_eligibility: fxGate,
        fx_decision: decision
          ? {
            id: String(decision.id),
            source_category: String(decision.source_category),
            approval_status: String(decision.approval_status),
            lifecycle_status: String(decision.lifecycle_status),
            decision_version: Number(decision.decision_version),
            root_decision_id: String(decision.root_decision_id),
            supersedes_decision_id: decision.supersedes_decision_id
              ? String(decision.supersedes_decision_id)
              : null,
            import_origin: (decision.import_origin ?? null) as
              | Record<string, unknown>
              | null,
            booked_rate: Number(decision.booked_rate),
            deviation_pct: decision.deviation_pct === null
              ? null
              : Number(decision.deviation_pct),
            stale_reference: Boolean(decision.stale_reference),
            fx_posting_eligible: fxGate.eligible,
          }
          : null,
      };
    });
  }

  protected async resolveTaxRateForInvoiceLine(
    companyId: string,
    taxCodeId: string,
    invoiceDate: string,
  ): Promise<number> {
    const { data: taxCode, error } = await this.client
      .from("tax_codes")
      .select("rate")
      .eq("id", taxCodeId)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .lte("effective_from", invoiceDate)
      .or(`effective_to.is.null,effective_to.gte.${invoiceDate}`)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to validate tax code: ${error.message}`);
    }

    if (!taxCode) {
      throw new ValidationError(
        "tax_code_id is not active, effective, or available for this company.",
        {
          field: "tax_code_id",
        },
      );
    }

    return Number(taxCode.rate);
  }
}

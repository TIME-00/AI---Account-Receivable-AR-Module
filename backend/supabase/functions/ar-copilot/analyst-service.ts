import type { SupabaseClient } from "supabase";
import type { AuthContext } from "../_shared/auth.ts";
import {
  requireAnyRole,
  requireCustomerAccess,
  requireOperationalReadRole,
} from "../_shared/auth.ts";
import { NotFoundError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import { ReceiptService } from "../receipts/service.ts";
import { ReportService } from "../reports/service.ts";
import type { LiveDashboardMetrics } from "../reports/dashboard-types.ts";
import { moneyToMinor } from "../reports/export-contract.ts";
import type {
  CopilotEvidence,
  CopilotLink,
  CopilotToolOutcome,
} from "./contract.ts";
import type {
  AnalysisFactor,
  AnalystAnalysis,
  AnalystReportPlan,
} from "./analyst-contract.ts";
import {
  ANALYST_MAX_DOCUMENT_FIELDS,
  ANALYST_MAX_RECOVERY_CANDIDATES,
} from "./analyst-contract.ts";
import {
  assertChartPreservesReport,
  buildChartSpec,
  buildCollectionHealthAnalysis,
  buildDailyBrief,
  buildExposureMovementAnalysis,
  buildPriorityAnalysis,
  exactMoney,
  recoveryCandidates,
} from "./analyst-engine.ts";
import {
  AnalystReportService,
  SupabaseAnalystReportSources,
} from "./analyst-report-service.ts";
import type { CopilotReadServiceContract } from "./read-service.ts";
import { trustedEntityLink } from "./read-service.ts";

type Row = Record<string, unknown>;

function evidence(
  kind: CopilotEvidence["kind"],
  id: string,
  label: string,
  number: string | null = null,
): CopilotEvidence {
  return { kind, id, label: label.slice(0, 160), number };
}

function dataRecord(outcome: CopilotToolOutcome): Row {
  if (Array.isArray(outcome.data)) {
    throw new Error("Expected one bounded record.");
  }
  return outcome.data;
}

function stringValue(value: unknown, maximum = 160): string | null {
  return typeof value === "string" ? value.slice(0, maximum) : null;
}

const SAFE_DOCUMENT_FIELD_NAMES = [
  "invoice_no",
  "invoice_date",
  "due_date",
  "currency",
  "total_amount",
  "receipt_no",
  "receipt_date",
  "value_date",
  "receipt_amount",
  "reference_no",
] as const;

export function selectSafeDocumentFields(
  value: unknown,
): Array<{ field: string; value: string | null; provenance: "EXTRACTED" }> {
  const extracted = value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : {};
  return SAFE_DOCUMENT_FIELD_NAMES.filter((field) =>
    Object.hasOwn(extracted, field)
  ).slice(0, ANALYST_MAX_DOCUMENT_FIELDS).map((field) => ({
    field,
    value: stringValue(extracted[field], 120),
    provenance: "EXTRACTED" as const,
  }));
}

function analysisOutcome(
  analysis: AnalystAnalysis,
  sourceEvidence: CopilotEvidence[],
  links: CopilotLink[],
): CopilotToolOutcome {
  return {
    data: analysis as unknown as Row,
    evidence: sourceEvidence.slice(0, 20),
    links: links.slice(0, 10),
    artifacts: [{ kind: "analysis", analysis: analysis as unknown as Row }],
  };
}

export interface CopilotAnalystServiceContract {
  getArPriorityAnalysis(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome>;
  getCustomerRiskAnalysis(
    auth: AuthContext,
    customerId: string,
  ): Promise<CopilotToolOutcome>;
  getCollectionHealthAnalysis(
    auth: AuthContext,
    months: number,
  ): Promise<CopilotToolOutcome>;
  getExposureMovementAnalysis(
    auth: AuthContext,
    metric: "overdue" | "aging",
  ): Promise<CopilotToolOutcome>;
  getUnappliedCashAnalysis(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome>;
  getRootCauseAnalysis(
    auth: AuthContext,
    targetType: "customer" | "invoice" | "receipt" | "automation_document",
    targetId: string,
  ): Promise<CopilotToolOutcome>;
  getDailyBrief(auth: AuthContext, limit: number): Promise<CopilotToolOutcome>;
  runReport(
    auth: AuthContext,
    plan: AnalystReportPlan,
  ): Promise<CopilotToolOutcome>;
  analyzeAutomationDocument(
    auth: AuthContext,
    documentId: string,
  ): Promise<CopilotToolOutcome>;
  analyzeExceptionRecovery(
    auth: AuthContext,
    exceptionId: string,
  ): Promise<CopilotToolOutcome>;
}

export class CopilotAnalystService implements CopilotAnalystServiceContract {
  readonly #admin: SupabaseClient;
  readonly #user: SupabaseClient;
  readonly #base: CopilotReadServiceContract;
  readonly #reports: ReportService;
  readonly #receipts: ReceiptService;
  readonly #analystReports: AnalystReportService;
  readonly #businessDate: string;

  constructor(
    admin: SupabaseClient,
    user: SupabaseClient,
    base: CopilotReadServiceContract,
    businessDate: string,
  ) {
    this.#admin = admin;
    this.#user = user;
    this.#base = base;
    this.#businessDate = businessDate;
    this.#reports = new ReportService(admin, user);
    this.#receipts = new ReceiptService(admin, user);
    this.#analystReports = new AnalystReportService(
      new SupabaseAnalystReportSources(admin, user),
      businessDate,
    );
  }

  async #dashboard(
    auth: AuthContext,
    months = 6,
  ): Promise<LiveDashboardMetrics> {
    return await this.#reports.getDashboardMetrics(
      auth,
      this.#businessDate,
      months,
    );
  }

  async #exceptionRows(
    auth: AuthContext,
    limit: number,
  ): Promise<
    Array<
      {
        id: string;
        reason_code: string;
        lifecycle_status: string;
        opened_at: string;
      }
    >
  > {
    if (
      !auth.roles.some((role) =>
        ["AR Supervisor", "Finance Manager", "Auditor"].includes(role)
      )
    ) return [];
    const { data, error } = await this.#admin.from("automation_exceptions")
      .select("id,reason_code,lifecycle_status,opened_at")
      .eq("company_id", auth.companyId)
      .in("lifecycle_status", ["open", "retryable"])
      .order("opened_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (error) throw new Error("Failed to load bounded exception priorities.");
    return ((data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      reason_code: String(row.reason_code),
      lifecycle_status: String(row.lifecycle_status),
      opened_at: String(row.opened_at),
    }));
  }

  async #overdueInvoiceCount(
    auth: AuthContext,
    customerId: string,
  ): Promise<number> {
    await requireCustomerAccess(auth, customerId);
    const { count, error } = await this.#user.from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("company_id", auth.companyId)
      .eq("customer_id", customerId)
      .eq("status", "Overdue")
      .gt("outstanding", 0);
    if (error) throw new Error("Failed to load scoped overdue count.");
    return count ?? 0;
  }

  async getArPriorityAnalysis(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome> {
    requireOperationalReadRole(auth);
    const [metrics, exceptions] = await Promise.all([
      this.#dashboard(auth),
      this.#exceptionRows(auth, limit),
    ]);
    const analysis = buildPriorityAnalysis(metrics, exceptions, limit);
    const sourceEvidence = analysis.priority_items.flatMap((item) =>
      item.entity_type === "customer"
        ? [
          evidence(
            "customer",
            item.entity_id,
            item.label,
            stringValue(item.facts.customer_code),
          ),
        ]
        : item.entity_type === "automation_exception"
        ? [evidence("automation_exception", item.entity_id, item.label)]
        : []
    );
    const links = analysis.priority_items.flatMap((item) => {
      const link = item.entity_type === "customer"
        ? trustedEntityLink("customer", item.entity_id, "View customer")
        : item.entity_type === "automation_exception"
        ? trustedEntityLink(
          "automation_exception",
          item.entity_id,
          "View exception",
        )
        : null;
      return link ? [link] : [];
    });
    return analysisOutcome(analysis, sourceEvidence, links);
  }

  async getCustomerRiskAnalysis(
    auth: AuthContext,
    customerId: string,
  ): Promise<CopilotToolOutcome> {
    requireOperationalReadRole(auth);
    const [customerOutcome, outstandingOutcome, overdueCount] = await Promise
      .all([
        this.#base.getCustomerSummary(auth, customerId),
        this.#base.listCustomerOutstanding(auth, customerId, 20),
        this.#overdueInvoiceCount(auth, customerId),
      ]);
    const customer = dataRecord(customerOutcome);
    const documents = Array.isArray(outstandingOutcome.data)
      ? outstandingOutcome.data
      : [];
    const overdueDocuments = documents.filter((row) =>
      row.status === "Overdue"
    );
    const factors: AnalysisFactor[] = [{
      factor_code: "STORED_CREDIT_RATING",
      impact_direction: "neutral" as const,
      metric: "credit_rating",
      current_value: stringValue(customer.credit_rating),
      comparison_value: null,
      absolute_change: null,
      percentage_change: null,
      evidence_type: "AUTHORITATIVE_FACT" as const,
      entity_refs: [{
        entity_type: "customer",
        entity_id: customerId,
        label: stringValue(customer.customer_name) ?? "Customer",
      }],
    }];
    if (overdueCount > 0) {
      factors.push({
        factor_code: "CUSTOMER_HAS_OVERDUE_INVOICES",
        impact_direction: "increases_attention",
        metric: "overdue_invoice_count",
        current_value: overdueCount,
        comparison_value: null,
        absolute_change: null,
        percentage_change: null,
        evidence_type: "DETERMINISTIC_DERIVATION",
        entity_refs: overdueDocuments.slice(0, 10).map((row) => ({
          entity_type: "invoice",
          entity_id: String(row.id),
          label: String(row.invoice_no),
        })),
      });
    }
    const analysis: AnalystAnalysis = {
      analysis_type: "customer_risk",
      as_of: this.#businessDate,
      base_currency: null,
      status: "complete",
      priority_items: [],
      factors,
      limitations: [
        "The stored credit rating remains authoritative; Copilot does not assign or recommend a replacement rating.",
        ...(overdueCount > overdueDocuments.length
          ? [
            "Entity references are bounded to the first 20 authorized outstanding documents; the overdue count is an exact scoped count.",
          ]
          : []),
      ],
    };
    return analysisOutcome(analysis, [
      ...customerOutcome.evidence,
      ...outstandingOutcome.evidence,
    ], [...customerOutcome.links, ...outstandingOutcome.links]);
  }

  async getCollectionHealthAnalysis(
    auth: AuthContext,
    months: number,
  ): Promise<CopilotToolOutcome> {
    requireOperationalReadRole(auth);
    const metrics = await this.#dashboard(auth, months);
    const analysis = buildCollectionHealthAnalysis(metrics);
    return analysisOutcome(analysis, [
      evidence(
        "ar_summary",
        `ar-summary:${auth.companyId}`,
        "Authorized collection trend",
      ),
    ], []);
  }

  async getExposureMovementAnalysis(
    auth: AuthContext,
    metric: "overdue" | "aging",
  ): Promise<CopilotToolOutcome> {
    requireOperationalReadRole(auth);
    const metrics = await this.#dashboard(auth, 2);
    const analysis = buildExposureMovementAnalysis(metrics, metric);
    return analysisOutcome(analysis, [
      evidence(
        "ar_summary",
        `ar-summary:${auth.companyId}`,
        "Current authorized AR exposure",
      ),
    ], []);
  }

  async getUnappliedCashAnalysis(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome> {
    requireOperationalReadRole(auth);
    const result = await this.#receipts.listReceipts(
      auth,
      { status: "Posted" },
      { page: 1, page_size: Math.min(200, limit * 5) },
    );
    const receipts = result.receipts.filter((row) =>
      moneyToMinor(
        exactMoney(row.unallocated_amount, "unallocated_amount"),
        "unallocated_amount",
      ) > 0n
    ).slice(0, limit).map((row, index) => ({
      category: "cash_application" as const,
      category_rank: index + 1,
      priority: "attention" as const,
      reason_codes: ["POSTED_CASH_UNAPPLIED"],
      entity_type: "receipt",
      entity_id: row.id,
      label: row.receipt_no,
      facts: {
        receipt_no: row.receipt_no,
        receipt_date: row.receipt_date,
        currency: row.currency,
        receipt_amount: exactMoney(row.receipt_amount, "receipt_amount"),
        unapplied_amount: exactMoney(
          row.unallocated_amount,
          "unallocated_amount",
        ),
      },
      evidence_type: "AUTHORITATIVE_FACT" as const,
    }));
    const analysis: AnalystAnalysis = {
      analysis_type: "unapplied_cash",
      as_of: this.#businessDate,
      base_currency: null,
      status: "complete",
      priority_items: receipts,
      factors: [],
      limitations: receipts.length === limit ||
          result.total > result.receipts.length
        ? [
          `Result is a bounded scan of ${result.receipts.length} authorized posted Receipts; refine the question or use the Receipt report for more rows.`,
        ]
        : [],
    };
    return analysisOutcome(
      analysis,
      receipts.map((row) =>
        evidence("receipt", row.entity_id, row.label, row.label)
      ),
      receipts.flatMap((row) => {
        const link = trustedEntityLink(
          "receipt",
          row.entity_id,
          "View receipt",
        );
        return link ? [link] : [];
      }),
    );
  }

  async getRootCauseAnalysis(
    auth: AuthContext,
    targetType: "customer" | "invoice" | "receipt" | "automation_document",
    targetId: string,
  ): Promise<CopilotToolOutcome> {
    validateUUID(targetId, "target_id");
    if (targetType === "customer") {
      return await this.getCustomerRiskAnalysis(auth, targetId);
    }
    if (targetType === "automation_document") {
      return await this.analyzeAutomationDocument(auth, targetId);
    }
    requireOperationalReadRole(auth);
    const outcome = targetType === "invoice"
      ? await this.#base.getInvoicePaymentContext(auth, targetId)
      : await this.#base.getReceiptAllocationContext(auth, targetId);
    const root = dataRecord(outcome);
    const entity = (root[targetType] ?? root) as Row;
    const allocations = Array.isArray(root.allocations) ? root.allocations : [];
    const outstanding = targetType === "invoice"
      ? stringValue(entity.outstanding)
      : stringValue(entity.unallocated_amount);
    const factors = [{
      factor_code: targetType === "invoice"
        ? "OUTSTANDING_BALANCE_REMAINS"
        : "UNAPPLIED_BALANCE_REMAINS",
      impact_direction: "increases_attention" as const,
      metric: targetType === "invoice"
        ? "outstanding_amount"
        : "unapplied_amount",
      current_value: outstanding,
      comparison_value: null,
      absolute_change: null,
      percentage_change: null,
      evidence_type: "AUTHORITATIVE_FACT" as const,
      entity_refs: [{
        entity_type: targetType,
        entity_id: targetId,
        label: stringValue(entity.invoice_no ?? entity.receipt_no) ??
          targetType,
      }],
    }, {
      factor_code: allocations.length === 0
        ? "NO_ACTIVE_ALLOCATION_EVIDENCE"
        : "ALLOCATION_EVIDENCE_PRESENT",
      impact_direction: allocations.length === 0
        ? "increases_attention" as const
        : "neutral" as const,
      metric: "allocation_count",
      current_value: allocations.length,
      comparison_value: null,
      absolute_change: null,
      percentage_change: null,
      evidence_type: "DIRECT_WORKFLOW_EVIDENCE" as const,
      entity_refs: [],
    }];
    const analysis: AnalystAnalysis = {
      analysis_type: "root_cause",
      as_of: this.#businessDate,
      base_currency: stringValue(entity.base_currency),
      status: "complete",
      priority_items: [],
      factors,
      limitations: [
        "Factors describe stored balance and allocation evidence; they do not infer customer intent or payment behavior.",
      ],
    };
    return analysisOutcome(analysis, outcome.evidence, outcome.links);
  }

  async getDailyBrief(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome> {
    const priority = await this.getArPriorityAnalysis(auth, limit);
    const analysis = dataRecord(priority) as unknown as AnalystAnalysis;
    const brief = buildDailyBrief(analysis);
    return {
      data: brief as unknown as Row,
      evidence: priority.evidence,
      links: priority.links,
      artifacts: [{
        kind: "daily_brief",
        daily_brief: brief as unknown as Row,
      }],
    };
  }

  async runReport(
    auth: AuthContext,
    plan: AnalystReportPlan,
  ): Promise<CopilotToolOutcome> {
    requireOperationalReadRole(auth);
    const report = await this.#analystReports.runReport(auth, plan);
    const chart = buildChartSpec(plan, report);
    if (chart) assertChartPreservesReport(chart, report);
    const evidenceItems = report.rows.flatMap((row) =>
      typeof row.document_id === "string"
        ? [
          evidence(
            plan.report === "receipt_summary" ? "receipt" : "invoice",
            row.document_id,
            String(row.document),
            String(row.document),
          ),
        ]
        : typeof row.customer_id === "string"
        ? [evidence("customer", row.customer_id, String(row.customer))]
        : []
    ).slice(0, 20);
    return {
      data: { report, chart } as unknown as Row,
      evidence: evidenceItems,
      links: [],
      artifacts: [{
        kind: "report",
        report: report as unknown as Row,
        chart: chart as unknown as Row | null,
      }],
    };
  }

  async analyzeAutomationDocument(
    auth: AuthContext,
    documentId: string,
  ): Promise<CopilotToolOutcome> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    validateUUID(documentId, "document_id");
    const { data: classification, error } = await this.#admin.from(
      "automation_document_classifications",
    )
      .select(
        "id,attachment_id,document_type,confidence,critical_confidence,status,created_at",
      )
      .eq("company_id", auth.companyId).eq("id", documentId).maybeSingle();
    if (error) throw new Error("Failed to load document analysis.");
    if (!classification) {
      throw new NotFoundError("Automation document", documentId);
    }
    const classRow = classification as Row;
    const { data: extraction, error: extractionError } = await this.#admin.from(
      "automation_extraction_results",
    )
      .select(
        "id,extracted_fields,field_confidence,validation_status,validation_codes,customer_id,customer_resolution_method,validated_at,created_at",
      )
      .eq("company_id", auth.companyId).eq("classification_id", documentId)
      .order("schema_version", { ascending: false }).limit(1).maybeSingle();
    if (extractionError) {
      throw new Error("Failed to load bounded extraction analysis.");
    }
    const extractionRow = (extraction ?? null) as Row | null;
    const safeFields = selectSafeDocumentFields(
      extractionRow?.extracted_fields,
    );
    const validationCodes = Array.isArray(extractionRow?.validation_codes)
      ? extractionRow.validation_codes.filter((item): item is string =>
        typeof item === "string"
      ).slice(0, 12)
      : [];
    const analysis = {
      document_id: documentId,
      document_type: stringValue(classRow.document_type),
      classification_status: stringValue(classRow.status),
      classification_confidence: stringValue(classRow.confidence),
      critical_field_confidence: stringValue(classRow.critical_confidence),
      processing_time: stringValue(classRow.created_at),
      extraction: extractionRow
        ? {
          validation_status: String(extractionRow.validation_status),
          validation_codes: validationCodes,
          fields: safeFields,
          customer_match: extractionRow.customer_id
            ? {
              matched: true,
              customer_id: String(extractionRow.customer_id),
              method: stringValue(extractionRow.customer_resolution_method),
              provenance: "MATCHED",
            }
            : {
              matched: false,
              customer_id: null,
              method: null,
              provenance: "MATCHED",
            },
          validated_at: stringValue(extractionRow.validated_at),
        }
        : null,
      provenance_note:
        "Extracted candidates are not authoritative booked values; validation and linked AR records retain their own authority.",
    };
    const base = await this.#base.getAutomationDocument(auth, documentId);
    return {
      data: analysis,
      evidence: base.evidence,
      links: base.links,
      artifacts: [{ kind: "document_analysis", document_analysis: analysis }],
    };
  }

  async analyzeExceptionRecovery(
    auth: AuthContext,
    exceptionId: string,
  ): Promise<CopilotToolOutcome> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    const outcome = await this.#base.getAutomationException(auth, exceptionId);
    const exception = dataRecord(outcome);
    const reasonCode = String(exception.reason_code);
    const plan = {
      exception_id: exceptionId,
      reason_code: reasonCode,
      lifecycle_status: String(exception.lifecycle_status),
      explanation:
        `Stored workflow evidence reports ${reasonCode}. Review the bounded evidence before using an existing governed recovery screen.`,
      candidate_resolutions: recoveryCandidates(reasonCode, [
        reasonCode,
        String(exception.lifecycle_status),
      ]).slice(0, ANALYST_MAX_RECOVERY_CANDIDATES),
      read_only: true,
      executable: false,
    };
    return {
      data: plan,
      evidence: outcome.evidence,
      links: outcome.links,
      artifacts: [{ kind: "recovery_plan", recovery_plan: plan }],
    };
  }
}

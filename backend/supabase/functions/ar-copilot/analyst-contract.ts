import { ValidationError } from "../_shared/errors.ts";
import { SUPPORTED_OPERATIONAL_CURRENCIES } from "../_shared/validators.ts";

export const ANALYST_MAX_PRIORITY_ITEMS = 10;
export const ANALYST_MAX_REPORT_ROWS = 50;
export const ANALYST_MAX_CHART_POINTS = 20;
export const ANALYST_MAX_DAILY_BRIEF_ITEMS = 8;
export const ANALYST_MAX_DOCUMENT_FIELDS = 10;
export const ANALYST_MAX_RECOVERY_CANDIDATES = 4;
export const ANALYST_MAX_COMPARISON_MONTHS = 12;

export const ANALYSIS_EVIDENCE_TYPES = [
  "AUTHORITATIVE_FACT",
  "DETERMINISTIC_DERIVATION",
  "DIRECT_WORKFLOW_EVIDENCE",
  "HEURISTIC_OBSERVATION",
] as const;
export type AnalysisEvidenceType = typeof ANALYSIS_EVIDENCE_TYPES[number];

export interface AnalysisFactor {
  factor_code: string;
  impact_direction: "increases_attention" | "reduces_attention" | "neutral";
  metric: string;
  current_value: string | number | null;
  comparison_value: string | number | null;
  absolute_change: string | null;
  percentage_change: string | null;
  period_key?: string | null;
  comparison_period_key?: string | null;
  evidence_type: AnalysisEvidenceType;
  entity_refs: Array<{ entity_type: string; entity_id: string; label: string }>;
}

export interface PriorityItem {
  category: "customer_exposure" | "cash_application" | "workflow_exception";
  category_rank: number;
  priority: "high" | "attention" | "info";
  reason_codes: string[];
  entity_type: string;
  entity_id: string;
  label: string;
  facts: Record<string, string | number | boolean | null>;
  evidence_type: Exclude<AnalysisEvidenceType, "HEURISTIC_OBSERVATION">;
}

export interface AnalystAnalysis {
  analysis_type:
    | "priority"
    | "customer_risk"
    | "collection_health"
    | "exposure_movement"
    | "unapplied_cash"
    | "root_cause";
  as_of: string;
  base_currency: string | null;
  status: "complete" | "insufficient_evidence";
  priority_items: PriorityItem[];
  factors: AnalysisFactor[];
  limitations: string[];
}

export interface ProactiveInsight {
  id: string;
  type:
    | "overdue_exposure"
    | "unapplied_cash"
    | "automation_exception";
  severity: "info" | "attention" | "high";
  title: string;
  reason_codes: string[];
  facts: Record<string, string | number | boolean | null>;
  entity_refs: Array<{ entity_type: string; entity_id: string; label: string }>;
  recommended_next_screen: string;
  evidence_type: Exclude<AnalysisEvidenceType, "HEURISTIC_OBSERVATION">;
}

export interface DailyBrief {
  as_of: string;
  generation: "on_demand";
  items: ProactiveInsight[];
}

export const REPORT_TYPES = [
  "aging",
  "invoice_summary",
  "receipt_summary",
  "customer_outstanding",
  "collections",
  "overdue_exposure",
] as const;
export type AnalystReportType = typeof REPORT_TYPES[number];

export const REPORT_METRICS = [
  "invoice_count",
  "receipt_count",
  "total_amount",
  "outstanding_amount",
  "overdue_amount",
  "unapplied_amount",
  "collection_amount",
] as const;
export type AnalystMetric = typeof REPORT_METRICS[number];

export const REPORT_DIMENSIONS = [
  "customer",
  "aging_bucket",
  "period",
  "document",
] as const;
export type AnalystDimension = typeof REPORT_DIMENSIONS[number];

export const REPORT_FILTER_FIELDS = [
  "status",
  "currency",
  "credit_rating",
  "minimum_amount",
] as const;
export type AnalystFilterField = typeof REPORT_FILTER_FIELDS[number];
export type AnalystFilterOperator = "eq" | "gte";

export interface AnalystReportPlan {
  report: AnalystReportType;
  metrics: AnalystMetric[];
  dimensions: AnalystDimension[];
  filters: Array<
    {
      field: AnalystFilterField;
      operator: AnalystFilterOperator;
      value: string;
    }
  >;
  period: {
    date_from: string | null;
    date_to: string | null;
    as_of_date: string | null;
  };
  sort: { metric: AnalystMetric; direction: "asc" | "desc" } | null;
  limit: number;
  chart_type: "bar" | "line" | "pie" | null;
}

export interface AnalystReportResult {
  report_type: AnalystReportType;
  title: string;
  description: string;
  as_of: string;
  base_currency: string | null;
  columns: Array<
    {
      field: string;
      label: string;
      format: "text" | "currency" | "number" | "date";
    }
  >;
  rows: Array<Record<string, string | number | null>>;
  summary: Record<string, string | number | boolean | null>;
  coverage: {
    status: "complete" | "bounded_incomplete" | "insufficient_evidence";
    source_total: number | null;
    returned_rows: number;
    top_n_complete: boolean | null;
    reason: string | null;
  };
  authority: "authoritative_rows";
}

export interface AnalystChartSpec {
  chart_type: "bar" | "line" | "pie";
  title: string;
  x_field: string;
  series: Array<
    { field: string; label: string; format: "currency" | "number" | "percent" }
  >;
  data: Array<Record<string, string | number | null>>;
  is_truncated: boolean;
  displayed_points: number;
  total_available_points: number;
}

const REPORT_RULES: Record<AnalystReportType, {
  metrics: readonly AnalystMetric[];
  dimensions: readonly AnalystDimension[];
  filters: readonly AnalystFilterField[];
}> = {
  aging: {
    metrics: ["invoice_count", "outstanding_amount"],
    dimensions: ["aging_bucket"],
    filters: [],
  },
  invoice_summary: {
    metrics: ["invoice_count", "total_amount", "outstanding_amount"],
    dimensions: ["document"],
    filters: ["status", "currency", "minimum_amount"],
  },
  receipt_summary: {
    metrics: ["receipt_count", "total_amount", "unapplied_amount"],
    dimensions: ["document"],
    filters: ["status", "currency", "minimum_amount"],
  },
  customer_outstanding: {
    metrics: ["outstanding_amount", "overdue_amount"],
    dimensions: ["customer"],
    filters: ["credit_rating"],
  },
  collections: {
    metrics: ["receipt_count", "collection_amount"],
    dimensions: ["period"],
    filters: [],
  },
  overdue_exposure: {
    metrics: ["invoice_count", "overdue_amount", "outstanding_amount"],
    dimensions: ["customer"],
    filters: [],
  },
};

const REPORT_SORTABLE_METRICS: Record<
  AnalystReportType,
  readonly AnalystMetric[]
> = {
  aging: [],
  invoice_summary: ["total_amount", "outstanding_amount"],
  receipt_summary: ["total_amount", "unapplied_amount"],
  customer_outstanding: ["outstanding_amount", "overdue_amount"],
  collections: [],
  overdue_exposure: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])
  ) {
    throw new ValidationError(`${field} contains unsupported fields.`);
  }
}

function dateOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} is invalid.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ValidationError(`${field} is invalid.`);
  }
  return value;
}

export function parseAnalystReportPlan(value: unknown): AnalystReportPlan {
  if (!isRecord(value)) throw new ValidationError("report plan is invalid.");
  exactKeys(value, [
    "report",
    "metrics",
    "dimensions",
    "filters",
    "period",
    "sort",
    "limit",
    "chart_type",
  ], "report plan");
  if (!REPORT_TYPES.includes(value.report as AnalystReportType)) {
    throw new ValidationError("report is unsupported.");
  }
  const report = value.report as AnalystReportType;
  const rules = REPORT_RULES[report];
  if (
    !Array.isArray(value.metrics) || value.metrics.length === 0 ||
    value.metrics.length > 3 ||
    new Set(value.metrics).size !== value.metrics.length ||
    value.metrics.some((item) => !rules.metrics.includes(item as AnalystMetric))
  ) {
    throw new ValidationError("report metrics are unsupported.");
  }
  if (
    !Array.isArray(value.dimensions) || value.dimensions.length === 0 ||
    value.dimensions.length > 2 ||
    new Set(value.dimensions).size !== value.dimensions.length ||
    value.dimensions.some((item) =>
      !rules.dimensions.includes(item as AnalystDimension)
    )
  ) {
    throw new ValidationError("report dimensions are unsupported.");
  }
  if (!Array.isArray(value.filters) || value.filters.length > 4) {
    throw new ValidationError("report filters are invalid.");
  }
  const filters = value.filters.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new ValidationError(`filters[${index}] is invalid.`);
    }
    exactKeys(raw, ["field", "operator", "value"], `filters[${index}]`);
    if (!rules.filters.includes(raw.field as AnalystFilterField)) {
      throw new ValidationError("report filter field is unsupported.");
    }
    if (raw.operator !== "eq" && raw.operator !== "gte") {
      throw new ValidationError("report filter operator is unsupported.");
    }
    if (raw.field !== "minimum_amount" && raw.operator !== "eq") {
      throw new ValidationError("report filter comparator is unsupported.");
    }
    if (
      typeof raw.value !== "string" || !raw.value.trim() ||
      raw.value.length > 80
    ) throw new ValidationError("report filter value is invalid.");
    if (
      raw.field === "minimum_amount" && !/^\d+(?:\.\d{1,2})?$/.test(raw.value)
    ) throw new ValidationError("minimum_amount is invalid.");
    if (
      raw.field === "currency" &&
      !SUPPORTED_OPERATIONAL_CURRENCIES.includes(
        raw.value as typeof SUPPORTED_OPERATIONAL_CURRENCIES[number],
      )
    ) {
      throw new ValidationError("currency is invalid.");
    }
    if (
      raw.field === "credit_rating" &&
      !["AAA", "AA", "A", "B", "C", "D"].includes(raw.value)
    ) throw new ValidationError("credit_rating is invalid.");
    const allowedStatuses = report === "invoice_summary"
      ? ["Draft", "Open", "Overdue", "Partially Paid", "Paid", "Cancelled"]
      : ["Draft", "Posted", "Fully Allocated", "Cancelled", "Bounced"];
    if (raw.field === "status" && !allowedStatuses.includes(raw.value)) {
      throw new ValidationError("status is invalid for this report.");
    }
    return {
      field: raw.field as AnalystFilterField,
      operator: raw.operator as AnalystFilterOperator,
      value: raw.value.trim(),
    };
  });
  if (new Set(filters.map((item) => item.field)).size !== filters.length) {
    throw new ValidationError("report filter fields must be unique.");
  }
  if (
    filters.some((item) => item.field === "minimum_amount") &&
    !filters.some((item) => item.field === "currency")
  ) {
    throw new ValidationError(
      "minimum_amount requires one explicit transaction currency.",
    );
  }
  if (!isRecord(value.period)) {
    throw new ValidationError("report period is invalid.");
  }
  exactKeys(
    value.period,
    ["date_from", "date_to", "as_of_date"],
    "report period",
  );
  const period = {
    date_from: dateOrNull(value.period.date_from, "date_from"),
    date_to: dateOrNull(value.period.date_to, "date_to"),
    as_of_date: dateOrNull(value.period.as_of_date, "as_of_date"),
  };
  if (period.date_from && period.date_to && period.date_from > period.date_to) {
    throw new ValidationError("date_from must not be after date_to.");
  }
  const isDocumentReport = report === "invoice_summary" ||
    report === "receipt_summary";
  if (isDocumentReport && period.as_of_date !== null) {
    throw new ValidationError(
      "as_of_date is unsupported for Invoice and Receipt document reports.",
    );
  }
  if (!isDocumentReport && (period.date_from || period.date_to)) {
    throw new ValidationError(
      "date ranges are unsupported for this as-of report.",
    );
  }
  let sort: AnalystReportPlan["sort"] = null;
  if (value.sort !== null) {
    if (!isRecord(value.sort)) {
      throw new ValidationError("report sort is invalid.");
    }
    exactKeys(value.sort, ["metric", "direction"], "report sort");
    if (
      !rules.metrics.includes(value.sort.metric as AnalystMetric) ||
      !(value.metrics as unknown[]).includes(value.sort.metric) ||
      !REPORT_SORTABLE_METRICS[report].includes(
        value.sort.metric as AnalystMetric,
      ) ||
      !["asc", "desc"].includes(String(value.sort.direction))
    ) throw new ValidationError("report sort is unsupported.");
    sort = {
      metric: value.sort.metric as AnalystMetric,
      direction: value.sort.direction as "asc" | "desc",
    };
  }
  if (
    !Number.isSafeInteger(value.limit) || Number(value.limit) < 1 ||
    Number(value.limit) > ANALYST_MAX_REPORT_ROWS
  ) {
    throw new ValidationError(
      `report limit must be 1 to ${ANALYST_MAX_REPORT_ROWS}.`,
    );
  }
  if (
    value.chart_type !== null &&
    !["bar", "line", "pie"].includes(String(value.chart_type))
  ) throw new ValidationError("chart type is unsupported.");
  return {
    report,
    metrics: [...new Set(value.metrics as AnalystMetric[])],
    dimensions: [...new Set(value.dimensions as AnalystDimension[])],
    filters,
    period,
    sort,
    limit: Number(value.limit),
    chart_type: value.chart_type as AnalystReportPlan["chart_type"],
  };
}

export interface FutureActionProposal {
  proposal_id: string;
  company_id: string;
  actor_user_id: string;
  action_type: string;
  target_entities: Array<{ entity_type: string; entity_id: string }>;
  display_summary: string;
  proposed_parameters: Record<string, string | number | boolean | null>;
  risk_impact_summary: string;
  requires_confirmation: true;
  expires_at: string;
  state_fingerprint: string;
  state_version: number;
  idempotency_key: string;
  audit_event_type: string;
  created_at: string;
}

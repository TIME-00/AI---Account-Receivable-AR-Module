import type { LiveDashboardMetrics } from "../reports/dashboard-types.ts";
import {
  decimalString,
  minorToMoney,
  moneyToMinor,
} from "../reports/export-contract.ts";
import { ValidationError } from "../_shared/errors.ts";
import type {
  AnalysisFactor,
  AnalystAnalysis,
  AnalystChartSpec,
  AnalystReportPlan,
  AnalystReportResult,
  DailyBrief,
  PriorityItem,
} from "./analyst-contract.ts";
import {
  ANALYST_MAX_CHART_POINTS,
  ANALYST_MAX_DAILY_BRIEF_ITEMS,
} from "./analyst-contract.ts";

export function exactMoney(value: unknown, field: string): string {
  return minorToMoney(moneyToMinor(decimalString(value, field), field));
}

function moneyDifference(current: string, comparison: string): string {
  return minorToMoney(
    moneyToMinor(current, "current") - moneyToMinor(comparison, "comparison"),
  );
}

function positiveMoney(value: string): boolean {
  return moneyToMinor(value, "money") > 0n;
}

function customerPriorityItems(
  metrics: LiveDashboardMetrics,
  limit: number,
): PriorityItem[] {
  return metrics.top_outstanding_customers.slice(0, limit).flatMap(
    (row, index) => {
      const overdue = exactMoney(row.overdue_base, "customer.overdue_base");
      if (!positiveMoney(overdue)) return [];
      const reasons = ["HIGH_OVERDUE_EXPOSURE"];
      if (row.overdue_invoice_count > 1) {
        reasons.push("MULTIPLE_OVERDUE_INVOICES");
      }
      return [{
        category: "customer_exposure" as const,
        category_rank: index + 1,
        priority: "attention" as const,
        reason_codes: reasons,
        entity_type: "customer",
        entity_id: row.customer_id,
        label: row.customer_name.slice(0, 160),
        facts: {
          customer_code: row.customer_code,
          overdue_amount: overdue,
          outstanding_amount: exactMoney(
            row.outstanding_base,
            "customer.outstanding_base",
          ),
          overdue_invoice_count: row.overdue_invoice_count,
          base_currency: metrics.meta.base_currency,
        },
        evidence_type: "DETERMINISTIC_DERIVATION" as const,
      }];
    },
  );
}

export function buildPriorityAnalysis(
  metrics: LiveDashboardMetrics,
  exceptions: Array<
    {
      id: string;
      reason_code: string;
      lifecycle_status: string;
      opened_at: string;
    }
  >,
  limit: number,
): AnalystAnalysis {
  const items = customerPriorityItems(metrics, limit);
  if (
    positiveMoney(exactMoney(metrics.kpis.unapplied_cash, "unapplied_cash"))
  ) {
    items.push({
      category: "cash_application",
      category_rank: 1,
      priority: "attention",
      reason_codes: ["UNAPPLIED_CASH_AVAILABLE"],
      entity_type: "ar_summary",
      entity_id: metrics.meta.company_id,
      label: "Unapplied cash",
      facts: {
        amount: exactMoney(metrics.kpis.unapplied_cash, "unapplied_cash"),
        base_currency: metrics.meta.base_currency,
      },
      evidence_type: "AUTHORITATIVE_FACT",
    });
  }
  for (
    const [index, item] of exceptions.slice(
      0,
      Math.max(0, limit - items.length),
    ).entries()
  ) {
    items.push({
      category: "workflow_exception",
      category_rank: index + 1,
      priority: "attention",
      reason_codes: [
        "OPEN_AUTOMATION_EXCEPTION",
        item.reason_code.toUpperCase(),
      ],
      entity_type: "automation_exception",
      entity_id: item.id,
      label: `Automation exception: ${item.reason_code}`.slice(0, 160),
      facts: {
        reason_code: item.reason_code,
        lifecycle_status: item.lifecycle_status,
        opened_at: item.opened_at,
      },
      evidence_type: "DIRECT_WORKFLOW_EVIDENCE",
    });
  }
  const bounded = items.slice(0, limit);
  return {
    analysis_type: "priority",
    as_of: metrics.meta.as_of_date,
    base_currency: metrics.meta.base_currency,
    status: "complete",
    priority_items: bounded,
    factors: [],
    limitations: [
      "Customer exposure, unapplied cash, and workflow exceptions are separate operational categories; no cross-category risk score is used.",
    ],
  };
}

export function buildCollectionHealthAnalysis(
  metrics: LiveDashboardMetrics,
): AnalystAnalysis {
  const points = metrics.collection_trend;
  const current = points.at(-1);
  const previous = points.at(-2);
  if (!current || !previous) {
    return {
      analysis_type: "collection_health",
      as_of: metrics.meta.as_of_date,
      base_currency: metrics.meta.base_currency,
      status: "insufficient_evidence",
      priority_items: [],
      factors: [],
      limitations: [
        "At least two authoritative monthly collection points are required for comparison.",
      ],
    };
  }
  const currentAmount = exactMoney(
    current.collected_base,
    "collection.current",
  );
  const previousAmount = exactMoney(
    previous.collected_base,
    "collection.previous",
  );
  const difference = moneyDifference(currentAmount, previousAmount);
  const factor: AnalysisFactor = {
    factor_code: moneyToMinor(difference, "difference") < 0n
      ? "COLLECTIONS_DECREASED"
      : "COLLECTIONS_INCREASED",
    impact_direction: moneyToMinor(difference, "difference") < 0n
      ? "increases_attention"
      : "reduces_attention",
    metric: "collection_amount",
    current_value: currentAmount,
    comparison_value: previousAmount,
    absolute_change: difference,
    percentage_change: null,
    period_key: current.month,
    comparison_period_key: previous.month,
    evidence_type: "DETERMINISTIC_DERIVATION",
    entity_refs: [],
  };
  return {
    analysis_type: "collection_health",
    as_of: metrics.meta.as_of_date,
    base_currency: metrics.meta.base_currency,
    status: "complete",
    priority_items: [],
    factors: [factor],
    limitations: [
      "Percentage change is omitted to avoid presenting a ratio when the comparison period is zero or incomplete.",
    ],
  };
}

export function buildExposureMovementAnalysis(
  metrics: LiveDashboardMetrics,
  metric: "overdue" | "aging",
): AnalystAnalysis {
  const factor: AnalysisFactor = metric === "overdue"
    ? {
      factor_code: "CURRENT_OVERDUE_EXPOSURE_AVAILABLE",
      impact_direction: "neutral",
      metric: "overdue_amount",
      current_value: exactMoney(
        metrics.kpis.overdue_outstanding,
        "overdue_outstanding",
      ),
      comparison_value: null,
      absolute_change: null,
      percentage_change: null,
      evidence_type: "AUTHORITATIVE_FACT",
      entity_refs: [],
    }
    : {
      factor_code: "CURRENT_AGING_DISTRIBUTION_AVAILABLE",
      impact_direction: "neutral",
      metric: "aging_bucket_count",
      current_value: metrics.aging_buckets.length,
      comparison_value: null,
      absolute_change: null,
      percentage_change: null,
      evidence_type: "AUTHORITATIVE_FACT",
      entity_refs: [],
    };
  return {
    analysis_type: "exposure_movement",
    as_of: metrics.meta.as_of_date,
    base_currency: metrics.meta.base_currency,
    status: "insufficient_evidence",
    priority_items: [],
    factors: [factor],
    limitations: [
      `Authoritative historical ${metric} snapshots are not stored, so movement and causal change cannot be reconstructed.`,
    ],
  };
}

export function buildDailyBrief(analysis: AnalystAnalysis): DailyBrief {
  return {
    as_of: analysis.as_of,
    generation: "on_demand",
    items: analysis.priority_items.slice(0, ANALYST_MAX_DAILY_BRIEF_ITEMS).map((
      item,
    ) => ({
      id: `${item.entity_type}:${item.entity_id}:${analysis.as_of}`,
      type: item.entity_type === "automation_exception"
        ? "automation_exception"
        : item.entity_type === "ar_summary"
        ? "unapplied_cash"
        : "overdue_exposure",
      severity: item.priority,
      title: item.label,
      reason_codes: item.reason_codes,
      facts: item.facts,
      entity_refs: item.entity_type === "ar_summary" ? [] : [{
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        label: item.label,
      }],
      recommended_next_screen: item.entity_type === "automation_exception"
        ? "/automation/exceptions"
        : item.entity_type === "customer"
        ? `/customers/${item.entity_id}`
        : "/allocations",
      evidence_type: item.evidence_type,
    })),
  };
}

const REPORT_CHART_FIELDS: Record<
  string,
  {
    x: string;
    metrics: Record<
      string,
      { field: string; label: string; format: "currency" | "number" }
    >;
  }
> = {
  aging: {
    x: "aging_bucket",
    metrics: {
      outstanding_amount: {
        field: "outstanding_amount",
        label: "Outstanding",
        format: "currency",
      },
      invoice_count: {
        field: "invoice_count",
        label: "Invoices",
        format: "number",
      },
    },
  },
  invoice_summary: {
    x: "document",
    metrics: {
      total_amount: {
        field: "total_amount",
        label: "Total",
        format: "currency",
      },
      outstanding_amount: {
        field: "outstanding_amount",
        label: "Outstanding",
        format: "currency",
      },
      invoice_count: {
        field: "invoice_count",
        label: "Invoices",
        format: "number",
      },
    },
  },
  receipt_summary: {
    x: "document",
    metrics: {
      total_amount: {
        field: "total_amount",
        label: "Receipt amount",
        format: "currency",
      },
      unapplied_amount: {
        field: "unapplied_amount",
        label: "Unapplied",
        format: "currency",
      },
      receipt_count: {
        field: "receipt_count",
        label: "Receipts",
        format: "number",
      },
    },
  },
  customer_outstanding: {
    x: "customer",
    metrics: {
      outstanding_amount: {
        field: "outstanding_amount",
        label: "Outstanding",
        format: "currency",
      },
      overdue_amount: {
        field: "overdue_amount",
        label: "Overdue",
        format: "currency",
      },
    },
  },
  collections: {
    x: "period",
    metrics: {
      collection_amount: {
        field: "collection_amount",
        label: "Collections",
        format: "currency",
      },
      receipt_count: {
        field: "receipt_count",
        label: "Receipts",
        format: "number",
      },
    },
  },
  overdue_exposure: {
    x: "customer",
    metrics: {
      overdue_amount: {
        field: "overdue_amount",
        label: "Overdue",
        format: "currency",
      },
      outstanding_amount: {
        field: "outstanding_amount",
        label: "Outstanding",
        format: "currency",
      },
      invoice_count: {
        field: "invoice_count",
        label: "Invoices",
        format: "number",
      },
    },
  },
};

export function buildChartSpec(
  plan: AnalystReportPlan,
  report: AnalystReportResult,
): AnalystChartSpec | null {
  if (!plan.chart_type) return null;
  if (
    (plan.report === "invoice_summary" ||
      plan.report === "receipt_summary") &&
    report.summary.multi_currency === true &&
    plan.metrics.some((metric) => metric.endsWith("_amount"))
  ) {
    throw new ValidationError(
      "A monetary chart cannot combine transaction currencies.",
    );
  }
  const config = REPORT_CHART_FIELDS[plan.report];
  if (!config) throw new ValidationError("Report is not chartable.");
  if (plan.chart_type === "line" && plan.report !== "collections") {
    throw new ValidationError("A line chart requires a time-period report.");
  }
  if (
    plan.chart_type === "line" &&
    report.summary.ordered_period_series !== true
  ) {
    throw new ValidationError(
      "A line chart requires an authoritative ordered period series.",
    );
  }
  if (
    plan.chart_type === "pie" &&
    (plan.report !== "aging" || plan.metrics.length !== 1 ||
      plan.metrics[0] !== "outstanding_amount")
  ) {
    throw new ValidationError(
      "A pie chart requires one true part-to-whole aging metric.",
    );
  }
  if (
    plan.chart_type === "pie" &&
    (report.coverage.status !== "complete" ||
      report.summary.canonical_partition_complete !== true ||
      report.summary.partition_total !== report.summary.report_total ||
      report.rows.length !== 5 ||
      JSON.stringify(report.rows.map((row) => row.aging_bucket_key)) !==
        JSON.stringify(["current", "1_30", "31_60", "61_90", "over_90"]))
  ) {
    throw new ValidationError(
      "A pie chart requires the complete reconciled aging partition.",
    );
  }
  if (plan.chart_type === "bar" && report.rows.length === 0) return null;
  const series = plan.metrics.map((metric) => {
    const entry = config.metrics[metric];
    if (
      !entry || !report.columns.some((column) => column.field === entry.field)
    ) {
      throw new ValidationError(
        "Chart field is not present in the validated report.",
      );
    }
    return { field: entry.field, label: entry.label, format: entry.format };
  });
  if (!report.columns.some((column) => column.field === config.x)) {
    throw new ValidationError(
      "Chart category field is not present in the validated report.",
    );
  }
  const data = report.rows.slice(0, ANALYST_MAX_CHART_POINTS).map((row) => {
    const point: Record<string, string | number | null> = {
      [config.x]: row[config.x] ?? null,
    };
    for (const item of series) point[item.field] = row[item.field] ?? null;
    return point;
  });
  return {
    chart_type: plan.chart_type,
    title: report.title,
    x_field: config.x,
    series,
    data,
    is_truncated: report.rows.length > data.length,
    displayed_points: data.length,
    total_available_points: report.rows.length,
  };
}

/**
 * A requested visualization is presentation, not financial authority. When a
 * valid authoritative report cannot legally support that chart shape (for
 * example an incomplete aging partition), retain the report and omit the
 * chart instead of turning an evidence limitation into an infrastructure 5xx.
 */
export function buildChartSpecIfSupported(
  plan: AnalystReportPlan,
  report: AnalystReportResult,
): AnalystChartSpec | null {
  try {
    return buildChartSpec(plan, report);
  } catch (error) {
    if (error instanceof ValidationError) return null;
    throw error;
  }
}

export function assertChartPreservesReport(
  chart: AnalystChartSpec,
  report: AnalystReportResult,
): void {
  if (
    chart.displayed_points !== chart.data.length ||
    chart.total_available_points !== report.rows.length ||
    chart.is_truncated !== (chart.data.length < report.rows.length)
  ) {
    throw new ValidationError("Chart coverage metadata is invalid.");
  }
  for (const [index, point] of chart.data.entries()) {
    const source = report.rows[index];
    if (!source) {
      throw new ValidationError(
        "Chart contains a row not present in the report.",
      );
    }
    for (const [field, value] of Object.entries(point)) {
      if (source[field] !== value) {
        throw new ValidationError(
          "Chart data differs from the validated report.",
        );
      }
    }
  }
}

const METRIC_FIELDS: Record<string, string> = {
  invoice_count: "invoice_count",
  receipt_count: "receipt_count",
  total_amount: "total_amount",
  outstanding_amount: "outstanding_amount",
  overdue_amount: "overdue_amount",
  unapplied_amount: "unapplied_amount",
  collection_amount: "collection_amount",
};

export function sortReportRows(
  rows: AnalystReportResult["rows"],
  plan: AnalystReportPlan,
): AnalystReportResult["rows"] {
  if (!plan.sort) return rows.slice(0, plan.limit);
  const field = METRIC_FIELDS[plan.sort.metric];
  if (!field) throw new ValidationError("Report sort metric is unsupported.");
  const direction = plan.sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left[field];
    const b = right[field];
    let comparison = 0;
    if (typeof a === "number" && typeof b === "number") {
      comparison = a < b ? -1 : a > b ? 1 : 0;
    } else if (typeof a === "string" && typeof b === "string") {
      const leftMoney = moneyToMinor(a, `sort.${field}`);
      const rightMoney = moneyToMinor(b, `sort.${field}`);
      comparison = leftMoney < rightMoney ? -1 : leftMoney > rightMoney ? 1 : 0;
    }
    if (comparison !== 0) return comparison * direction;
    const leftTie = String(
      left.document_id ?? left.customer_id ?? left.period ??
        left.aging_bucket_key ?? "",
    );
    const rightTie = String(
      right.document_id ?? right.customer_id ?? right.period ??
        right.aging_bucket_key ?? "",
    );
    return leftTie.localeCompare(rightTie);
  }).slice(0, plan.limit);
}

export interface RecoveryCandidate {
  resolution_type: string;
  label: string;
  supporting_evidence: string[];
  requires_human_confirmation: true;
}

const RECOVERY_BY_REASON: Record<string, Array<[string, string]>> = {
  customer_unresolved: [[
    "review_customer_match",
    "Review customer match candidates",
  ]],
  customer_ambiguous: [[
    "select_customer_match",
    "Review the ambiguous customer candidates",
  ]],
  invoice_conflict: [[
    "review_invoice_reference",
    "Review the conflicting Invoice reference",
  ]],
  receipt_conflict: [[
    "review_receipt_reference",
    "Review the conflicting Receipt reference",
  ]],
  arithmetic_mismatch: [[
    "review_extracted_amounts",
    "Compare extracted totals with the document",
  ]],
  currency_unsupported: [[
    "review_transaction_currency",
    "Review the supported transaction currency",
  ]],
  allocation_evidence_insufficient: [[
    "open_allocation_wizard",
    "Review eligible allocations",
  ]],
  allocation_currency_mismatch: [[
    "review_allocation_currency",
    "Review receipt and Invoice currencies",
  ]],
  ambiguous_classification: [[
    "review_document_classification",
    "Review the document classification",
  ]],
  low_confidence: [[
    "review_extracted_fields",
    "Review low-confidence extracted fields",
  ]],
  extraction_schema_invalid: [[
    "review_validation_codes",
    "Review document validation findings",
  ]],
  provider_unavailable: [[
    "review_provider_readiness",
    "Review provider readiness before a governed retry",
  ]],
};

export function recoveryCandidates(
  reasonCode: string,
  evidenceCodes: string[],
): RecoveryCandidate[] {
  return (RECOVERY_BY_REASON[reasonCode] ??
    [["manual_review", "Review the exception evidence"]]).map((
      [resolution_type, label],
    ) => ({
      resolution_type,
      label,
      supporting_evidence: evidenceCodes.slice(0, 6),
      requires_human_confirmation: true,
    }));
}

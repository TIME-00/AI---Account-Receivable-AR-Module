import type {
  CopilotContextHint,
  CopilotEvidence,
  CopilotToolOutcome,
} from "./contract.ts";
import { minorToMoney, moneyToMinor } from "../reports/export-contract.ts";
import type {
  AggregationScope,
  CompanyClaimCategory,
  CompanyEvidenceGrant,
  CompanyFactKind,
  EvidenceCoverage,
  EvidenceCoverageStatus,
  LiveEvidenceGrant,
} from "./live-evidence.ts";

const EVIDENCE_ENTITY_TYPES: Partial<
  Record<CopilotEvidence["kind"], import("./contract.ts").CopilotEntityType>
> = {
  customer: "customer",
  invoice: "invoice",
  credit_note: "credit_note",
  debit_note: "debit_note",
  receipt: "receipt",
  automation_document: "automation_document",
  automation_exception: "automation_exception",
  journal_entry: "journal_entry",
  audit_event: "audit_event",
};

const SUPPORTED_CURRENCIES = new Set([
  "MYR",
  "SGD",
  "USD",
  "EUR",
  "GBP",
  "CNY",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalMoney(value: unknown): string | null {
  try {
    return minorToMoney(moneyToMinor(value, "live_evidence.money"));
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

function previousMonth(period: string): string | null {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) return null;
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${
    String(date.getUTCMonth() + 1).padStart(2, "0")
  }`;
}

function boundedCoverage(value: unknown): EvidenceCoverage | null {
  const input = record(value);
  if (
    !input ||
    !["complete", "bounded_incomplete", "insufficient_evidence"].includes(
      String(input.status),
    )
  ) return null;
  return {
    status: input.status as EvidenceCoverageStatus,
    source_total: input.source_total === null
      ? null
      : positiveInteger(input.source_total),
    returned_rows: input.returned_rows === null
      ? null
      : positiveInteger(input.returned_rows),
    top_n_complete: typeof input.top_n_complete === "boolean"
      ? input.top_n_complete
      : null,
  };
}

function companyFact(
  claim_category: CompanyClaimCategory,
  fact_kind: CompanyFactKind,
  detail: Omit<
    Partial<CompanyEvidenceGrant>,
    "scope" | "claim_category" | "fact_kind"
  > = {},
): CompanyEvidenceGrant {
  return { scope: "company", claim_category, fact_kind, ...detail };
}

function uniqueGrants(grants: LiveEvidenceGrant[]): LiveEvidenceGrant[] {
  const found = new Map<string, LiveEvidenceGrant>();
  for (const grant of grants) {
    const key = grant.scope === "entity"
      ? `entity:${grant.entity_type}:${grant.entity_id}`
      : JSON.stringify(grant);
    found.set(key, grant);
  }
  return [...found.values()];
}

function entityGrants(outcome: CopilotToolOutcome): LiveEvidenceGrant[] {
  return outcome.evidence.flatMap((item) => {
    const entityType = EVIDENCE_ENTITY_TYPES[item.kind];
    return entityType
      ? [{
        scope: "entity" as const,
        entity_type: entityType,
        entity_id: item.id,
      }]
      : [];
  });
}

function summaryGrant(
  category: CompanyClaimCategory,
  coverage: EvidenceCoverage | null = null,
): CompanyEvidenceGrant {
  return companyFact(category, "summary", { coverage });
}

function moneyGrant(
  category: CompanyClaimCategory,
  currency: unknown,
  value: unknown,
  detail: Partial<CompanyEvidenceGrant> = {},
): CompanyEvidenceGrant | null {
  const normalizedCurrency = typeof currency === "string"
    ? currency.toUpperCase()
    : "";
  const normalizedMoney = canonicalMoney(value);
  return SUPPORTED_CURRENCIES.has(normalizedCurrency) &&
      normalizedMoney !== null
    ? companyFact(category, "money", {
      currency: normalizedCurrency,
      money_value: normalizedMoney,
      time_basis: "unspecified",
      aggregation_scope: "company_total" as AggregationScope,
      ...detail,
    })
    : null;
}

function countGrant(
  category: CompanyClaimCategory,
  value: unknown,
  coverage: EvidenceCoverage | null = null,
  detail: Partial<CompanyEvidenceGrant> = {},
): CompanyEvidenceGrant | null {
  const count = positiveInteger(value);
  return count === null ? null : companyFact(category, "count", {
    count_value: count,
    count_comparator: "exact",
    coverage,
    ...detail,
  });
}

function minimumCountGrant(
  category: CompanyClaimCategory,
  value: unknown,
  detail: Partial<CompanyEvidenceGrant> = {},
): CompanyEvidenceGrant | null {
  const count = positiveInteger(value);
  return count === null || count === 0 ? null : companyFact(category, "count", {
    count_value: count,
    count_comparator: "at_least",
    ...detail,
  });
}

function existenceGrant(
  category: CompanyClaimCategory,
  present: boolean,
  coverage: EvidenceCoverage | null = null,
  detail: Partial<CompanyEvidenceGrant> = {},
): CompanyEvidenceGrant {
  return companyFact(category, "existence", {
    state_value: present ? "present" : "absent",
    coverage,
    ...detail,
  });
}

function analysisItems(
  data: Record<string, unknown>,
): Record<string, unknown>[] {
  return Array.isArray(data.priority_items)
    ? data.priority_items.map(record).filter((
      item,
    ): item is Record<string, unknown> => item !== null)
    : [];
}

function priorityGrants(data: Record<string, unknown>): CompanyEvidenceGrant[] {
  const grants: CompanyEvidenceGrant[] = [summaryGrant("priority")];
  const items = analysisItems(data);
  if (data.status === "complete") {
    grants.push(existenceGrant("priority", items.length > 0));
  } else if (items.length > 0) grants.push(existenceGrant("priority", true));
  const priorityMinimum = minimumCountGrant("priority", items.length);
  if (priorityMinimum) grants.push(priorityMinimum);
  const categoryCounts = new Map<CompanyClaimCategory, number>();
  for (const item of items) {
    const category = String(item.category ?? item.type ?? "");
    const facts = record(item.facts) ?? {};
    if (category === "customer_exposure" || category === "overdue_exposure") {
      grants.push(existenceGrant("customer_attention", true));
      grants.push(existenceGrant("overdue", true));
      grants.push(existenceGrant("outstanding", true));
      categoryCounts.set(
        "customer_attention",
        (categoryCounts.get("customer_attention") ?? 0) + 1,
      );
    } else if (
      category === "cash_application" || category === "unapplied_cash"
    ) {
      grants.push(existenceGrant("unapplied_cash", true));
      categoryCounts.set(
        "unapplied_cash",
        (categoryCounts.get("unapplied_cash") ?? 0) + 1,
      );
      if (item.entity_type === "ar_summary") {
        const grant = moneyGrant(
          "unapplied_cash",
          facts.base_currency,
          facts.amount,
          {
            time_basis: "current",
          },
        );
        if (grant) grants.push(grant);
      }
    } else if (
      category === "workflow_exception" || category === "automation_exception"
    ) {
      grants.push(existenceGrant("workflow_exception", true));
      categoryCounts.set(
        "workflow_exception",
        (categoryCounts.get("workflow_exception") ?? 0) + 1,
      );
    }
  }
  for (const [category, count] of categoryCounts) {
    const grant = minimumCountGrant(category, count);
    if (grant) grants.push(grant);
  }
  return grants;
}

function factorGrants(
  data: Record<string, unknown>,
  expectedMetric: "collection_amount" | "overdue_amount",
  category: CompanyClaimCategory,
): CompanyEvidenceGrant[] {
  const grants: CompanyEvidenceGrant[] = [summaryGrant(category)];
  const currency = data.base_currency;
  const factors = Array.isArray(data.factors)
    ? data.factors.map(record).filter((item): item is Record<string, unknown> =>
      item !== null
    )
    : [];
  for (const factor of factors) {
    if (factor.metric !== expectedMetric) continue;
    const current = moneyGrant(category, currency, factor.current_value, {
      time_basis: "current",
    });
    if (current) grants.push(current);
    const comparison = moneyGrant(category, currency, factor.comparison_value, {
      time_basis: "previous",
    });
    if (comparison) grants.push(comparison);
    if (data.status !== "complete") continue;
    const code = String(factor.factor_code ?? "");
    const direction = code.includes("DECREASED")
      ? "decreased" as const
      : code.includes("INCREASED")
      ? "increased" as const
      : null;
    if (!direction) continue;
    const periodKey = typeof factor.period_key === "string" &&
        /^\d{4}-(?:0[1-9]|1[0-2])$/.test(factor.period_key)
      ? factor.period_key
      : null;
    const comparisonPeriodKey =
      typeof factor.comparison_period_key === "string" &&
        /^\d{4}-(?:0[1-9]|1[0-2])$/.test(factor.comparison_period_key)
        ? factor.comparison_period_key
        : null;
    if (periodKey === null || comparisonPeriodKey === null) continue;
    const asOfMonth = typeof data.as_of === "string"
      ? data.as_of.slice(0, 7)
      : null;
    const window = asOfMonth === periodKey &&
        previousMonth(periodKey) === comparisonPeriodKey
      ? "current_month_vs_previous_month" as const
      : "specific_period_comparison" as const;
    const absolute = canonicalMoney(factor.absolute_change);
    const absoluteValue = absolute === null ? null : minorToMoney(
      moneyToMinor(absolute, "trend.absolute") < 0n
        ? -moneyToMinor(absolute, "trend.absolute")
        : moneyToMinor(absolute, "trend.absolute"),
    );
    grants.push(companyFact(category, "trend", {
      trend_direction: direction,
      currency: typeof currency === "string" ? currency : null,
      money_value: absoluteValue,
      time_basis: "change",
      trend_window: window,
      period_key: periodKey,
      comparison_period_key: comparisonPeriodKey,
    }));
  }
  return grants;
}

function reportCategories(
  report: Record<string, unknown>,
): CompanyClaimCategory[] {
  const categories = new Set<CompanyClaimCategory>();
  const type = String(report.report_type ?? "");
  if (type === "aging") categories.add("aging");
  if (type === "invoice_summary") categories.add("invoice_summary");
  if (type === "receipt_summary") categories.add("receipt_summary");
  if (type === "customer_outstanding") categories.add("customer_attention");
  if (type === "collections") categories.add("collections");
  if (type === "overdue_exposure") {
    categories.add("overdue");
    categories.add("customer_attention");
  }
  const columns = Array.isArray(report.columns) ? report.columns : [];
  const fields = new Set(columns.flatMap((item) => {
    const column = record(item);
    return typeof column?.field === "string" ? [column.field] : [];
  }));
  if (fields.has("outstanding_amount")) categories.add("outstanding");
  if (fields.has("overdue_amount")) categories.add("overdue");
  if (fields.has("unapplied_amount")) categories.add("unapplied_cash");
  if (fields.has("collection_amount")) categories.add("collections");
  return [...categories];
}

const METRIC_CATEGORIES: Readonly<Record<string, CompanyClaimCategory[]>> = {
  outstanding_amount: ["outstanding"],
  overdue_amount: ["overdue"],
  unapplied_amount: ["unapplied_cash"],
  collection_amount: ["collections"],
};

function reportLabel(row: Record<string, unknown>): string | null {
  for (const key of ["customer", "document", "aging_bucket", "period"]) {
    if (typeof row[key] === "string") {
      const label = String(row[key]).trim()
        .replace(/[.,;:!?\u3002\uff01\uff1f]+$/u, "")
        .toLocaleLowerCase();
      return label || null;
    }
  }
  return null;
}

function reportTimeBasis(
  report: Record<string, unknown>,
  row: Record<string, unknown> | null = null,
  businessDate: string | null = null,
): CompanyEvidenceGrant["time_basis"] {
  const asOf = typeof report.as_of === "string" ? report.as_of : null;
  if (businessDate === null || asOf !== businessDate) return "unspecified";
  if (row && typeof row.period === "string") {
    return row.period === businessDate.slice(0, 7) ? "current" : "unspecified";
  }
  return "current";
}

function reportGrants(
  outcome: CopilotToolOutcome,
  businessDate: string | null,
): CompanyEvidenceGrant[] {
  const root = record(outcome.data);
  const report = record(root?.report);
  if (!report) return [];
  const coverage = boundedCoverage(report.coverage);
  const rows = Array.isArray(report.rows)
    ? report.rows.map(record).filter((item): item is Record<string, unknown> =>
      item !== null
    )
    : [];
  const categories = reportCategories(report);
  const reportType = String(report.report_type ?? "");
  const grants: CompanyEvidenceGrant[] = categories.map((category) =>
    summaryGrant(category, coverage)
  );
  const baseCurrency = typeof report.base_currency === "string"
    ? report.base_currency
    : null;
  for (const row of rows) {
    const rowCurrency = typeof row.currency === "string"
      ? row.currency
      : baseCurrency;
    for (const [field, metricCategories] of Object.entries(METRIC_CATEGORIES)) {
      if (!Object.hasOwn(row, field)) continue;
      for (const category of metricCategories) {
        const grant = moneyGrant(category, rowCurrency, row[field], {
          coverage,
          aggregation_scope: "row",
          row_label: reportLabel(row),
          time_basis: reportTimeBasis(report, row, businessDate),
        });
        if (grant) grants.push(grant);
      }
    }
  }
  const summary = record(report.summary) ?? {};
  const reportTotal = moneyGrant(
    "outstanding",
    baseCurrency,
    summary.report_total,
    {
      coverage,
      aggregation_scope: "company_total",
      time_basis: reportTimeBasis(report, null, businessDate),
    },
  );
  if (reportTotal) grants.push(reportTotal);
  const sourceTotal = coverage?.source_total;
  const total = sourceTotal ??
    (reportType === "invoice_summary" || reportType === "receipt_summary"
      ? positiveInteger(summary.matching_document_count)
      : reportType === "customer_outstanding"
      ? positiveInteger(summary.matching_customer_count)
      : null);
  if (total !== null && total !== undefined) {
    const category = reportType === "receipt_summary"
      ? "receipt_summary"
      : reportType === "customer_outstanding"
      ? "customer_attention"
      : "invoice_summary";
    const grant = countGrant(category, total, coverage);
    if (grant) grants.push(grant);
    if (reportType === "invoice_summary" && categories.includes("overdue")) {
      const overdueCount = countGrant("overdue", total, coverage);
      if (overdueCount) grants.push(overdueCount);
    }
  }
  if (coverage?.status === "complete") {
    for (const category of categories) {
      grants.push(companyFact(category, "complete_set", { coverage }));
      grants.push(existenceGrant(category, rows.length > 0, coverage));
    }
    for (const [field, metricCategories] of Object.entries(METRIC_CATEGORIES)) {
      const candidates = rows.flatMap((row) => {
        const money = canonicalMoney(row[field]);
        const label = reportLabel(row);
        return money !== null && label !== null
          ? [{
            row,
            money,
            label,
            minor: moneyToMinor(money, `report.${field}`),
          }]
          : [];
      });
      if (candidates.length === 0) continue;
      const highest = candidates.reduce((best, item) =>
        item.minor > best.minor ? item : best
      );
      const lowest = candidates.reduce((best, item) =>
        item.minor < best.minor ? item : best
      );
      const rankCategories = new Set(metricCategories);
      if (
        reportType === "customer_outstanding" ||
        reportType === "overdue_exposure"
      ) rankCategories.add("customer_attention");
      for (const category of rankCategories) {
        grants.push(companyFact(category, "top_n", {
          rank_direction: "highest",
          rank_label: highest.label,
          top_n_count: 1,
          coverage,
        }));
        grants.push(companyFact(category, "top_n", {
          rank_direction: "lowest",
          rank_label: lowest.label,
          top_n_count: 1,
          coverage,
        }));
      }
    }
  }
  if (coverage?.top_n_complete === true) {
    for (const category of categories) {
      grants.push(companyFact(category, "top_n", {
        rank_direction: "top",
        rank_label: null,
        top_n_count: coverage.returned_rows,
        coverage,
      }));
    }
  }
  return grants;
}

function toolFactGrants(
  toolName: string,
  outcome: CopilotToolOutcome,
  businessDate: string | null,
): CompanyEvidenceGrant[] {
  const data = record(outcome.data);
  switch (toolName) {
    case "get_ar_summary": {
      if (!data) return [];
      const grants: CompanyEvidenceGrant[] = [summaryGrant("ar_summary")];
      const outstanding = moneyGrant(
        "outstanding",
        data.base_currency,
        data.total_outstanding_base ?? data.total_outstanding,
        { time_basis: "current" },
      );
      const overdue = moneyGrant(
        "overdue",
        data.base_currency,
        data.total_overdue_base ?? data.total_overdue,
        { time_basis: "current" },
      );
      if (outstanding) grants.push(outstanding);
      if (overdue) grants.push(overdue);
      const customers = countGrant(
        "customer_attention",
        data.total_customers,
        null,
        { time_basis: "current" },
      );
      if (customers) grants.push(customers);
      if (Array.isArray(data.by_currency)) {
        for (const item of data.by_currency) {
          const row = record(item);
          const grant = moneyGrant("outstanding", row?.currency, row?.amount, {
            time_basis: "current",
          });
          if (grant) grants.push(grant);
        }
      }
      return grants;
    }
    case "list_overdue_invoices": {
      const legacyRows = Array.isArray(outcome.data) ? outcome.data : null;
      const payload = record(outcome.data);
      const rows = legacyRows ??
        (Array.isArray(payload?.rows) ? payload.rows : null);
      if (!rows) return [];
      const coverage = boundedCoverage(payload?.coverage);
      const grants = [
        summaryGrant("overdue", coverage),
        summaryGrant("invoice_summary", coverage),
      ];
      if (rows.length > 0) {
        grants.push(
          existenceGrant("overdue", true, coverage, {
            time_basis: "current",
          }),
          existenceGrant("invoice_summary", true, coverage, {
            time_basis: "current",
          }),
        );
        const overdueMinimum = minimumCountGrant(
          "overdue",
          rows.length,
          { time_basis: "current" },
        );
        const invoiceMinimum = minimumCountGrant(
          "invoice_summary",
          rows.length,
          { time_basis: "current" },
        );
        if (overdueMinimum) grants.push(overdueMinimum);
        if (invoiceMinimum) grants.push(invoiceMinimum);
      }
      const total = positiveInteger(payload?.total_count) ??
        coverage?.source_total;
      if (total !== null && total !== undefined) {
        const overdueTotal = countGrant("overdue", total, coverage, {
          time_basis: "current",
        });
        const invoiceTotal = countGrant("invoice_summary", total, coverage, {
          time_basis: "current",
        });
        if (overdueTotal) grants.push(overdueTotal);
        if (invoiceTotal) grants.push(invoiceTotal);
        if (total === 0 && coverage?.status === "complete") {
          grants.push(
            existenceGrant("overdue", false, coverage, {
              time_basis: "current",
            }),
            existenceGrant("invoice_summary", false, coverage, {
              time_basis: "current",
            }),
          );
        }
      }
      if (coverage?.status === "complete") {
        grants.push(
          companyFact("overdue", "complete_set", { coverage }),
          companyFact("invoice_summary", "complete_set", { coverage }),
        );
      }
      return grants;
    }
    case "list_open_automation_exceptions": {
      if (!Array.isArray(outcome.data)) return [];
      const grants = [summaryGrant("workflow_exception")];
      if (outcome.data.length > 0) {
        grants.push(existenceGrant("workflow_exception", true));
        const minimum = minimumCountGrant(
          "workflow_exception",
          outcome.data.length,
        );
        if (minimum) grants.push(minimum);
      }
      return grants;
    }
    case "get_ar_priority_analysis":
      return data ? priorityGrants(data) : [];
    case "get_collection_health_analysis":
      return data ? factorGrants(data, "collection_amount", "collections") : [];
    case "get_exposure_movement_analysis":
      return data ? factorGrants(data, "overdue_amount", "overdue") : [];
    case "get_unapplied_cash_analysis": {
      if (!data) return [];
      const grants = [summaryGrant("unapplied_cash")];
      if (analysisItems(data).length > 0) {
        grants.push(existenceGrant("unapplied_cash", true));
        const minimum = minimumCountGrant(
          "unapplied_cash",
          analysisItems(data).length,
        );
        if (minimum) grants.push(minimum);
      }
      return grants;
    }
    case "get_daily_brief": {
      if (!data) return [];
      const items = Array.isArray(data.items)
        ? data.items.map(record).filter((
          item,
        ): item is Record<string, unknown> => item !== null)
        : [];
      const analysisLike = {
        ...data,
        status: "complete",
        priority_items: items,
      };
      return priorityGrants(analysisLike);
    }
    case "run_ar_report":
      return reportGrants(outcome, businessDate);
    default:
      return [];
  }
}

export function liveEvidenceGrantsFromOutcome(
  toolName: string,
  outcome: CopilotToolOutcome,
  context: { businessDate?: string | null } = {},
): LiveEvidenceGrant[] {
  return uniqueGrants([
    ...toolFactGrants(toolName, outcome, context.businessDate ?? null),
    ...entityGrants(outcome),
  ]);
}

export function validatedContextGrant(
  context: CopilotContextHint,
  outcome: CopilotToolOutcome | null,
): LiveEvidenceGrant[] {
  if (!context.entity_type || !context.entity_id || !outcome) return [];
  return uniqueGrants([{
    scope: "entity",
    entity_type: context.entity_type,
    entity_id: context.entity_id,
  }, ...entityGrants(outcome)]);
}

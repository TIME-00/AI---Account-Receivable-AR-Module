import type { SupabaseClient } from "supabase";
import type { AuthContext } from "../_shared/auth.ts";
import { AuthorizationError, BusinessError } from "../_shared/errors.ts";
import {
  SUPPORTED_OPERATIONAL_CURRENCIES,
  validateDate,
} from "../_shared/validators.ts";
import type { LiveDashboardMetrics } from "../reports/dashboard-types.ts";
import { minorToMoney, moneyToMinor } from "../reports/export-contract.ts";
import type { CustomerAgingRow } from "../reports/service.ts";
import { ReportService } from "../reports/service.ts";
import type {
  AnalystMetric,
  AnalystReportPlan,
  AnalystReportResult,
} from "./analyst-contract.ts";
import { exactMoney, sortReportRows } from "./analyst-engine.ts";

type ReportRow = AnalystReportResult["rows"][number];

export interface AnalystDocumentRow {
  id: string;
  document: string;
  document_date: string;
  status: string;
  customer_id: string;
  currency: string;
  total_amount: string;
  outstanding_amount?: string;
  unapplied_amount?: string;
}

export interface AnalystDocumentRowsResult {
  rows: AnalystDocumentRow[];
  total: number;
  base_currency: string;
  filter_currency: string | null;
  sort_metric: string | null;
  sort_direction: "asc" | "desc" | null;
}

export interface AnalystDocumentRowsRequest {
  status: string | null;
  currency: string | null;
  date_from: string | null;
  date_to: string | null;
  minimum_amount: string | null;
  sort_metric: string | null;
  sort_direction: "asc" | "desc" | null;
  limit: number;
}

export interface AnalystReportSources {
  getDashboard(
    auth: AuthContext,
    asOfDate: string,
    months: number,
  ): Promise<LiveDashboardMetrics>;
  getCustomerAging(
    auth: AuthContext,
    asOfDate: string,
    pageSize: number,
    creditRating: string | null,
  ): Promise<{ rows: CustomerAgingRow[]; total: number }>;
  getDocumentRows(
    kind: "invoice" | "receipt",
    auth: AuthContext,
    request: AnalystDocumentRowsRequest,
  ): Promise<AnalystDocumentRowsResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new BusinessError(
      "REPORT_CONTRACT_INVALID",
      `Invalid analytical report field: ${field}.`,
      500,
    );
  }
  return value;
}

function currency(value: unknown, field: string): string {
  const result = requiredText(value, field, 3);
  if (
    !SUPPORTED_OPERATIONAL_CURRENCIES.includes(
      result as typeof SUPPORTED_OPERATIONAL_CURRENCIES[number],
    )
  ) {
    throw new BusinessError(
      "REPORT_CONTRACT_INVALID",
      `Invalid analytical report field: ${field}.`,
      500,
    );
  }
  return result;
}

export function parseAnalystDocumentRowsResult(
  value: unknown,
  kind: "invoice" | "receipt",
  request: AnalystDocumentRowsRequest,
): AnalystDocumentRowsResult {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new BusinessError(
      "REPORT_CONTRACT_INVALID",
      "The analytical report source returned an invalid result.",
      500,
    );
  }
  if (
    !Number.isSafeInteger(value.total) || Number(value.total) < 0 ||
    Number(value.total) < value.rows.length || value.rows.length > request.limit
  ) {
    throw new BusinessError(
      "REPORT_CONTRACT_INVALID",
      "The analytical report source returned invalid coverage metadata.",
      500,
    );
  }
  const expectedMoney = kind === "invoice"
    ? "outstanding_amount"
    : "unapplied_amount";
  const rows = value.rows.map((raw, index): AnalystDocumentRow => {
    if (!isRecord(raw)) {
      throw new BusinessError(
        "REPORT_CONTRACT_INVALID",
        `The analytical report row ${index} is invalid.`,
        500,
      );
    }
    const rowCurrency = currency(raw.currency, `rows[${index}].currency`);
    if (request.currency && rowCurrency !== request.currency) {
      throw new BusinessError(
        "REPORT_CONTRACT_INVALID",
        "The authoritative report source violated the requested currency scope.",
        500,
      );
    }
    const result: AnalystDocumentRow = {
      id: requiredText(raw.id, `rows[${index}].id`, 36),
      document: requiredText(raw.document, `rows[${index}].document`, 30),
      document_date: requiredText(
        raw.document_date,
        `rows[${index}].document_date`,
        10,
      ),
      status: requiredText(raw.status, `rows[${index}].status`, 24),
      customer_id: requiredText(
        raw.customer_id,
        `rows[${index}].customer_id`,
        36,
      ),
      currency: rowCurrency,
      total_amount: exactMoney(raw.total_amount, `rows[${index}].total_amount`),
    };
    result[expectedMoney] = exactMoney(
      raw[expectedMoney],
      `rows[${index}].${expectedMoney}`,
    );
    return result;
  });
  const baseCurrency = currency(value.base_currency, "base_currency");
  const filterCurrency = value.filter_currency === null
    ? null
    : currency(value.filter_currency, "filter_currency");
  if (filterCurrency !== request.currency) {
    throw new BusinessError(
      "REPORT_CONTRACT_INVALID",
      "The report source did not apply the requested currency filter.",
      500,
    );
  }
  const sortMetric = value.sort_metric === null
    ? null
    : requiredText(value.sort_metric, "sort_metric", 30);
  const sortDirection = value.sort_direction === null
    ? null
    : requiredText(value.sort_direction, "sort_direction", 4);
  if (
    sortMetric !== request.sort_metric ||
    sortDirection !== request.sort_direction ||
    (sortDirection !== null && sortDirection !== "asc" &&
      sortDirection !== "desc")
  ) {
    throw new BusinessError(
      "REPORT_CONTRACT_INVALID",
      "The report source did not apply the requested sort.",
      500,
    );
  }
  return {
    rows,
    total: Number(value.total),
    base_currency: baseCurrency,
    filter_currency: filterCurrency,
    sort_metric: sortMetric,
    sort_direction: sortDirection as "asc" | "desc" | null,
  };
}

export class SupabaseAnalystReportSources implements AnalystReportSources {
  readonly #reports: ReportService;

  constructor(
    private readonly trusted: SupabaseClient,
    user: SupabaseClient,
  ) {
    this.#reports = new ReportService(user, user);
  }

  getDashboard(
    auth: AuthContext,
    asOfDate: string,
    months: number,
  ): Promise<LiveDashboardMetrics> {
    return this.#reports.getDashboardMetrics(auth, asOfDate, months);
  }

  getCustomerAging(
    auth: AuthContext,
    asOfDate: string,
    pageSize: number,
    creditRating: string | null,
  ): Promise<{ rows: CustomerAgingRow[]; total: number }> {
    return this.#reports.getAgingByCustomer(
      auth,
      asOfDate,
      { page: 1, page_size: pageSize },
      creditRating ?? undefined,
    );
  }

  async getDocumentRows(
    kind: "invoice" | "receipt",
    auth: AuthContext,
    request: AnalystDocumentRowsRequest,
  ): Promise<AnalystDocumentRowsResult> {
    const companyScope = auth.roles.some((role) =>
      ["AR Supervisor", "Finance Manager", "Auditor"].includes(role)
    );
    const { data, error } = await this.trusted.rpc(
      kind === "invoice"
        ? "ar_copilot_invoice_report_rows"
        : "ar_copilot_receipt_report_rows",
      {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
        p_scope_mode: companyScope ? "company" : "assigned",
        p_status: request.status,
        p_currency: request.currency,
        p_date_from: request.date_from,
        p_date_to: request.date_to,
        p_minimum_amount: request.minimum_amount,
        p_sort_metric: request.sort_metric,
        p_sort_direction: request.sort_direction,
        p_limit: request.limit,
      },
    );
    if (error) {
      if (error.code === "42501") throw new AuthorizationError();
      throw new BusinessError(
        "REPORT_QUERY_FAILED",
        "Unable to retrieve the requested analytical report.",
        500,
      );
    }
    return parseAnalystDocumentRowsResult(data, kind, request);
  }
}

const METRIC_COLUMNS: Record<AnalystMetric, {
  label: string;
  format: "currency" | "number";
}> = {
  invoice_count: { label: "Invoices", format: "number" },
  receipt_count: { label: "Receipts", format: "number" },
  total_amount: { label: "Total amount", format: "currency" },
  outstanding_amount: { label: "Outstanding amount", format: "currency" },
  overdue_amount: { label: "Overdue amount", format: "currency" },
  unapplied_amount: { label: "Unapplied amount", format: "currency" },
  collection_amount: { label: "Collection amount", format: "currency" },
};

function selectedColumns(
  dimension: { field: string; label: string },
  plan: AnalystReportPlan,
  metadata: Array<{ field: string; label: string; format: "text" | "date" }> =
    [],
): AnalystReportResult["columns"] {
  return [
    { ...dimension, format: "text" as const },
    ...metadata,
    ...plan.metrics.map((metric) => ({
      field: metric,
      ...METRIC_COLUMNS[metric],
    })),
  ];
}

function projectMetrics(
  source: ReportRow,
  plan: AnalystReportPlan,
  retained: readonly string[],
): ReportRow {
  const result: ReportRow = {};
  for (const field of retained) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  for (const metric of plan.metrics) result[metric] = source[metric] ?? null;
  return result;
}

function coverage(
  sourceTotal: number | null,
  returnedRows: number,
  topNComplete: boolean | null,
  reason: string | null,
): AnalystReportResult["coverage"] {
  const complete = sourceTotal !== null && returnedRows >= sourceTotal;
  return {
    status: complete ? "complete" : "bounded_incomplete",
    source_total: sourceTotal,
    returned_rows: returnedRows,
    top_n_complete: topNComplete,
    reason: complete ? null : reason,
  };
}

function sumMoney(rows: ReportRow[], field: string): string {
  return minorToMoney(rows.reduce(
    (sum, row) => sum + moneyToMinor(row[field], `report.${field}`),
    0n,
  ));
}

function assertDocumentSourcePostconditions(
  source: AnalystDocumentRowsResult,
  request: AnalystDocumentRowsRequest,
  balanceField: "outstanding_amount" | "unapplied_amount",
): void {
  const minimum = request.minimum_amount === null
    ? null
    : moneyToMinor(request.minimum_amount, "minimum_amount");
  for (const row of source.rows) {
    if (request.currency !== null && row.currency !== request.currency) {
      throw new BusinessError(
        "REPORT_CONTRACT_INVALID",
        "The report source returned a row outside the requested currency.",
        500,
      );
    }
    if (
      minimum !== null &&
      moneyToMinor(row[balanceField], balanceField) < minimum
    ) {
      throw new BusinessError(
        "REPORT_CONTRACT_INVALID",
        "The report source returned a row below the requested minimum amount.",
        500,
      );
    }
  }
  if (!request.sort_metric) return;
  for (let index = 1; index < source.rows.length; index += 1) {
    const previous = moneyToMinor(
      source.rows[index - 1][request.sort_metric as keyof AnalystDocumentRow],
      `sort.${request.sort_metric}`,
    );
    const current = moneyToMinor(
      source.rows[index][request.sort_metric as keyof AnalystDocumentRow],
      `sort.${request.sort_metric}`,
    );
    const invalid = request.sort_direction === "asc"
      ? previous > current
      : previous < current;
    if (invalid) {
      throw new BusinessError(
        "REPORT_CONTRACT_INVALID",
        "The report source did not sort before applying the result limit.",
        500,
      );
    }
  }
}

export class AnalystReportService {
  constructor(
    private readonly sources: AnalystReportSources,
    private readonly businessDate: string,
  ) {
    validateDate(businessDate, "business_date");
  }

  async runReport(
    auth: AuthContext,
    plan: AnalystReportPlan,
  ): Promise<AnalystReportResult> {
    return plan.report === "invoice_summary" ||
        plan.report === "receipt_summary"
      ? await this.#document(auth, plan)
      : await this.#dashboard(auth, plan);
  }

  async #document(
    auth: AuthContext,
    plan: AnalystReportPlan,
  ): Promise<AnalystReportResult> {
    const kind = plan.report === "invoice_summary" ? "invoice" : "receipt";
    const filter = (field: string) =>
      plan.filters.find((item) => item.field === field)?.value ?? null;
    const request: AnalystDocumentRowsRequest = {
      status: filter("status"),
      currency: filter("currency"),
      date_from: plan.period.date_from,
      date_to: plan.period.date_to,
      minimum_amount: filter("minimum_amount"),
      sort_metric: plan.sort?.metric ?? null,
      sort_direction: plan.sort?.direction ?? null,
      limit: plan.limit,
    };
    const source = await this.sources.getDocumentRows(kind, auth, request);
    const countMetric = kind === "invoice" ? "invoice_count" : "receipt_count";
    const balanceMetric = kind === "invoice"
      ? "outstanding_amount"
      : "unapplied_amount";
    assertDocumentSourcePostconditions(source, request, balanceMetric);
    const rows = source.rows.map((row) =>
      projectMetrics(
        {
          document: row.document,
          document_id: row.id,
          document_date: row.document_date,
          customer_id: row.customer_id,
          status: row.status,
          currency: row.currency,
          [countMetric]: 1,
          total_amount: row.total_amount,
          [balanceMetric]: row[balanceMetric] ?? null,
        },
        plan,
        [
          "document",
          "document_id",
          "document_date",
          "customer_id",
          "status",
          "currency",
        ],
      )
    );
    const topNComplete = plan.sort ? true : null;
    return {
      report_type: plan.report,
      title: kind === "invoice" ? "Invoice Summary" : "Receipt Summary",
      description: source.total > rows.length
        ? "Authoritative rows from a bounded result; the complete matching set is larger."
        : "Complete authorized document result.",
      as_of: this.businessDate,
      base_currency: source.base_currency,
      columns: selectedColumns(
        { field: "document", label: "Document" },
        plan,
        [
          { field: "document_date", label: "Date", format: "date" },
          { field: "status", label: "Status", format: "text" },
          { field: "currency", label: "Currency", format: "text" },
        ],
      ),
      rows,
      summary: {
        row_count: rows.length,
        matching_document_count: source.total,
        transaction_currency: source.filter_currency,
        minimum_amount: request.minimum_amount,
        multi_currency: new Set(rows.map((row) => row.currency)).size > 1,
        sort_applied_before_limit: plan.sort !== null,
      },
      coverage: coverage(
        source.total,
        rows.length,
        topNComplete,
        "The request intentionally returned a bounded subset of the matching documents.",
      ),
      authority: "authoritative_rows",
    };
  }

  async #dashboard(
    auth: AuthContext,
    plan: AnalystReportPlan,
  ): Promise<AnalystReportResult> {
    const asOf = plan.period.as_of_date ?? this.businessDate;
    if (plan.report === "customer_outstanding") {
      return await this.#customer(auth, plan, asOf);
    }
    const months = plan.report === "collections"
      ? Math.min(12, Math.max(2, plan.limit))
      : 6;
    const metrics = await this.sources.getDashboard(auth, asOf, months);
    if (plan.report === "aging") return this.#aging(plan, metrics);
    if (plan.report === "collections") return this.#collections(plan, metrics);
    return this.#overdue(plan, metrics);
  }

  #aging(
    plan: AnalystReportPlan,
    metrics: LiveDashboardMetrics,
  ): AnalystReportResult {
    const allRows = metrics.aging_buckets.map((row) => ({
      aging_bucket: row.label,
      aging_bucket_key: row.key,
      invoice_count: row.invoice_count,
      outstanding_amount: exactMoney(row.outstanding_base, "aging.outstanding"),
    }));
    const rows = allRows.slice(0, plan.limit).map((row) =>
      projectMetrics(row, plan, ["aging_bucket", "aging_bucket_key"])
    );
    const canonicalKeys = ["current", "1_30", "31_60", "61_90", "over_90"];
    const completePartition = rows.length === canonicalKeys.length &&
      rows.every((row, index) => row.aging_bucket_key === canonicalKeys[index]);
    const partitionTotal = plan.metrics.includes("outstanding_amount")
      ? sumMoney(rows, "outstanding_amount")
      : null;
    const reportTotal = exactMoney(
      metrics.kpis.total_outstanding_ar,
      "aging.report_total",
    );
    return {
      report_type: "aging",
      title: "AR Aging",
      description: "Authorized fixed-bucket aging distribution.",
      as_of: metrics.meta.as_of_date,
      base_currency: metrics.meta.base_currency,
      columns: selectedColumns(
        { field: "aging_bucket", label: "Aging bucket" },
        plan,
      ),
      rows,
      summary: {
        row_count: rows.length,
        canonical_partition_complete: completePartition,
        partition_total: partitionTotal,
        report_total: reportTotal,
      },
      coverage: coverage(
        allRows.length,
        rows.length,
        null,
        "The requested limit omitted one or more canonical aging buckets.",
      ),
      authority: "authoritative_rows",
    };
  }

  #collections(
    plan: AnalystReportPlan,
    metrics: LiveDashboardMetrics,
  ): AnalystReportResult {
    const rows = metrics.collection_trend.slice(-plan.limit).map((row) =>
      projectMetrics(
        {
          period: row.month,
          receipt_count: row.receipt_count,
          collection_amount: exactMoney(
            row.collected_base,
            "collections.amount",
          ),
        },
        plan,
        ["period"],
      )
    );
    return {
      report_type: "collections",
      title: "Collections Trend",
      description: "Authorized monthly collection series.",
      as_of: metrics.meta.as_of_date,
      base_currency: metrics.meta.base_currency,
      columns: selectedColumns({ field: "period", label: "Period" }, plan),
      rows,
      summary: { row_count: rows.length, ordered_period_series: true },
      coverage: coverage(rows.length, rows.length, null, null),
      authority: "authoritative_rows",
    };
  }

  #overdue(
    plan: AnalystReportPlan,
    metrics: LiveDashboardMetrics,
  ): AnalystReportResult {
    const allRows = metrics.top_outstanding_customers.map((row) => ({
      customer: row.customer_name,
      customer_id: row.customer_id,
      invoice_count: row.overdue_invoice_count,
      outstanding_amount: exactMoney(
        row.outstanding_base,
        "customer.outstanding",
      ),
      overdue_amount: exactMoney(row.overdue_base, "customer.overdue"),
    }));
    const rows = allRows.slice(0, plan.limit).map((row) =>
      projectMetrics(row, plan, ["customer", "customer_id"])
    );
    return {
      report_type: "overdue_exposure",
      title: "Overdue Exposure",
      description: "Bounded authoritative dashboard customer ranking.",
      as_of: metrics.meta.as_of_date,
      base_currency: metrics.meta.base_currency,
      columns: selectedColumns({ field: "customer", label: "Customer" }, plan),
      rows,
      summary: { row_count: rows.length },
      coverage: {
        status: "bounded_incomplete",
        source_total: null,
        returned_rows: rows.length,
        top_n_complete: null,
        reason:
          "The dashboard authority exposes a bounded customer ranking without a full-set count.",
      },
      authority: "authoritative_rows",
    };
  }

  async #customer(
    auth: AuthContext,
    plan: AnalystReportPlan,
    asOf: string,
  ): Promise<AnalystReportResult> {
    const rating = plan.filters.find((item) => item.field === "credit_rating")
      ?.value ?? null;
    const [source, dashboard] = await Promise.all([
      this.sources.getCustomerAging(auth, asOf, 200, rating),
      this.sources.getDashboard(auth, asOf, 2),
    ]);
    const candidates = source.rows.map((row) => ({
      customer: row.customer_name,
      customer_id: row.customer_id,
      credit_rating: row.credit_rating,
      outstanding_amount: exactMoney(row.base_total, "customer.base_total"),
      overdue_amount: minorToMoney(
        moneyToMinor(row.bucket_1_30, "customer.bucket_1_30") +
          moneyToMinor(row.bucket_31_60, "customer.bucket_31_60") +
          moneyToMinor(row.bucket_61_90, "customer.bucket_61_90") +
          moneyToMinor(row.bucket_over_90, "customer.bucket_over_90"),
      ),
    }));
    const sorted = sortReportRows(candidates, plan);
    const rows = sorted.map((row) =>
      projectMetrics(row, plan, ["customer", "customer_id", "credit_rating"])
    );
    const sourceComplete = source.total <= candidates.length;
    return {
      report_type: "customer_outstanding",
      title: "Customer Outstanding",
      description: sourceComplete
        ? "Complete authorized customer aging result."
        : "Bounded authorized customer aging rows; a global requested sort cannot be proven complete.",
      as_of: asOf,
      base_currency: dashboard.meta.base_currency,
      columns: selectedColumns(
        { field: "customer", label: "Customer" },
        plan,
        [{ field: "credit_rating", label: "Credit rating", format: "text" }],
      ),
      rows,
      summary: {
        row_count: rows.length,
        matching_customer_count: source.total,
        source_rows_examined: candidates.length,
      },
      coverage: coverage(
        source.total,
        rows.length,
        plan.sort ? sourceComplete : null,
        sourceComplete
          ? "The requested limit intentionally bounds the complete candidate set."
          : "The source exceeded 200 authorized customers; the returned ordering is not a proven global top-N.",
      ),
      authority: "authoritative_rows",
    };
  }
}

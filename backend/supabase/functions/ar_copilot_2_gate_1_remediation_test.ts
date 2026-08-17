import type { AuthContext } from "./_shared/auth.ts";
import { BusinessError, ValidationError } from "./_shared/errors.ts";
import type { LiveDashboardMetrics } from "./reports/dashboard-types.ts";
import type { CustomerAgingRow } from "./reports/service.ts";
import { dateInTimeZone } from "./_shared/business-time.ts";
import {
  type AnalystReportPlan,
  type AnalystReportResult,
  parseAnalystReportPlan,
} from "./ar-copilot/analyst-contract.ts";
import {
  type AnalystDocumentRowsRequest,
  type AnalystDocumentRowsResult,
  AnalystReportService,
  type AnalystReportSources,
  parseAnalystDocumentRowsResult,
} from "./ar-copilot/analyst-report-service.ts";
import {
  assertChartPreservesReport,
  buildChartSpec,
} from "./ar-copilot/analyst-engine.ts";
import { searchSystemGuide } from "./ar-copilot/knowledge.ts";
import {
  detectCopilotLanguage,
  multilingualIntentSignals,
} from "./ar-copilot/language.ts";
import {
  classifyCopilotQuestion,
  questionHasLiveClaimSignals,
  questionRequiresLiveData,
} from "./ar-copilot/tools.ts";
import {
  type CompanyEvidenceGrant,
  liveEvidenceGrantsFromOutcome,
  questionLiveEvidenceRequirements,
  verifyFinalAnswerLiveEvidence,
} from "./ar-copilot/live-evidence.ts";

const COMPANY = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000002";
const CUSTOMER = "30000000-0000-4000-8000-000000000003";
const TEST_BUSINESS_DATE = "2026-08-14";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

async function rejects(
  callback: () => unknown | Promise<unknown>,
  expected: new (...args: never[]) => Error = ValidationError,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    assert(error instanceof expected, `Expected ${expected.name}`);
    return;
  }
  throw new Error("Expected rejection");
}

function auth(roles: AuthContext["roles"] = ["Finance Manager"]): AuthContext {
  return {
    userId: USER,
    companyId: COMPANY,
    roles,
    highestRole: roles[0],
    email: null,
  };
}

function plan(overrides: Partial<AnalystReportPlan> = {}): AnalystReportPlan {
  return {
    report: "invoice_summary",
    metrics: ["outstanding_amount"],
    dimensions: ["document"],
    filters: [{ field: "currency", operator: "eq", value: "SGD" }],
    period: { date_from: null, date_to: null, as_of_date: null },
    sort: { metric: "outstanding_amount", direction: "desc" },
    limit: 2,
    chart_type: null,
    ...overrides,
  };
}

function dashboard(): LiveDashboardMetrics {
  return {
    meta: {
      company_id: COMPANY,
      base_currency: "SGD",
      as_of_date: "2026-08-14",
      calculated_at: "2026-08-14T00:00:00Z",
      scope: "company",
      trend_months: 6,
    },
    kpis: {
      total_outstanding_ar: 15000,
      overdue_outstanding: 12000,
      overdue_invoice_count: 4,
      unapplied_cash: 500,
      current_month_collections: 900,
      current_month_posted_invoices: 2,
      import_rows_needing_review: 0,
    },
    invoice_status_counts: {
      open: 1,
      partially_paid: 1,
      overdue_status: 4,
      paid: 0,
      unpaid_total: 6,
    },
    aging_buckets: [
      {
        key: "current",
        label: "Current",
        invoice_count: 1,
        outstanding_base: 3000,
        percentage: 20,
      },
      {
        key: "1_30",
        label: "1-30",
        invoice_count: 1,
        outstanding_base: 2000,
        percentage: 13.33,
      },
      {
        key: "31_60",
        label: "31-60",
        invoice_count: 1,
        outstanding_base: 3000,
        percentage: 20,
      },
      {
        key: "61_90",
        label: "61-90",
        invoice_count: 1,
        outstanding_base: 4000,
        percentage: 26.67,
      },
      {
        key: "over_90",
        label: "Over 90",
        invoice_count: 1,
        outstanding_base: 3000,
        percentage: 20,
      },
    ],
    collection_trend: [
      { month: "2026-07", collected_base: 1000, receipt_count: 2 },
      { month: "2026-08", collected_base: 900, receipt_count: 1 },
    ],
    top_outstanding_customers: [{
      customer_id: CUSTOMER,
      customer_code: "C-1",
      customer_name: "Scoped Customer",
      outstanding_base: 15000,
      overdue_base: 12000,
      overdue_invoice_count: 4,
    }],
    credit_rating_distribution: [],
    customer_credit_rating_distribution: {
      population: "VISIBLE_CUSTOMERS",
      included_statuses: ["Active", "Inactive", "Blocked", "On Hold"],
      rows: [],
    },
    total_invoices: 6,
    open_invoices: 6,
    overdue_invoices: 4,
    total_receipts: 2,
    total_ar_balance: 15000,
    total_overdue_balance: 12000,
    total_credit_balance: 500,
    overdue_percentage: 80,
  };
}

const INVOICE_ROWS = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    document: "INV-MYR-LARGE",
    document_date: "2026-08-14",
    status: "Open",
    customer_id: CUSTOMER,
    currency: "MYR",
    total_amount: "9000.00",
    outstanding_amount: "9000.00",
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    document: "INV-SGD-SMALL",
    document_date: "2026-08-13",
    status: "Open",
    customer_id: CUSTOMER,
    currency: "SGD",
    total_amount: "1000.00",
    outstanding_amount: "1000.00",
  },
  {
    id: "40000000-0000-4000-8000-000000000003",
    document: "INV-SGD-LARGE",
    document_date: "2026-08-01",
    status: "Overdue",
    customer_id: CUSTOMER,
    currency: "SGD",
    total_amount: "7000.00",
    outstanding_amount: "7000.00",
  },
] as const;

const RECEIPT_ROWS = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    document: "RCT-MYR-LARGE",
    document_date: "2026-08-14",
    status: "Posted",
    customer_id: CUSTOMER,
    currency: "MYR",
    total_amount: "8000.00",
    unapplied_amount: "8000.00",
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    document: "RCT-SGD-LARGE",
    document_date: "2026-08-01",
    status: "Posted",
    customer_id: CUSTOMER,
    currency: "SGD",
    total_amount: "6000.00",
    unapplied_amount: "6000.00",
  },
] as const;

class FakeSources implements AnalystReportSources {
  requests: Array<{
    kind: "invoice" | "receipt";
    auth: AuthContext;
    request: AnalystDocumentRowsRequest;
  }> = [];
  sourceTotalOverride: number | null = null;
  malformedRows: AnalystDocumentRowsResult["rows"] | null = null;
  customerRows: CustomerAgingRow[] = [];
  customerTotal = 0;

  getDashboard(): Promise<LiveDashboardMetrics> {
    return Promise.resolve(dashboard());
  }

  getCustomerAging(): Promise<{ rows: CustomerAgingRow[]; total: number }> {
    return Promise.resolve({
      rows: this.customerRows,
      total: this.customerTotal,
    });
  }

  getDocumentRows(
    kind: "invoice" | "receipt",
    a: AuthContext,
    request: AnalystDocumentRowsRequest,
  ): Promise<AnalystDocumentRowsResult> {
    this.requests.push({ kind, auth: a, request: structuredClone(request) });
    if (this.malformedRows) {
      return Promise.resolve({
        rows: this.malformedRows,
        total: this.sourceTotalOverride ?? this.malformedRows.length,
        base_currency: "SGD",
        filter_currency: request.currency,
        sort_metric: request.sort_metric,
        sort_direction: request.sort_direction,
      });
    }
    const field = kind === "invoice"
      ? "outstanding_amount"
      : "unapplied_amount";
    let rows = [...(kind === "invoice" ? INVOICE_ROWS : RECEIPT_ROWS)].map((
      row,
    ) => ({ ...row }));
    if (request.currency) {
      rows = rows.filter((row) => row.currency === request.currency);
    }
    if (request.status) {
      rows = rows.filter((row) => row.status === request.status);
    }
    if (request.minimum_amount) {
      const minimum = BigInt(request.minimum_amount.replace(".", ""));
      rows = rows.filter((row) =>
        BigInt(String(row[field as keyof typeof row]).replace(".", "")) >=
          minimum
      );
    }
    if (request.sort_metric) {
      rows.sort((left, right) => {
        const aValue = BigInt(
          String(left[request.sort_metric as keyof typeof left]).replace(
            ".",
            "",
          ),
        );
        const bValue = BigInt(
          String(right[request.sort_metric as keyof typeof right]).replace(
            ".",
            "",
          ),
        );
        const comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
        return request.sort_direction === "asc" ? comparison : -comparison;
      });
    }
    const total = this.sourceTotalOverride ?? rows.length;
    return Promise.resolve({
      rows: rows.slice(0, request.limit),
      total,
      base_currency: "SGD",
      filter_currency: request.currency,
      sort_metric: request.sort_metric,
      sort_direction: request.sort_direction,
    } as AnalystDocumentRowsResult);
  }
}

Deno.test("runReport propagates currency, minimum, sort, tenant, and actor to the authoritative boundary", async () => {
  const sources = new FakeSources();
  await new AnalystReportService(sources, TEST_BUSINESS_DATE).runReport(
    auth(),
    plan({
      filters: [
        { field: "currency", operator: "eq", value: "SGD" },
        { field: "minimum_amount", operator: "gte", value: "5000.00" },
      ],
    }),
  );
  assertEquals(sources.requests[0].request.currency, "SGD");
  assertEquals(sources.requests[0].request.minimum_amount, "5000.00");
  assertEquals(sources.requests[0].request.sort_metric, "outstanding_amount");
  assertEquals(sources.requests[0].auth.companyId, COMPANY);
  assertEquals(sources.requests[0].auth.userId, USER);
});

Deno.test("runReport SGD scope cannot return a large MYR Invoice", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan(),
  );
  assertEquals(report.rows.map((row) => row.document), [
    "INV-SGD-LARGE",
    "INV-SGD-SMALL",
  ]);
  assert(report.rows.every((row) => row.currency === "SGD"));
});

Deno.test("runReport MYR scope cannot return SGD Invoices", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan({
      filters: [{ field: "currency", operator: "eq", value: "MYR" }],
    }),
  );
  assertEquals(report.rows.map((row) => row.document), ["INV-MYR-LARGE"]);
});

Deno.test("runReport Receipt minimum applies only inside selected currency", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan({
      report: "receipt_summary",
      metrics: ["unapplied_amount"],
      filters: [
        { field: "currency", operator: "eq", value: "SGD" },
        { field: "minimum_amount", operator: "gte", value: "5000.00" },
      ],
      sort: { metric: "unapplied_amount", direction: "desc" },
    }),
  );
  assertEquals(report.rows.map((row) => row.document), ["RCT-SGD-LARGE"]);
  assert(report.rows.every((row) => row.currency === "SGD"));
});

Deno.test("runReport rejects a source row outside selected currency", async () => {
  const sources = new FakeSources();
  sources.malformedRows = [{ ...INVOICE_ROWS[0] }];
  await rejects(
    () =>
      new AnalystReportService(sources, TEST_BUSINESS_DATE).runReport(
        auth(),
        plan(),
      ),
    BusinessError,
  );
});

Deno.test("runReport rejects a source row below selected exact minimum", async () => {
  const sources = new FakeSources();
  sources.malformedRows = [{ ...INVOICE_ROWS[1] }];
  await rejects(
    () =>
      new AnalystReportService(sources, TEST_BUSINESS_DATE).runReport(
        auth(),
        plan({
          filters: [
            { field: "currency", operator: "eq", value: "SGD" },
            { field: "minimum_amount", operator: "gte", value: "5000.00" },
          ],
        }),
      ),
    BusinessError,
  );
});

Deno.test("runReport top-N sort occurs before requested limit", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan({ limit: 1 }),
  );
  assertEquals(report.rows[0].document, "INV-SGD-LARGE");
  assertEquals(report.rows[0].outstanding_amount, "7000.00");
});

Deno.test("runReport rejects an incorrectly ordered authoritative source", async () => {
  const sources = new FakeSources();
  sources.malformedRows = [{ ...INVOICE_ROWS[1] }, { ...INVOICE_ROWS[2] }];
  await rejects(
    () =>
      new AnalystReportService(sources, TEST_BUSINESS_DATE).runReport(
        auth(),
        plan(),
      ),
    BusinessError,
  );
});

Deno.test("bounded top-N rows do not claim a complete matching set", async () => {
  const sources = new FakeSources();
  sources.sourceTotalOverride = 12;
  const report = await new AnalystReportService(sources, TEST_BUSINESS_DATE)
    .runReport(
      auth(),
      plan({ limit: 2 }),
    );
  assertEquals(report.coverage.status, "bounded_incomplete");
  assertEquals(report.coverage.source_total, 12);
  assertEquals(report.coverage.top_n_complete, true);
  assertEquals(report.authority, "authoritative_rows");
});

Deno.test("selected metrics shape document financial fields", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan({
      metrics: ["invoice_count"],
      sort: null,
    }),
  );
  assert(report.columns.some((column) => column.field === "invoice_count"));
  assert(!report.columns.some((column) => column.field === "total_amount"));
  assert(!Object.hasOwn(report.rows[0], "total_amount"));
  assert(!Object.hasOwn(report.rows[0], "outstanding_amount"));
});

Deno.test("sort metric must be selected and genuinely sortable", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...plan({ metrics: ["invoice_count"] }),
      sort: { metric: "outstanding_amount", direction: "desc" },
    })
  );
  await rejects(() =>
    parseAnalystReportPlan({
      ...plan({ metrics: ["invoice_count"] }),
      sort: { metric: "invoice_count", direction: "desc" },
    })
  );
});

Deno.test("unimplemented status/currency/credit-rating dimensions are rejected", async () => {
  for (const dimension of ["status", "currency", "credit_rating"]) {
    await rejects(() =>
      parseAnalystReportPlan({ ...plan(), dimensions: [dimension] })
    );
  }
});

Deno.test("retained document dimension is executed as one authoritative document per row", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan(),
  );
  assertEquals(report.columns[0].field, "document");
  assertEquals(
    new Set(report.rows.map((row) => row.document)).size,
    report.rows.length,
  );
});

Deno.test("duplicate filters and contradictory period fields remain rejected", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...plan(),
      filters: [
        { field: "currency", operator: "eq", value: "MYR" },
        { field: "currency", operator: "eq", value: "SGD" },
      ],
    })
  );
  await rejects(() =>
    parseAnalystReportPlan({
      ...plan(),
      period: { date_from: null, date_to: null, as_of_date: "2026-08-14" },
    })
  );
});

Deno.test("mixed-currency monetary chart remains rejected", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan({
      filters: [],
      sort: null,
      chart_type: "bar",
    }),
  );
  await rejects(() =>
    buildChartSpec(plan({ filters: [], sort: null, chart_type: "bar" }), report)
  );
});

Deno.test("empty report base currency comes from authority and is not hard-coded MYR", async () => {
  const sources = new FakeSources();
  sources.malformedRows = [];
  const report = await new AnalystReportService(sources, TEST_BUSINESS_DATE)
    .runReport(
      auth(),
      plan(),
    );
  assertEquals(report.rows, []);
  assertEquals(report.base_currency, "SGD");
});

Deno.test("analytical row parser rejects currency-filter drift", async () => {
  await rejects(() =>
    parseAnalystDocumentRowsResult(
      {
        rows: [{ ...INVOICE_ROWS[0] }],
        total: 1,
        base_currency: "MYR",
        filter_currency: "SGD",
        sort_metric: null,
        sort_direction: null,
      },
      "invoice",
      {
        status: null,
        currency: "SGD",
        date_from: null,
        date_to: null,
        minimum_amount: null,
        sort_metric: null,
        sort_direction: null,
        limit: 10,
      },
    ), BusinessError);
});

Deno.test("full five-bucket aging partition permits a reconciled pie", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan({
      report: "aging",
      metrics: ["outstanding_amount"],
      dimensions: ["aging_bucket"],
      filters: [],
      period: { date_from: null, date_to: null, as_of_date: "2026-08-14" },
      sort: null,
      limit: 5,
      chart_type: "pie",
    }),
  );
  assertEquals(
    buildChartSpec({
      ...plan(),
      report: "aging",
      metrics: ["outstanding_amount"],
      dimensions: ["aging_bucket"],
      filters: [],
      period: { date_from: null, date_to: null, as_of_date: "2026-08-14" },
      sort: null,
      limit: 5,
      chart_type: "pie",
    }, report)?.chart_type,
    "pie",
  );
});

Deno.test("partial three-of-five aging partition rejects pie", async () => {
  const piePlan = plan({
    report: "aging",
    metrics: ["outstanding_amount"],
    dimensions: ["aging_bucket"],
    filters: [],
    period: { date_from: null, date_to: null, as_of_date: "2026-08-14" },
    sort: null,
    limit: 3,
    chart_type: "pie",
  });
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    piePlan,
  );
  assertEquals(report.coverage.status, "bounded_incomplete");
  await rejects(() => buildChartSpec(piePlan, report));
});

Deno.test("chart values copy field-for-field and mutation is rejected", async () => {
  const chartPlan = plan({ chart_type: "bar" });
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    chartPlan,
  );
  const chart = buildChartSpec(chartPlan, report)!;
  assertEquals(
    chart.data[0].outstanding_amount,
    report.rows[0].outstanding_amount,
  );
  chart.data[0].outstanding_amount = "0.01";
  await rejects(() => assertChartPreservesReport(chart, report));
});

Deno.test("bar chart truncation is explicitly disclosed", () => {
  const report: AnalystReportResult = {
    report_type: "invoice_summary",
    title: "Invoices",
    description: "Bounded",
    as_of: "2026-08-14",
    base_currency: "MYR",
    columns: [
      { field: "document", label: "Document", format: "text" },
      { field: "outstanding_amount", label: "Outstanding", format: "currency" },
    ],
    rows: Array.from({ length: 25 }, (_, index) => ({
      document: `INV-${index}`,
      outstanding_amount: `${index}.00`,
    })),
    summary: { multi_currency: false },
    coverage: {
      status: "complete",
      source_total: 25,
      returned_rows: 25,
      top_n_complete: null,
      reason: null,
    },
    authority: "authoritative_rows",
  };
  const chart = buildChartSpec(plan({ chart_type: "bar", limit: 25 }), report)!;
  assertEquals(chart.is_truncated, true);
  assertEquals(chart.displayed_points, 20);
  assertEquals(chart.total_available_points, 25);
});

Deno.test("line chart requires an ordered collection series", async () => {
  const report: AnalystReportResult = {
    report_type: "collections",
    title: "Collections",
    description: "Series",
    as_of: "2026-08-14",
    base_currency: "MYR",
    columns: [
      { field: "period", label: "Period", format: "text" },
      { field: "collection_amount", label: "Collections", format: "currency" },
    ],
    rows: [{ period: "2026-08", collection_amount: "100.00" }],
    summary: { ordered_period_series: false },
    coverage: {
      status: "complete",
      source_total: 1,
      returned_rows: 1,
      top_n_complete: null,
      reason: null,
    },
    authority: "authoritative_rows",
  };
  await rejects(() =>
    buildChartSpec(
      plan({
        report: "collections",
        metrics: ["collection_amount"],
        dimensions: ["period"],
        filters: [],
        period: { date_from: null, date_to: null, as_of_date: "2026-08-14" },
        sort: null,
        chart_type: "line",
      }),
      report,
    )
  );
});

for (
  const question of [
    "What is unapplied cash?",
    "什么是未分配收款？",
    "什么叫 unapplied cash？",
    "什么是 Straight-Through？",
    "allocation 是什么意思？",
    "Apa maksud unapplied cash?",
    "Apa itu Straight-Through?",
    "Apa maksud allocation?",
  ]
) {
  Deno.test(`definition remains system knowledge: ${question}`, () => {
    assertEquals(classifyCopilotQuestion(question), "system_knowledge");
    assertEquals(questionRequiresLiveData(question), false);
  });
}

for (
  const question of [
    "现在有多少逾期发票？",
    "目前哪个客户欠最多？",
    "帮我看看今天有什么需要处理",
    "为什么现在 overdue 这么高？",
    "跟上个月相比收款怎样？",
    "今天有哪些 exception 要处理？",
    "目前有多少未分配收款？",
    "Berapa invois tertunggak sekarang?",
    "Pelanggan mana paling banyak outstanding?",
    "Apa yang saya perlu fokus hari ini?",
    "Kenapa overdue sekarang tinggi?",
    "Bandingkan kutipan bulan ini dengan bulan lepas",
    "Berapa unapplied cash sekarang?",
    "Exception mana perlu saya tengok hari ini?",
  ]
) {
  Deno.test(`multilingual live claim requires evidence: ${question}`, () => {
    assertEquals(classifyCopilotQuestion(question), "live_data");
    assert(questionHasLiveClaimSignals(question));
    assert(questionRequiresLiveData(question));
  });
}

for (
  const question of [
    "直接发 reminder 给客户",
    "帮我发送 reminder",
    "帮我直接把这张 invoice post 掉",
    "帮我 allocate 这个 receipt",
    "Hantar reminder sekarang",
    "Tolong hantar reminder",
    "Tolong post invoice ini",
    "Tolong allocate receipt ini",
  ]
) {
  Deno.test(`multilingual action remains read-only intent: ${question}`, () => {
    assertEquals(classifyCopilotQuestion(question), "write_action");
    assert(multilingualIntentSignals(question).write);
  });
}

Deno.test("Malay product wording is detected as Malay despite English financial terms", () => {
  assertEquals(
    detectCopilotLanguage("Pelanggan mana paling banyak outstanding?"),
    "ms",
  );
});

Deno.test("canonical identifiers, currencies, and exact money remain unchanged", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    TEST_BUSINESS_DATE,
  ).runReport(
    auth(),
    plan(),
  );
  assertEquals(report.rows[0].document, "INV-SGD-LARGE");
  assertEquals(report.rows[0].currency, "SGD");
  assertEquals(report.rows[0].outstanding_amount, "7000.00");
});

Deno.test("multilingual system guide aliases resolve canonical knowledge", () => {
  assertEquals(
    searchSystemGuide("什么是未分配收款？")[0]?.id,
    "receipt-lifecycle",
  );
  assertEquals(
    searchSystemGuide("Apa maksud allocation?")[0]?.id,
    "allocation",
  );
});

Deno.test("Migration 046 applies filters before ranking and preserves Edge-bound scope", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../database/046_post_ar_copilot_2_reporting_currency_filter.sql",
      import.meta.url,
    ),
  );
  assert(migration.includes("public.ar_copilot_validate_report_scope"));
  assert(migration.includes("CURRENT_USER <> 'service_role'"));
  assert(migration.includes("i.currency = p_currency::CHAR(3)"));
  assert(migration.includes("i.outstanding >= p_minimum_amount"));
  assert(migration.includes("r.unallocated_amount >= p_minimum_amount"));
  assert(
    migration.indexOf("p_currency IS NULL") <
      migration.indexOf("ROW_NUMBER() OVER"),
  );
  assert(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.ar_copilot_invoice_report_rows",
    ),
  );
  assert(migration.includes("TO service_role"));
  assert(!migration.includes("TO authenticated"));
});

Deno.test("AR Clerk overdue helper independently invokes customer access authority", async () => {
  const source = await Deno.readTextFile(
    new URL("./ar-copilot/analyst-service.ts", import.meta.url),
  );
  const helper = source.slice(
    source.indexOf("async #overdueInvoiceCount"),
    source.indexOf("async getArPriorityAnalysis"),
  );
  assert(helper.includes("await requireCustomerAccess(auth, customerId)"));
  assert(helper.includes('.eq("company_id", auth.companyId)'));
  assert(helper.includes('.eq("customer_id", customerId)'));
});

Deno.test("report remediation adds no write authority", async () => {
  const sources = await Promise.all([
    Deno.readTextFile(
      new URL("./ar-copilot/analyst-report-service.ts", import.meta.url),
    ),
    Deno.readTextFile(
      new URL(
        "../../../database/046_post_ar_copilot_2_reporting_currency_filter.sql",
        import.meta.url,
      ),
    ),
  ]);
  assert(!/\.(?:insert|update|delete|upsert)\s*\(/.test(sources[0]));
  assert(
    !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|public\.|FROM)/.test(
      sources[1],
    ),
  );
});

const EMPTY_CONTEXT = {
  page: "dashboard" as const,
  entity_type: null,
  entity_id: null,
};

for (
  const [question, expected] of [
    ["How do I allocate a receipt?", "system_knowledge"],
    ["What does post mean?", "system_knowledge"],
    ["Can you explain allocate for me?", "system_knowledge"],
    ["What happens when an invoice is posted?", "system_knowledge"],
    ["Which receipts can I allocate?", "live_data"],
    ["Show me the post-dated receipts.", "live_data"],
    ["Which invoices are open right now?", "live_data"],
    ["Allocate this receipt.", "write_action"],
    ["Please post this invoice.", "write_action"],
    ["Reverse this allocation.", "write_action"],
    ["Send the reminder now.", "write_action"],
    ["allocation 是什么意思？", "system_knowledge"],
    ["怎么进行 receipt allocation？", "system_knowledge"],
    ["帮我 allocate 这个 receipt", "write_action"],
    ["直接发 reminder 给客户", "write_action"],
    ["Apa maksud allocation?", "system_knowledge"],
    ["Macam mana nak allocate receipt?", "system_knowledge"],
    ["Tolong allocate receipt ini", "write_action"],
    ["Hantar reminder sekarang", "write_action"],
  ] as const
) {
  Deno.test(`B5 R1 classifier: ${question}`, () => {
    assertEquals(classifyCopilotQuestion(question), expected);
  });
}

for (
  const question of [
    "Anything urgent in AR today?",
    "Who should I chase first?",
    "Is outstanding getting high lately?",
    "What needs attention this morning?",
    "今天 AR 情况怎样？",
    "哪个客户现在最需要关注？",
    "最近 outstanding 多吗？",
    "今天有什么值得我留意？",
    "Macam mana keadaan AR hari ini?",
    "Customer mana patut saya tengok dulu?",
    "Outstanding sekarang banyak tak?",
    "Ada apa-apa yang perlu saya tengok hari ini?",
  ]
) {
  Deno.test(`B5 R2 live paraphrase requires company evidence: ${question}`, () => {
    assert(
      questionLiveEvidenceRequirements(question, EMPTY_CONTEXT).some(
        (requirement) => requirement.scope === "company",
      ),
    );
  });
}

for (
  const question of [
    "What is overdue?",
    "What is unapplied cash?",
    "什么是逾期发票？",
    "什么是未分配收款？",
    "Apa maksud overdue?",
    "Apa maksud unapplied cash?",
    "Hi",
    "How are you today?",
    "Thanks",
    "Can you explain that more simply?",
    "Send the reminder now.",
    "Hantar reminder sekarang",
  ]
) {
  Deno.test(`B5 R2 conceptual/casual question needs no live evidence: ${question}`, () => {
    assertEquals(
      questionLiveEvidenceRequirements(question, EMPTY_CONTEXT),
      [],
    );
  });
}

for (
  const answer of [
    "Outstanding stands at MYR 999.00.",
    "Overdue exposure is MYR 500.00.",
    "Seven invoices remain unpaid.",
    "Collections reached MYR 10,000 this month.",
    "Total AR sits at MYR 1,250,000.",
    "Unapplied cash amounts to SGD 42,000.",
    "There are several accounts needing attention.",
    "The receivables balance totals USD 75,400.",
    "Many customers require urgent attention.",
    "Outstanding totals 999.00.",
    "No receipts remain unapplied.",
    "AR totals one million in the current portfolio.",
  ]
) {
  Deno.test(`B5 R2-A claim-shaped answer is denied without evidence: ${answer}`, () => {
    const result = verifyFinalAnswerLiveEvidence({
      question: "Give me an AR snapshot.",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    assert(result.requirements.some((item) => item.scope === "company"));
  });
}

for (
  const [question, answer] of [
    [
      "What is outstanding balance?",
      "Outstanding balance is the unpaid amount remaining on a posted document.",
    ],
    [
      "What is overdue exposure?",
      "Overdue exposure describes receivables that remain unpaid after their due dates.",
    ],
    [
      "What is unapplied cash?",
      "Unapplied cash is a posted Receipt amount not yet matched to an Invoice.",
    ],
    [
      "What does collection mean in AR?",
      "Collection in AR is the process of receiving and applying customer payments.",
    ],
  ]
) {
  Deno.test(`B5 R2-A conceptual definition remains allowed: ${question}`, () => {
    const result = verifyFinalAnswerLiveEvidence({
      question,
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, true);
    assertEquals(result.requirements, []);
  });
}

const INVOICE_A = "50000000-0000-4000-8000-000000000005";
const INVOICE_B = "50000000-0000-4000-8000-000000000006";
const RECEIPT_A = "60000000-0000-4000-8000-000000000006";
const INVOICE_CONTEXT = {
  page: "invoice_detail" as const,
  entity_type: "invoice" as const,
  entity_id: INVOICE_A,
};
const INVOICE_A_GRANT = {
  scope: "entity" as const,
  entity_type: "invoice" as const,
  entity_id: INVOICE_A,
};

Deno.test("B5 R2-B mixed entity and company answer requires both grants", () => {
  const candidate =
    "This invoice still has an outstanding balance. Your company currently has 7 overdue invoices.";
  const entityOnly = verifyFinalAnswerLiveEvidence({
    question: "Why is this invoice still open?",
    answer: candidate,
    context: INVOICE_CONTEXT,
    grants: [INVOICE_A_GRANT],
  });
  assertEquals(entityOnly.allowed, false);
  assert(entityOnly.requirements.some((item) => item.scope === "entity"));
  assert(
    entityOnly.requirements.some((item) =>
      item.scope === "company" && item.claim_category === "overdue"
    ),
  );

  const fullySupported = verifyFinalAnswerLiveEvidence({
    question: "Why is this invoice still open?",
    answer: candidate,
    context: INVOICE_CONTEXT,
    grants: [
      INVOICE_A_GRANT,
      {
        scope: "company",
        claim_category: "overdue",
        fact_kind: "count",
        count_value: 7,
        count_comparator: "exact",
        time_basis: "current",
      },
      {
        scope: "company",
        claim_category: "invoice_summary",
        fact_kind: "count",
        count_value: 7,
        count_comparator: "exact",
        time_basis: "current",
      },
    ],
  });
  assertEquals(fullySupported.allowed, true);
});

Deno.test("B5 R2-B matching entity evidence permits an entity-only answer", () => {
  const result = verifyFinalAnswerLiveEvidence({
    question: "Why is this invoice still open?",
    answer: "This invoice still has an outstanding balance.",
    context: INVOICE_CONTEXT,
    grants: [INVOICE_A_GRANT],
  });
  assertEquals(result.allowed, true);
});

Deno.test("B5 R2-C entity evidence is exact and null identity fails closed", () => {
  const invoiceB = {
    scope: "entity" as const,
    entity_type: "invoice" as const,
    entity_id: INVOICE_B,
  };
  const receiptA = {
    scope: "entity" as const,
    entity_type: "receipt" as const,
    entity_id: RECEIPT_A,
  };
  const candidate = "This invoice still has an outstanding balance.";
  assertEquals(
    verifyFinalAnswerLiveEvidence({
      question: "Why is this invoice still open?",
      answer: candidate,
      context: INVOICE_CONTEXT,
      grants: [invoiceB],
    }).allowed,
    false,
  );
  assertEquals(
    verifyFinalAnswerLiveEvidence({
      question: "Why is this invoice still open?",
      answer: candidate,
      context: INVOICE_CONTEXT,
      grants: [INVOICE_A_GRANT],
    }).allowed,
    true,
  );
  assertEquals(
    verifyFinalAnswerLiveEvidence({
      question: "Why is this invoice still open?",
      answer: candidate,
      context: EMPTY_CONTEXT,
      grants: [invoiceB],
    }).allowed,
    false,
  );
  assertEquals(
    verifyFinalAnswerLiveEvidence({
      question: "Why is this invoice still open?",
      answer: candidate,
      context: INVOICE_CONTEXT,
      grants: [receiptA],
    }).allowed,
    false,
  );
});

Deno.test("B5 R2-D workflow exception evidence grants no overdue authority", () => {
  const outcome = {
    data: [{
      id: "70000000-0000-4000-8000-000000000007",
      reason_code: "provider_unavailable",
    }],
    evidence: [{
      kind: "automation_exception" as const,
      id: "70000000-0000-4000-8000-000000000007",
      label: "Automation exception",
      number: null,
    }],
    links: [],
  };
  const grants = liveEvidenceGrantsFromOutcome(
    "list_open_automation_exceptions",
    outcome,
  );
  assertEquals(
    verifyFinalAnswerLiveEvidence({
      question: "Which exceptions are open now?",
      answer: "Your company currently has MYR 500,000 overdue.",
      context: EMPTY_CONTEXT,
      grants,
    }).allowed,
    false,
  );
  const supported = verifyFinalAnswerLiveEvidence({
    question: "Which exceptions are open now?",
    answer: "There is at least one open automation exception.",
    context: EMPTY_CONTEXT,
    grants,
  });
  assertEquals(supported.allowed, true);
});

Deno.test("B5 R2-D unapplied evidence cannot authorize collection totals", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "get_unapplied_cash_analysis",
    {
      data: { analysis_type: "unapplied_cash", priority_items: [] },
      evidence: [],
      links: [],
    },
  );
  assertEquals(
    verifyFinalAnswerLiveEvidence({
      question: "How much unapplied cash is there now?",
      answer: "Collections reached MYR 10,000 this month.",
      context: EMPTY_CONTEXT,
      grants,
    }).allowed,
    false,
  );
  assertEquals(
    verifyFinalAnswerLiveEvidence({
      question: "How much unapplied cash is there now?",
      answer: "Unapplied cash amounts to MYR 0.00.",
      context: EMPTY_CONTEXT,
      grants,
    }).allowed,
    false,
  );
});

Deno.test("B5 R2-D relevant overdue evidence authorizes an overdue claim", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "list_overdue_invoices",
    { data: [], evidence: [], links: [] },
  );
  assertEquals(
    verifyFinalAnswerLiveEvidence({
      question: "How many overdue invoices are there right now?",
      answer: "Zero invoices are overdue.",
      context: EMPTY_CONTEXT,
      grants,
    }).allowed,
    false,
  );
});

const FACT_SUMMARY_OUTCOME = {
  data: {
    as_of_date: "2026-08-15",
    base_currency: "MYR",
    total_outstanding_base: "500.00",
    total_overdue_base: "125.00",
  },
  evidence: [],
  links: [],
};

function factAllowed(
  question: string,
  answer: string,
  grants = liveEvidenceGrantsFromOutcome(
    "get_ar_summary",
    FACT_SUMMARY_OUTCOME,
  ),
): boolean {
  return verifyFinalAnswerLiveEvidence({
    question,
    answer,
    context: EMPTY_CONTEXT,
    grants,
  }).allowed;
}

Deno.test("R2 fact money matches exact canonical value and currency", () => {
  assertEquals(
    factAllowed(
      "How much is overdue now?",
      "Your company currently has MYR 125.00 overdue.",
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "How much is overdue now?",
      "Your company currently has MYR 125 overdue.",
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "How much is overdue now?",
      "Your company currently has MYR 125.000 overdue.",
    ),
    true,
  );
  for (
    const answer of [
      "Your company currently has MYR 500,000 overdue.",
      "Your company currently has SGD 125.00 overdue.",
      "Your company currently has MYR 124.99 overdue.",
    ]
  ) assertEquals(factAllowed("How much is overdue now?", answer), false);
});

function overdueListOutcome(
  count: number,
  coverage: {
    status: "complete" | "bounded_incomplete";
    source_total: number | null;
    returned_rows: number;
    top_n_complete: boolean | null;
  } | null,
) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `invoice-${index + 1}`,
    invoice_no: `INV-${index + 1}`,
  }));
  return {
    data: coverage
      ? { rows, total_count: coverage.source_total, coverage }
      : rows,
    evidence: [],
    links: [],
  };
}

Deno.test("R2 bounded list proves minimum existence but not an exact total", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "list_overdue_invoices",
    overdueListOutcome(1, null),
  );
  assertEquals(
    factAllowed(
      "Show overdue invoices.",
      "There is at least one overdue invoice.",
      grants,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "Show overdue invoices.",
      "There is exactly 1 overdue invoice.",
      grants,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "How many overdue invoices are there?",
      "There are 7 overdue invoices.",
      grants,
    ),
    false,
  );
});

Deno.test("R2 complete authoritative total binds the exact count", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "list_overdue_invoices",
    overdueListOutcome(7, {
      status: "complete",
      source_total: 7,
      returned_rows: 7,
      top_n_complete: null,
    }),
  );
  assertEquals(
    factAllowed(
      "How many overdue invoices are there?",
      "There are 7 overdue invoices.",
      grants,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "How many overdue invoices are there?",
      "There are 8 overdue invoices.",
      grants,
    ),
    false,
  );
});

function customerReportOutcome(
  coverage: {
    status: "complete" | "bounded_incomplete";
    source_total: number | null;
    returned_rows: number;
    top_n_complete: boolean | null;
  },
  rows: Array<{ customer: string; outstanding_amount: string }>,
  summary: Record<string, string | number | boolean | null> = {
    row_count: rows.length,
  },
  asOf = "2026-08-15",
) {
  return {
    data: {
      report: {
        report_type: "customer_outstanding",
        title: "Customer Outstanding",
        description: "Authorized rows",
        as_of: asOf,
        base_currency: "MYR",
        columns: [
          { field: "customer", label: "Customer", format: "text" },
          {
            field: "outstanding_amount",
            label: "Outstanding",
            format: "currency",
          },
        ],
        rows,
        summary,
        coverage: { ...coverage, reason: null },
        authority: "authoritative_rows",
      },
      chart: null,
    },
    evidence: [],
    links: [],
  };
}

Deno.test("R2 report columns grant only actual deterministic money values", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 1,
        returned_rows: 1,
        top_n_complete: null,
      },
      [{ customer: "ABC", outstanding_amount: "10000.00" }],
    ),
  );
  assertEquals(
    factAllowed(
      "Show the customer outstanding report.",
      "ABC outstanding is MYR 10,000.00.",
      grants,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "Show the customer outstanding report.",
      "Outstanding is MYR 999,999.",
      grants,
    ),
    false,
  );
});

Deno.test("R2 bounded coverage denies complete-set and global-rank claims", () => {
  const boundedReport = customerReportOutcome(
    {
      status: "bounded_incomplete",
      source_total: null,
      returned_rows: 1,
      top_n_complete: null,
    },
    [{ customer: "ABC", outstanding_amount: "10000.00" }],
  );
  const reportGrants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    boundedReport,
  );
  const boundedListGrants = liveEvidenceGrantsFromOutcome(
    "list_overdue_invoices",
    overdueListOutcome(1, {
      status: "bounded_incomplete",
      source_total: null,
      returned_rows: 1,
      top_n_complete: null,
    }),
  );
  for (
    const answer of [
      "These are all overdue invoices.",
      "This is the complete overdue invoice list.",
    ]
  ) {
    assertEquals(
      factAllowed("Show overdue invoices.", answer, boundedListGrants),
      false,
    );
  }
  assertEquals(
    factAllowed(
      "Show customer outstanding.",
      "ABC is the highest outstanding customer in the company.",
      reportGrants,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "Show customer outstanding.",
      "These are the top 5 customers in the company.",
      reportGrants,
    ),
    false,
  );
});

Deno.test("R2 complete and proven top-N coverage grants only its proven scope", () => {
  const completeList = liveEvidenceGrantsFromOutcome(
    "list_overdue_invoices",
    overdueListOutcome(2, {
      status: "complete",
      source_total: 2,
      returned_rows: 2,
      top_n_complete: null,
    }),
  );
  assertEquals(
    factAllowed(
      "Show overdue invoices.",
      "These are all overdue invoices.",
      completeList,
    ),
    true,
  );
  const topTwo = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "bounded_incomplete",
        source_total: 10,
        returned_rows: 2,
        top_n_complete: true,
      },
      [
        { customer: "ABC", outstanding_amount: "10000.00" },
        { customer: "DEF", outstanding_amount: "9000.00" },
      ],
    ),
  );
  assertEquals(
    factAllowed(
      "Show customer outstanding.",
      "These are the top 2 customers in the company.",
      topTwo,
    ),
    true,
  );
});

Deno.test("R2 insufficient historical evidence grants current value but no trend", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "get_exposure_movement_analysis",
    {
      data: {
        analysis_type: "exposure_movement",
        base_currency: "MYR",
        status: "insufficient_evidence",
        priority_items: [],
        factors: [{
          factor_code: "CURRENT_OVERDUE_EXPOSURE_AVAILABLE",
          metric: "overdue_amount",
          current_value: "125.00",
          comparison_value: null,
          absolute_change: null,
        }],
      },
      evidence: [],
      links: [],
    },
  );
  assertEquals(
    factAllowed(
      "Show current overdue.",
      "Company current overdue is MYR 125.00.",
      grants,
    ),
    true,
  );
  for (
    const answer of [
      "Overdue increased by MYR 50,000 last month.",
      "Overdue decreased last month.",
      "Aging deteriorated compared with last month.",
    ]
  ) {
    assertEquals(
      factAllowed("Compare overdue with last month.", answer, grants),
      false,
    );
  }
});

Deno.test("R2 empty analyses grant no positive money count or existence fact", () => {
  const emptyUnapplied = liveEvidenceGrantsFromOutcome(
    "get_unapplied_cash_analysis",
    {
      data: {
        analysis_type: "unapplied_cash",
        status: "complete",
        priority_items: [],
        factors: [],
      },
      evidence: [],
      links: [],
    },
  );
  assertEquals(
    factAllowed(
      "What is unapplied cash?",
      "Unapplied cash is MYR 42,000.",
      emptyUnapplied,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "What is unapplied cash?",
      "There is unapplied cash requiring attention.",
      emptyUnapplied,
    ),
    false,
  );
  const emptyPriority = liveEvidenceGrantsFromOutcome(
    "get_ar_priority_analysis",
    {
      data: { status: "complete", priority_items: [], factors: [] },
      evidence: [],
      links: [],
    },
  );
  assertEquals(
    factAllowed(
      "Give me an AR snapshot.",
      "Several customers require urgent attention.",
      emptyPriority,
    ),
    false,
  );
});

Deno.test("R2 non-empty priority evidence supports bounded positive existence", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "get_ar_priority_analysis",
    {
      data: {
        status: "complete",
        priority_items: [{
          category: "customer_exposure",
          entity_type: "customer",
          entity_id: CUSTOMER,
          facts: {},
        }],
        factors: [],
      },
      evidence: [],
      links: [],
    },
  );
  assertEquals(
    factAllowed(
      "Show customers needing attention.",
      "There is at least one customer requiring attention.",
      grants,
    ),
    true,
  );
});

for (
  const answer of [
    "\u903e\u671f\u53d1\u7968\u6709\u4e03\u5f20\u3002",
    "\u672a\u5206\u914d\u6536\u6b3e\u603b\u989d\u662f MYR 42,000\u3002",
    "\u5e94\u6536\u4f59\u989d\u4e3a MYR 999,000\u3002",
    "\u6709\u51e0\u4e2a\u5ba2\u6237\u9700\u8981\u4f18\u5148\u8ddf\u8fdb\u3002",
    "Tujuh invois masih tertunggak.",
    "Baki tertunggak berjumlah MYR 500,000.",
    "Tunai belum diagih berjumlah SGD 42,000.",
    "Beberapa pelanggan perlu diberi perhatian.",
  ]
) {
  Deno.test(`R2 multilingual financial quantity is denied without evidence: ${answer}`, () => {
    assertEquals(factAllowed("What is unapplied cash?", answer, []), false);
  });
}

Deno.test("R2 multilingual quantity guard preserves conceptual definitions", () => {
  for (
    const [question, answer] of [
      [
        "What is unapplied cash?",
        "Unapplied cash is a posted receipt balance not yet allocated.",
      ],
      [
        "\u4ec0\u4e48\u662f\u672a\u5206\u914d\u6536\u6b3e\uff1f",
        "\u672a\u5206\u914d\u6536\u6b3e\u662f\u5df2\u8fc7\u8d26\u4f46\u5c1a\u672a\u5339\u914d\u53d1\u7968\u7684\u6536\u6b3e\u3002",
      ],
      [
        "Apa maksud unapplied cash?",
        "Unapplied cash ialah resit yang telah dipos tetapi belum dipadankan.",
      ],
    ]
  ) assertEquals(factAllowed(question, answer, []), true);
});

Deno.test("R2 mixed financial facts require every exact value", () => {
  const collectionGrants = liveEvidenceGrantsFromOutcome(
    "get_collection_health_analysis",
    {
      data: {
        analysis_type: "collection_health",
        base_currency: "MYR",
        status: "complete",
        priority_items: [],
        factors: [{
          factor_code: "COLLECTIONS_INCREASED",
          metric: "collection_amount",
          current_value: "50.00",
          comparison_value: "25.00",
          absolute_change: "25.00",
        }],
      },
      evidence: [],
      links: [],
    },
  );
  const grants = [
    ...liveEvidenceGrantsFromOutcome("get_ar_summary", FACT_SUMMARY_OUTCOME),
    ...collectionGrants,
  ];
  assertEquals(
    factAllowed(
      "Give me an AR snapshot.",
      "Company overdue is MYR 125.00 and company collections are MYR 999.00.",
      grants,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "Give me an AR snapshot.",
      "Company overdue is MYR 125.00 and company collections are MYR 50.00.",
      grants,
    ),
    true,
  );
});

Deno.test("B5 cleanup rejects unsupported operational report currency", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      report: "invoice_summary",
      metrics: ["outstanding_amount"],
      dimensions: ["document"],
      filters: [{ field: "currency", operator: "eq", value: "JPY" }],
      period: { date_from: null, date_to: null, as_of_date: null },
      sort: null,
      limit: 10,
      chart_type: null,
    })
  );
});

Deno.test("R2 qualitative company financial assertions fail closed without evidence", () => {
  for (
    const answer of [
      "Aging deteriorated compared with last month.",
      "Overdue worsened compared with last month.",
      "Collections performance is weak this month.",
      "The aging profile has shifted towards the older buckets.",
      "Overdue exposure is concentrated in a few customers.",
      "\u8d26\u9f84\u6bd4\u4e0a\u4e2a\u6708\u6076\u5316\u4e86\u3002",
      "Penuaan bertambah buruk berbanding bulan lepas.",
    ]
  ) assertEquals(factAllowed("Explain the AR position.", answer, []), false);
  assertEquals(
    factAllowed(
      "What is aging?",
      "Aging is a way to group outstanding invoices by how long they have been due.",
      [],
    ),
    true,
  );
});

function temporalMoneyGrant(
  time_basis: "current" | "previous" | "unspecified",
): CompanyEvidenceGrant[] {
  return [{
    scope: "company",
    claim_category: "overdue",
    fact_kind: "money",
    currency: "MYR",
    money_value: "125.00",
    time_basis,
    aggregation_scope: "company_total",
  }];
}

Deno.test("R2 exact money requires strict compatible temporal authority", () => {
  const current = temporalMoneyGrant("current");
  assertEquals(
    factAllowed(
      "Show overdue.",
      "Company current overdue is MYR 125.",
      current,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "Show overdue.",
      "Company last month overdue was MYR 125.",
      current,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "Show overdue.",
      "\u4e0a\u4e2a\u6708\u903e\u671f\u91d1\u989d\u662f MYR 125\u3002",
      current,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "Show overdue.",
      "Bulan lepas baki tertunggak ialah MYR 125.",
      current,
    ),
    false,
  );

  const previous = temporalMoneyGrant("previous");
  assertEquals(
    factAllowed(
      "Show overdue.",
      "Company last month overdue was MYR 125.",
      previous,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "Show overdue.",
      "Company current overdue is MYR 125.",
      previous,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "Show overdue.",
      "\u76ee\u524d\u903e\u671f\u91d1\u989d\u662f MYR 125\u3002",
      previous,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "Show overdue.",
      "Baki tertunggak sekarang ialah MYR 125.",
      previous,
    ),
    false,
  );

  const unspecified = temporalMoneyGrant("unspecified");
  assertEquals(
    factAllowed(
      "Show overdue.",
      "Company current overdue is MYR 125.",
      unspecified,
    ),
    false,
  );
  assertEquals(
    factAllowed(
      "Show overdue.",
      "Company last month overdue was MYR 125.",
      unspecified,
    ),
    false,
  );
});

Deno.test("R2 collection trend authority is bound to its comparison window", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "get_collection_health_analysis",
    {
      data: {
        analysis_type: "collection_health",
        as_of: "2026-08-15",
        base_currency: "MYR",
        status: "complete",
        priority_items: [],
        factors: [{
          factor_code: "COLLECTIONS_INCREASED",
          metric: "collection_amount",
          current_value: "150.00",
          comparison_value: "100.00",
          absolute_change: "50.00",
          period_key: "2026-08",
          comparison_period_key: "2026-07",
        }],
      },
      evidence: [],
      links: [],
    },
  );
  const question =
    "How did collections change this month compared with last month?";
  assertEquals(
    factAllowed(
      question,
      "Collections increased this month compared with last month.",
      grants,
    ),
    true,
  );
  for (
    const answer of [
      "Collections increased last month.",
      "Collections increased today.",
      "Collections increased in June.",
      "Kutipan meningkat bulan lepas.",
    ]
  ) assertEquals(factAllowed(question, answer, grants), false);
});

Deno.test("R2 global rank authority binds direction and named subject order", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 2,
        returned_rows: 2,
        top_n_complete: null,
      },
      [
        { customer: "ABC", outstanding_amount: "20000.00" },
        { customer: "XYZ", outstanding_amount: "10000.00" },
      ],
    ),
  );
  for (
    const answer of [
      "ABC is the highest outstanding customer.",
      "The highest outstanding customer is ABC.",
      "ABC has the highest outstanding balance.",
      "\u6700\u9ad8\u5e94\u6536\u4f59\u989d\u7684\u5ba2\u6237\u662f ABC\u3002",
    ]
  ) {
    assertEquals(
      factAllowed("Rank customer outstanding.", answer, grants),
      true,
    );
  }
  for (
    const answer of [
      "XYZ is the highest outstanding customer.",
      "The highest outstanding customer is XYZ.",
      "Your highest outstanding customer is XYZ.",
      "The lowest outstanding customer is ABC.",
      "\u6700\u9ad8\u5e94\u6536\u4f59\u989d\u7684\u5ba2\u6237\u662f XYZ\u3002",
      "Pelanggan dengan baki outstanding paling tinggi ialah XYZ.",
    ]
  ) {
    assertEquals(
      factAllowed("Rank customer outstanding.", answer, grants),
      false,
    );
  }
});

Deno.test("R2 report money distinguishes row facts from company aggregates", () => {
  const rows = [
    { customer: "ABC", outstanding_amount: "10000.00" },
    { customer: "XYZ", outstanding_amount: "20000.00" },
  ];
  const coverage = {
    status: "complete" as const,
    source_total: 2,
    returned_rows: 2,
    top_n_complete: null,
  };
  const rowOnly = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(coverage, rows),
  );
  assertEquals(
    factAllowed("Show outstanding.", "ABC outstanding is MYR 10,000.", rowOnly),
    true,
  );
  assertEquals(
    factAllowed("Show outstanding.", "XYZ outstanding is MYR 20,000.", rowOnly),
    true,
  );
  assertEquals(
    factAllowed("Show outstanding.", "ABC outstanding is MYR 20,000.", rowOnly),
    false,
  );
  for (
    const answer of [
      "Company outstanding is MYR 10,000.",
      "Company outstanding is MYR 20,000.",
      "Total outstanding is MYR 20,000.",
      "Across the company outstanding is MYR 20,000.",
      "\u516c\u53f8\u5e94\u6536\u4f59\u989d\u603b\u989d\u662f MYR 20,000\u3002",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, rowOnly), false);

  const withAggregate = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(coverage, rows, {
      row_count: 2,
      report_total: "30000.00",
    }),
  );
  assertEquals(
    factAllowed(
      "Show outstanding.",
      "Company total outstanding is MYR 30,000.",
      withAggregate,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "Show outstanding.",
      "Company total outstanding is MYR 20,000.",
      withAggregate,
    ),
    false,
  );
});

Deno.test("R2 report current authority follows the MY business date across UTC midnight", () => {
  const clock = new Date("2026-08-15T16:30:00Z");
  const businessDate = dateInTimeZone(clock, "Asia/Kuala_Lumpur");
  assertEquals(businessDate, "2026-08-16");

  const current = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 1,
        returned_rows: 1,
        top_n_complete: null,
      },
      [{ customer: "ABC", outstanding_amount: "125.00" }],
      { row_count: 1, report_total: "125.00" },
      "2026-08-16",
    ),
    { businessDate },
  );
  assertEquals(
    factAllowed(
      "Show current outstanding.",
      "Company total outstanding is currently MYR 125.00.",
      current,
    ),
    true,
  );

  const priorUtcDate = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 1,
        returned_rows: 1,
        top_n_complete: null,
      },
      [{ customer: "ABC", outstanding_amount: "125.00" }],
      { row_count: 1, report_total: "125.00" },
      "2026-08-15",
    ),
    { businessDate },
  );
  assertEquals(
    factAllowed(
      "Show current outstanding.",
      "Company total outstanding is currently MYR 125.00.",
      priorUtcDate,
    ),
    false,
  );
});

Deno.test("R2 shared business date is deterministic at MY and SG midnight boundaries", () => {
  for (const timeZone of ["Asia/Kuala_Lumpur", "Asia/Singapore"]) {
    assertEquals(
      dateInTimeZone(new Date("2026-08-15T15:59:59Z"), timeZone),
      "2026-08-15",
    );
    assertEquals(
      dateInTimeZone(new Date("2026-08-15T16:00:00Z"), timeZone),
      "2026-08-16",
    );
    assertEquals(
      dateInTimeZone(new Date("2026-08-15T16:30:00Z"), timeZone),
      "2026-08-16",
    );
  }
});

Deno.test("runReport default as_of uses its trusted business date", async () => {
  const report = await new AnalystReportService(
    new FakeSources(),
    "2026-08-16",
  ).runReport(
    auth(),
    plan({
      period: { date_from: null, date_to: null, as_of_date: null },
    }),
  );
  assertEquals(report.as_of, "2026-08-16");
});

Deno.test("R2 complex legal row names stay row-bound and never escalate to company total", () => {
  const coverage = {
    status: "complete" as const,
    source_total: 2,
    returned_rows: 2,
    top_n_complete: null,
  };
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      coverage,
      [
        {
          customer: "ABC Trading (M) Sdn Bhd",
          outstanding_amount: "20000.00",
        },
        { customer: "Lim & Sons, Bhd.", outstanding_amount: "10000.00" },
      ],
      { row_count: 2, report_total: "30000.00" },
    ),
  );

  for (
    const answer of [
      "ABC Trading (M) Sdn Bhd outstanding is MYR 20,000.",
      "Lim & Sons, Bhd. outstanding is MYR 10,000.",
      "Company total outstanding is MYR 30,000.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), true);

  for (
    const answer of [
      "ABC Trading (M) Sdn Bhd outstanding is MYR 30,000.",
      "ABC Trading (M) Sdn Bhd has MYR 30,000 outstanding.",
      "Lim & Sons, Bhd. outstanding is MYR 30,000.",
      "Company total outstanding is MYR 20,000.",
      "Unresolved @ Customer outstanding is MYR 30,000.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), false);
});

Deno.test("R2 hyphenated customer row remains bound to its exact value", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 1,
        returned_rows: 1,
        top_n_complete: null,
      },
      [{ customer: "Customer-01", outstanding_amount: "5000.00" }],
    ),
  );
  assertEquals(
    factAllowed(
      "Show outstanding.",
      "Customer-01 outstanding is MYR 5,000.",
      grants,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "Show outstanding.",
      "Customer-01 outstanding is MYR 6,000.",
      grants,
    ),
    false,
  );
});

function overdueExistenceGrants(
  time_basis: "current" | "previous",
): CompanyEvidenceGrant[] {
  return ["overdue", "invoice_summary"].map((claim_category) => ({
    scope: "company" as const,
    claim_category: claim_category as CompanyEvidenceGrant["claim_category"],
    fact_kind: "existence" as const,
    state_value: "present" as const,
    time_basis,
  }));
}

Deno.test("R2 historical existence assertions fail closed without evidence in EN ZH MS", () => {
  for (
    const answer of [
      "There were overdue invoices last month.",
      "There was unapplied cash last month.",
      "There had been overdue invoices in July.",
      "Overdue invoices existed last month.",
      "\u4e0a\u4e2a\u6708\u6709\u903e\u671f\u53d1\u7968\u3002",
      "\u4e0a\u4e2a\u6708\u8fd8\u6709\u672a\u5206\u914d\u6536\u6b3e\u3002",
      "Bulan lepas terdapat invois tertunggak.",
      "Bulan lepas ada penerimaan belum diagih.",
    ]
  ) assertEquals(factAllowed("Explain the AR position.", answer, []), false);
});

Deno.test("R2 existence grants preserve current and previous temporal isolation", () => {
  const current = overdueExistenceGrants("current");
  assertEquals(
    factAllowed(
      "Show overdue invoices.",
      "There are overdue invoices currently.",
      current,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "Show overdue invoices.",
      "There were overdue invoices last month.",
      current,
    ),
    false,
  );

  const previous = overdueExistenceGrants("previous");
  assertEquals(
    factAllowed(
      "Show overdue invoices.",
      "There were overdue invoices last month.",
      previous,
    ),
    true,
  );
  assertEquals(
    factAllowed(
      "Show overdue invoices.",
      "There are overdue invoices currently.",
      previous,
    ),
    false,
  );
});

Deno.test("R2 AR-prefixed legal name remains an exact row and never becomes company total", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 2,
        returned_rows: 2,
        top_n_complete: null,
      },
      [
        { customer: "AR Trading Sdn Bhd", outstanding_amount: "20000.00" },
        { customer: "Zenith Bhd", outstanding_amount: "10000.00" },
      ],
      { row_count: 2, report_total: "30000.00" },
    ),
  );

  for (
    const answer of [
      "AR Trading Sdn Bhd outstanding is MYR 20,000.",
      "Zenith Bhd outstanding is MYR 10,000.",
      "Company total outstanding is MYR 30,000.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), true);

  for (
    const answer of [
      "AR Trading Sdn Bhd outstanding is MYR 30,000.",
      "AR Trading Sdn Bhd has MYR 30,000 outstanding.",
      "Zenith Bhd outstanding is MYR 30,000.",
      "Company total outstanding is MYR 20,000.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), false);
});

Deno.test("R2 AR-vocabulary and control legal names bind only their exact row values", () => {
  const names = [
    "AR Trading Sdn Bhd",
    "AR Engineering Sdn Bhd",
    "Balance Point Sdn Bhd",
    "Outstanding Ventures Bhd",
    "Collections Management Sdn Bhd",
    "Overdue Holdings Sdn Bhd",
    "Zenith Bhd",
    "Arif Trading Sdn Bhd",
    "Aramco Malaysia Sdn Bhd",
    "Customer-01",
    "ABC Trading (M) Sdn Bhd",
    "Lim & Sons, Bhd.",
    "The Company Trading Sdn Bhd",
    "Total AR Solutions Sdn Bhd",
    "Company Finance Sdn Bhd",
  ];
  const rows = names.map((customer, index) => ({
    customer,
    outstanding_amount: `${index + 1}000.00`,
  }));
  const companyTotal = "120000.00";
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: rows.length,
        returned_rows: rows.length,
        top_n_complete: null,
      },
      rows,
      { row_count: rows.length, report_total: companyTotal },
    ),
  );

  for (const [index, name] of names.entries()) {
    const exact = ((index + 1) * 1000).toLocaleString("en-US");
    assert(
      factAllowed(
        "Show outstanding.",
        `${name} outstanding is MYR ${exact}.`,
        grants,
      ) === true,
      `Expected exact row authority for ${name}`,
    );
    assert(
      factAllowed(
        "Show outstanding.",
        `${name} outstanding is MYR 120,000.`,
        grants,
      ) === false,
      `Company total must not become row authority for ${name}`,
    );
    assert(
      factAllowed(
        "Show outstanding.",
        `${name} outstanding is MYR 79,000.`,
        grants,
      ) === false,
      `Wrong row value must be denied for ${name}`,
    );
  }
});

Deno.test("R2 company totals require positive aggregate syntax and ambiguous subjects fail closed", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 2,
        returned_rows: 2,
        top_n_complete: null,
      },
      [
        { customer: "AR Trading Sdn Bhd", outstanding_amount: "20000.00" },
        { customer: "Zenith Bhd", outstanding_amount: "10000.00" },
      ],
      { row_count: 2, report_total: "30000.00" },
    ),
  );

  for (
    const answer of [
      "Company total outstanding is MYR 30,000.",
      "Your company outstanding is MYR 30,000.",
      "Across the company, outstanding is MYR 30,000.",
      "Total outstanding is MYR 30,000.",
      "\u516c\u53f8\u5e94\u6536\u4f59\u989d\u603b\u989d\u662f MYR 30,000\u3002",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), true);

  for (
    const answer of [
      "Company total outstanding is MYR 20,000.",
      "Your company outstanding is MYR 20,000.",
      "Across the company, outstanding is MYR 20,000.",
      "Total outstanding is MYR 20,000.",
      "\u516c\u53f8\u5e94\u6536\u4f59\u989d\u603b\u989d\u662f MYR 20,000\u3002",
      "Outstanding is MYR 30,000.",
      "Balance is MYR 30,000.",
      "AR is MYR 30,000.",
      "Unknown @ Holdings outstanding is MYR 30,000.",
      "AR Trading And Manufacturing Industries Holdings International Group Sdn Bhd outstanding is MYR 30,000.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), false);
});

Deno.test("R2 money declarations without a predicate metric emit fail-closed requirements", () => {
  const names = [
    "Zenith Bhd",
    "Overdue Holdings Sdn Bhd",
    "Collections Management Sdn Bhd",
    "Balance Point Sdn Bhd",
    "AR Trading Sdn Bhd",
    "Outstanding Ventures Bhd",
    "ABC Trading (M) Sdn Bhd",
    "Lim & Sons, Bhd.",
  ];

  for (const name of names) {
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is outstanding balance?",
      answer: `${name} has MYR 999,999.`,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    const companyRequirements = result.requirements.filter((item) =>
      item.scope === "company"
    );
    assert(companyRequirements.length > 0, `${name} emitted no requirement`);
    assertEquals(
      companyRequirements.some((item) =>
        item.claim_category === "unresolved_money" &&
        item.fact_kind === "money" && item.aggregation_scope === "row" &&
        item.row_label === name.toLocaleLowerCase().replace(/[.,;:!?]+$/u, "")
      ),
      true,
    );
  }

  const ordinaryExample = verifyFinalAnswerLiveEvidence({
    question: "What is outstanding balance?",
    answer: "Example: Zenith Bhd has MYR 999,999.",
    context: EMPTY_CONTEXT,
    grants: [],
  });
  assertEquals(ordinaryExample.allowed, false);
  assert(ordinaryExample.requirements.length > 0);

  const trendWording = verifyFinalAnswerLiveEvidence({
    question: "What is outstanding balance?",
    answer: "Zenith Bhd has MYR 999,999 and increased.",
    context: EMPTY_CONTEXT,
    grants: [],
  });
  assertEquals(trendWording.allowed, false);
  assert(trendWording.requirements.length > 0);
});

Deno.test("R2 row money uses only its predicate category and never subject vocabulary", () => {
  const cases = [
    ["Overdue Holdings Sdn Bhd", "20000.00"],
    ["Collections Management Sdn Bhd", "15000.00"],
    ["Zenith Bhd", "10000.00"],
  ] as const;
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: cases.length,
        returned_rows: cases.length,
        top_n_complete: null,
      },
      cases.map(([customer, outstanding_amount]) => ({
        customer,
        outstanding_amount,
      })),
      { row_count: cases.length, report_total: "45000.00" },
    ),
  );

  for (const [name, amount] of cases) {
    const displayAmount = Number(amount).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    const supported = verifyFinalAnswerLiveEvidence({
      question: "Show outstanding.",
      answer: `${name} has MYR ${displayAmount} outstanding.`,
      context: EMPTY_CONTEXT,
      grants,
    });
    assertEquals(supported.allowed, true);
    assertEquals(
      supported.requirements.filter((item) => item.scope === "company").map(
        (item) => item.claim_category,
      ),
      ["outstanding"],
    );

    for (const unsupported of ["45,000", "999,999"]) {
      assertEquals(
        factAllowed(
          "Show outstanding.",
          `${name} has MYR ${unsupported}.`,
          grants,
        ),
        false,
      );
    }
  }

  for (
    const answer of [
      "Company total outstanding is MYR 45,000.",
      "Your company outstanding is MYR 45,000.",
      "Across the company, outstanding is MYR 45,000.",
      "Total outstanding is MYR 45,000.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), true);
  for (
    const answer of [
      "Company total outstanding is MYR 20,000.",
      "Your company outstanding is MYR 20,000.",
      "Across the company, outstanding is MYR 20,000.",
      "Total outstanding is MYR 20,000.",
      "Outstanding is MYR 45,000.",
      "Balance is MYR 45,000.",
      "AR is MYR 45,000.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), false);
});

Deno.test("R2 pure money-formatting examples remain non-factual in EN ZH MS", () => {
  for (
    const answer of [
      "The example value MYR 500.00 is not translated.",
      "Example value MYR 500.00 is not translated.",
      "Sample amount MYR 500.00 is not actual.",
      "Kod contoh INV-202608-00001 dan nilai contoh MYR 500.00 tidak diterjemahkan.",
      "Nilai contoh MYR 500.00 tidak diterjemahkan.",
      "\u793a\u4f8b\u91d1\u989d MYR 500.00 \u4e0d\u7ffb\u8bd1\u3002",
    ]
  ) {
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is an example currency format?",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, true);
    assertEquals(result.requirements, []);
  }
});

Deno.test("R2 formatting vocabulary cannot suppress row or company money authority", () => {
  const attacks = [
    "Example Zenith Bhd has MYR 999,999 not translated.",
    "Contoh Zenith Bhd has MYR 999,999 tidak diterjemahkan.",
    "\u793a\u4f8b Zenith Bhd \u6709 MYR 999,999 \u4e0d\u7ffb\u8bd1\u3002",
    "Example: Zenith Bhd has MYR 999,999, not translated.",
    "For example Zenith Bhd has MYR 999,999 which is not translated.",
    "For example the outstanding for Zenith Bhd is MYR 999,999 which is not translated.",
    "Sample: Zenith Bhd outstanding is MYR 999,999 (not actual).",
    "Example figures where Zenith Bhd has MYR 999,999 are not translated.",
    "\u793a\u4f8b\uff1aZenith Bhd \u7684 outstanding \u662f MYR 999,999\uff0c\u4e0d\u662f\u5b9e\u9645\u503c\u3002",
    "Contoh nilai Zenith Bhd outstanding MYR 999,999 tidak diterjemahkan.",
    "For example, Zenith Bhd has MYR 999,999 outstanding, though the currency code is not translated.",
    "Zenith Bhd has MYR 999,999 and the amount is not translated.",
    "Zenith Bhd has MYR 999,999; the amount is not translated.",
    "Zenith Bhd actually has MYR 999,999, which is not translated.",
    "AR Trading Sdn Bhd has MYR 999,999 and MYR is not translated.",
    "The current balance for Zenith Bhd is MYR 999,999 and is not translated.",
    "Zenith Bhd has MYR 999,999 and this is not actual.",
    'Zenith Bhd outstanding is MYR 999,999, marked "not actual".',
    "The company total outstanding is MYR 999,999 and the label says not actual.",
    "Sample data: the company total outstanding is MYR 999,999 which is not actual.",
    "Contoh: Zenith Bhd mempunyai MYR 999,999 tidak diterjemahkan.",
  ];

  for (const answer of attacks) {
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is outstanding balance?",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    assert(result.requirements.length > 0, `No requirement for: ${answer}`);
  }
});

Deno.test("R2 formatting meta and factual clauses remain independently verified", () => {
  for (
    const answer of [
      "The example value MYR 500.00 is not translated. Zenith Bhd has MYR 999,999.",
      "The example value MYR 500.00 is not translated; Zenith Bhd has MYR 999,999.",
      "The example value MYR 500.00 is not translated, while Zenith Bhd has MYR 999,999.",
    ]
  ) {
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is outstanding balance?",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    assert(result.requirements.length > 0);
  }
});

Deno.test("R2 real grants cannot validate formatting-disguised wrong money", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 1,
        returned_rows: 1,
        top_n_complete: null,
      },
      [{ customer: "Zenith Bhd", outstanding_amount: "10000.00" }],
      { row_count: 1, report_total: "45000.00" },
    ),
  );
  for (
    const answer of [
      "For example the outstanding for Zenith Bhd is MYR 999,999 which is not translated.",
      "Example: Zenith Bhd has MYR 999,999, not translated.",
      "Sample data: the company total outstanding is MYR 999,999 which is not actual.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), false);

  assertEquals(
    factAllowed(
      "Show outstanding.",
      "Company total outstanding is MYR 45,000.",
      grants,
    ),
    true,
  );
});

Deno.test("R2 named money proximity is verb-independent before the amount", () => {
  const attacks = [
    "For example Zenith Bhd owes MYR 999,999 which is not translated.",
    "For example Zenith Bhd carries MYR 999,999 which is not translated.",
    "For example Zenith Bhd is owed MYR 999,999 which is not translated.",
    "For example the amount for Zenith Bhd is MYR 999,999 which is not translated.",
    "For example Zenith Bhd is at MYR 999,999 which is not translated.",
    "For example Zenith Bhd records MYR 999,999 which is not translated.",
    "For example Zenith Bhd shows MYR 999,999 which is not translated.",
    "For example Zenith Bhd reports MYR 999,999 which is not translated.",
    "For example Zenith Bhd reflects MYR 999,999 which is not translated.",
    "For example Zenith Bhd represents MYR 999,999 which is not translated.",
    "For example Zenith Bhd accounts for MYR 999,999 which is not translated.",
    "For example Zenith Bhd sits at MYR 999,999 which is not translated.",
    "For example Zenith Bhd stands at MYR 999,999 which is not translated.",
    "For example Zenith Bhd currently carries MYR 999,999 which is not translated.",
    "For example Zenith Bhd mempunyai baki MYR 999,999 which is not translated.",
  ];

  for (const answer of attacks) {
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is outstanding balance?",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    assert(result.requirements.length > 0, `No requirement for: ${answer}`);
  }
  const futureVerb = verifyFinalAnswerLiveEvidence({
    question: "What is outstanding balance?",
    answer:
      "For example Zenith Bhd reflects MYR 999,999 which is not translated.",
    context: EMPTY_CONTEXT,
    grants: [],
  });
  assertEquals(
    futureVerb.requirements.some((item) =>
      item.scope === "company" &&
      item.claim_category === "unresolved_money"
    ),
    true,
  );
});

Deno.test("R2 money-first and multilingual named associations are not formatting exemptions", () => {
  for (
    const answer of [
      "For example MYR 999,999 belongs to Zenith Bhd which is not translated.",
      "For example MYR 999,999 is associated with Zenith Bhd which is not translated.",
      "For example MYR 999,999 for Zenith Bhd is not translated.",
      "\u793a\u4f8b Zenith Bhd \u6b20 MYR 999,999\uff0c\u4e0d\u7ffb\u8bd1\u3002",
      "Contoh Zenith Bhd berhutang MYR 999,999 tidak diterjemahkan.",
    ]
  ) {
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is outstanding balance?",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    assert(result.requirements.length > 0, `No requirement for: ${answer}`);
  }
});

Deno.test("R2 verb-independent named amounts remain denied with real row and company grants", () => {
  const grants = liveEvidenceGrantsFromOutcome(
    "run_ar_report",
    customerReportOutcome(
      {
        status: "complete",
        source_total: 1,
        returned_rows: 1,
        top_n_complete: null,
      },
      [{ customer: "Zenith Bhd", outstanding_amount: "10000.00" }],
      { row_count: 1, report_total: "45000.00" },
    ),
  );
  for (
    const answer of [
      "For example Zenith Bhd owes MYR 999,999 which is not translated.",
      "For example Zenith Bhd carries MYR 45,000 which is not translated.",
      "For example Zenith Bhd reflects MYR 10,000 which is not translated.",
      "For example MYR 45,000 belongs to Zenith Bhd which is not translated.",
    ]
  ) assertEquals(factAllowed("Show outstanding.", answer, grants), false);

  for (
    const answer of [
      "Zenith Bhd owes MYR 999,999.",
      "Zenith Bhd carries MYR 999,999.",
      "Zenith Bhd is owed MYR 999,999.",
      "MYR 999,999 belongs to Zenith Bhd.",
      "The amount for Zenith Bhd is MYR 999,999.",
      "Zenith Bhd is at MYR 999,999.",
      "Zenith Bhd \u6b20 MYR 999,999.",
      "Zenith Bhd berhutang MYR 999,999.",
    ]
  ) {
    assertEquals(
      factAllowed("What is outstanding balance?", answer, []),
      false,
    );
  }
});

Deno.test("R2 pure-formatting whitelist rejects single-token customer assertions", () => {
  for (
    const answer of [
      "For example Acme owes MYR 999,999 which is not translated.",
      "For example Grab carries MYR 999,999 which is not translated.",
      "For example Shopee reflects MYR 999,999 which is not translated.",
      "For example Petronas reflects MYR 999,999 which is not translated.",
      "For example Zenith owes MYR 999,999 which is not translated.",
      "For example Maybank records MYR 999,999 which is not translated.",
      "For example MYR 999,999 belongs to Shopee which is not translated.",
    ]
  ) {
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is outstanding balance?",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    assert(result.requirements.length > 0, `No requirement for: ${answer}`);
  }
});

Deno.test("R2 pure-formatting whitelist has no entity-money distance boundary", () => {
  for (const distance of [60, 120, 121, 140, 201]) {
    const middle = "owes descriptive financial context ".repeat(10).slice(
      0,
      distance - 2,
    );
    const gap = ` ${middle} `;
    const answer = `For example Acme${gap}MYR 999,999 which is not translated.`;
    assertEquals(
      answer.indexOf("MYR") - answer.indexOf("Acme") - "Acme".length,
      distance,
    );
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is outstanding balance?",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    assert(result.requirements.length > 0, `No requirement at ${distance}`);
  }
});

Deno.test("R2 pure-formatting whitelist rejects factual and multi-money near misses", () => {
  for (
    const answer of [
      "The example value MYR 500.00 is not translated for Zenith Bhd.",
      "The example value for Zenith Bhd is MYR 999,999 and is not translated.",
      "Example MYR 500.00 is not translated, while Zenith Bhd reflects MYR 999,999.",
      "Example output shows Zenith Bhd owes MYR 999,999 which is not translated.",
      "Sample customer Acme owes MYR 999,999; value not translated.",
      "The example value MYR 500.00 is not translated, but Zenith Bhd outstanding is MYR 999,999.",
      "MYR 500.00 is only an untranslated example while Zenith Bhd owes MYR 999,999.",
      "Nilai contoh MYR 500.00 tidak diterjemahkan tetapi Zenith Bhd berhutang MYR 999,999.",
    ]
  ) {
    const result = verifyFinalAnswerLiveEvidence({
      question: "What is outstanding balance?",
      answer,
      context: EMPTY_CONTEXT,
      grants: [],
    });
    assertEquals(result.allowed, false);
    assert(result.requirements.length > 0, `No requirement for: ${answer}`);
  }
});

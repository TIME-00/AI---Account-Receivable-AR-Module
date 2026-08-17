import type { AuthContext } from "./_shared/auth.ts";
import type { SupabaseClient } from "supabase";
import {
  AuthorizationError,
  BusinessError,
  ValidationError,
} from "./_shared/errors.ts";
import type { LiveDashboardMetrics } from "./reports/dashboard-types.ts";
import type { CopilotToolOutcome } from "./ar-copilot/contract.ts";
import {
  ANALYSIS_EVIDENCE_TYPES,
  ANALYST_MAX_CHART_POINTS,
  ANALYST_MAX_DAILY_BRIEF_ITEMS,
  ANALYST_MAX_REPORT_ROWS,
  type AnalystReportPlan,
  type AnalystReportResult,
  parseAnalystReportPlan,
  REPORT_DIMENSIONS,
  REPORT_METRICS,
  REPORT_TYPES,
} from "./ar-copilot/analyst-contract.ts";
import {
  assertChartPreservesReport,
  buildChartSpec,
  buildChartSpecIfSupported,
  buildCollectionHealthAnalysis,
  buildDailyBrief,
  buildExposureMovementAnalysis,
  buildPriorityAnalysis,
  exactMoney,
  recoveryCandidates,
  sortReportRows,
} from "./ar-copilot/analyst-engine.ts";
import { SupabaseAnalystReportSources } from "./ar-copilot/analyst-report-service.ts";
import {
  type CopilotAnalystServiceContract,
  selectSafeDocumentFields,
} from "./ar-copilot/analyst-service.ts";
import {
  ANALYST_TOOL_DEFINITIONS,
  ANALYST_TOOL_NAMES,
  AnalystToolExecutor,
} from "./ar-copilot/analyst-tools.ts";
import {
  detectCopilotLanguage,
  languageInstruction,
  multilingualIntentSignals,
  selectCopilotLanguage,
} from "./ar-copilot/language.ts";
import { AR_COPILOT_POLICY } from "./ar-copilot/policy.ts";
import type { CopilotReadServiceContract } from "./ar-copilot/read-service.ts";
import { CopilotService } from "./ar-copilot/service.ts";
import {
  classifyCopilotQuestion,
  COPILOT_TOOL_NAMES,
  questionRequiresLiveData,
} from "./ar-copilot/tools.ts";
import type {
  CopilotModelInputItem,
  CopilotModelProvider,
  CopilotModelTurn,
} from "./ar-copilot/openai.ts";

const COMPANY = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000002";
const CUSTOMER = "30000000-0000-4000-8000-000000000003";
const INVOICE = "40000000-0000-4000-8000-000000000004";

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
): Promise<Error> {
  try {
    await callback();
  } catch (error) {
    assert(error instanceof expected, `Expected ${expected.name}`);
    return error as Error;
  }
  throw new Error("Expected rejection");
}

function auth(roles: AuthContext["roles"]): AuthContext {
  return {
    userId: USER,
    companyId: COMPANY,
    roles,
    highestRole: roles[0],
    email: null,
  };
}

function dashboard(
  overrides: Partial<LiveDashboardMetrics["kpis"]> = {},
): LiveDashboardMetrics {
  return {
    meta: {
      company_id: COMPANY,
      base_currency: "MYR",
      as_of_date: "2026-08-14",
      calculated_at: "2026-08-14T00:00:00.000Z",
      scope: "company",
      trend_months: 6,
    },
    kpis: {
      total_outstanding_ar: 9000,
      overdue_outstanding: 8200,
      overdue_invoice_count: 2,
      unapplied_cash: 500,
      current_month_collections: 1000,
      current_month_posted_invoices: 1,
      import_rows_needing_review: 0,
      ...overrides,
    },
    invoice_status_counts: {
      open: 1,
      partially_paid: 1,
      overdue_status: 2,
      paid: 0,
      unpaid_total: 4,
    },
    aging_buckets: [
      {
        key: "current",
        label: "Current",
        invoice_count: 1,
        outstanding_base: 800,
        percentage: 8.89,
      },
      {
        key: "1_30",
        label: "1-30",
        invoice_count: 0,
        outstanding_base: 0,
        percentage: 0,
      },
      {
        key: "31_60",
        label: "31-60",
        invoice_count: 0,
        outstanding_base: 0,
        percentage: 0,
      },
      {
        key: "61_90",
        label: "61-90",
        invoice_count: 0,
        outstanding_base: 0,
        percentage: 0,
      },
      {
        key: "over_90",
        label: "Over 90",
        invoice_count: 2,
        outstanding_base: 8200,
        percentage: 91.11,
      },
    ],
    collection_trend: [
      { month: "2026-07", collected_base: 1500, receipt_count: 2 },
      { month: "2026-08", collected_base: 1000, receipt_count: 1 },
    ],
    top_outstanding_customers: [{
      customer_id: CUSTOMER,
      customer_code: "CUST-1",
      customer_name: "Safe Customer",
      outstanding_base: 9000,
      overdue_base: 8200,
      overdue_invoice_count: 2,
    }],
    credit_rating_distribution: [],
    customer_credit_rating_distribution: {
      population: "VISIBLE_CUSTOMERS",
      included_statuses: ["Active", "Inactive", "Blocked", "On Hold"],
      rows: [],
    },
    total_invoices: 4,
    open_invoices: 4,
    overdue_invoices: 2,
    total_receipts: 1,
    total_ar_balance: 9000,
    total_overdue_balance: 8200,
    total_credit_balance: 500,
    overdue_percentage: 91.11,
  };
}

function reportPlan(
  overrides: Partial<AnalystReportPlan> = {},
): AnalystReportPlan {
  return {
    report: "aging",
    metrics: ["outstanding_amount"],
    dimensions: ["aging_bucket"],
    filters: [],
    period: { date_from: null, date_to: null, as_of_date: "2026-08-14" },
    sort: null,
    limit: 10,
    chart_type: "bar",
    ...overrides,
  };
}

function reportResult(): AnalystReportResult {
  return {
    report_type: "aging",
    title: "AR Aging",
    description: "Authorized report",
    as_of: "2026-08-14",
    base_currency: "MYR",
    columns: [
      { field: "aging_bucket", label: "Aging bucket", format: "text" },
      { field: "outstanding_amount", label: "Outstanding", format: "currency" },
      { field: "invoice_count", label: "Invoices", format: "number" },
    ],
    rows: [
      {
        aging_bucket: "Current",
        aging_bucket_key: "current",
        outstanding_amount: "800.00",
        invoice_count: 1,
      },
      {
        aging_bucket: "1-30",
        aging_bucket_key: "1_30",
        outstanding_amount: "0.00",
        invoice_count: 0,
      },
      {
        aging_bucket: "31-60",
        aging_bucket_key: "31_60",
        outstanding_amount: "0.00",
        invoice_count: 0,
      },
      {
        aging_bucket: "61-90",
        aging_bucket_key: "61_90",
        outstanding_amount: "0.00",
        invoice_count: 0,
      },
      {
        aging_bucket: "Over 90",
        aging_bucket_key: "over_90",
        outstanding_amount: "8200.00",
        invoice_count: 2,
      },
    ],
    summary: {
      row_count: 5,
      canonical_partition_complete: true,
      partition_total: "9000.00",
      report_total: "9000.00",
    },
    coverage: {
      status: "complete",
      source_total: 5,
      returned_rows: 5,
      top_n_complete: null,
      reason: null,
    },
    authority: "authoritative_rows",
  };
}

Deno.test("priority analysis uses authoritative dashboard facts and reason codes", () => {
  const value = buildPriorityAnalysis(dashboard(), [], 5);
  assertEquals(value.priority_items[0].facts.overdue_amount, "8200.00");
  assert(
    value.priority_items[0].reason_codes.includes("HIGH_OVERDUE_EXPOSURE"),
  );
});

Deno.test("priority analysis uses no opaque risk score", () => {
  const serialized = JSON.stringify(buildPriorityAnalysis(dashboard(), [], 5));
  assert(!serialized.includes("risk_score"));
  assert(!serialized.includes("confidence_percent"));
});

Deno.test("priority analysis emits no fake insight when no condition exists", () => {
  const empty = dashboard({ unapplied_cash: 0 });
  empty.top_outstanding_customers = [];
  assertEquals(buildPriorityAnalysis(empty, [], 5).priority_items, []);
});

Deno.test("priority analysis keeps retryability as workflow evidence, not financial materiality", () => {
  const empty = dashboard({ unapplied_cash: 0 });
  empty.top_outstanding_customers = [];
  const item = buildPriorityAnalysis(empty, [{
    id: INVOICE,
    reason_code: "customer_unresolved",
    lifecycle_status: "retryable",
    opened_at: "2026-08-14T00:00:00Z",
  }], 5).priority_items[0];
  assertEquals(item.priority, "attention");
  assertEquals(item.evidence_type, "DIRECT_WORKFLOW_EVIDENCE");
});

Deno.test("priority categories do not let a retryable exception outrank customer exposure", () => {
  const analysis = buildPriorityAnalysis(dashboard(), [{
    id: INVOICE,
    reason_code: "provider_unavailable",
    lifecycle_status: "retryable",
    opened_at: "2026-08-14T00:00:00Z",
  }], 10);
  assertEquals(analysis.priority_items[0].entity_type, "customer");
  assertEquals(analysis.priority_items[0].category, "customer_exposure");
  assertEquals(analysis.priority_items[0].category_rank, 1);
});

Deno.test("priority output is bounded", () => {
  const exceptions = Array.from(
    { length: 20 },
    (_, index) => ({
      id: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000004`,
      reason_code: "customer_unresolved",
      lifecycle_status: "open",
      opened_at: "2026-08-14T00:00:00Z",
    }),
  );
  assertEquals(
    buildPriorityAnalysis(dashboard({ unapplied_cash: 0 }), exceptions, 3)
      .priority_items.length,
    3,
  );
});

Deno.test("collection health derives an exact monetary change", () => {
  const analysis = buildCollectionHealthAnalysis(dashboard());
  assertEquals(analysis.factors[0].absolute_change, "-500.00");
  assertEquals(analysis.factors[0].factor_code, "COLLECTIONS_DECREASED");
});

Deno.test("collection health refuses comparison without two points", () => {
  const value = dashboard();
  value.collection_trend = value.collection_trend.slice(0, 1);
  assertEquals(
    buildCollectionHealthAnalysis(value).status,
    "insufficient_evidence",
  );
});

Deno.test("overdue movement refuses causality without historical snapshots", () => {
  const analysis = buildExposureMovementAnalysis(dashboard(), "overdue");
  assertEquals(analysis.status, "insufficient_evidence");
  assertEquals(analysis.factors[0].current_value, "8200.00");
  assertEquals(analysis.factors[0].comparison_value, null);
  assertEquals(analysis.factors[0].percentage_change, null);
});

Deno.test("exact money does not use floating arithmetic", () => {
  assertEquals(exactMoney("8200.10", "amount"), "8200.10");
  assertEquals(exactMoney(0, "amount"), "0.00");
});

Deno.test("Daily Brief is on demand and bounded", () => {
  const brief = buildDailyBrief(buildPriorityAnalysis(dashboard(), [], 10));
  assertEquals(brief.generation, "on_demand");
  assert(brief.items.length <= ANALYST_MAX_DAILY_BRIEF_ITEMS);
});

Deno.test("Daily Brief links only to fixed internal screens", () => {
  const brief = buildDailyBrief(buildPriorityAnalysis(dashboard(), [], 10));
  assert(
    brief.items.every((item) => item.recommended_next_screen.startsWith("/")),
  );
  assert(!JSON.stringify(brief).includes("http"));
});

for (const evidenceType of ANALYSIS_EVIDENCE_TYPES) {
  Deno.test(`analysis provenance vocabulary includes ${evidenceType}`, () => {
    assert(ANALYSIS_EVIDENCE_TYPES.includes(evidenceType));
  });
}

Deno.test("report DSL accepts a fully allow-listed aging plan", () => {
  assertEquals(parseAnalystReportPlan(reportPlan()).report, "aging");
});

for (const report of REPORT_TYPES) {
  Deno.test(`report registry contains bounded type ${report}`, () => {
    assert(REPORT_TYPES.includes(report));
  });
}

Deno.test("report DSL rejects unknown report", async () => {
  await rejects(() =>
    parseAnalystReportPlan({ ...reportPlan(), report: "sql" })
  );
});

Deno.test("report DSL rejects unknown metric", async () => {
  await rejects(() =>
    parseAnalystReportPlan({ ...reportPlan(), metrics: ["arbitrary_column"] })
  );
});

Deno.test("report DSL rejects unknown dimension", async () => {
  await rejects(() =>
    parseAnalystReportPlan({ ...reportPlan(), dimensions: ["table_name"] })
  );
});

Deno.test("report DSL rejects extra SQL field", async () => {
  await rejects(() =>
    parseAnalystReportPlan({ ...reportPlan(), sql: "select *" })
  );
});

Deno.test("report DSL rejects arbitrary filter column", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan({
        report: "invoice_summary",
        metrics: ["invoice_count"],
        dimensions: ["document"],
      }),
      filters: [{ field: "created_by", operator: "eq", value: USER }],
    })
  );
});

Deno.test("report DSL rejects unsupported comparator", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan({
        report: "invoice_summary",
        metrics: ["invoice_count"],
        dimensions: ["document"],
      }),
      filters: [{
        field: "minimum_amount",
        operator: "contains",
        value: "5000",
      }],
    })
  );
});

Deno.test("report DSL rejects SQL-like amount", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan({
        report: "invoice_summary",
        metrics: ["invoice_count"],
        dimensions: ["document"],
      }),
      filters: [{
        field: "minimum_amount",
        operator: "gte",
        value: "0;drop table",
      }],
    })
  );
});

Deno.test("report DSL rejects invalid role-independent currency value", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan({
        report: "invoice_summary",
        metrics: ["invoice_count"],
        dimensions: ["document"],
      }),
      filters: [{ field: "currency", operator: "eq", value: "MYR OR 1=1" }],
    })
  );
});

Deno.test("minimum amount requires an explicit transaction currency", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan({
        report: "invoice_summary",
        metrics: ["outstanding_amount"],
        dimensions: ["document"],
        period: {
          date_from: "2026-08-01",
          date_to: "2026-08-14",
          as_of_date: null,
        },
      }),
      filters: [{
        field: "minimum_amount",
        operator: "gte",
        value: "5000.00",
      }],
    })
  );
});

Deno.test("minimum amount accepts one validated currency boundary", () => {
  const plan = parseAnalystReportPlan({
    ...reportPlan({
      report: "invoice_summary",
      metrics: ["outstanding_amount"],
      dimensions: ["document"],
      period: {
        date_from: "2026-08-01",
        date_to: "2026-08-14",
        as_of_date: null,
      },
    }),
    filters: [
      { field: "currency", operator: "eq", value: "MYR" },
      { field: "minimum_amount", operator: "gte", value: "5000.00" },
    ],
  });
  assertEquals(plan.filters.length, 2);
});

Deno.test("report DSL rejects duplicate metrics and filters", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan(),
      metrics: ["outstanding_amount", "outstanding_amount"],
    })
  );
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan({
        report: "customer_outstanding",
        metrics: ["outstanding_amount"],
        dimensions: ["customer"],
      }),
      filters: [
        { field: "credit_rating", operator: "eq", value: "A" },
        { field: "credit_rating", operator: "eq", value: "B" },
      ],
    })
  );
});

Deno.test("report DSL rejects period fields a report would ignore", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan(),
      period: {
        date_from: "2026-08-01",
        date_to: "2026-08-14",
        as_of_date: null,
      },
    })
  );
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan({
        report: "receipt_summary",
        metrics: ["receipt_count"],
        dimensions: ["document"],
      }),
      period: {
        date_from: null,
        date_to: null,
        as_of_date: "2026-08-14",
      },
    })
  );
});

Deno.test("report DSL rejects invalid status for report family", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan({
        report: "receipt_summary",
        metrics: ["receipt_count"],
        dimensions: ["document"],
      }),
      filters: [{ field: "status", operator: "eq", value: "Overdue" }],
    })
  );
});

Deno.test("report DSL enforces row maximum", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan(),
      limit: ANALYST_MAX_REPORT_ROWS + 1,
    })
  );
});

Deno.test("report DSL enforces date ordering", async () => {
  await rejects(() =>
    parseAnalystReportPlan({
      ...reportPlan(),
      period: {
        date_from: "2026-08-14",
        date_to: "2026-08-01",
        as_of_date: null,
      },
    })
  );
});

Deno.test("report DSL accepts only report-owned metrics", async () => {
  await rejects(() =>
    parseAnalystReportPlan({ ...reportPlan(), metrics: ["collection_amount"] })
  );
});

for (const metric of REPORT_METRICS) {
  Deno.test(`metric identifier is canonical ${metric}`, () =>
    assert(!metric.includes(" ")));
}

for (const dimension of REPORT_DIMENSIONS) {
  Deno.test(`dimension identifier is canonical ${dimension}`, () =>
    assert(!dimension.includes(".")));
}

Deno.test("report sorting keeps exact decimal strings", () => {
  const rows = sortReportRows(
    reportResult().rows,
    reportPlan({ sort: { metric: "outstanding_amount", direction: "desc" } }),
  );
  assertEquals(rows[0].outstanding_amount, "8200.00");
});

Deno.test("chart spec is derived only from report rows", () => {
  const chart = buildChartSpec(reportPlan(), reportResult());
  assert(chart);
  assertEquals(
    chart.data[0].outstanding_amount,
    reportResult().rows[0].outstanding_amount,
  );
});

Deno.test("chart integrity guard rejects changed value", async () => {
  const chart = buildChartSpec(reportPlan(), reportResult())!;
  chart.data[0].outstanding_amount = "999999.00";
  await rejects(() => assertChartPreservesReport(chart, reportResult()));
});

Deno.test("chart rejects unknown data field", async () => {
  const report = reportResult();
  report.columns = report.columns.filter((column) =>
    column.field !== "outstanding_amount"
  );
  await rejects(() => buildChartSpec(reportPlan(), report));
});

Deno.test("line chart requires time series", async () => {
  await rejects(() =>
    buildChartSpec(reportPlan({ chart_type: "line" }), reportResult())
  );
});

Deno.test("pie chart requires one part-to-whole aging metric", async () => {
  await rejects(() =>
    buildChartSpec(
      reportPlan({ chart_type: "pie", metrics: ["invoice_count"] }),
      reportResult(),
    )
  );
});

Deno.test("unsupported chart presentation preserves the authoritative report", () => {
  const chart = buildChartSpecIfSupported(
    reportPlan({ chart_type: "line" }),
    reportResult(),
  );
  assertEquals(chart, null);
});

Deno.test("valid aging composition permits a pie", () => {
  assertEquals(
    buildChartSpec(reportPlan({ chart_type: "pie" }), reportResult())
      ?.chart_type,
    "pie",
  );
});

Deno.test("chart point count is bounded", () => {
  const report = reportResult();
  report.rows = Array.from(
    { length: 40 },
    (_, index) => ({
      aging_bucket: `B${index}`,
      outstanding_amount: `${index}.00`,
      invoice_count: index,
    }),
  );
  assertEquals(
    buildChartSpec(reportPlan(), report)?.data.length,
    ANALYST_MAX_CHART_POINTS,
  );
});

Deno.test("chart spec contains no JSX HTML or external resources", () => {
  const serialized = JSON.stringify(
    buildChartSpec(reportPlan(), reportResult()),
  );
  assert(!/[<>]|https?:|javascript:/i.test(serialized));
});

Deno.test("multi-currency document monetary chart is rejected", async () => {
  const report = reportResult();
  report.report_type = "invoice_summary";
  report.summary = { row_count: 2, multi_currency: true };
  report.columns[0] = { field: "document", label: "Document", format: "text" };
  await rejects(() =>
    buildChartSpec(
      reportPlan({
        report: "invoice_summary",
        dimensions: ["document"],
        chart_type: "bar",
      }),
      report,
    )
  );
});

Deno.test("document field allow-list retains safe business fields with provenance", () => {
  const fields = selectSafeDocumentFields({
    invoice_no: "INV-1",
    currency: "MYR",
    total_amount: "500.00",
  });
  assertEquals(fields.map((item) => item.provenance), [
    "EXTRACTED",
    "EXTRACTED",
    "EXTRACTED",
  ]);
});

for (
  const forbidden of [
    "raw_ocr",
    "gmail_body",
    "attachment_content",
    "email",
    "phone",
    "address",
    "bank_account",
    "access_token",
    "provider_payload",
  ]
) {
  Deno.test(`document analysis excludes ${forbidden}`, () => {
    const fields = selectSafeDocumentFields({
      [forbidden]: "secret",
      invoice_no: "INV-1",
    });
    assertEquals(fields.map((item) => item.field), ["invoice_no"]);
    assert(!JSON.stringify(fields).includes("secret"));
  });
}

Deno.test("document field value is bounded", () => {
  assertEquals(
    selectSafeDocumentFields({ reference_no: "x".repeat(500) })[0].value
      ?.length,
    120,
  );
});

Deno.test("exception recovery suggestion is read-only human-confirmed", () => {
  const candidates = recoveryCandidates("customer_unresolved", [
    "customer_unresolved",
  ]);
  assertEquals(candidates[0].requires_human_confirmation, true);
  assertEquals(candidates[0].resolution_type, "review_customer_match");
});

for (
  const reason of [
    "customer_ambiguous",
    "invoice_conflict",
    "receipt_conflict",
    "arithmetic_mismatch",
    "currency_unsupported",
    "allocation_evidence_insufficient",
    "low_confidence",
  ]
) {
  Deno.test(`exception reason ${reason} maps to bounded review proposal`, () => {
    const candidate = recoveryCandidates(reason, [reason])[0];
    assert(
      candidate.resolution_type.startsWith("review") ||
        candidate.resolution_type.startsWith("select") ||
        candidate.resolution_type.startsWith("open"),
    );
    assertEquals(candidate.requires_human_confirmation, true);
  });
}

Deno.test("unknown exception reason stays manual review", () => {
  assertEquals(
    recoveryCandidates("unknown", ["unknown"])[0].resolution_type,
    "manual_review",
  );
});

for (
  const [text, language] of [["Explain this", "en"], [
    "为什么这个 receipt 还没有 allocate？",
    "zh-CN",
  ], ["Kenapa invoice ni masih overdue?", "ms"]] as const
) {
  Deno.test(`language detection selects ${language}`, () =>
    assertEquals(detectCopilotLanguage(text), language));
}

Deno.test("explicit English overrides recent Chinese", () => {
  assertEquals(
    selectCopilotLanguage("Answer in English.", [
      { role: "user", content: "为什么？" },
      { role: "assistant", content: "解释" },
      { role: "user", content: "Answer in English." },
    ]),
    "en",
  );
});

Deno.test("recent Chinese carries into a short follow-up", () => {
  assertEquals(
    selectCopilotLanguage("More simply", [
      { role: "user", content: "为什么？" },
      { role: "assistant", content: "解释" },
      { role: "user", content: "More simply" },
    ]),
    "zh-CN",
  );
});

Deno.test("recent Malay carries into a short follow-up", () => {
  assertEquals(
    selectCopilotLanguage("Simpler", [
      { role: "user", content: "Kenapa masih overdue?" },
      { role: "assistant", content: "Kerana" },
      { role: "user", content: "Simpler" },
    ]),
    "ms",
  );
});

Deno.test("Chinese live question requires live evidence", () =>
  assertEquals(
    questionRequiresLiveData("现在有多少 overdue invoices？"),
    true,
  ));
Deno.test("Malay live question requires live evidence", () =>
  assertEquals(
    questionRequiresLiveData("Berapa invoice overdue sekarang?"),
    true,
  ));
Deno.test("Chinese analysis vocabulary is a live-data signal", () =>
  assertEquals(multilingualIntentSignals("分析目前的收款风险").live, true));
Deno.test("Malay reporting vocabulary is a live-data signal", () =>
  assertEquals(
    multilingualIntentSignals("Tunjukkan laporan risiko kutipan").live,
    true,
  ));
Deno.test("Chinese write request remains read-only", () =>
  assertEquals(
    classifyCopilotQuestion("帮我直接 post 这张 invoice"),
    "write_action",
  ));
Deno.test("Malay write request remains read-only", () =>
  assertEquals(
    classifyCopilotQuestion("Tolong post invoice ini"),
    "write_action",
  ));
Deno.test("language instruction preserves identifiers and amounts", () => {
  for (const language of ["en", "zh-CN", "ms"] as const) {
    const instruction = languageInstruction(language);
    assert(instruction.includes("identifiers"));
    assert(instruction.includes("amounts"));
  }
});

Deno.test("analyst tool registry contains no generic or write tool", () => {
  const names = ANALYST_TOOL_NAMES.join(" ");
  assert(
    !/(execute_sql|query_table|generic_rpc|generic_filter|post_invoice|allocate_receipt|send_reminder|retry_exception)/i
      .test(names),
  );
});

Deno.test("combined Copilot registry preserves all analyst tools", () => {
  assert(ANALYST_TOOL_NAMES.every((name) => COPILOT_TOOL_NAMES.includes(name)));
  assertEquals(ANALYST_TOOL_DEFINITIONS.length, ANALYST_TOOL_NAMES.length);
});

Deno.test("report tool exposes only dimensions accepted by the deterministic parser", () => {
  const definition = ANALYST_TOOL_DEFINITIONS.find((item) =>
    item.name === "run_ar_report"
  );
  const parameters = definition?.parameters as {
    properties?: {
      dimensions?: { items?: { enum?: string[] } };
    };
  };
  assertEquals(parameters.properties?.dimensions?.items?.enum, [
    "customer",
    "aging_bucket",
    "period",
    "document",
  ]);
});

Deno.test("analyst dashboard reports retain the trusted dashboard RPC client", async () => {
  let trustedCalls = 0;
  let userCalls = 0;
  const trustedDashboard = dashboard();
  trustedDashboard.meta.trend_months = 2;
  const ratings = ["AAA", "AA", "A", "B", "C", "D"] as const;
  trustedDashboard.credit_rating_distribution = ratings.map((rating) => ({
    rating,
    customer_count: 0,
    outstanding_base: 0,
  }));
  trustedDashboard.customer_credit_rating_distribution.rows = ratings.map(
    (rating) => ({ rating, customer_count: 0 }),
  );
  const trusted = {
    rpc: () => {
      trustedCalls += 1;
      return Promise.resolve({ data: trustedDashboard, error: null });
    },
  } as unknown as SupabaseClient;
  const user = {
    rpc: () => {
      userCalls += 1;
      return Promise.resolve({ data: null, error: { code: "42501" } });
    },
  } as unknown as SupabaseClient;
  const result = await new SupabaseAnalystReportSources(trusted, user)
    .getDashboard(auth(["Finance Manager"]), "2026-08-14", 6);
  assertEquals(result.meta.base_currency, "MYR");
  assertEquals(trustedCalls, 1);
  assertEquals(userCalls, 0);
});

class FakeAnalyst implements CopilotAnalystServiceContract {
  calls: Array<{ name: string; auth: AuthContext; args: unknown[] }> = [];
  result(
    name: string,
    a: AuthContext,
    ...args: unknown[]
  ): Promise<CopilotToolOutcome> {
    this.calls.push({ name, auth: a, args });
    return Promise.resolve({
      data: { analysis_type: name, amount: "8200.00" },
      evidence: [{
        kind: "customer",
        id: CUSTOMER,
        label: "Safe Customer",
        number: "CUST-1",
      }],
      links: [],
      artifacts: [{
        kind: "analysis",
        analysis: { analysis_type: name, amount: "8200.00" },
      }],
    });
  }
  getArPriorityAnalysis(a: AuthContext, limit: number) {
    return this.result("priority", a, limit);
  }
  getCustomerRiskAnalysis(a: AuthContext, id: string) {
    return this.result("customer", a, id);
  }
  getCollectionHealthAnalysis(a: AuthContext, months: number) {
    return this.result("collections", a, months);
  }
  getExposureMovementAnalysis(
    a: AuthContext,
    metric: "overdue" | "aging",
  ) {
    return this.result("exposure_movement", a, metric);
  }
  getUnappliedCashAnalysis(a: AuthContext, limit: number) {
    return this.result("unapplied", a, limit);
  }
  getRootCauseAnalysis(
    a: AuthContext,
    type: "customer" | "invoice" | "receipt" | "automation_document",
    id: string,
  ) {
    return this.result("root", a, type, id);
  }
  getDailyBrief(a: AuthContext, limit: number) {
    return this.result("brief", a, limit);
  }
  runReport(a: AuthContext, plan: AnalystReportPlan) {
    return this.result("report", a, plan);
  }
  analyzeAutomationDocument(a: AuthContext, id: string) {
    return this.result("document", a, id);
  }
  analyzeExceptionRecovery(a: AuthContext, id: string) {
    return this.result("recovery", a, id);
  }
}

Deno.test("System Admin receives no financial analysis", async () => {
  await rejects(
    () =>
      new AnalystToolExecutor(new FakeAnalyst()).execute(
        auth(["System Admin"]),
        "get_ar_priority_analysis",
        '{"limit":5}',
      ),
    AuthorizationError,
  );
});

Deno.test("Finance Manager company analysis is accepted", async () => {
  const fake = new FakeAnalyst();
  await new AnalystToolExecutor(fake).execute(
    auth(["Finance Manager"]),
    "get_ar_priority_analysis",
    '{"limit":5}',
  );
  assertEquals(fake.calls[0].auth.companyId, COMPANY);
});

Deno.test("overdue movement analysis remains a live scoped tool", async () => {
  const fake = new FakeAnalyst();
  await new AnalystToolExecutor(fake).execute(
    auth(["Finance Manager"]),
    "get_exposure_movement_analysis",
    '{"metric":"overdue"}',
  );
  assertEquals(fake.calls[0].name, "exposure_movement");
  assertEquals(fake.calls[0].auth.companyId, COMPANY);
});

Deno.test("AR Clerk identity and company are passed unchanged for assigned scope", async () => {
  const fake = new FakeAnalyst();
  await new AnalystToolExecutor(fake).execute(
    auth(["AR Clerk"]),
    "get_customer_risk_analysis",
    `{"customer_id":"${CUSTOMER}"}`,
  );
  assertEquals(fake.calls[0].auth.userId, USER);
  assertEquals(fake.calls[0].auth.companyId, COMPANY);
});

Deno.test("multi-role user receives authority by role membership", async () => {
  const fake = new FakeAnalyst();
  await new AnalystToolExecutor(fake).execute(
    auth(["System Admin", "Finance Manager"]),
    "get_daily_brief",
    '{"limit":3}',
  );
  assertEquals(fake.calls.length, 1);
});

Deno.test("AR Clerk cannot analyze Automation documents", async () => {
  await rejects(
    () =>
      new AnalystToolExecutor(new FakeAnalyst()).execute(
        auth(["AR Clerk"]),
        "analyze_automation_document",
        `{"document_id":"${INVOICE}"}`,
      ),
    AuthorizationError,
  );
});

Deno.test("invalid report plans are tagged for one content-free correction", async () => {
  const error = await rejects(() =>
    new AnalystToolExecutor(new FakeAnalyst()).execute(
      auth(["Finance Manager"]),
      "run_ar_report",
      JSON.stringify({
        ...reportPlan({
          report: "collections",
          metrics: ["collection_amount"],
          dimensions: ["period"],
        }),
        period: {
          date_from: "2026-01-01",
          date_to: "2026-06-30",
          as_of_date: null,
        },
      }),
    )
  );
  assert(error instanceof ValidationError);
  assertEquals(error.details, { category: "invalid_report_plan" });
});

Deno.test("analyst tool arguments reject extra tenant authority", async () => {
  await rejects(() =>
    new AnalystToolExecutor(new FakeAnalyst()).execute(
      auth(["Finance Manager"]),
      "get_ar_priority_analysis",
      `{"limit":5,"company_id":"${COMPANY}"}`,
    )
  );
});

Deno.test("analytical tool limit and report bounds are explicit", () => {
  assertEquals(ANALYST_MAX_REPORT_ROWS, 50);
  assertEquals(ANALYST_MAX_CHART_POINTS, 20);
  assertEquals(ANALYST_MAX_DAILY_BRIEF_ITEMS, 8);
});

class ScriptedModel implements CopilotModelProvider {
  readonly provider = "openai" as const;
  readonly model = "gpt-5.6-luna";
  inputs: CopilotModelInputItem[][] = [];
  constructor(private readonly turns: CopilotModelTurn[]) {}
  turn(input: CopilotModelInputItem[]): Promise<CopilotModelTurn> {
    this.inputs.push(structuredClone(input));
    return Promise.resolve(this.turns.shift()!);
  }
}

Deno.test("analytical artifact is optional and returned only after analytical tool evidence", async () => {
  const model = new ScriptedModel([
    {
      type: "tool_calls",
      calls: [{
        call_id: "call-1",
        name: "get_ar_priority_analysis",
        arguments: '{"limit":5}',
      }],
    },
    { type: "answer", answer: "Review the authorized priorities." },
  ]);
  const result = await new CopilotService({
    model,
    reads: {} as CopilotReadServiceContract,
    analytics: new FakeAnalyst(),
    recordTelemetry: () => {},
    recordPhaseTelemetry: () => {},
  }).chat(auth(["Finance Manager"]), {
    messages: [{ role: "user", content: "What should I focus on today?" }],
    context: { page: "dashboard", entity_type: null, entity_id: null },
  });
  assertEquals(result.artifacts?.[0].kind, "analysis");
  assertEquals(result.status.tool_names, ["get_ar_priority_analysis"]);
});

Deno.test("different analytical findings remain independently available", async () => {
  const model = new ScriptedModel([
    {
      type: "tool_calls",
      calls: [
        {
          call_id: "call-1",
          name: "get_ar_priority_analysis",
          arguments: '{"limit":5}',
        },
        {
          call_id: "call-2",
          name: "get_collection_health_analysis",
          arguments: '{"months":6}',
        },
      ],
    },
    { type: "answer", answer: "Review both authorized findings." },
  ]);
  const result = await new CopilotService({
    model,
    reads: {} as CopilotReadServiceContract,
    analytics: new FakeAnalyst(),
    recordTelemetry: () => {},
    recordPhaseTelemetry: () => {},
  }).chat(auth(["Finance Manager"]), {
    messages: [{
      role: "user",
      content: "Compare today's priorities and collection health.",
    }],
    context: { page: "dashboard", entity_type: null, entity_id: null },
  });
  assertEquals(result.artifacts?.length, 2);
  assertEquals(result.status.tool_call_count, 2);
});

Deno.test("live-tool gate failures expose content-free phase metadata", async () => {
  const model = new ScriptedModel([{
    type: "tool_calls",
    calls: [{
      call_id: "call-content-free",
      name: "get_collection_health_analysis",
      arguments: '{"months":6}',
    }],
  }]);
  const error = await rejects(() =>
    new CopilotService({
      model,
      reads: {} as CopilotReadServiceContract,
      analytics: new FakeAnalyst(),
      recordTelemetry: () => {},
      recordPhaseTelemetry: () => {},
    }).chat(auth(["Finance Manager"]), {
      messages: [{ role: "user", content: "Explain AR concepts." }],
      context: { page: "dashboard", entity_type: null, entity_id: null },
    }), BusinessError);
  assert(error instanceof BusinessError);
  assertEquals(error.details, {
    phase: "tool_authorization",
    round: 0,
    tool_name: "get_collection_health_analysis",
    error_category: "live_tool_not_authorized_for_question",
  });
  const serialized = JSON.stringify(error.details);
  assert(!serialized.includes("Explain AR concepts"));
  assert(!serialized.includes("months"));
});

Deno.test("one invalid report plan can be corrected without losing evidence authority", async () => {
  const invalid = JSON.stringify({
    ...reportPlan({
      report: "collections",
      metrics: ["collection_amount"],
      dimensions: ["period"],
    }),
    period: {
      date_from: "2026-01-01",
      date_to: "2026-06-30",
      as_of_date: null,
    },
  });
  const valid = JSON.stringify(reportPlan({
    report: "collections",
    metrics: ["collection_amount"],
    dimensions: ["period"],
    period: { date_from: null, date_to: null, as_of_date: "2026-08-14" },
    chart_type: "line",
    limit: 6,
  }));
  const model = new ScriptedModel([
    {
      type: "tool_calls",
      calls: [{
        call_id: "call-invalid-report",
        name: "run_ar_report",
        arguments: invalid,
      }],
    },
    {
      type: "tool_calls",
      calls: [{
        call_id: "call-valid-report",
        name: "run_ar_report",
        arguments: valid,
      }],
    },
    { type: "answer", answer: "The requested report is ready." },
  ]);
  const analyst = new FakeAnalyst();
  const result = await new CopilotService({
    model,
    reads: {} as CopilotReadServiceContract,
    analytics: analyst,
    recordTelemetry: () => {},
    recordPhaseTelemetry: () => {},
  }).chat(auth(["Finance Manager"]), {
    messages: [{
      role: "user",
      content: "Show me a report of collections for six months.",
    }],
    context: { page: "dashboard", entity_type: null, entity_id: null },
  });
  assertEquals(result.status.tool_names, ["run_ar_report"]);
  assertEquals(result.status.tool_call_count, 2);
  assertEquals(analyst.calls.length, 1);
  const correction = model.inputs[1].find((item) =>
    "type" in item && item.type === "function_call_output"
  );
  assert(correction && "output" in correction);
  assert(typeof correction.output === "string");
  assert(correction.output.includes("INVALID_REPORT_PLAN"));
  assert(!correction.output.includes("2026-01-01"));
});

Deno.test("structured analytical amount reaches model unchanged", async () => {
  const model = new ScriptedModel([
    {
      type: "tool_calls",
      calls: [{
        call_id: "call-1",
        name: "get_ar_priority_analysis",
        arguments: '{"limit":5}',
      }],
    },
    { type: "answer", answer: "Review the authorized priorities." },
  ]);
  await new CopilotService({
    model,
    reads: {} as CopilotReadServiceContract,
    analytics: new FakeAnalyst(),
    recordTelemetry: () => {},
    recordPhaseTelemetry: () => {},
  }).chat(auth(["Finance Manager"]), {
    messages: [{ role: "user", content: "What should I focus on today?" }],
    context: { page: "dashboard", entity_type: null, entity_id: null },
  });
  const toolOutput = model.inputs.at(-1)?.find((item) =>
    "type" in item && item.type === "function_call_output"
  );
  assert(toolOutput && "output" in toolOutput);
  assert(typeof toolOutput.output === "string");
  const parsed = JSON.parse(toolOutput.output) as {
    data: { amount: string };
  };
  assertEquals(parsed.data.amount, "8200.00");
});

Deno.test("server language instruction is injected outside browser authority", async () => {
  const model = new ScriptedModel([{
    type: "answer",
    answer: "我可以帮助分析应收账款。",
  }]);
  const result = await new CopilotService({
    model,
    reads: {} as CopilotReadServiceContract,
    recordTelemetry: () => {},
  }).chat(auth(["Finance Manager"]), {
    messages: [{ role: "user", content: "你能帮我什么？" }],
    context: { page: "dashboard", entity_type: null, entity_id: null },
  });
  assert(JSON.stringify(model.inputs[0]).includes("Simplified Chinese"));
  assertEquals(result.answer, "我可以帮助分析应收账款。");
});

Deno.test("Malay presentation preserves financial identifiers and amounts", async () => {
  const answer =
    "Kod contoh INV-202608-00001 dan nilai contoh MYR 500.00 tidak diterjemahkan.";
  const model = new ScriptedModel([{ type: "answer", answer }]);
  const result = await new CopilotService({
    model,
    reads: {} as CopilotReadServiceContract,
    recordTelemetry: () => {},
  }).chat(auth(["Finance Manager"]), {
    messages: [{
      role: "user",
      content: "Terangkan secara ringkas tetapi jawab berdasarkan panduan.",
    }],
    context: { page: "dashboard", entity_type: null, entity_id: null },
  });
  assertEquals(result.answer, answer);
  assert(JSON.stringify(model.inputs[0]).includes("Bahasa Melayu"));
});

Deno.test("policy forbids invented analysis and all Gate 1 execution", () => {
  assert(AR_COPILOT_POLICY.includes("Do not invent causes"));
  assert(AR_COPILOT_POLICY.includes("cannot execute"));
  assert(AR_COPILOT_POLICY.includes("Never count, sum, group, rank"));
  assert(AR_COPILOT_POLICY.includes("Never emit an LLM confidence percentage"));
});

Deno.test("analyst telemetry and service source remain content-free and tenant scoped", async () => {
  const source = await Deno.readTextFile(
    new URL("./ar-copilot/analyst-service.ts", import.meta.url),
  );
  assert(source.includes('.eq("company_id", auth.companyId)'));
  assert(!source.includes("console.log"));
  assert(!source.includes("prompt:"));
  assert(!source.includes("answer:"));
});

Deno.test("analyst service contains no mutation call", async () => {
  const source = await Deno.readTextFile(
    new URL("./ar-copilot/analyst-service.ts", import.meta.url),
  );
  assert(!/\.(insert|update|delete|upsert)\s*\(/.test(source));
  assert(
    !/(postInvoice|postReceipt|allocateReceipt|retryException|sendReminder)\s*\(/
      .test(source),
  );
});

Deno.test("reporting surface has no arbitrary SQL RPC or HTTP tool", () => {
  const parameterShapes = JSON.stringify(
    ANALYST_TOOL_DEFINITIONS.map((tool) => tool.parameters),
  );
  assert(
    !/(execute_sql|query_table|generic_rpc|generic_http|url)/i.test(
      parameterShapes,
    ),
  );
});

for (
  const [question, expected] of [
    ["Hi", "casual_general"],
    ["How are you today?", "casual_general"],
    ["What is unapplied cash?", "system_knowledge"],
    ["How many overdue invoices are there right now?", "live_data"],
    ["Why is this invoice still open?", "live_data"],
    ["Why is this receipt still unapplied?", "live_data"],
    ["How are collections performing?", "live_data"],
    ["Analyze this automation document.", "live_data"],
  ] as const
) {
  Deno.test(`v2 intent remains compatible: ${question}`, () =>
    assertEquals(classifyCopilotQuestion(question), expected));
}

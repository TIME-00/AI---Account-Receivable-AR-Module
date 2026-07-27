import type { AuthContext } from "./_shared/auth.ts";
import type { Invoice, Receipt } from "./_shared/types.ts";
import {
  enforcePayloadLimit,
  EXPORT_OVERSIZE_MESSAGE,
  EXPORT_PAYLOAD_LIMIT_BYTES,
  type ExportCompany,
  type ExportDataset,
  ExportDatasetTooLargeError,
  type ExportQuery,
  parseExportQuery,
  serializedUtf8Bytes,
} from "./reports/export-contract.ts";
import {
  handleReportExportRequest,
  type ReportExportServiceContract,
} from "./reports/export-handler.ts";
import type {
  ExportCustomerMetadata,
  ExportPage,
  ExportRepository,
} from "./reports/export-repository.ts";
import { ReportExportService } from "./reports/export-service.ts";
import type { CustomerAgingRow } from "./reports/service.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message = "Values differ",
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

async function rejects(
  action: () => Promise<unknown>,
  fragment: string,
): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    assert(
      String(error).includes(fragment),
      `Expected ${fragment}, got ${String(error)}`,
    );
    return error;
  }
  throw new Error(`Expected rejection containing ${fragment}`);
}

function uuid(index: number, family = 0): string {
  return `${String(family).padStart(8, "0")}-0000-4000-8000-${
    String(index).padStart(12, "0")
  }`;
}

const company: ExportCompany = {
  id: uuid(1, 1),
  name: "Authoritative Demo Company",
  base_currency: "MYR",
  timezone: "Asia/Kuala_Lumpur",
};
const auth: AuthContext = {
  companyId: company.id,
  userId: uuid(1, 2),
  roles: ["Finance Manager"],
  highestRole: "Finance Manager",
  email: null,
};
const unauthorized: AuthContext = {
  ...auth,
  roles: ["System Admin"],
  highestRole: "System Admin",
};
const fixedNow = () => new Date("2026-07-27T12:34:56.000Z");

function agingRow(index: number): CustomerAgingRow {
  return {
    customer_id: uuid(index + 1, 3),
    customer_name: `Customer ${String(index).padStart(5, "0")}`,
    customer_code: `CUST-${String(index).padStart(5, "0")}`,
    credit_limit: 1000,
    credit_rating: ["AAA", "AA", "A", "B", "C", "D"][index % 6],
    total_outstanding: Number(index + 1),
    base_total: Number(index + 1),
    base_currency: "MYR",
    by_currency: [{
      currency: index % 2 === 0 ? "MYR" : "USD",
      amount: Number(index + 1),
      base_amount: Number(index + 1),
      count: 1,
    }],
    meta: {
      base_currency: "MYR",
      multi_currency: false,
      normalization_basis: "current_balance_x_booked_rate",
    },
    current_amount: Number(index + 1),
    bucket_1_30: 0,
    bucket_31_60: 0,
    bucket_61_90: 0,
    bucket_over_90: 0,
  };
}

function invoiceRow(index: number): Invoice {
  return {
    id: uuid(index + 1, 4),
    company_id: company.id,
    invoice_no: `INV-${String(index).padStart(6, "0")}`,
    doc_type: index % 3 === 0
      ? "Credit Note"
      : index % 3 === 1
      ? "Debit Note"
      : "Invoice",
    invoice_date: "2026-07-01",
    due_date: "2026-07-31",
    customer_id: uuid((index % 25) + 1, 3),
    customer_name: `Customer ${index % 25}`,
    currency: index % 2 === 0 ? "MYR" : "USD",
    exchange_rate: index % 2 === 0 ? 1 : 4.25,
    base_currency: "MYR",
    fx_source_category: "REFERENCE_SELECTED",
    fx_decision_id: uuid(index + 1, 7),
    subtotal: 10,
    tax_total: 0,
    total_amount: 10,
    base_total: index % 2 === 0 ? 10 : 42.5,
    outstanding: 6,
    status: index % 2 === 0 ? "Open" : "Partially Paid",
    fx_decision: {
      id: uuid(index + 1, 7),
      source_category: "REFERENCE_SELECTED",
      approval_status: "NotRequired",
      lifecycle_status: "Posted",
      decision_version: 1,
      root_decision_id: uuid(index + 1, 7),
      supersedes_decision_id: null,
      import_origin: null,
      booked_rate: index % 2 === 0 ? 1 : 4.25,
      deviation_pct: null,
      stale_reference: false,
      fx_posting_eligible: true,
    },
  } as Invoice;
}

function receiptRow(index: number): Receipt {
  return {
    id: uuid(index + 1, 5),
    company_id: company.id,
    receipt_no: `RCT-${String(index).padStart(6, "0")}`,
    receipt_date: "2026-07-02",
    value_date: "2026-07-02",
    customer_id: uuid((index % 25) + 1, 3),
    customer_name: `Customer ${index % 25}`,
    payment_method: index % 2 === 0 ? "TT" : "GIRO",
    currency: index % 2 === 0 ? "MYR" : "USD",
    exchange_rate: index % 2 === 0 ? 1 : 4.25,
    base_currency: "MYR",
    fx_source_category: "REFERENCE_SELECTED",
    fx_decision_id: uuid(index + 1, 8),
    receipt_amount: 10,
    base_amount: index % 2 === 0 ? 10 : 42.5,
    allocated_amount: 4,
    unallocated_amount: 6,
    bank_account_id: uuid(1, 9),
    bank_account_name: "Demo Bank",
    status: index % 2 === 0 ? "Posted" : "Fully Allocated",
    fx_decision: {
      id: uuid(index + 1, 8),
      source_category: "REFERENCE_SELECTED",
      approval_status: "NotRequired",
      lifecycle_status: "Posted",
      decision_version: 1,
      root_decision_id: uuid(index + 1, 8),
      supersedes_decision_id: null,
      import_origin: null,
      booked_rate: index % 2 === 0 ? 1 : 4.25,
      deviation_pct: null,
      stale_reference: false,
      fx_posting_eligible: true,
    },
  } as Receipt;
}

class FakeRepository implements ExportRepository {
  agingRows: CustomerAgingRow[] = [];
  invoiceRows: Invoice[] = [];
  receiptRows: Receipt[] = [];
  company = company;
  seenAuth: AuthContext[] = [];
  pageCalls = { aging: 0, invoices: 0, receipts: 0 };

  getCompany(value: AuthContext): Promise<ExportCompany> {
    this.seenAuth.push(value);
    return Promise.resolve(this.company);
  }

  getAgingPage(
    value: AuthContext,
    _asOfDate: string,
    page: number,
    creditRating?: string,
  ): Promise<ExportPage<CustomerAgingRow>> {
    this.seenAuth.push(value);
    this.pageCalls.aging += 1;
    const filtered = creditRating
      ? this.agingRows.filter((row) => row.credit_rating === creditRating)
      : this.agingRows;
    return Promise.resolve(this.page(filtered, page));
  }

  getInvoicePage(
    value: AuthContext,
    _filters: Record<string, string>,
    page: number,
  ): Promise<ExportPage<Invoice>> {
    this.seenAuth.push(value);
    this.pageCalls.invoices += 1;
    return Promise.resolve(this.page(this.invoiceRows, page));
  }

  getReceiptPage(
    value: AuthContext,
    _filters: Record<string, string>,
    page: number,
  ): Promise<ExportPage<Receipt>> {
    this.seenAuth.push(value);
    this.pageCalls.receipts += 1;
    return Promise.resolve(this.page(this.receiptRows, page));
  }

  getCustomers(
    value: AuthContext,
    customerIds: string[],
  ): Promise<Map<string, ExportCustomerMetadata>> {
    this.seenAuth.push(value);
    return Promise.resolve(
      new Map(customerIds.map((id) => {
        const sourceIndex = Number(id.slice(-12)) - 1;
        return [id, {
          id,
          customer_code: `CUST-${id.slice(-6)}`,
          customer_name: `Customer ${id.slice(-6)}`,
          customer_status: sourceIndex % 2 === 0 ? "Active" : "On Hold",
          credit_rating: ["AAA", "AA", "A", "B", "C", "D"][sourceIndex % 6],
          credit_limit: "1000.00",
        }];
      })),
    );
  }

  getOldestDueDates(
    value: AuthContext,
    customerIds: string[],
    _asOfDate: string,
  ): Promise<Map<string, string | null>> {
    this.seenAuth.push(value);
    return Promise.resolve(
      new Map(customerIds.map((id) => [id, "2026-06-01"])),
    );
  }

  private page<T>(rows: T[], page: number): ExportPage<T> {
    const from = (page - 1) * 200;
    return { rows: rows.slice(from, from + 200), total: rows.length };
  }
}

function query(
  type: Parameters<typeof parseExportQuery>[0],
  text: string,
): ExportQuery {
  return parseExportQuery(
    type,
    new URL(`https://example.test/reports/export/${type}?${text}`),
  );
}

Deno.test("Gate C query contracts reject duplicates, paging, authority overrides, totals, and invalid enums", () => {
  const valid = query(
    "invoices",
    "date_from=2026-01-01&date_to=2026-12-31&status=Open&doc_type=Invoice&currency=USD&search=demo&sort=base_total&order=asc",
  );
  assertEquals(
    Object.entries(valid.filters).sort(),
    Object.entries({
      date_from: "2026-01-01",
      date_to: "2026-12-31",
      status: "Open",
      doc_type: "Invoice",
      currency: "USD",
      search: "demo",
    }).sort(),
  );
  assertEquals(valid.sort, { field: "base_total", order: "asc" });

  for (
    const text of [
      "as_of_date=2026-07-27&as_of_date=2026-07-26",
      "as_of_date=2026-07-27&page=1",
      "as_of_date=2026-07-27&page_size=20",
      "as_of_date=2026-07-27&cursor=x",
      `as_of_date=2026-07-27&company_id=${company.id}`,
      `as_of_date=2026-07-27&user_id=${auth.userId}`,
      "as_of_date=2026-07-27&outstanding_base_total=10",
      "as_of_date=bad",
      "as_of_date=2026-07-27&order=sideways",
      "as_of_date=2026-07-27&sort=sql",
    ]
  ) {
    let threw = false;
    try {
      query("aging", text);
    } catch {
      threw = true;
    }
    assert(threw, `Expected rejection for ${text}`);
  }
});

Deno.test("Gate C aging exports every row beyond the 1000 PostgREST boundary without duplicate or skip", async () => {
  const repository = new FakeRepository();
  repository.agingRows = Array.from(
    { length: 1_205 },
    (_, index) => agingRow(index),
  );
  const result = await new ReportExportService(repository, fixedNow)
    .exportAging(
      auth,
      query("aging", "as_of_date=2026-07-27&sort=customer_code&order=asc"),
    );
  assertEquals(result.row_count, 1_205);
  assertEquals(repository.pageCalls.aging, 7);
  assertEquals(new Set(result.rows.map((row) => row.customer_id)).size, 1_205);
  assertEquals(result.generated_at, "2026-07-27T12:34:56.000Z");
  assertEquals(result.company, company);
  assertEquals(result.filters, { as_of_date: "2026-07-27" });
  assertEquals(result.sort, { field: "customer_code", order: "asc" });
  assert(typeof result.summary.outstanding_base_total === "string");
});

Deno.test("Gate C exactly 5000 rows succeeds and traverses deterministic 200-row pages", async () => {
  const repository = new FakeRepository();
  repository.agingRows = Array.from(
    { length: 5_000 },
    (_, index) => agingRow(index),
  );
  const result = await new ReportExportService(repository, fixedNow)
    .exportAging(
      auth,
      query("aging", "as_of_date=2026-07-27"),
    );
  assertEquals(result.row_count, 5_000);
  assertEquals(repository.pageCalls.aging, 25);
  assertEquals(result.rows[0].customer_id, uuid(1, 3));
  assertEquals(result.rows[4_999].customer_id, uuid(5_000, 3));
});

Deno.test("Gate C every approved sort executes and equal primary values retain an ascending ID tie-breaker", async () => {
  const repository = new FakeRepository();
  repository.agingRows = [agingRow(2), agingRow(0), agingRow(1)];
  repository.invoiceRows = [invoiceRow(2), invoiceRow(0), invoiceRow(1)];
  repository.receiptRows = [receiptRow(2), receiptRow(0), receiptRow(1)];
  const service = new ReportExportService(repository, fixedNow);

  for (
    const sort of [
      "customer_code",
      "customer_name",
      "outstanding_base",
      "overdue_base",
    ]
  ) {
    for (const order of ["asc", "desc"]) {
      const result = await service.exportAging(
        auth,
        query(
          "aging",
          `as_of_date=2026-07-27&sort=${sort}&order=${order}`,
        ),
      );
      assertEquals(result.row_count, 3);
    }
  }

  for (
    const sort of [
      "invoice_date",
      "invoice_no",
      "customer_name",
      "total_amount",
      "base_total",
      "outstanding",
    ]
  ) {
    for (const order of ["asc", "desc"]) {
      const result = await service.exportInvoices(
        auth,
        query("invoices", `sort=${sort}&order=${order}`),
      );
      assertEquals(result.row_count, 3);
    }
  }

  for (
    const sort of [
      "receipt_date",
      "receipt_no",
      "customer_name",
      "receipt_amount",
      "base_amount",
      "unallocated_amount",
    ]
  ) {
    for (const order of ["asc", "desc"]) {
      const result = await service.exportReceipts(
        auth,
        query("receipts", `sort=${sort}&order=${order}`),
      );
      assertEquals(result.row_count, 3);
    }
  }

  for (
    const sort of [
      "customer_code",
      "customer_name",
      "outstanding_base",
      "overdue_base",
    ]
  ) {
    for (const order of ["asc", "desc"]) {
      const result = await service.exportCustomerOutstanding(
        auth,
        query(
          "customer-outstanding",
          `as_of_date=2026-07-27&sort=${sort}&order=${order}`,
        ),
      );
      assertEquals(result.row_count, 3);
    }
  }

  const agingTie = await service.exportAging(
    auth,
    query(
      "aging",
      "as_of_date=2026-07-27&sort=overdue_base&order=desc",
    ),
  );
  assertEquals(
    agingTie.rows.map((row) => row.customer_id),
    [uuid(1, 3), uuid(2, 3), uuid(3, 3)],
  );
  const invoiceTie = await service.exportInvoices(
    auth,
    query("invoices", "sort=invoice_date&order=desc"),
  );
  assertEquals(
    invoiceTie.rows.map((row) => row.invoice_id),
    [uuid(1, 4), uuid(2, 4), uuid(3, 4)],
  );
  const receiptTie = await service.exportReceipts(
    auth,
    query("receipts", "sort=receipt_date&order=desc"),
  );
  assertEquals(
    receiptTie.rows.map((row) => row.receipt_id),
    [uuid(1, 5), uuid(2, 5), uuid(3, 5)],
  );
});

Deno.test("Gate C Invoice, Receipt, and Customer Outstanding exports also traverse more than 1000 matching rows", async () => {
  const repository = new FakeRepository();
  repository.agingRows = Array.from(
    { length: 1_205 },
    (_, index) => agingRow(index),
  );
  repository.invoiceRows = Array.from(
    { length: 1_205 },
    (_, index) => invoiceRow(index),
  );
  repository.receiptRows = Array.from(
    { length: 1_205 },
    (_, index) => receiptRow(index),
  );
  const service = new ReportExportService(repository, fixedNow);
  const [invoices, receipts, outstanding] = await Promise.all([
    service.exportInvoices(auth, query("invoices", "")),
    service.exportReceipts(auth, query("receipts", "")),
    service.exportCustomerOutstanding(
      auth,
      query("customer-outstanding", "as_of_date=2026-07-27"),
    ),
  ]);
  assertEquals(invoices.row_count, 1_205);
  assertEquals(receipts.row_count, 1_205);
  assertEquals(outstanding.row_count, 1_205);
  assertEquals(new Set(invoices.rows.map((row) => row.invoice_id)).size, 1_205);
  assertEquals(new Set(receipts.rows.map((row) => row.receipt_id)).size, 1_205);
  assertEquals(
    new Set(outstanding.rows.map((row) => row.customer_id)).size,
    1_205,
  );
  assertEquals(repository.pageCalls.invoices, 7);
  assertEquals(repository.pageCalls.receipts, 7);
  assertEquals(repository.pageCalls.aging, 7);
});

Deno.test("Gate C 5001 matching rows returns the exact controlled oversize contract", async () => {
  const repository = new FakeRepository();
  repository.agingRows = Array.from(
    { length: 5_001 },
    (_, index) => agingRow(index),
  );
  const error = await rejects(
    () =>
      new ReportExportService(repository, fixedNow).exportAging(
        auth,
        query("aging", "as_of_date=2026-07-27"),
      ),
    "exceeds the export limit",
  );
  assert(error instanceof ExportDatasetTooLargeError);
  assertEquals(error.status, 422);
  assertEquals(error.details, {
    row_limit: 5_000,
    payload_limit_bytes: 8_388_608,
    estimated_rows: 5_001,
  });
});

Deno.test("Gate C payload limit measures UTF-8 bytes and accepts a bounded near-limit envelope", () => {
  const base: ExportDataset = {
    schema_version: 1,
    report_type: "aging",
    generated_at: "2026-07-27T12:34:56.000Z",
    company,
    filters: { as_of_date: "2026-07-27" },
    sort: { field: "customer_code", order: "asc" },
    row_count: 0,
    summary: { note: "a".repeat(8_000_000) },
    rows: [],
  };
  assert(serializedUtf8Bytes({ data: base }) < EXPORT_PAYLOAD_LIMIT_BYTES);
  enforcePayloadLimit(base);
  const multibyte = { ...base, summary: { note: "界".repeat(2_800_000) } };
  assert(serializedUtf8Bytes({ data: multibyte }) > EXPORT_PAYLOAD_LIMIT_BYTES);
  let threw = false;
  try {
    enforcePayloadLimit(multibyte);
  } catch (error) {
    threw = error instanceof ExportDatasetTooLargeError;
  }
  assert(threw, "Expected UTF-8 payload overflow");
});

Deno.test("Gate C Invoice export preserves booked snapshots, exact balance math, filter, ordering, and breakdowns", async () => {
  const repository = new FakeRepository();
  repository.invoiceRows = Array.from(
    { length: 1_001 },
    (_, index) => invoiceRow(index),
  );
  const result = await new ReportExportService(repository, fixedNow)
    .exportInvoices(
      auth,
      query("invoices", "currency=USD&sort=base_total&order=desc"),
    );
  assertEquals(result.row_count, 500);
  assertEquals(repository.pageCalls.invoices, 6);
  assert(result.rows.every((row) => row.currency === "USD"));
  assert(result.rows.every((row) => row.base_total === "42.50"));
  assert(result.rows.every((row) => row.outstanding_base === "25.50"));
  assert(result.rows.every((row) => row.booked_exchange_rate === "4.25"));
  assertEquals(result.summary.document_base_total, "21250.00");
  assertEquals(result.summary.outstanding_base_total, "12750.00");
  assert(Array.isArray(result.summary.status_breakdown));
  assert(Array.isArray(result.summary.doc_type_breakdown));
});

Deno.test("Gate C Receipt export reconciles native allocation and immutable booked-rate base balances", async () => {
  const repository = new FakeRepository();
  repository.receiptRows = [receiptRow(0), receiptRow(1)];
  const result = await new ReportExportService(repository, fixedNow)
    .exportReceipts(
      auth,
      query("receipts", "sort=receipt_no&order=asc"),
    );
  assertEquals(result.row_count, 2);
  assertEquals(result.summary.receipt_base_total, "52.50");
  assertEquals(result.summary.unallocated_base_total, "31.50");
  assertEquals(result.summary.allocated_base_total, "21.00");
  assert(result.rows.every((row) => row.allocated_amount_native === "4.00"));
  assert(Array.isArray(result.summary.payment_method_breakdown));
});

Deno.test("Gate C Customer Outstanding filters rating/status and returns oldest due and exact totals", async () => {
  const repository = new FakeRepository();
  repository.agingRows = Array.from(
    { length: 12 },
    (_, index) => agingRow(index),
  );
  const result = await new ReportExportService(repository, fixedNow)
    .exportCustomerOutstanding(
      auth,
      query(
        "customer-outstanding",
        "as_of_date=2026-07-27&credit_rating=A&customer_status=Active&sort=overdue_base&order=desc",
      ),
    );
  assert(result.rows.every((row) => row.credit_rating === "A"));
  assert(result.rows.every((row) => row.customer_status === "Active"));
  assert(result.rows.every((row) => row.oldest_due_date === "2026-06-01"));
  assertEquals(
    result.summary.credit_limit_total,
    `${result.row_count * 1000}.00`,
  );
});

Deno.test("Gate C empty authorized result returns valid zero summaries for all four routes", async () => {
  const repository = new FakeRepository();
  const service = new ReportExportService(repository, fixedNow);
  const results = await Promise.all([
    service.exportAging(auth, query("aging", "as_of_date=2026-07-27")),
    service.exportInvoices(auth, query("invoices", "")),
    service.exportReceipts(auth, query("receipts", "")),
    service.exportCustomerOutstanding(
      auth,
      query("customer-outstanding", "as_of_date=2026-07-27"),
    ),
  ]);
  for (const result of results) {
    assertEquals(result.row_count, 0);
    assertEquals(result.rows, []);
    assertEquals(result.company, company);
  }
  assertEquals(results[0].summary.outstanding_base_total, "0.00");
  assertEquals(results[1].summary.document_base_total, "0.00");
  assertEquals(results[2].summary.receipt_base_total, "0.00");
  assertEquals(results[3].summary.credit_limit_total, "0.00");
});

Deno.test("Gate C role and tenant authority fail before export data can cross context", async () => {
  const repository = new FakeRepository();
  repository.agingRows = [agingRow(0)];
  await rejects(
    () =>
      new ReportExportService(repository, fixedNow).exportAging(
        unauthorized,
        query("aging", "as_of_date=2026-07-27"),
      ),
    "requires one of",
  );
  repository.company = { ...company, id: uuid(2, 1) };
  await rejects(
    () =>
      new ReportExportService(repository, fixedNow).exportAging(
        auth,
        query("aging", "as_of_date=2026-07-27"),
      ),
    "metadata is malformed",
  );
});

Deno.test("Gate C malformed authoritative totals and duplicate traversal fail closed", async () => {
  const malformed = new FakeRepository();
  malformed.getAgingPage = () =>
    Promise.resolve({ rows: [agingRow(0)], total: Number.NaN });
  await rejects(
    () =>
      new ReportExportService(malformed, fixedNow).exportAging(
        auth,
        query("aging", "as_of_date=2026-07-27"),
      ),
    "Malformed authoritative integer",
  );

  const duplicate = new FakeRepository();
  duplicate.agingRows = Array.from(
    { length: 201 },
    (_, index) => agingRow(index),
  );
  duplicate.getAgingPage = (_auth, _date, page) => {
    const rows = page === 1
      ? duplicate.agingRows.slice(0, 200)
      : [duplicate.agingRows[0]];
    return Promise.resolve({ rows, total: 201 });
  };
  await rejects(
    () =>
      new ReportExportService(duplicate, fixedNow).exportAging(
        auth,
        query("aging", "as_of_date=2026-07-27"),
      ),
    "duplicate row",
  );
});

Deno.test("Gate C handler exposes exact four GET routes, trailing slash, safe errors, and no alternate write route", async () => {
  const dataset: ExportDataset = {
    schema_version: 1,
    report_type: "aging",
    generated_at: "2026-07-27T12:34:56.000Z",
    company,
    filters: { as_of_date: "2026-07-27" },
    sort: { field: "customer_code", order: "asc" },
    row_count: 0,
    summary: {},
    rows: [],
  };
  const service: ReportExportServiceContract = {
    exportAging: () => Promise.resolve(dataset),
    exportInvoices: () =>
      Promise.resolve({ ...dataset, report_type: "invoices" }),
    exportReceipts: () =>
      Promise.resolve({ ...dataset, report_type: "receipts" }),
    exportCustomerOutstanding: () =>
      Promise.resolve({ ...dataset, report_type: "customer-outstanding" }),
  };
  for (
    const path of [
      "/export/aging/",
      "/export/invoices",
      "/export/receipts",
      "/export/customer-outstanding",
    ]
  ) {
    const response = await handleReportExportRequest(
      new Request(
        `https://example.test/reports${path}?${
          path.includes("aging") || path.includes("outstanding")
            ? "as_of_date=2026-07-27"
            : ""
        }`,
      ),
      auth,
      service,
      path,
    );
    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert("data" in body);
    assert(!("success" in body));
  }

  const post = await handleReportExportRequest(
    new Request(
      "https://example.test/reports/export/aging?as_of_date=2026-07-27",
      {
        method: "POST",
      },
    ),
    auth,
    service,
    "/export/aging",
  );
  assertEquals(post.status, 405);
  const unknown = await handleReportExportRequest(
    new Request("https://example.test/reports/export/other"),
    auth,
    service,
    "/export/other",
  );
  assertEquals(unknown.status, 404);
});

Deno.test("Gate C handler returns exact oversize envelope with no partial rows or internal detail", async () => {
  const failing = () => Promise.reject(new ExportDatasetTooLargeError(5_001));
  const service: ReportExportServiceContract = {
    exportAging: failing,
    exportInvoices: failing,
    exportReceipts: failing,
    exportCustomerOutstanding: failing,
  };
  const response = await handleReportExportRequest(
    new Request(
      "https://example.test/reports/export/aging?as_of_date=2026-07-27",
    ),
    auth,
    service,
    "/export/aging",
  );
  assertEquals(response.status, 422);
  assertEquals(await response.json(), {
    error: {
      code: "EXPORT_DATASET_TOO_LARGE",
      message: EXPORT_OVERSIZE_MESSAGE,
      details: {
        row_limit: 5_000,
        payload_limit_bytes: 8_388_608,
        estimated_rows: 5_001,
      },
    },
  });
});

Deno.test("Gate C handler sanitizes malformed repository failures without SQL, schema, or stack leakage", async () => {
  const failing = () =>
    Promise.reject(
      new Error(
        "relation private_financial_export does not exist; SELECT * FROM secrets",
      ),
    );
  const service: ReportExportServiceContract = {
    exportAging: failing,
    exportInvoices: failing,
    exportReceipts: failing,
    exportCustomerOutstanding: failing,
  };
  const response = await handleReportExportRequest(
    new Request(
      "https://example.test/reports/export/aging?as_of_date=2026-07-27",
    ),
    auth,
    service,
    "/export/aging",
  );
  assertEquals(response.status, 500);
  const body = JSON.stringify(await response.json());
  assert(!body.includes("private_financial_export"));
  assert(!body.includes("SELECT"));
  assert(!body.includes("secrets"));
  assert(!body.includes("stack"));
});

Deno.test("Gate C source contains no migration, write route, dynamic SQL, cron, or client total authority", async () => {
  const files = await Promise.all([
    Deno.readTextFile(new URL("./reports/export-contract.ts", import.meta.url)),
    Deno.readTextFile(
      new URL("./reports/export-repository.ts", import.meta.url),
    ),
    Deno.readTextFile(new URL("./reports/export-service.ts", import.meta.url)),
    Deno.readTextFile(new URL("./reports/export-handler.ts", import.meta.url)),
  ]);
  const source = files.join("\n");
  for (
    const forbidden of [
      ".insert(",
      ".update(",
      ".delete(",
      ".upsert(",
      "cron.schedule",
      "overdue_ar",
      "service_role",
      "base_total=",
      "base_amount=",
    ]
  ) {
    assert(
      !source.includes(forbidden),
      `Forbidden Gate C source fragment: ${forbidden}`,
    );
  }
});

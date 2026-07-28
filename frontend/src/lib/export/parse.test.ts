import { describe, expect, it } from "vitest";
import { ExportParseError, parseExportDataset } from "./parse";
import { ALL_REPORT_TYPES, buildRawExport } from "./test/export-fixtures";

describe("parseExportDataset", () => {
  it("accepts a valid envelope for all four reports", () => {
    for (const type of ALL_REPORT_TYPES) {
      const dataset = parseExportDataset(type, buildRawExport(type, { count: 3 }));
      expect(dataset.report_type).toBe(type);
      expect(dataset.row_count).toBe(3);
      expect(dataset.rows).toHaveLength(3);
      expect(dataset.company.base_currency).toBe("MYR");
      expect(dataset.summary.base_currency).toBe("MYR");
      expect(dataset.generated_at).toBe("2026-07-27T12:34:56.000Z");
    }
  });

  it("accepts an empty (zero-row) authorized result", () => {
    const dataset = parseExportDataset("aging", buildRawExport("aging", { count: 0 }));
    expect(dataset.row_count).toBe(0);
    expect(dataset.rows).toEqual([]);
  });

  it("rejects an unsupported schema version", () => {
    const raw = { ...buildRawExport("aging"), schema_version: 2 };
    expect(() => parseExportDataset("aging", raw)).toThrow(ExportParseError);
  });

  it("rejects a report_type mismatch", () => {
    expect(() => parseExportDataset("invoices", buildRawExport("aging"))).toThrow(
      ExportParseError,
    );
  });

  it("rejects malformed company metadata", () => {
    const raw = buildRawExport("aging") as Record<string, unknown>;
    raw.company = { id: "x", name: "", base_currency: "MYR", timezone: "" };
    expect(() => parseExportDataset("aging", raw)).toThrow(ExportParseError);
  });

  it("rejects a non-UUID company id and invalid IANA timezone", () => {
    const badId = buildRawExport("aging") as {
      company: Record<string, unknown>;
    };
    badId.company.id = "company-1";
    expect(() => parseExportDataset("aging", badId)).toThrow(/company\.id/i);

    const badTimezone = buildRawExport("aging") as {
      company: Record<string, unknown>;
    };
    badTimezone.company.timezone = "Not/A_Timezone";
    expect(() => parseExportDataset("aging", badTimezone)).toThrow(/timezone/i);
  });

  it("accepts canonical PostgreSQL UUIDs without RFC version or variant bits", () => {
    const raw = buildRawExport("aging") as {
      company: Record<string, unknown>;
      rows: Record<string, unknown>[];
    };
    raw.company.id = "00000000-0000-0000-0000-000000000001";
    raw.rows[0].customer_id = "00000000-0000-0000-0000-000000000002";

    const dataset = parseExportDataset("aging", raw);

    expect(dataset.company.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(dataset.rows[0].customer_id).toBe(
      "00000000-0000-0000-0000-000000000002",
    );
  });

  it("rejects a non-ISO generated_at", () => {
    const raw = { ...buildRawExport("aging"), generated_at: "2026-07-27 12:00" };
    expect(() => parseExportDataset("aging", raw)).toThrow(ExportParseError);
  });

  it("rejects a malformed monetary decimal string", () => {
    const raw = buildRawExport("aging") as { rows: Record<string, unknown>[] };
    raw.rows[0].outstanding_base = "200.5";
    expect(() => parseExportDataset("aging", raw)).toThrow(/money field/i);
  });

  it("rejects a row_count that disagrees with rows", () => {
    const raw = { ...buildRawExport("aging"), row_count: 99 };
    expect(() => parseExportDataset("aging", raw)).toThrow(/row_count/i);
  });

  it("rejects a dataset above the backend's 5,000-row ceiling", () => {
    const raw = buildRawExport("aging", { count: 5001 });
    expect(() => parseExportDataset("aging", raw)).toThrow(/dataset limit/i);
  });

  it("rejects an unsupported enum value", () => {
    const raw = buildRawExport("aging") as { rows: Record<string, unknown>[] };
    raw.rows[0].credit_rating = "ZZZ";
    expect(() => parseExportDataset("aging", raw)).toThrow(/enum field/i);
  });

  it("rejects a malformed date", () => {
    const raw = buildRawExport("invoices") as { rows: Record<string, unknown>[] };
    raw.rows[0].invoice_date = "2026/07/01";
    expect(() => parseExportDataset("invoices", raw)).toThrow(/date field/i);
  });

  it("rejects an impossible calendar date", () => {
    const raw = buildRawExport("invoices") as { rows: Record<string, unknown>[] };
    raw.rows[0].invoice_date = "2026-02-31";
    expect(() => parseExportDataset("invoices", raw)).toThrow(/date field/i);
  });

  it("rejects a malformed id", () => {
    const raw = buildRawExport("invoices") as { rows: Record<string, unknown>[] };
    raw.rows[0].invoice_id = "not-a-uuid";
    expect(() => parseExportDataset("invoices", raw)).toThrow(/id field/i);
  });

  it("rejects a summary base currency that disagrees with the company", () => {
    const raw = buildRawExport("aging") as { summary: Record<string, unknown> };
    raw.summary.base_currency = "USD";
    expect(() => parseExportDataset("aging", raw)).toThrow(/base currency/i);
  });

  it("rejects a missing summary total", () => {
    const raw = buildRawExport("aging") as { summary: Record<string, unknown> };
    delete raw.summary.overdue_base_total;
    expect(() => parseExportDataset("aging", raw)).toThrow(ExportParseError);
  });

  it("rejects unsupported top-level, row and summary members", () => {
    const top = buildRawExport("aging");
    top.internal_sql = "secret";
    expect(() => parseExportDataset("aging", top)).toThrow(/unsupported member/i);

    const row = buildRawExport("aging") as { rows: Record<string, unknown>[] };
    row.rows[0].company_id = "forged";
    expect(() => parseExportDataset("aging", row)).toThrow(/unsupported member/i);

    const summary = buildRawExport("aging") as { summary: Record<string, unknown> };
    summary.summary.relation_name = "private.table";
    expect(() => parseExportDataset("aging", summary)).toThrow(/unsupported member/i);
  });

  it("rejects unsupported filters, malformed filter values and sort fields", () => {
    const unknown = buildRawExport("aging") as {
      filters: Record<string, unknown>;
    };
    unknown.filters.page = "2";
    expect(() => parseExportDataset("aging", unknown)).toThrow(/filter "page"/i);

    const invalidDate = buildRawExport("aging") as {
      filters: Record<string, unknown>;
    };
    invalidDate.filters.as_of_date = "2026-02-31";
    expect(() => parseExportDataset("aging", invalidDate)).toThrow(/date field/i);

    const invalidSort = buildRawExport("aging") as {
      sort: Record<string, unknown>;
    };
    invalidSort.sort.field = "company_id";
    expect(() => parseExportDataset("aging", invalidSort)).toThrow(/sort field/i);
  });

  it("requires exact backend row authority fields and matching base currency", () => {
    const missingCustomer = buildRawExport("invoices") as {
      rows: Record<string, unknown>[];
    };
    delete missingCustomer.rows[0].customer_id;
    expect(() => parseExportDataset("invoices", missingCustomer)).toThrow(/required member/i);

    const wrongBase = buildRawExport("receipts") as {
      rows: Record<string, unknown>[];
    };
    wrongBase.rows[0].base_currency = "USD";
    expect(() => parseExportDataset("receipts", wrongBase)).toThrow(/base currency/i);
  });

  it("rejects duplicate stable IDs and summary/breakdown count mismatches", () => {
    const duplicate = buildRawExport("aging") as {
      rows: Record<string, unknown>[];
    };
    duplicate.rows[1].customer_id = duplicate.rows[0].customer_id;
    expect(() => parseExportDataset("aging", duplicate)).toThrow(/duplicate/i);

    const badCount = buildRawExport("invoices") as {
      summary: Record<string, unknown>;
    };
    badCount.summary.document_count = 2;
    expect(() => parseExportDataset("invoices", badCount)).toThrow(/summary count/i);
  });

  it("rejects a malformed breakdown row", () => {
    const raw = buildRawExport("invoices") as {
      summary: { status_breakdown: Record<string, unknown>[] };
    };
    raw.summary.status_breakdown[0].base_total_total = "oops";
    expect(() => parseExportDataset("invoices", raw)).toThrow(ExportParseError);
  });

  it("preserves nullable fields (fx + oldest_due_date) as null", () => {
    const invoices = parseExportDataset("invoices", buildRawExport("invoices", { count: 5 }));
    expect(invoices.rows.some((r) => r.fx_source_category === null)).toBe(true);
    const outstanding = parseExportDataset(
      "customer-outstanding",
      buildRawExport("customer-outstanding", { count: 6 }),
    );
    expect(outstanding.rows.some((r) => r.oldest_due_date === null)).toBe(true);
  });
});

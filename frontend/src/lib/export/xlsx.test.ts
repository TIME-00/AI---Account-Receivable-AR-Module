import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { generateReportXlsx } from "./xlsx";
import { parseExportDataset } from "./parse";
import { ALL_REPORT_TYPES, buildRawExport } from "./test/export-fixtures";

async function loadWorkbook(blob: Blob): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

function headerIndex(ws: ExcelJS.Worksheet, header: string): number {
  const values = ws.getRow(1).values as (string | undefined)[];
  return values.findIndex((v) => v === header);
}

describe("generateReportXlsx", () => {
  it("produces a valid, non-empty XLSX for every populated report", async () => {
    for (const type of ALL_REPORT_TYPES) {
      const dataset = parseExportDataset(type, buildRawExport(type, { count: 4 }));
      const blob = await generateReportXlsx(dataset);
      expect(blob.type).toContain("spreadsheetml");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(String.fromCharCode(...bytes.slice(0, 2))).toBe("PK");

      const wb = await loadWorkbook(blob);
      expect(wb.getWorksheet("Report")).toBeTruthy();
      expect(wb.getWorksheet("Summary")).toBeTruthy();
      expect(wb.getWorksheet("Info")).toBeTruthy();
      const report = wb.getWorksheet("Report")!;
      // Header row + 4 data rows.
      expect(report.rowCount).toBe(5);
    }
  }, 20000);

  it("freezes the header row and sets an autofilter", async () => {
    const dataset = parseExportDataset("aging", buildRawExport("aging", { count: 2 }));
    const wb = await loadWorkbook(await generateReportXlsx(dataset));
    const report = wb.getWorksheet("Report")!;
    const view = report.views?.[0] as { state?: string; ySplit?: number } | undefined;
    expect(view?.state).toBe("frozen");
    expect(view?.ySplit).toBe(1);
    expect(report.autoFilter).toBeTruthy();
  }, 20000);

  it("preserves monetary values as EXACT decimal strings (no float)", async () => {
    const raw = buildRawExport("aging", { count: 4 }) as {
      rows: Record<string, unknown>[];
    };
    for (const [index, value] of [
      "0.01",
      "0.10",
      "999999999999.99",
      "-1234.56",
    ].entries()) {
      raw.rows[index].outstanding_base = value;
    }
    const dataset = parseExportDataset("aging", raw);
    const wb = await loadWorkbook(await generateReportXlsx(dataset));
    const report = wb.getWorksheet("Report")!;
    const col = headerIndex(report, "Total Outstanding");
    expect([2, 3, 4, 5].map((row) => report.getRow(row).getCell(col).value)).toEqual([
      "0.01",
      "0.10",
      "999999999999.99",
      "-1234.56",
    ]);
    for (let row = 2; row <= 5; row += 1) {
      expect(typeof report.getRow(row).getCell(col).value).toBe("string");
      expect(report.getRow(row).getCell(col).type).not.toBe(ExcelJS.ValueType.Formula);
    }
  }, 20000);

  it("keeps native and base currency columns distinct for invoices", async () => {
    const dataset = parseExportDataset("invoices", buildRawExport("invoices", { count: 2 }));
    const wb = await loadWorkbook(await generateReportXlsx(dataset));
    const report = wb.getWorksheet("Report")!;
    expect(headerIndex(report, "Native Total")).toBeGreaterThan(0);
    expect(headerIndex(report, "Base Total")).toBeGreaterThan(0);
    expect(headerIndex(report, "Booked Rate")).toBeGreaterThan(0);
  }, 20000);

  it("neutralizes spreadsheet-injection strings so they stay inert text", async () => {
    const dangerous = [
      '=HYPERLINK("http://evil","x")',
      "+SUM(1,1)",
      "-2+3",
      "@SUM(1,1)",
      "\t=CMD()",
      "\r=CMD()",
      "\n=CMD()",
      '  =HYPERLINK("http://evil","x")',
    ];
    const raw = buildRawExport("invoices", { count: dangerous.length }) as {
      company: Record<string, unknown>;
      filters: Record<string, unknown>;
      rows: Record<string, unknown>[];
    };
    raw.company.name = '=HYPERLINK("http://evil/company","x")';
    raw.filters.search = '=HYPERLINK("http://evil/filter","x")';
    dangerous.forEach((value, index) => {
      raw.rows[index].customer_name = value;
      raw.rows[index].customer_code = value;
      raw.rows[index].invoice_no = value;
    });
    const dataset = parseExportDataset("invoices", raw);
    const wb = await loadWorkbook(await generateReportXlsx(dataset));
    const report = wb.getWorksheet("Report")!;
    for (const header of ["Customer", "Cust Code", "Invoice No"]) {
      const col = headerIndex(report, header);
      dangerous.forEach((_, index) => {
        const cell = report.getRow(index + 2).getCell(col);
        expect(typeof cell.value).toBe("string");
        expect(String(cell.value).startsWith("'")).toBe(true);
      });
    }
    for (const ws of wb.worksheets) {
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
          expect((cell as { formula?: string }).formula).toBeUndefined();
          expect((cell as { hyperlink?: string }).hyperlink).toBeUndefined();
        })
      );
    }
    const workbookText = JSON.stringify(
      wb.worksheets.map((sheet) => sheet.getSheetValues()),
    );
    expect(workbookText).toContain(
      '\'=HYPERLINK(\\"http://evil/company\\",\\"x\\")',
    );
    expect(workbookText).toContain(
      '\'=HYPERLINK(\\"http://evil/filter\\",\\"x\\")',
    );
  }, 20000);

  it("includes authoritative summary and filter metadata", async () => {
    const dataset = parseExportDataset("invoices", buildRawExport("invoices", { count: 3 }));
    const wb = await loadWorkbook(await generateReportXlsx(dataset));
    const info = JSON.stringify(wb.getWorksheet("Info")!.getSheetValues());
    expect(info).toContain("TSH Synergy Demo Sdn Bhd");
    expect(info).toContain("2026-07-01");
    const summary = JSON.stringify(wb.getWorksheet("Summary")!.getSheetValues());
    expect(summary).toContain("95.00");
  }, 20000);

  it("produces a valid workbook for an empty report", async () => {
    const dataset = parseExportDataset("receipts", buildRawExport("receipts", { count: 0 }));
    const wb = await loadWorkbook(await generateReportXlsx(dataset));
    expect(wb.getWorksheet("Report")!.rowCount).toBe(1); // header only
  }, 20000);

  it("round-trips exactly 5,000 rows without omission", async () => {
    const dataset = parseExportDataset(
      "aging",
      buildRawExport("aging", { count: 5_000 }),
    );
    const wb = await loadWorkbook(await generateReportXlsx(dataset));
    const report = wb.getWorksheet("Report")!;
    expect(report.rowCount).toBe(5_001);
    const codeColumn = headerIndex(report, "Code");
    expect(report.getRow(2).getCell(codeColumn).value).toBe("CUST-00000");
    expect(report.getRow(5_001).getCell(codeColumn).value).toBe("CUST-04999");
  }, 120000);
});

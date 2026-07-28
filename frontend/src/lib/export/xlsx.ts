// ============================================================================
// TSH Synergy AR — Gate C report export: client-side XLSX generation
//
// Monetary and rate values are written as their EXACT backend decimal strings
// (never parsed through a JS float), so no rounding is introduced. Every
// source-controlled text value (names, codes, numbers, filter text, metadata)
// is neutralized so it can never be interpreted as a spreadsheet formula.
// Summaries are taken verbatim from the backend — never an Excel formula over
// the visible rows. exceljs is imported dynamically to stay out of the bundle.
// ============================================================================

import type ExcelJS from "exceljs";
import type { ExportDataset } from "./types";
import { displayFields, type FieldSpec, REPORT_SPECS } from "./schema";
import { neutralizeSpreadsheetText } from "./format";
import { appliedFilters, formatGeneratedAt, sortLabel } from "./meta";
import { ExportGenerationError } from "./errors";

type Worksheet = ExcelJS.Worksheet;
type Workbook = ExcelJS.Workbook;

let excelPromise: Promise<typeof ExcelJS> | null = null;

async function loadExcel(): Promise<typeof ExcelJS> {
  if (!excelPromise) {
    excelPromise = import("exceljs")
      .then((mod) => (mod as { default?: typeof ExcelJS }).default ?? (mod as unknown as typeof ExcelJS))
      .catch((error) => {
        excelPromise = null;
        throw error;
      });
  }
  return excelPromise;
}

const HEADER_FILL = "FFF1F5F9";
const HEADER_FONT = "FF334155";

/** exceljs forbids \ / ? * [ ] : in sheet names and caps them at 31 chars. */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || "Sheet").slice(0, 31);
}

function isMoneyOrRate(spec: FieldSpec): boolean {
  return spec.kind === "money" || spec.kind === "rate";
}

/** Column width heuristic (character units) from header and value kind. */
function columnWidth(spec: FieldSpec): number {
  if (spec.key.endsWith("name")) return 30;
  if (spec.kind === "money" || spec.kind === "rate") return 16;
  if (spec.kind === "date" || spec.kind === "date_null") return 13;
  if (spec.key === "currency") return 7;
  return Math.max(10, (spec.header?.length ?? 8) + 2);
}

function styleHeaderRow(ws: Worksheet, columnCount: number): void {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: HEADER_FONT } };
  header.alignment = { vertical: "middle", wrapText: true };
  for (let col = 1; col <= columnCount; col += 1) {
    header.getCell(col).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
  }
  header.commit?.();
}

function buildReportSheet(wb: Workbook, dataset: ExportDataset): void {
  const fields = displayFields(dataset.report_type);
  const ws = wb.addWorksheet(safeSheetName("Report"), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = fields.map((f) => ({
    header: f.header ?? f.key,
    key: f.key,
    width: columnWidth(f),
  }));

  for (const row of dataset.rows) {
    const excelRow = ws.addRow(
      Object.fromEntries(
        fields.map((f) => {
          const value = row[f.key];
          if (value === null) return [f.key, "—"];
          // Money/rate are strict validated decimal strings — safe as exact
          // text (no float), and never a formula-injection vector.
          if (isMoneyOrRate(f)) return [f.key, value];
          return [f.key, neutralizeSpreadsheetText(value)];
        }),
      ),
    );
    fields.forEach((f, index) => {
      if (f.align === "right") {
        excelRow.getCell(index + 1).alignment = { horizontal: "right" };
      }
    });
  }

  styleHeaderRow(ws, fields.length);
  if (fields.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: fields.length },
    };
  }
}

function appendKeyValueTable(
  ws: Worksheet,
  title: string,
  pairs: { label: string; value: string }[],
): void {
  ws.addRow([]);
  const titleRow = ws.addRow([title]);
  titleRow.font = { bold: true };
  for (const pair of pairs) {
    ws.addRow([
      neutralizeSpreadsheetText(pair.label),
      neutralizeSpreadsheetText(pair.value),
    ]);
  }
}

function buildSummarySheet(wb: Workbook, dataset: ExportDataset): void {
  const spec = REPORT_SPECS[dataset.report_type];
  const ws = wb.addWorksheet(safeSheetName("Summary"));
  ws.columns = [{ width: 34 }, { width: 20 }, { width: 20 }, { width: 20 }];

  const totals: { label: string; value: string }[] = [
    ...spec.summaryCounts.map((c) => ({
      label: c.label,
      value: String(dataset.summary.counts[c.key] ?? 0),
    })),
    ...spec.summaryTotals.map((t) => ({
      label: `${t.label} (${dataset.summary.base_currency})`,
      value: dataset.summary.totals[t.key] ?? "—",
    })),
  ];
  appendKeyValueTable(ws, "Authoritative summary", totals);

  if (dataset.summary.native_by_currency.length > 0) {
    ws.addRow([]);
    const heading = ws.addRow(["By transaction currency", "Rows", "Native total", "Base total"]);
    heading.font = { bold: true };
    for (const c of dataset.summary.native_by_currency) {
      ws.addRow([
        neutralizeSpreadsheetText(c.currency),
        c.row_count,
        c.native_total,
        c.base_total,
      ]);
    }
  }

  for (const breakdown of spec.breakdowns) {
    const rows = dataset.summary.breakdowns[breakdown.sourceKey] ?? [];
    if (rows.length === 0) continue;
    ws.addRow([]);
    const heading = ws.addRow([
      breakdown.title,
      "Count",
      ...breakdown.totals.map((t) => `${t.label} (${dataset.summary.base_currency})`),
    ]);
    heading.font = { bold: true };
    for (const r of rows) {
      ws.addRow([
        neutralizeSpreadsheetText(r.key),
        r.count,
        ...breakdown.totals.map((t) => r.totals[t.key] ?? "—"),
      ]);
    }
  }
}

function buildInfoSheet(wb: Workbook, dataset: ExportDataset): void {
  const spec = REPORT_SPECS[dataset.report_type];
  const ws = wb.addWorksheet(safeSheetName("Info"));
  ws.columns = [{ width: 22 }, { width: 60 }];

  appendKeyValueTable(ws, "Report", [
    { label: "Report", value: spec.title },
    { label: "Company", value: dataset.company.name },
    { label: "Base currency", value: dataset.company.base_currency },
    { label: "Timezone", value: dataset.company.timezone },
    { label: "Generated", value: formatGeneratedAt(dataset) },
    { label: "Sort", value: sortLabel(dataset) },
    { label: "Record count", value: String(dataset.row_count) },
  ]);

  const filters = appliedFilters(dataset);
  appendKeyValueTable(
    ws,
    "Applied filters",
    filters.length > 0 ? filters : [{ label: "Filters", value: "none" }],
  );

  ws.addRow([]);
  ws.addRow([
    "Note",
    "All monetary values are authoritative company figures supplied by the backend export contract. Totals are not recomputed in the spreadsheet.",
  ]);
}

/** Generate an XLSX Blob for the report. Rejects with ExportGenerationError on failure. */
export async function generateReportXlsx(dataset: ExportDataset): Promise<Blob> {
  try {
    const Excel = await loadExcel();
    const wb = new Excel.Workbook();
    wb.creator = "TSH Synergy AR";
    wb.created = new Date(dataset.generated_at);

    buildReportSheet(wb, dataset);
    buildSummarySheet(wb, dataset);
    buildInfoSheet(wb, dataset);

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    if (blob.size === 0) throw new ExportGenerationError();
    return blob;
  } catch (error) {
    if (error instanceof ExportGenerationError) throw error;
    throw new ExportGenerationError();
  }
}

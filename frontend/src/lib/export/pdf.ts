// ============================================================================
// TSH Synergy AR — Gate C report export: client-side PDF generation
//
// Uses pdfmake with a same-origin, locally bundled Noto Sans CJK font (SIL
// OFL-1.1). The font is fetched only when a PDF is requested and covers the
// Simplified Chinese, Traditional Chinese, Japanese and Latin text required by
// the export contract. No system or remote runtime font is used. All figures
// come straight from the authoritative dataset; nothing is recomputed.
// pdfmake itself is imported dynamically so it stays out of the initial bundle.
// ============================================================================

import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from "pdfmake/interfaces";
import type { ExportDataset } from "./types";
import { displayFields, type FieldSpec, REPORT_SPECS } from "./schema";
import { formatDecimalString } from "./format";
import { appliedFilters, formatGeneratedAt, sortLabel } from "./meta";
import { ExportGenerationError } from "./errors";

interface PdfMakeInstance {
  vfs?: Record<string, string>;
  fonts?: Record<string, {
    normal: string;
    bold: string;
    italics: string;
    bolditalics: string;
  }>;
  createPdf(doc: TDocumentDefinitions): {
    getBlob(cb: (blob: Blob) => void): void;
    getBuffer(cb: (buffer: Uint8Array) => void): void;
  };
}

let pdfMakePromise: Promise<PdfMakeInstance> | null = null;
let cjkFontPromise: Promise<string> | null = null;

export const PDF_FONT_URL = "/fonts/NotoSansCJKsc-Regular.otf";
const PDF_FONT_FILE = "NotoSansCJKsc-Regular.otf";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Load and validate the licensed same-origin CJK font exactly once. */
async function loadCjkFont(): Promise<string> {
  if (!cjkFontPromise) {
    cjkFontPromise = (async () => {
      const response = await fetch(PDF_FONT_URL, {
        method: "GET",
        cache: "force-cache",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("The bundled PDF font could not be loaded.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const isOpenType = bytes.length > 1_000_000 &&
        bytes[0] === 0x4f &&
        bytes[1] === 0x54 &&
        bytes[2] === 0x54 &&
        bytes[3] === 0x4f;
      if (!isOpenType) throw new Error("The bundled PDF font is invalid.");
      return bytesToBase64(bytes);
    })().catch((error) => {
      cjkFontPromise = null;
      throw error;
    });
  }
  return cjkFontPromise;
}

async function loadPdfMake(): Promise<PdfMakeInstance> {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const [pdfMakeModule, fontBase64] = await Promise.all([
        import("pdfmake/build/pdfmake"),
        loadCjkFont(),
      ]);
      const instance = ((pdfMakeModule as { default?: PdfMakeInstance }).default ??
        (pdfMakeModule as unknown as PdfMakeInstance));
      instance.vfs = { [PDF_FONT_FILE]: fontBase64 };
      instance.fonts = {
        NotoSansCJK: {
          normal: PDF_FONT_FILE,
          bold: PDF_FONT_FILE,
          italics: PDF_FONT_FILE,
          bolditalics: PDF_FONT_FILE,
        },
      };
      return instance;
    })().catch((error) => {
      pdfMakePromise = null;
      throw error;
    });
  }
  return pdfMakePromise;
}

const BRAND = "#2563eb";
const MUTED = "#64748b";
const RULE = "#e2e8f0";

function cellText(spec: FieldSpec, value: string | null): string {
  if (value === null) return "—";
  if (spec.kind === "money") return formatDecimalString(value);
  return value;
}

function dataTable(dataset: ExportDataset): Content {
  const fields = displayFields(dataset.report_type);
  const header: TableCell[] = fields.map((f) => ({
    text: f.header ?? f.key,
    style: "th",
    alignment: f.align === "right" ? "right" : "left",
  }));
  const body: TableCell[][] = [header];

  if (dataset.rows.length === 0) {
    body.push([
      {
        text: "No records match the applied filters.",
        colSpan: fields.length,
        alignment: "center",
        italics: true,
        color: MUTED,
        margin: [0, 6, 0, 6],
      },
      ...Array(fields.length - 1).fill({}),
    ]);
  } else {
    for (const row of dataset.rows) {
      body.push(
        fields.map((f) => ({
          text: cellText(f, row[f.key]),
          alignment: f.align === "right" ? "right" : "left",
          style: "td",
        })),
      );
    }
  }

  const widths = fields.map((f) => (f.key.endsWith("name") ? "*" : "auto"));

  return {
    table: { headerRows: 1, dontBreakRows: true, widths, body },
    layout: {
      hLineWidth: (i: number) => (i === 0 || i === 1 ? 0.75 : 0.25),
      vLineWidth: () => 0,
      hLineColor: () => RULE,
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 2,
      paddingBottom: () => 2,
      fillColor: (rowIndex: number) =>
        rowIndex === 0 ? "#f1f5f9" : rowIndex % 2 === 0 ? "#fbfcfe" : null,
    },
  };
}

function summaryContent(dataset: ExportDataset): Content[] {
  const spec = REPORT_SPECS[dataset.report_type];
  const blocks: Content[] = [
    { text: "Summary", style: "h2", margin: [0, 4, 0, 4] },
  ];

  const totalsBody: TableCell[][] = [];
  for (const c of spec.summaryCounts) {
    totalsBody.push([
      { text: c.label, style: "sumLabel" },
      { text: String(dataset.summary.counts[c.key] ?? 0), style: "sumValue", alignment: "right" },
    ]);
  }
  for (const t of spec.summaryTotals) {
    const value = dataset.summary.totals[t.key];
    totalsBody.push([
      { text: `${t.label} (${dataset.summary.base_currency})`, style: "sumLabel" },
      {
        text: value === undefined ? "—" : formatDecimalString(value),
        style: "sumValue",
        alignment: "right",
      },
    ]);
  }
  blocks.push({
    table: { widths: ["*", "auto"], body: totalsBody },
    layout: "lightHorizontalLines",
    margin: [0, 0, 0, 6],
  });

  if (dataset.summary.native_by_currency.length > 0) {
    const body: TableCell[][] = [
      [
        { text: "Currency", style: "th" },
        { text: "Rows", style: "th", alignment: "right" },
        { text: "Native total", style: "th", alignment: "right" },
        { text: "Base total", style: "th", alignment: "right" },
      ],
      ...dataset.summary.native_by_currency.map((c): TableCell[] => [
        { text: c.currency, style: "td" },
        { text: String(c.row_count), style: "td", alignment: "right" },
        { text: formatDecimalString(c.native_total), style: "td", alignment: "right" },
        { text: formatDecimalString(c.base_total), style: "td", alignment: "right" },
      ]),
    ];
    blocks.push({ text: "By transaction currency", style: "h3", margin: [0, 2, 0, 2] });
    blocks.push({
      table: { headerRows: 1, widths: ["auto", "auto", "*", "*"], body },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 6],
    });
  }

  for (const breakdown of spec.breakdowns) {
    const rows = dataset.summary.breakdowns[breakdown.sourceKey] ?? [];
    if (rows.length === 0) continue;
    const body: TableCell[][] = [
      [
        { text: breakdown.dimensionLabel, style: "th" },
        { text: "Count", style: "th", alignment: "right" },
        ...breakdown.totals.map((t): TableCell => ({
          text: `${t.label} (${dataset.summary.base_currency})`,
          style: "th",
          alignment: "right",
        })),
      ],
      ...rows.map((r): TableCell[] => [
        { text: r.key, style: "td" },
        { text: String(r.count), style: "td", alignment: "right" },
        ...breakdown.totals.map((t): TableCell => ({
          text: formatDecimalString(r.totals[t.key] ?? "0.00"),
          style: "td",
          alignment: "right",
        })),
      ]),
    ];
    blocks.push({ text: breakdown.title, style: "h3", margin: [0, 2, 0, 2] });
    blocks.push({
      table: {
        headerRows: 1,
        widths: ["*", "auto", ...breakdown.totals.map(() => "auto" as const)],
        body,
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 6],
    });
  }

  return blocks;
}

function buildDocDefinition(dataset: ExportDataset): TDocumentDefinitions {
  const spec = REPORT_SPECS[dataset.report_type];
  const filters = appliedFilters(dataset);

  const metaLines: Content[] = [
    { text: dataset.company.name, style: "company" },
    {
      text: `Base currency: ${dataset.company.base_currency}    Generated: ${formatGeneratedAt(dataset)}`,
      style: "meta",
    },
    { text: `Sort: ${sortLabel(dataset)}`, style: "meta" },
    filters.length > 0
      ? {
        text: [
          { text: "Filters: ", bold: true },
          filters.map((f) => `${f.label}: ${f.value}`).join("    "),
        ],
        style: "meta",
      }
      : { text: "Filters: none", style: "meta" },
  ];

  return {
    pageSize: "A4",
    pageOrientation: spec.landscape ? "landscape" : "portrait",
    pageMargins: [24, 60, 24, 40],
    defaultStyle: { font: "NotoSansCJK", fontSize: 7.5, color: "#0f172a" },
    header: () => ({
      columns: [
        { text: spec.title, style: "title", margin: [24, 20, 0, 0] },
      ],
    }),
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: "TSH Synergy AR — authoritative export",
          alignment: "left",
          style: "footer",
          margin: [24, 0, 0, 0],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: "right",
          style: "footer",
          margin: [0, 0, 24, 0],
        },
      ],
    }),
    content: [
      ...metaLines,
      { text: "", margin: [0, 0, 0, 4] },
      ...summaryContent(dataset),
      { text: "Detail", style: "h2", margin: [0, 6, 0, 4] },
      { text: `${dataset.row_count} record(s)`, style: "meta", margin: [0, 0, 0, 4] },
      dataTable(dataset),
    ],
    styles: {
      title: { fontSize: 13, bold: true, color: BRAND },
      company: { fontSize: 10, bold: true },
      meta: { fontSize: 8, color: MUTED, margin: [0, 1, 0, 1] },
      h2: { fontSize: 10, bold: true, color: "#0f172a" },
      h3: { fontSize: 8.5, bold: true, color: MUTED },
      th: { bold: true, fontSize: 7.5, color: "#334155" },
      td: { fontSize: 7.5 },
      sumLabel: { fontSize: 8 },
      sumValue: { fontSize: 8, bold: true },
      footer: { fontSize: 7, color: MUTED },
    },
  };
}

/** Generate a PDF Blob for the report. Rejects with ExportGenerationError on failure. */
export async function generateReportPdf(dataset: ExportDataset): Promise<Blob> {
  try {
    const pdfMake = await loadPdfMake();
    const doc = pdfMake.createPdf(buildDocDefinition(dataset));
    return await new Promise<Blob>((resolve, reject) => {
      try {
        if (typeof doc.getBlob === "function") {
          doc.getBlob((blob) => {
            if (blob && blob.size > 0) resolve(blob);
            else reject(new ExportGenerationError());
          });
        } else {
          doc.getBuffer((buffer) => {
            if (buffer && buffer.byteLength > 0) {
              resolve(new Blob([buffer as unknown as BlobPart], { type: "application/pdf" }));
            } else {
              reject(new ExportGenerationError());
            }
          });
        }
      } catch (error) {
        reject(error);
      }
    });
  } catch (error) {
    if (error instanceof ExportGenerationError) throw error;
    throw new ExportGenerationError();
  }
}

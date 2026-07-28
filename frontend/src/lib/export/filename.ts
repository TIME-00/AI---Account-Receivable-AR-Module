// ============================================================================
// TSH Synergy AR — Gate C report export: safe filename builder
// ============================================================================

import type { ExportDataset, ExportFormat, ExportReportType } from "./types";

const BASE_NAME: Record<ExportReportType, string> = {
  aging: "ar-aging-report",
  invoices: "invoice-summary",
  receipts: "receipt-summary",
  "customer-outstanding": "customer-outstanding",
};

const EXTENSION: Record<ExportFormat, string> = {
  pdf: "pdf",
  xlsx: "xlsx",
};

const MAX_STEM_LENGTH = 120;

/**
 * Reduce an arbitrary string to a safe filename token. Any character that is
 * not an ASCII letter or digit — including control characters, spaces and the
 * path separators `/` and `\` — collapses to a single hyphen.
 */
function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function dateStamp(dataset: ExportDataset): string {
  const raw = dataset.filters.as_of_date ??
    dataset.filters.date_to ??
    dataset.generated_at.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return slug(raw) || "report";
}

/**
 * Build the download filename, e.g. `ar-aging-report_2026-07-28.pdf`. Always
 * yields a bounded, separator-free name with the correct extension, even when
 * the dataset metadata is malformed.
 */
export function buildExportFilename(
  dataset: ExportDataset,
  format: ExportFormat,
): string {
  const base = BASE_NAME[dataset.report_type] ?? "report";
  const stamp = dateStamp(dataset);
  const stem = `${base}_${stamp}`
    .slice(0, MAX_STEM_LENGTH)
    .replace(/[_-]+$/g, "") || "report";
  return `${stem}.${EXTENSION[format] ?? "bin"}`;
}

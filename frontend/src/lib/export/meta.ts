// ============================================================================
// TSH Synergy AR — Gate C report export: shared metadata presentation
// ============================================================================

import type { ExportDataset } from "./types";

const FILTER_LABELS: Record<string, string> = {
  as_of_date: "As of date",
  date_from: "From date",
  date_to: "To date",
  status: "Status",
  doc_type: "Document type",
  payment_method: "Payment method",
  currency: "Currency",
  credit_rating: "Credit rating",
  customer_status: "Customer status",
  search: "Search",
};

export function filterLabel(key: string): string {
  return FILTER_LABELS[key] ?? key;
}

/** Ordered, human-readable applied-filter pairs (empty when none applied). */
export function appliedFilters(dataset: ExportDataset): { label: string; value: string }[] {
  return Object.entries(dataset.filters).map(([key, value]) => ({
    label: filterLabel(key),
    value,
  }));
}

/**
 * Render `generated_at` (ISO-8601 UTC) in the company's timezone. Falls back to
 * the raw ISO string if the timezone or value cannot be formatted.
 */
export function formatGeneratedAt(dataset: ExportDataset): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: dataset.company.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    return `${formatter.format(new Date(dataset.generated_at))} (${dataset.company.timezone})`;
  } catch {
    return dataset.generated_at;
  }
}

export function sortLabel(dataset: ExportDataset): string {
  return `${dataset.sort.field} (${dataset.sort.order === "asc" ? "ascending" : "descending"})`;
}

// ============================================================================
// TSH Synergy AR — Gate C report export: shared types
//
// These types mirror the authoritative backend export contract
// (backend/supabase/functions/reports/export-*.ts). Every monetary value is an
// exact decimal STRING produced by the backend's BigInt minor-unit arithmetic —
// the frontend never recomputes or aggregates money. Summaries are taken
// verbatim from the backend response.
// ============================================================================

import { SUPPORTED_CURRENCIES } from "@/lib/currency";

export const EXPORT_REPORT_TYPES = [
  "aging",
  "invoices",
  "receipts",
  "customer-outstanding",
] as const;

export type ExportReportType = (typeof EXPORT_REPORT_TYPES)[number];
export type SortOrder = "asc" | "desc";
export type ExportFormat = "pdf" | "xlsx";

/** Backend-authoritative row/summary enum domains (must match _shared/constants). */
export const EXPORT_CREDIT_RATINGS = ["AAA", "AA", "A", "B", "C", "D"] as const;
export const EXPORT_CUSTOMER_STATUSES = [
  "Active",
  "Inactive",
  "Blocked",
  "On Hold",
] as const;
export const EXPORT_DOC_TYPES = ["Invoice", "Credit Note", "Debit Note"] as const;
export const EXPORT_INVOICE_STATUSES = [
  "Draft",
  "Open",
  "Partially Paid",
  "Paid",
  "Overdue",
  "Cancelled",
  "Written Off",
] as const;
export const EXPORT_PAYMENT_METHODS = [
  "CHQ",
  "TT",
  "CASH",
  "CC",
  "GIRO",
  "OFST",
  "ONLN",
] as const;
export const EXPORT_RECEIPT_STATUSES = [
  "Draft",
  "Posted",
  "Fully Allocated",
  "Cancelled",
  "Bounced",
] as const;
export const EXPORT_OPERATIONAL_CURRENCIES = SUPPORTED_CURRENCIES;
export const EXPORT_FX_SOURCE_CATEGORIES = [
  "BASE_PARITY",
  "REFERENCE_SELECTED",
  "CATALOG",
  "MANUAL_OVERRIDE",
  "LEGACY_UNVERIFIED",
] as const;
export const EXPORT_FX_LIFECYCLE_STATUSES = [
  "Draft",
  "Pending",
  "Approved",
  "Rejected",
  "Superseded",
  "Posted",
] as const;

export interface ExportCompany {
  id: string;
  name: string;
  base_currency: string;
  timezone: string;
}

export interface ExportSort {
  field: string;
  order: SortOrder;
}

/** One entry of a report's native transaction-currency breakdown. */
export interface ExportCurrencyTotal {
  currency: string;
  row_count: number;
  native_total: string;
  base_total: string;
}

/** One entry of a status / doc-type / payment-method breakdown. */
export interface ExportBreakdownRow {
  key: string;
  count: number;
  totals: Record<string, string>;
}

export interface ExportDataset<
  TRow extends Record<string, string | null> = Record<string, string | null>,
> {
  schema_version: 1;
  report_type: ExportReportType;
  generated_at: string;
  company: ExportCompany;
  filters: Record<string, string>;
  sort: ExportSort;
  row_count: number;
  summary: ExportSummary;
  rows: TRow[];
}

/**
 * A normalized, presentation-friendly view of the backend summary. Monetary
 * totals stay as exact decimal strings; native_by_currency and the optional
 * breakdowns are normalized into stable shapes for rendering.
 */
export interface ExportSummary {
  base_currency: string;
  /** Whole-number counts surfaced by the report (e.g. customer_count). */
  counts: Record<string, number>;
  /** Exact decimal-string totals keyed by their backend field name. */
  totals: Record<string, string>;
  native_by_currency: ExportCurrencyTotal[];
  /** Present only for invoices / receipts. */
  breakdowns: Record<string, ExportBreakdownRow[]>;
}

/** The controlled oversize error surfaced by the backend (HTTP 422). */
export interface ExportOversizeDetails {
  row_limit: number;
  payload_limit_bytes: number;
  estimated_rows: number;
}

// ============================================================================
// TSH Synergy AR — Gate C export test fixtures
//
// Builds RAW export response bodies (the object carried in the backend's
// `{ data: … }` envelope) exactly as the Edge function emits them, so parser,
// PDF, XLSX and hook tests all exercise realistic authoritative shapes.
// Test-only: never imported by application code.
// ============================================================================

import type { ExportReportType } from "../types";

export function fixtureUuid(index: number, family = 1): string {
  return `${String(family).padStart(8, "0")}-0000-4000-8000-${
    String(index).padStart(12, "0")
  }`;
}

const COMPANY = {
  id: fixtureUuid(1, 9),
  name: "TSH Synergy Demo Sdn Bhd",
  base_currency: "MYR",
  timezone: "Asia/Kuala_Lumpur",
};

const GENERATED_AT = "2026-07-27T12:34:56.000Z";

function agingRow(index: number, name?: string): Record<string, unknown> {
  return {
    customer_id: fixtureUuid(index + 1, 3),
    customer_code: `CUST-${String(index).padStart(5, "0")}`,
    customer_name: name ?? `Customer ${String(index).padStart(5, "0")}`,
    credit_rating: ["AAA", "AA", "A", "B", "C", "D"][index % 6],
    current_base: "100.00",
    bucket_1_30_base: "10.00",
    bucket_31_60_base: "20.00",
    bucket_61_90_base: "30.00",
    bucket_91_plus_base: "40.00",
    outstanding_base: "200.00",
    overdue_base: "100.00",
  };
}

function outstandingRow(index: number, name?: string): Record<string, unknown> {
  return {
    ...agingRow(index, name),
    customer_status: index % 2 === 0 ? "Active" : "On Hold",
    credit_limit: "1000.00",
    base_currency: "MYR",
    oldest_due_date: index % 3 === 0 ? null : "2026-06-01",
  };
}

function invoiceRow(index: number, name?: string): Record<string, unknown> {
  const usd = index % 2 === 1;
  return {
    invoice_id: fixtureUuid(index + 1, 4),
    invoice_no: `INV-${String(index).padStart(6, "0")}`,
    doc_type: ["Invoice", "Credit Note", "Debit Note"][index % 3],
    invoice_date: "2026-07-01",
    due_date: index % 4 === 0 ? null : "2026-07-31",
    customer_id: fixtureUuid((index % 5) + 1, 3),
    customer_code: `CUST-${String(index % 5).padStart(5, "0")}`,
    customer_name: name ?? `Customer ${index % 5}`,
    status: usd ? "Partially Paid" : "Open",
    currency: usd ? "USD" : "MYR",
    total_amount_native: "10.00",
    outstanding_native: "6.00",
    booked_exchange_rate: usd ? "4.25" : "1",
    base_currency: "MYR",
    base_total: usd ? "42.50" : "10.00",
    outstanding_base: usd ? "25.50" : "6.00",
    fx_source_category: index % 5 === 0 ? null : "REFERENCE_SELECTED",
    fx_lifecycle_status: index % 5 === 0 ? null : "Posted",
  };
}

function receiptRow(index: number, name?: string): Record<string, unknown> {
  const usd = index % 2 === 1;
  return {
    receipt_id: fixtureUuid(index + 1, 5),
    receipt_no: `RCT-${String(index).padStart(6, "0")}`,
    receipt_date: "2026-07-02",
    customer_id: fixtureUuid((index % 5) + 1, 3),
    customer_code: `CUST-${String(index % 5).padStart(5, "0")}`,
    customer_name: name ?? `Customer ${index % 5}`,
    status: usd ? "Fully Allocated" : "Posted",
    payment_method: usd ? "GIRO" : "TT",
    currency: usd ? "USD" : "MYR",
    receipt_amount_native: "10.00",
    allocated_amount_native: "4.00",
    unallocated_amount_native: "6.00",
    booked_exchange_rate: usd ? "4.25" : "1",
    base_currency: "MYR",
    base_amount: usd ? "42.50" : "10.00",
    unallocated_base: usd ? "25.50" : "6.00",
    fx_source_category: "REFERENCE_SELECTED",
    fx_lifecycle_status: "Posted",
  };
}

const NATIVE_BY_CURRENCY = [
  { currency: "MYR", row_count: 1, native_total: "10.00", base_total: "10.00" },
  { currency: "USD", row_count: 1, native_total: "10.00", base_total: "42.50" },
];

interface BuildOptions {
  count?: number;
  /** Override every row's customer_name (Unicode / injection tests). */
  customerName?: string;
}

function breakdownCounts(
  rows: Record<string, unknown>[],
  dimension: string,
  totalKeys: readonly string[],
): Record<string, unknown>[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[dimension]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({
    [dimension]: key,
    count,
    ...Object.fromEntries(totalKeys.map((totalKey) => [totalKey, "0.00"])),
  }));
}

/** Build the raw `data` object for `type` (pre-parse, backend-shaped). */
export function buildRawExport(
  type: ExportReportType,
  options: BuildOptions = {},
): Record<string, unknown> {
  const count = options.count ?? 3;
  const name = options.customerName;
  const base = {
    schema_version: 1,
    report_type: type,
    generated_at: GENERATED_AT,
    company: { ...COMPANY },
    filters: {} as Record<string, string>,
    sort: { field: "customer_code", order: "asc" },
  };

  if (type === "aging") {
    const rows = Array.from({ length: count }, (_, i) => agingRow(i, name));
    return {
      ...base,
      filters: { as_of_date: "2026-07-27" },
      row_count: rows.length,
      summary: {
        base_currency: "MYR",
        customer_count: rows.length,
        outstanding_base_total: "600.00",
        overdue_base_total: "300.00",
        current_base_total: "300.00",
        bucket_1_30_base_total: "30.00",
        bucket_31_60_base_total: "60.00",
        bucket_61_90_base_total: "90.00",
        bucket_91_plus_base_total: "120.00",
        native_by_currency: NATIVE_BY_CURRENCY,
      },
      rows,
    };
  }

  if (type === "customer-outstanding") {
    const rows = Array.from({ length: count }, (_, i) => outstandingRow(i, name));
    return {
      ...base,
      filters: { as_of_date: "2026-07-27" },
      row_count: rows.length,
      summary: {
        base_currency: "MYR",
        customer_count: rows.length,
        outstanding_base_total: "600.00",
        overdue_base_total: "300.00",
        current_base_total: "300.00",
        bucket_1_30_base_total: "30.00",
        bucket_31_60_base_total: "60.00",
        bucket_61_90_base_total: "90.00",
        bucket_91_plus_base_total: "120.00",
        credit_limit_total: "3000.00",
        native_by_currency: NATIVE_BY_CURRENCY,
      },
      rows,
    };
  }

  if (type === "invoices") {
    const rows = Array.from({ length: count }, (_, i) => invoiceRow(i, name));
    return {
      ...base,
      filters: { date_from: "2026-07-01", date_to: "2026-07-31" },
      sort: { field: "invoice_date", order: "desc" },
      row_count: rows.length,
      summary: {
        document_count: rows.length,
        base_currency: "MYR",
        document_base_total: "95.00",
        outstanding_base_total: "57.00",
        native_by_currency: NATIVE_BY_CURRENCY,
        status_breakdown: breakdownCounts(
          rows,
          "status",
          ["base_total_total", "outstanding_base_total"],
        ),
        doc_type_breakdown: breakdownCounts(
          rows,
          "doc_type",
          ["base_total_total", "outstanding_base_total"],
        ),
      },
      rows,
    };
  }

  const rows = Array.from({ length: count }, (_, i) => receiptRow(i, name));
  return {
    ...base,
    filters: { date_from: "2026-07-01", date_to: "2026-07-31" },
    sort: { field: "receipt_date", order: "desc" },
    row_count: rows.length,
    summary: {
      receipt_count: rows.length,
      base_currency: "MYR",
      receipt_base_total: "95.00",
      allocated_base_total: "38.00",
      unallocated_base_total: "57.00",
      native_by_currency: NATIVE_BY_CURRENCY,
      status_breakdown: breakdownCounts(
        rows,
        "status",
        ["base_amount_total", "unallocated_base_total"],
      ),
      payment_method_breakdown: breakdownCounts(
        rows,
        "payment_method",
        ["base_amount_total", "unallocated_base_total"],
      ),
    },
    rows,
  };
}

export const FIXTURE_COMPANY = COMPANY;
export const FIXTURE_GENERATED_AT = GENERATED_AT;
export const ALL_REPORT_TYPES: ExportReportType[] = [
  "aging",
  "invoices",
  "receipts",
  "customer-outstanding",
];

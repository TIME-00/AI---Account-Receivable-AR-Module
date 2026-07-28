// ============================================================================
// TSH Synergy AR — Gate C report export: report schema (single source of truth)
//
// One declarative spec per report drives BOTH strict parsing and PDF/XLSX
// rendering, so the two can never drift. Column order here is the exact order
// used in the generated documents.
// ============================================================================

import {
  EXPORT_CREDIT_RATINGS,
  EXPORT_CUSTOMER_STATUSES,
  EXPORT_DOC_TYPES,
  EXPORT_INVOICE_STATUSES,
  EXPORT_FX_LIFECYCLE_STATUSES,
  EXPORT_FX_SOURCE_CATEGORIES,
  EXPORT_OPERATIONAL_CURRENCIES,
  EXPORT_PAYMENT_METHODS,
  EXPORT_RECEIPT_STATUSES,
  type ExportReportType,
} from "./types";

export type FieldKind =
  | "id"
  | "text"
  | "text_null"
  | "enum"
  | "enum_null"
  | "currency"
  | "date"
  | "date_null"
  | "money"
  | "rate";

export type Align = "left" | "right";

export interface FieldSpec {
  key: string;
  /** Column header used in PDF/XLSX. Absent → validated but not displayed. */
  header?: string;
  kind: FieldKind;
  align?: Align;
  /** Allowed values for `enum` kind. */
  enumValues?: readonly string[];
}

export interface BreakdownSpec {
  /** Backend summary array key, e.g. "status_breakdown". */
  sourceKey: string;
  title: string;
  /** The dimension field name on each breakdown row, e.g. "status". */
  dimension: string;
  dimensionLabel: string;
  /** Exact backend enum values accepted for the breakdown dimension. */
  enumValues: readonly string[];
  /** Money total columns present on each breakdown row. */
  totals: { key: string; label: string }[];
}

export interface ReportSpec {
  title: string;
  /** True when the row set is wide enough to need landscape PDF. */
  landscape: boolean;
  /** Ordered fields; `header`-less entries are validated but not rendered. */
  fields: FieldSpec[];
  /** Stable row identity field (validated, drives dedupe safety in tests). */
  idField: string;
  /** Whole-number count fields on the summary. */
  summaryCounts: { key: string; label: string }[];
  /** Exact decimal-string total fields on the summary. */
  summaryTotals: { key: string; label: string }[];
  breakdowns: BreakdownSpec[];
  /** Exact normalized filter fields which may be echoed by the backend. */
  filterFields: Record<string, FieldSpec>;
  /** Exact backend-applied sort fields for this report. */
  sortFields: readonly string[];
  /** Filters which must always be present in a successful response. */
  requiredFilters: readonly string[];
}

const MONEY: Align = "right";

export const REPORT_SPECS: Record<ExportReportType, ReportSpec> = {
  aging: {
    title: "AR Aging Report",
    landscape: true,
    idField: "customer_id",
    fields: [
      { key: "customer_id", kind: "id" },
      { key: "customer_code", header: "Code", kind: "text", align: "left" },
      { key: "customer_name", header: "Customer", kind: "text", align: "left" },
      {
        key: "credit_rating",
        header: "Rating",
        kind: "enum",
        align: "left",
        enumValues: EXPORT_CREDIT_RATINGS,
      },
      { key: "current_base", header: "Current", kind: "money", align: MONEY },
      { key: "bucket_1_30_base", header: "1–30", kind: "money", align: MONEY },
      { key: "bucket_31_60_base", header: "31–60", kind: "money", align: MONEY },
      { key: "bucket_61_90_base", header: "61–90", kind: "money", align: MONEY },
      { key: "bucket_91_plus_base", header: "91+", kind: "money", align: MONEY },
      {
        key: "outstanding_base",
        header: "Total Outstanding",
        kind: "money",
        align: MONEY,
      },
      {
        key: "overdue_base",
        header: "Total Overdue",
        kind: "money",
        align: MONEY,
      },
    ],
    summaryCounts: [{ key: "customer_count", label: "Customers" }],
    summaryTotals: [
      { key: "outstanding_base_total", label: "Total Outstanding" },
      { key: "overdue_base_total", label: "Total Overdue" },
      { key: "current_base_total", label: "Current" },
      { key: "bucket_1_30_base_total", label: "1–30" },
      { key: "bucket_31_60_base_total", label: "31–60" },
      { key: "bucket_61_90_base_total", label: "61–90" },
      { key: "bucket_91_plus_base_total", label: "91+" },
    ],
    breakdowns: [],
    filterFields: {
      as_of_date: { key: "as_of_date", kind: "date" },
      search: { key: "search", kind: "text" },
    },
    sortFields: ["customer_code", "customer_name", "outstanding_base", "overdue_base"],
    requiredFilters: ["as_of_date"],
  },

  invoices: {
    title: "Invoice Summary",
    landscape: true,
    idField: "invoice_id",
    fields: [
      { key: "invoice_id", kind: "id" },
      { key: "invoice_no", header: "Invoice No", kind: "text", align: "left" },
      {
        key: "doc_type",
        header: "Type",
        kind: "enum",
        align: "left",
        enumValues: EXPORT_DOC_TYPES,
      },
      { key: "invoice_date", header: "Date", kind: "date", align: "left" },
      { key: "due_date", header: "Due Date", kind: "date_null", align: "left" },
      { key: "customer_id", kind: "id" },
      { key: "customer_code", header: "Cust Code", kind: "text", align: "left" },
      { key: "customer_name", header: "Customer", kind: "text", align: "left" },
      {
        key: "status",
        header: "Status",
        kind: "enum",
        align: "left",
        enumValues: EXPORT_INVOICE_STATUSES,
      },
      { key: "currency", header: "Curr", kind: "currency", align: "left" },
      {
        key: "total_amount_native",
        header: "Native Total",
        kind: "money",
        align: MONEY,
      },
      {
        key: "outstanding_native",
        header: "Native Outstanding",
        kind: "money",
        align: MONEY,
      },
      {
        key: "booked_exchange_rate",
        header: "Booked Rate",
        kind: "rate",
        align: MONEY,
      },
      { key: "base_currency", kind: "currency" },
      { key: "base_total", header: "Base Total", kind: "money", align: MONEY },
      {
        key: "outstanding_base",
        header: "Base Outstanding",
        kind: "money",
        align: MONEY,
      },
      {
        key: "fx_source_category",
        header: "FX Source",
        kind: "enum_null",
        align: "left",
        enumValues: EXPORT_FX_SOURCE_CATEGORIES,
      },
      {
        key: "fx_lifecycle_status",
        header: "FX Lifecycle",
        kind: "enum_null",
        align: "left",
        enumValues: EXPORT_FX_LIFECYCLE_STATUSES,
      },
    ],
    summaryCounts: [{ key: "document_count", label: "Documents" }],
    summaryTotals: [
      { key: "document_base_total", label: "Document Base Total" },
      { key: "outstanding_base_total", label: "Outstanding Base Total" },
    ],
    breakdowns: [
      {
        sourceKey: "status_breakdown",
        title: "Status Breakdown",
        dimension: "status",
        dimensionLabel: "Status",
        enumValues: EXPORT_INVOICE_STATUSES,
        totals: [
          { key: "base_total_total", label: "Base Total" },
          { key: "outstanding_base_total", label: "Outstanding Base" },
        ],
      },
      {
        sourceKey: "doc_type_breakdown",
        title: "Document Type Breakdown",
        dimension: "doc_type",
        dimensionLabel: "Type",
        enumValues: EXPORT_DOC_TYPES,
        totals: [
          { key: "base_total_total", label: "Base Total" },
          { key: "outstanding_base_total", label: "Outstanding Base" },
        ],
      },
    ],
    filterFields: {
      date_from: { key: "date_from", kind: "date" },
      date_to: { key: "date_to", kind: "date" },
      status: { key: "status", kind: "enum", enumValues: EXPORT_INVOICE_STATUSES },
      doc_type: { key: "doc_type", kind: "enum", enumValues: EXPORT_DOC_TYPES },
      currency: {
        key: "currency",
        kind: "enum",
        enumValues: EXPORT_OPERATIONAL_CURRENCIES,
      },
      search: { key: "search", kind: "text" },
    },
    sortFields: [
      "invoice_date",
      "invoice_no",
      "customer_name",
      "total_amount",
      "base_total",
      "outstanding",
    ],
    requiredFilters: [],
  },

  receipts: {
    title: "Receipt Summary",
    landscape: true,
    idField: "receipt_id",
    fields: [
      { key: "receipt_id", kind: "id" },
      { key: "receipt_no", header: "Receipt No", kind: "text", align: "left" },
      { key: "receipt_date", header: "Date", kind: "date", align: "left" },
      { key: "customer_id", kind: "id" },
      { key: "customer_code", header: "Cust Code", kind: "text", align: "left" },
      { key: "customer_name", header: "Customer", kind: "text", align: "left" },
      {
        key: "payment_method",
        header: "Method",
        kind: "enum",
        align: "left",
        enumValues: EXPORT_PAYMENT_METHODS,
      },
      {
        key: "status",
        header: "Status",
        kind: "enum",
        align: "left",
        enumValues: EXPORT_RECEIPT_STATUSES,
      },
      { key: "currency", header: "Curr", kind: "currency", align: "left" },
      {
        key: "receipt_amount_native",
        header: "Native Receipt",
        kind: "money",
        align: MONEY,
      },
      {
        key: "allocated_amount_native",
        header: "Native Allocated",
        kind: "money",
        align: MONEY,
      },
      {
        key: "unallocated_amount_native",
        header: "Native Unallocated",
        kind: "money",
        align: MONEY,
      },
      {
        key: "booked_exchange_rate",
        header: "Booked Rate",
        kind: "rate",
        align: MONEY,
      },
      { key: "base_currency", kind: "currency" },
      { key: "base_amount", header: "Base Amount", kind: "money", align: MONEY },
      {
        key: "unallocated_base",
        header: "Base Unallocated",
        kind: "money",
        align: MONEY,
      },
      {
        key: "fx_source_category",
        header: "FX Source",
        kind: "enum_null",
        align: "left",
        enumValues: EXPORT_FX_SOURCE_CATEGORIES,
      },
      {
        key: "fx_lifecycle_status",
        header: "FX Lifecycle",
        kind: "enum_null",
        align: "left",
        enumValues: EXPORT_FX_LIFECYCLE_STATUSES,
      },
    ],
    summaryCounts: [{ key: "receipt_count", label: "Receipts" }],
    summaryTotals: [
      { key: "receipt_base_total", label: "Receipt Base Total" },
      { key: "allocated_base_total", label: "Allocated Base Total" },
      { key: "unallocated_base_total", label: "Unallocated Base Total" },
    ],
    breakdowns: [
      {
        sourceKey: "status_breakdown",
        title: "Status Breakdown",
        dimension: "status",
        dimensionLabel: "Status",
        enumValues: EXPORT_RECEIPT_STATUSES,
        totals: [
          { key: "base_amount_total", label: "Base Amount" },
          { key: "unallocated_base_total", label: "Unallocated Base" },
        ],
      },
      {
        sourceKey: "payment_method_breakdown",
        title: "Payment Method Breakdown",
        dimension: "payment_method",
        dimensionLabel: "Method",
        enumValues: EXPORT_PAYMENT_METHODS,
        totals: [
          { key: "base_amount_total", label: "Base Amount" },
          { key: "unallocated_base_total", label: "Unallocated Base" },
        ],
      },
    ],
    filterFields: {
      date_from: { key: "date_from", kind: "date" },
      date_to: { key: "date_to", kind: "date" },
      status: { key: "status", kind: "enum", enumValues: EXPORT_RECEIPT_STATUSES },
      payment_method: {
        key: "payment_method",
        kind: "enum",
        enumValues: EXPORT_PAYMENT_METHODS,
      },
      currency: {
        key: "currency",
        kind: "enum",
        enumValues: EXPORT_OPERATIONAL_CURRENCIES,
      },
      search: { key: "search", kind: "text" },
    },
    sortFields: [
      "receipt_date",
      "receipt_no",
      "customer_name",
      "receipt_amount",
      "base_amount",
      "unallocated_amount",
    ],
    requiredFilters: [],
  },

  "customer-outstanding": {
    title: "Customer Outstanding",
    landscape: true,
    idField: "customer_id",
    fields: [
      { key: "customer_id", kind: "id" },
      { key: "customer_code", header: "Code", kind: "text", align: "left" },
      { key: "customer_name", header: "Customer", kind: "text", align: "left" },
      {
        key: "customer_status",
        header: "Status",
        kind: "enum",
        align: "left",
        enumValues: EXPORT_CUSTOMER_STATUSES,
      },
      {
        key: "credit_rating",
        header: "Rating",
        kind: "enum",
        align: "left",
        enumValues: EXPORT_CREDIT_RATINGS,
      },
      { key: "credit_limit", header: "Credit Limit", kind: "money", align: MONEY },
      { key: "base_currency", kind: "currency" },
      { key: "current_base", header: "Current", kind: "money", align: MONEY },
      { key: "bucket_1_30_base", header: "1–30", kind: "money", align: MONEY },
      { key: "bucket_31_60_base", header: "31–60", kind: "money", align: MONEY },
      { key: "bucket_61_90_base", header: "61–90", kind: "money", align: MONEY },
      { key: "bucket_91_plus_base", header: "91+", kind: "money", align: MONEY },
      {
        key: "outstanding_base",
        header: "Total Outstanding",
        kind: "money",
        align: MONEY,
      },
      { key: "overdue_base", header: "Total Overdue", kind: "money", align: MONEY },
      {
        key: "oldest_due_date",
        header: "Oldest Due",
        kind: "date_null",
        align: "left",
      },
    ],
    summaryCounts: [{ key: "customer_count", label: "Customers" }],
    summaryTotals: [
      { key: "outstanding_base_total", label: "Total Outstanding" },
      { key: "overdue_base_total", label: "Total Overdue" },
      { key: "current_base_total", label: "Current" },
      { key: "bucket_1_30_base_total", label: "1–30" },
      { key: "bucket_31_60_base_total", label: "31–60" },
      { key: "bucket_61_90_base_total", label: "61–90" },
      { key: "bucket_91_plus_base_total", label: "91+" },
      { key: "credit_limit_total", label: "Credit Limit Total" },
    ],
    breakdowns: [],
    filterFields: {
      as_of_date: { key: "as_of_date", kind: "date" },
      credit_rating: {
        key: "credit_rating",
        kind: "enum",
        enumValues: EXPORT_CREDIT_RATINGS,
      },
      customer_status: {
        key: "customer_status",
        kind: "enum",
        enumValues: EXPORT_CUSTOMER_STATUSES,
      },
      search: { key: "search", kind: "text" },
    },
    sortFields: ["customer_code", "customer_name", "outstanding_base", "overdue_base"],
    requiredFilters: ["as_of_date"],
  },
};

/** Fields that appear as columns (have a header), in document order. */
export function displayFields(type: ExportReportType): FieldSpec[] {
  return REPORT_SPECS[type].fields.filter((f) => f.header);
}

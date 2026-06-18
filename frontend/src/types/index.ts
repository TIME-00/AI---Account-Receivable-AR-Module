// ============================================================================
// TSH Synergy AR — Frontend TypeScript Types
// Mirrors backend/_shared/types.ts exactly
// All amount fields are `number`, formatted to 2 decimals on display
// ============================================================================

// ─── Enums ──────────────────────────────────────────────────────────────────

export type CustomerType = "Corporate" | "Individual" | "Government" | "Intercompany";
export type CustomerStatus = "Active" | "Inactive" | "Blocked" | "On Hold";
export type CreditRating = "AAA" | "AA" | "A" | "B" | "C" | "D";
export type DocType = "Invoice" | "Credit Note" | "Debit Note";
export type InvoiceStatus = "Draft" | "Open" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled" | "Written Off";
export type CNType = "Linked" | "Standalone";
export type ReasonCode = "Return" | "Discount" | "Price Adjustment" | "Error Correction" | "Other";
export type PaymentMethod = "CHQ" | "TT" | "CASH" | "CC" | "GIRO" | "OFST" | "ONLN";
export type ReceiptStatus = "Draft" | "Posted" | "Fully Allocated" | "Cancelled" | "Bounced";
export type AllocationMethod = "Manual" | "Auto_FIFO" | "Auto_Amount";
export type AllocationStatus = "Active" | "Reversed";
export type JESourceType = "INV" | "RCT" | "CN" | "DN" | "REV" | "ADJ" | "WO";
export type UserRole = "AR Clerk" | "AR Supervisor" | "Finance Manager" | "System Admin" | "Auditor";

// ─── API Envelope ───────────────────────────────────────────────────────────

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: APIError;
  meta?: APIMeta;
}

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface APIMeta {
  total?: number;
  page?: number;
  page_size?: number;
  has_next?: boolean;
}

export interface PaginationParams {
  page: number;
  page_size: number;
}

// ─── Customer ───────────────────────────────────────────────────────────────

export interface ShippingAddress {
  addr_line1: string;
  addr_line2?: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  is_default?: boolean;
}

export interface AltContact {
  contact_name: string;
  phone: string;
  email: string;
  position?: string;
}

export interface Customer {
  id: string;
  company_id: string;
  customer_id: string;
  customer_name: string;
  short_name: string | null;
  customer_type: CustomerType;
  registration_no: string | null;
  tax_id: string | null;
  status: CustomerStatus;
  customer_group_id: string | null;
  parent_id: string | null;
  is_deleted: boolean;
  is_hidden: boolean;
  hidden_reason: string | null;
  hidden_at: string | null;
  normalized_customer_name: string;
  bill_addr_line1: string;
  bill_addr_line2: string | null;
  bill_city: string;
  bill_state: string;
  bill_postal: string;
  bill_country: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  shipping_addresses: ShippingAddress[];
  alt_contacts: AltContact[];
  default_currency: string;
  ar_control_acct_id: string | null;
  revenue_acct_id: string | null;
  payment_term_id: string | null;
  credit_limit: number;
  credit_rating: CreditRating;
  e_invoice_enabled: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerCreditUtilization {
  id: string;
  company_id: string;
  customer_id: string;
  customer_name: string;
  credit_limit: number;
  credit_rating: CreditRating;
  total_outstanding: number;
  total_unallocated_receipts: number;
  total_unused_cn: number;
  credit_utilization: number;
  available_credit: number;
}

// ─── Invoice ────────────────────────────────────────────────────────────────

export interface Invoice {
  id: string;
  company_id: string;
  invoice_no: string;
  doc_type: DocType;
  invoice_date: string;
  due_date: string | null;
  customer_id: string;
  customer_name: string;
  currency: string;
  exchange_rate: number;
  base_currency: string;
  subtotal: number;
  tax_total: number;
  total_amount: number;
  base_total: number;
  outstanding: number;
  status: InvoiceStatus;
  posting_period: string | null;
  reference_no: string | null;
  internal_remarks: string | null;
  invoice_remarks: string | null;
  ref_invoice_id: string | null;
  cn_type: CNType | null;
  reason_code: ReasonCode | null;
  reason_desc: string | null;
  created_by: string | null;
  created_at: string;
  posted_by: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  updated_at: string;
  version: number;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  line_no: number;
  description: string;
  item_code: string | null;
  quantity: number;
  uom: string | null;
  unit_price: number;
  discount_pct: number;
  discount_amt: number;
  line_amount: number;
  tax_code_id: string | null;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
  gl_account_id: string | null;
  cost_center: string | null;
  line_remarks: string | null;
}

// ─── Receipt ────────────────────────────────────────────────────────────────

export interface Receipt {
  id: string;
  company_id: string;
  receipt_no: string;
  receipt_date: string;
  value_date: string | null;
  customer_id: string;
  customer_name: string;
  payment_method: PaymentMethod;
  currency: string;
  exchange_rate: number;
  base_currency: string;
  receipt_amount: number;
  base_amount: number;
  allocated_amount: number;
  unallocated_amount: number;
  bank_account_id: string;
  bank_account_name: string;
  reference_no: string | null;
  cheque_date: string | null;
  status: ReceiptStatus;
  posting_period: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  posted_by: string | null;
  posted_at: string | null;
  updated_at: string;
}

// ─── Bank Account ───────────────────────────────────────────────────────────

export interface BankAccount {
  id: string;
  company_id: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  swift_code: string | null;
  currency: string;
  gl_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Allocation ─────────────────────────────────────────────────────────────

export interface AllocationDetail {
  id: string;
  receipt_id: string;
  invoice_id: string;
  doc_type: DocType;
  allocated_amount: number;
  base_allocated: number;
  forex_gain_loss: number;
  discount_amount: number;
  allocation_date: string;
  allocated_by: string | null;
  allocation_method: AllocationMethod;
  status: AllocationStatus;
}

export interface AllocationDetailFull extends AllocationDetail {
  receipt_no: string;
  invoice_no: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  receipt_customer_name: string;
  invoice_customer_name: string;
  receipt_amount: number;
  receipt_currency: string;
  receipt_allocated_amount: number;
  receipt_unallocated_amount: number;
  invoice_total_amount: number;
  invoice_outstanding: number;
  invoice_due_date: string | null;
}

// ─── Journal Entry ──────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  company_id: string;
  je_no: string;
  je_date: string;
  posting_period: string;
  source_type: JESourceType;
  source_doc_no: string | null;
  source_doc_id: string | null;
  description: string | null;
  currency: string | null;
  exchange_rate: number;
  total_debit: number;
  total_credit: number;
  is_reversal: boolean;
  is_reversed: boolean;
  created_by: string | null;
  created_at: string;
}

// ─── Report Types ───────────────────────────────────────────────────────────

export interface AgingBucketResult {
  bucket_name: string;
  from_days: number;
  to_days: number | null;
  invoice_count: number;
  total_outstanding: number;
  percentage: number;
}

export interface CustomerAgingRow {
  customer_id: string;
  customer_name: string;
  customer_code: string;
  credit_limit: number;
  credit_rating: string;
  total_outstanding: number;
  current_amount: number;
  bucket_1_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_over_90: number;
}

/**
 * @deprecated Legacy flat dashboard shape. Superseded by {@link LiveDashboardMetrics}
 * (the nested base-currency contract from `GET /reports/dashboard`). Kept only for
 * temporary compatibility; do not use for new dashboard visuals.
 */
export interface DashboardSummary {
  total_invoices: number;
  open_invoices: number;
  overdue_invoices: number;
  total_receipts: number;
  total_ar_balance: number;
  total_overdue_balance: number;
  total_credit_balance: number;
  overdue_percentage: number;
}

// ─── Live Dashboard Contract (Batch 7A) ─────────────────────────────────────
// Mirrors backend/supabase/functions/reports/dashboard-types.ts exactly.
// All `*_base` amounts are in the company base currency (meta.base_currency).

export type DashboardScope = "assigned_customers" | "company";
export type AgingBucketKey = "current" | "1_30" | "31_60" | "61_90" | "over_90";

export interface DashboardMeta {
  company_id: string;
  base_currency: string;
  /** Business as-of date (YYYY-MM-DD), derived server-side from BUSINESS_TIME_ZONE. */
  as_of_date: string;
  /** ISO timestamp the metrics were calculated at. */
  calculated_at: string;
  scope: DashboardScope;
  trend_months: number;
}

export interface DashboardKpis {
  total_outstanding_ar: number;
  overdue_outstanding: number;
  overdue_invoice_count: number;
  unapplied_cash: number;
  current_month_collections: number;
  current_month_posted_invoices: number;
  import_rows_needing_review: number;
}

export interface DashboardInvoiceStatusCounts {
  open: number;
  partially_paid: number;
  overdue_status: number;
  paid: number;
  unpaid_total: number;
}

export interface DashboardAgingBucket {
  key: AgingBucketKey;
  label: string;
  invoice_count: number;
  outstanding_base: number;
  percentage: number;
}

export interface DashboardCollectionTrendPoint {
  /** Calendar month, YYYY-MM. */
  month: string;
  collected_base: number;
  receipt_count: number;
}

export interface DashboardTopCustomer {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  outstanding_base: number;
  overdue_base: number;
  overdue_invoice_count: number;
}

export interface DashboardCreditRatingRow {
  /** Maintained customer master credit rating — NOT a predictive/AI score. */
  rating: CreditRating;
  customer_count: number;
  outstanding_base: number;
}

/**
 * Nested live dashboard contract returned by `GET /reports/dashboard`.
 * Source of truth for all dashboard visuals. The deprecated top-level aliases
 * are retained only for transitional compatibility and must not back new visuals.
 */
export interface LiveDashboardMetrics {
  meta: DashboardMeta;
  kpis: DashboardKpis;
  invoice_status_counts: DashboardInvoiceStatusCounts;
  aging_buckets: DashboardAgingBucket[];
  collection_trend: DashboardCollectionTrendPoint[];
  top_outstanding_customers: DashboardTopCustomer[];
  credit_rating_distribution: DashboardCreditRatingRow[];

  /** @deprecated Compatibility alias — use invoice_status_counts / kpis. */
  total_invoices: number;
  /** @deprecated Compatibility alias. */
  open_invoices: number;
  /** @deprecated Compatibility alias. */
  overdue_invoices: number;
  /** @deprecated Compatibility alias. */
  total_receipts: number;
  /** @deprecated Legacy transaction-currency alias. */
  total_ar_balance: number;
  /** @deprecated Legacy transaction-currency alias. */
  total_overdue_balance: number;
  /** @deprecated Legacy unapplied-receipt + credit-note alias. */
  total_credit_balance: number;
  /** @deprecated Compatibility alias. */
  overdue_percentage: number;
}

export interface ARSummary {
  total_customers: number;
  total_outstanding: number;
  total_overdue: number;
  overdue_percentage: number;
  aging_summary: AgingBucketResult[];
}

// ─── Constants (mirroring backend) ──────────────────────────────────────────

export const PAYMENT_METHOD_NAMES: Record<string, string> = {
  CHQ: "Cheque",
  TT: "Telegraphic Transfer",
  CASH: "Cash",
  CC: "Credit Card",
  GIRO: "Direct Debit / GIRO",
  OFST: "Offset / Contra",
  ONLN: "Online Payment",
};

export const CREDIT_RATINGS = ["AAA", "AA", "A", "B", "C", "D"] as const;
export const CUSTOMER_TYPES = ["Corporate", "Individual", "Government", "Intercompany"] as const;
export const CUSTOMER_STATUSES = ["Active", "Inactive", "Blocked", "On Hold"] as const;
export const INVOICE_STATUSES = ["Draft", "Open", "Partially Paid", "Paid", "Overdue", "Cancelled", "Written Off"] as const;
export const RECEIPT_STATUSES = ["Draft", "Posted", "Fully Allocated", "Cancelled", "Bounced"] as const;

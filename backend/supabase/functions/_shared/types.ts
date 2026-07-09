// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Shared Type Definitions
// All interfaces map directly to PostgreSQL tables in 001_create_tables.sql
// ============================================================================

// ─── Base Config Types ──────────────────────────────────────────────────────

export interface Company {
  id: string;
  company_code: string;
  company_name: string;
  registration_no: string | null;
  tax_id: string | null;
  base_currency: string;
  country: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GLAccount {
  id: string;
  company_id: string;
  account_code: string;
  account_name: string;
  account_type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: string;
  company_id: string;
  bank_name: string;
  account_name: string;
  account_no: string;
  swift_code: string | null;
  currency: string;
  gl_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FiscalPeriod {
  id: string;
  company_id: string;
  period_code: string;
  status: 'Open' | 'Closed' | 'Year-End';
  start_date: string;
  end_date: string;
  opened_by: string | null;
  opened_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentTerm {
  id: string;
  company_id: string;
  term_code: string;
  term_name: string;
  term_type: 'Fixed Days' | 'End of Month' | 'Prepaid' | 'COD' | 'Custom';
  days: number | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaxCode {
  id: string;
  company_id: string;
  tax_code: string;
  tax_name: string;
  tax_type: 'Output' | 'Input';
  rate: number;
  effective_from: string;
  effective_to: string | null;
  country: string;
  gl_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerGroup {
  id: string;
  company_id: string;
  group_code: string;
  group_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExchangeRate {
  id: string;
  company_id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
  created_by: string | null;
  created_at: string;
}

export interface AgingBucket {
  id: string;
  company_id: string;
  bucket_no: number;
  bucket_name: string;
  from_days: number;
  to_days: number | null;
  created_at: string;
  updated_at: string;
}

export interface ARSystemConfig {
  id: string;
  company_id: string;
  config_key: string;
  config_value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Customer Types ─────────────────────────────────────────────────────────

export type CustomerType = 'Corporate' | 'Individual' | 'Government' | 'Intercompany';
export type CustomerStatus = 'Active' | 'Inactive' | 'Blocked' | 'On Hold';
export type CreditRating = 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D';

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
  customer_id: string;       // Business key: CUST-NNNNN
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

  // Contact
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

  // Finance
  default_currency: string;
  ar_control_acct_id: string | null;
  revenue_acct_id: string | null;
  tax_output_acct_id: string | null;
  discount_acct_id: string | null;
  bad_debt_acct_id: string | null;
  allowance_acct_id: string | null;
  forex_gain_acct_id: string | null;
  forex_loss_acct_id: string | null;
  payment_term_id: string | null;
  credit_limit: number;
  credit_rating: CreditRating;
  e_invoice_enabled: boolean;

  // Audit
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerBankDetail {
  id: string;
  customer_id: string;
  bank_name: string;
  account_name: string;
  account_no: string;
  swift_code: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Transaction Types ──────────────────────────────────────────────────────

export type DocType = 'Invoice' | 'Credit Note' | 'Debit Note';
export type InvoiceStatus = 'Draft' | 'Open' | 'Partially Paid' | 'Paid' | 'Overdue' | 'Cancelled' | 'Written Off';
export type CNType = 'Linked' | 'Standalone';
export type ReasonCode = 'Return' | 'Discount' | 'Price Adjustment' | 'Error Correction' | 'Other';

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
  fx_source_category: string | null;
  fx_decision_id: string | null;
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
  ar_acct: string | null;
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
  product_id: string | null;
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
  created_at: string;
  updated_at: string;
}

// ─── Receipt Types ──────────────────────────────────────────────────────────

export type PaymentMethod = 'CHQ' | 'TT' | 'CASH' | 'CC' | 'GIRO' | 'OFST' | 'ONLN';
export type ReceiptStatus = 'Draft' | 'Posted' | 'Fully Allocated' | 'Cancelled' | 'Bounced';

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
  fx_source_category: string | null;
  fx_decision_id: string | null;
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

// ─── Allocation Types ───────────────────────────────────────────────────────

export type AllocationMethod = 'Manual' | 'Auto_FIFO' | 'Auto_Amount';
export type AllocationStatus = 'Active' | 'Reversed';

export interface AllocationDetail {
  id: string;
  receipt_id: string;
  invoice_id: string;
  doc_type: DocType;
  allocated_amount: number;
  base_allocated: number;
  invoice_rate: number;
  receipt_rate: number;
  forex_gain_loss: number;
  discount_amount: number;
  allocation_date: string;
  allocated_by: string | null;
  allocation_method: AllocationMethod;
  status: AllocationStatus;
  reversed_by: string | null;
  reversed_at: string | null;
  reverse_reason: string | null;
  created_at: string;
}

// ─── Journal Entry Types ────────────────────────────────────────────────────

export type JESourceType = 'INV' | 'RCT' | 'CN' | 'DN' | 'REV' | 'ADJ' | 'WO';

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
  base_currency: string | null;
  total_debit: number;
  total_credit: number;
  is_reversal: boolean;
  original_je_id: string | null;
  is_reversed: boolean;
  reversal_je_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface JournalEntryLine {
  id: string;
  je_id: string;
  line_no: number;
  gl_account_id: string;
  description: string | null;
  debit_amount: number;
  credit_amount: number;
  base_debit: number;
  base_credit: number;
  currency: string | null;
  original_amount: number;
  created_at: string;
}

// ─── Audit Types ────────────────────────────────────────────────────────────

export interface CustomerChangeLog {
  id: string;
  customer_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  change_reason: string | null;
}

export interface CreditControlLog {
  id: string;
  company_id: string;
  customer_id: string;
  action: string;
  details: string | null;
  amount: number | null;
  approved_by: string | null;
  approved_at: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

// ─── Auth Types ─────────────────────────────────────────────────────────────

export type UserRole = 'AR Clerk' | 'AR Supervisor' | 'Finance Manager' | 'System Admin' | 'Auditor';

export interface UserRoleRecord {
  id: string;
  user_id: string;
  company_id: string;
  role: UserRole;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── View Types (read-only projections) ─────────────────────────────────────

export interface CustomerCreditUtilization {
  id: string;
  company_id: string;
  customer_id: string;
  customer_name: string;
  short_name: string | null;
  customer_type: CustomerType;
  status: CustomerStatus;
  credit_limit: number;
  credit_rating: CreditRating;
  default_currency: string;
  total_outstanding: number;
  total_unallocated_receipts: number;
  total_unused_cn: number;
  credit_utilization: number;
  available_credit: number;
}

export interface CustomerARSummary {
  id: string;
  company_id: string;
  customer_id: string;
  customer_name: string;
  default_currency: string;
  credit_limit: number;
  credit_rating: CreditRating;
  total_ar_balance: number;
  overdue_ar_balance: number;
  credit_balance: number;
  credit_utilization: number;
  credit_utilization_pct: number;
  available_credit: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
}

// ─── API Request / Response Types ───────────────────────────────────────────

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: APIError;
  meta?: APIMeta;
}

export interface APIError {
  code: string;          // e.g. "BR-INV-002", "VALIDATION_ERROR"
  message: string;       // Human-readable error message
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

// ─── Customer-specific Request DTOs ─────────────────────────────────────────

export interface CreateCustomerRequest {
  customer_name: string;
  short_name?: string;
  customer_type: CustomerType;
  registration_no?: string;
  tax_id?: string;

  // Contact
  bill_addr_line1: string;
  bill_addr_line2?: string;
  bill_city: string;
  bill_state: string;
  bill_postal: string;
  bill_country: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  shipping_addresses?: ShippingAddress[];
  alt_contacts?: AltContact[];

  // Finance
  default_currency?: string;
  ar_control_acct_id?: string;
  revenue_acct_id?: string;
  tax_output_acct_id?: string;
  discount_acct_id?: string;
  bad_debt_acct_id?: string;
  allowance_acct_id?: string;
  forex_gain_acct_id?: string;
  forex_loss_acct_id?: string;
  payment_term_id?: string;
  credit_limit?: number;
  credit_rating?: CreditRating;
  e_invoice_enabled?: boolean;

  // Group & parent
  customer_group_id?: string;
  parent_id?: string;
}

export interface UpdateCustomerRequest {
  customer_name?: string;
  short_name?: string;
  customer_type?: CustomerType;
  registration_no?: string;
  tax_id?: string;

  bill_addr_line1?: string;
  bill_addr_line2?: string;
  bill_city?: string;
  bill_state?: string;
  bill_postal?: string;
  bill_country?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  shipping_addresses?: ShippingAddress[];
  alt_contacts?: AltContact[];

  default_currency?: string;
  ar_control_acct_id?: string;
  revenue_acct_id?: string;
  tax_output_acct_id?: string;
  discount_acct_id?: string;
  bad_debt_acct_id?: string;
  allowance_acct_id?: string;
  forex_gain_acct_id?: string;
  forex_loss_acct_id?: string;
  payment_term_id?: string;
  e_invoice_enabled?: boolean;
  customer_group_id?: string;
  parent_id?: string;
}

export interface UpdateCreditLimitRequest {
  new_credit_limit: number;
  reason: string;
}

export interface UpdateCreditRatingRequest {
  new_credit_rating: CreditRating;
  reason: string;
}

export interface UpdateCustomerStatusRequest {
  new_status: CustomerStatus;
  reason: string;
}

export interface CustomerListFilters {
  status?: CustomerStatus;
  customer_type?: CustomerType;
  customer_group_id?: string;
  bill_country?: string;
  credit_rating?: CreditRating;
  search?: string;           // Searches customer_name, short_name, customer_id
  include_deleted?: boolean;
}

// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Shared Constants
// All constants referenced across multiple Edge Functions
// ============================================================================

// ─── Customer Constants ─────────────────────────────────────────────────────

export const CUSTOMER_TYPES = ['Corporate', 'Individual', 'Government', 'Intercompany'] as const;
export const CUSTOMER_STATUSES = ['Active', 'Inactive', 'Blocked', 'On Hold'] as const;
export const CREDIT_RATINGS = ['AAA', 'AA', 'A', 'B', 'C', 'D'] as const;

/** Allowed special characters in customer names (PRD Part 1 §2.1 #2) */
export const CUSTOMER_NAME_ALLOWED_SPECIAL = ['&', '.', ',', '-', '(', ')'];

/** Role hierarchy: lower number = higher authority */
export const ROLE_HIERARCHY: Record<string, number> = {
  'Finance Manager': 1,
  'AR Supervisor':   2,
  'AR Clerk':        3,
  'System Admin':    4,
  'Auditor':         5,
};

/** Credit rating order (higher number = worse rating) */
export const CREDIT_RATING_ORDER: Record<string, number> = {
  'AAA':         1,
  'AA':          2,
  'A':           3,
  'B':           4,
  'C':           5,
  'D':           0,
};

/** Valid status transitions (PRD Part 1 §2.1 Status Flow Rules) */
export const CUSTOMER_STATUS_TRANSITIONS: Record<string, string[]> = {
  'Active':   ['Inactive', 'On Hold', 'Blocked'],
  'Inactive': ['Active'],
  'On Hold':  ['Active', 'Blocked'],
  'Blocked':  ['Active'],  // Only Finance Manager can unblock
};

// ─── Credit Control Constants ───────────────────────────────────────────────

export const CREDIT_LIMIT_ADJUSTMENT = {
  AR_SUPERVISOR_MAX_PCT: 20,  // AR Supervisor can adjust ±20%
};

// ─── Invoice Constants ──────────────────────────────────────────────────────

export const DOC_TYPES = ['Invoice', 'Credit Note', 'Debit Note'] as const;
export const INVOICE_STATUSES = ['Draft', 'Open', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled', 'Written Off'] as const;
export const CN_TYPES = ['Linked', 'Standalone'] as const;
export const REASON_CODES = ['Return', 'Discount', 'Price Adjustment', 'Error Correction', 'Other'] as const;

/** Terminal statuses — no further status changes allowed */
export const TERMINAL_STATUSES = ['Paid', 'Cancelled', 'Written Off'] as const;

/** Statuses included in credit utilization calculation */
export const CREDIT_UTIL_STATUSES = ['Open', 'Overdue', 'Partially Paid'] as const;

// ─── Receipt Constants ──────────────────────────────────────────────────────

export const PAYMENT_METHODS = ['CHQ', 'TT', 'CASH', 'CC', 'GIRO', 'OFST', 'ONLN'] as const;
export const RECEIPT_STATUSES = ['Draft', 'Posted', 'Fully Allocated', 'Cancelled', 'Bounced'] as const;

// ─── System Config Keys ─────────────────────────────────────────────────────

export const CONFIG_KEYS = {
  DEFAULT_AR_CONTROL_ACCT: 'default_ar_control_account',
  DEFAULT_REVENUE_ACCT: 'default_revenue_account',
  DEFAULT_TAX_OUTPUT_ACCT: 'default_tax_output_account',
  DEFAULT_DISCOUNT_ACCT: 'default_discount_account',
  DEFAULT_BAD_DEBT_ACCT: 'default_bad_debt_account',
  DEFAULT_ALLOWANCE_ACCT: 'default_allowance_account',
  DEFAULT_FOREX_GAIN_ACCT: 'default_forex_gain_account',
  DEFAULT_FOREX_LOSS_ACCT: 'default_forex_loss_account',
  DEFAULT_BANK_ACCT: 'default_bank_account',
  DEFAULT_CHEQUE_ACCT: 'default_cheque_account',
  INVOICE_FUTURE_DAYS_LIMIT: 'invoice_future_days_limit',
  CREDIT_CHECK_ENABLED: 'credit_check_enabled',
  AUTO_OVERDUE_ENABLED: 'auto_overdue_enabled',
  OVERDUE_HOLD_DAYS: 'overdue_hold_days',
};

// ─── Pagination Defaults ────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ─── Country Defaults ───────────────────────────────────────────────────────

/** Default values for country-specific settings */
export const COUNTRY_DEFAULTS: Record<string, { currency: string; tax_type: string }> = {
  MY: { currency: 'MYR', tax_type: 'SST' },
  SG: { currency: 'SGD', tax_type: 'GST' },
  US: { currency: 'USD', tax_type: 'Sales Tax' },
  GB: { currency: 'GBP', tax_type: 'VAT' },
  AU: { currency: 'AUD', tax_type: 'GST' },
  HK: { currency: 'HKD', tax_type: 'None' },
};

// ─── Customer Type Account Mapping ──────────────────────────────────────────

/** Default GL account code prefixes by customer type */
export const CUSTOMER_TYPE_ACCOUNT_MAP: Record<string, { ar: string; revenue: string }> = {
  Corporate:     { ar: '1100-001', revenue: '4000-001' },
  Individual:    { ar: '1100-002', revenue: '4000-002' },
  Government:    { ar: '1100-003', revenue: '4000-003' },
  Intercompany:  { ar: '1100-004', revenue: '4500-001' },
};

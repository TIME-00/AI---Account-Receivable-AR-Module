// ============================================================================
// TSH Synergy AR — Frontend Monetary / Multi-Currency Contract Types
// Mirrors backend/supabase/functions/reports/monetary-contracts.ts and the
// FX read-contract enrichment in _shared/fx-read-contracts.ts EXACTLY.
//
// Batch 9D-D. These are the ONLY authoritative sources of company-base amounts
// and per-currency aggregation. The frontend must never derive a mixed-currency
// company-base total itself — always consume base_total / by_currency here.
// ============================================================================

// ─── Normalization / amount basis discriminators ────────────────────────────
// Mirror the backend string constants; used to label the accounting basis of a
// company-base total in the UI (never inferred client-side).

export type NormalizationBasis =
  | "current_balance_x_booked_rate"
  | "original_booked_base_snapshot"
  | "stored_booked_base_snapshot";

export type SummaryAmountBasis =
  | "current_outstanding"
  | "current_unallocated"
  | "original_document_total";

// ─── Per-currency aggregation ───────────────────────────────────────────────

/** One transaction-currency subtotal within a mixed-currency collection. */
export interface CurrencyTotal {
  currency: string;
  /** Native transaction-currency subtotal (NEVER summed across currencies). */
  amount: number;
  /** Company-base equivalent from stored booking snapshots. */
  base_amount: number;
  count: number;
}

export interface MonetaryAggregationMeta {
  base_currency: string;
  multi_currency: boolean;
  normalization_basis: NormalizationBasis;
}

/**
 * Authoritative summary for a set of rows. `base_total` is the only correct
 * company-base total; `by_currency` supplies per-currency native subtotals.
 */
export interface MonetarySummary {
  row_count: number;
  amount_basis: SummaryAmountBasis;
  base_total: number;
  base_currency: string;
  by_currency: CurrencyTotal[];
  meta: MonetaryAggregationMeta;
}

/** Attached to invoice/receipt collection responses via `meta.summary`. */
export interface MonetaryCollectionSummary {
  current_balance_summary: MonetarySummary;
  document_total_summary: MonetarySummary;
}

// ─── FX booking-decision read enrichment (invoice / receipt rows & detail) ───
// Mirrors _shared/fx-read-contracts.ts + service.ts attachFxDecisionReadSummary.

export type FxPostingEligibilityReason =
  | "missing_decision"
  | "stale_decision"
  | "non_current_decision"
  | "pending_approval"
  | "rejected"
  | "blocked"
  | "inconsistent_state"
  | "approved"
  | "not_required";

export interface FxPostingEligibility {
  gate: "fx_governance";
  eligible: boolean;
  reason: FxPostingEligibilityReason;
}

/** Canonical FX booking-rate provenance source categories (Batch 9D-C/9D-D). */
export type FxSourceCategory =
  | "BASE_PARITY"
  | "CATALOG"
  | "REFERENCE_SELECTED"
  | "MANUAL_OVERRIDE"
  | "LEGACY_UNVERIFIED";

/** Approval status of an FX booking-rate decision (migration 022 CHECK). */
export type FxApprovalStatus = "NotRequired" | "Pending" | "Approved" | "Rejected";

/** Lifecycle status of an FX booking-rate decision (migration 022 CHECK). */
export type FxLifecycleStatus =
  | "Draft"
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Superseded"
  | "Posted";

/**
 * Governance decision snapshot attached to an invoice/receipt read.
 *
 * Every field is REQUIRED: `attachFxDecisionReadSummary` builds this object
 * eagerly and coerces each field (e.g. `Number(decision.booked_rate)`), so a
 * present decision always carries a complete shape. Only the fields the backend
 * explicitly emits as nullable are nullable here.
 */
export interface FxDecisionReadSummary {
  id: string;
  /** DB CHECK-constrained to exactly these five categories (migration 022). */
  source_category: FxSourceCategory;
  approval_status: FxApprovalStatus;
  lifecycle_status: FxLifecycleStatus;
  decision_version: number;
  root_decision_id: string;
  supersedes_decision_id: string | null;
  import_origin: Record<string, unknown> | null;
  booked_rate: number;
  deviation_pct: number | null;
  stale_reference: boolean;
  fx_posting_eligible: boolean;
}

/**
 * Fields merged onto Invoice/Receipt by the backend read enrichment.
 *
 * B9DD-FEIR-009: these are REQUIRED, not optional. Every invoice/receipt read
 * path runs `attachFxDecisionReadSummary` — list (`listInvoices`/`listReceipts`),
 * detail (`getInvoiceById`/`getReceiptById`), create and post — and that helper
 * unconditionally sets `base_available`, `fx_posting_eligibility` and
 * `fx_decision` on every row. Typing them optional invited `?.` chains that
 * silently degraded to a "no decision" presentation, hiding real contract drift.
 */
export interface FxReadEnrichment {
  /**
   * True when a stored company-base amount is present and finite. When false,
   * the UI must show an explicit unavailable state — never a fabricated rate.
   */
  base_available: boolean;
  fx_posting_eligibility: FxPostingEligibility;
  /** Null when the document has no governing decision (a real, expected state). */
  fx_decision: FxDecisionReadSummary | null;
  /** FK to the governing decision; null when the document is not FX-governed. */
  fx_decision_id: string | null;
}

// ─── Customer statement contract ────────────────────────────────────────────
// Mirrors reports/service.ts StatementLine + CustomerStatement EXACTLY.

export interface StatementCurrencyBalance {
  currency: string;
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
}

/**
 * One statement movement.
 *
 * `transaction_balance` / `balance` are nullable: a running transaction-currency
 * balance is only meaningful for a single-currency statement, and the backend
 * emits null for them when the period spans multiple currencies. `base_balance`
 * is always a number because the company-base running balance is always valid.
 */
export interface StatementLine {
  date: string;
  doc_type: string;
  doc_no: string;
  description: string;
  currency: string;
  exchange_rate: number;
  transaction_debit: number;
  transaction_credit: number;
  transaction_balance: number | null;
  debit: number;
  credit: number;
  balance: number | null;
  base_currency: string;
  base_debit: number;
  base_credit: number;
  base_balance: number;
  /** Always the stored booked-base snapshot basis for statement lines. */
  amount_basis: "stored_booked_base_snapshot";
}

/**
 * Authoritative customer statement (`GET /reports/statement/:customerId`).
 *
 * Legacy transaction-currency aggregates (`opening_balance`, `closing_balance`,
 * `total_debit`, `total_credit`) are nullable — they are only valid for a
 * single-currency statement and the backend nulls them otherwise. The
 * company-base equivalents (`*_base`) are always present.
 */
export interface CustomerStatement {
  customer_id: string;
  customer_name: string;
  customer_code: string;
  address: string;
  period_from: string;
  period_to: string;
  opening_balance: number | null;
  lines: StatementLine[];
  closing_balance: number | null;
  total_debit: number | null;
  total_credit: number | null;
  base_currency: string;
  opening_balance_base: number;
  closing_balance_base: number;
  total_debit_base: number;
  total_credit_base: number;
  by_currency: StatementCurrencyBalance[];
  meta: MonetaryAggregationMeta;
  legacy_amount_basis: "transaction_currency_legacy";
  /** False when the statement spans >1 currency, making legacy fields invalid. */
  legacy_transaction_fields_valid: boolean;
  legacy_transaction_currency: string | null;
}

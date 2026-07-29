// ============================================================================
// TSH Synergy AR — Gate D strict versioned monetary-summary boundary parser.
//
// One fail-closed parser for the Invoice/Receipt collection `meta.summary`.
// It mirrors backend/supabase/functions/reports/monetary-contracts.ts EXACTLY
// and is the ONLY place raw summary JSON is validated. Pages and components
// must consume the normalized, explicitly-versioned model this returns — never
// the raw API shape — so a v1 (pre-Migration-033) legacy total can never be
// presented as verified v2 authority, and a malformed contract fails closed.
// ============================================================================

// ─── Exact enum domains (must match the backend contract verbatim) ──────────

export const AMOUNT_BASES = [
  "current_outstanding",
  "current_unallocated",
  "original_document_total",
] as const;
export type AmountBasis = (typeof AMOUNT_BASES)[number];

export const NORMALIZATION_BASES = [
  "current_balance_x_booked_rate",
  "original_booked_base_snapshot",
  "stored_booked_base_snapshot",
] as const;
export type NormalizationBasis = (typeof NORMALIZATION_BASES)[number];

export const AUTHORITY_BASIS = "current_consistent_booked_fx_decision" as const;

// ─── Normalized, explicitly-versioned frontend model ────────────────────────

export interface ParsedCurrencyGroupV1 {
  currency: string;
  /** Native transaction-currency subtotal (compat numeric; never aggregated). */
  amount: number;
  /** Legacy company-base numeric — compatibility only, NEVER authoritative. */
  legacyBaseAmount: number;
  count: number;
}

export interface ParsedSummaryV1 {
  contractVersion: 1;
  amountBasis: AmountBasis;
  normalizationBasis: NormalizationBasis;
  baseCurrency: string;
  rowCount: number;
  multiCurrency: boolean;
  byCurrency: ParsedCurrencyGroupV1[];
  /** Legacy numeric base total — compatibility data only, never verified. */
  legacyBaseTotal: number;
}

export interface ParsedCurrencyGroupV2 {
  currency: string;
  /** Exact native decimal string (preserved verbatim; never parsed to number). */
  amount: string;
  /** Exact authoritative company-base decimal string; null when none authoritative. */
  baseAmount: string | null;
  count: number;
  authoritativeDocumentCount: number;
  unavailableCount: number;
  baseAvailable: boolean;
}

export interface ParsedSummaryV2 {
  contractVersion: 2;
  amountBasis: AmountBasis;
  normalizationBasis: NormalizationBasis;
  authorityBasis: typeof AUTHORITY_BASIS;
  baseCurrency: string;
  rowCount: number;
  matchingDocumentCount: number;
  authoritativeDocumentCount: number;
  unavailableCount: number;
  baseAvailable: boolean;
  multiCurrency: boolean;
  /** Exact authoritative base decimal string; null when nothing is authoritative. */
  baseTotal: string | null;
  byCurrency: ParsedCurrencyGroupV2[];
  unavailableByCurrency: Array<{ currency: string; documentCount: number }>;
}

export type ParsedSummary = ParsedSummaryV1 | ParsedSummaryV2;

export interface ParsedCollectionSummary {
  contractVersion: 1 | 2;
  currentBalance: ParsedSummary;
  documentTotal: ParsedSummary;
}

/** Internal, non-leaking parse failure. Callers map this to a safe UI state. */
export class MonetarySummaryParseError extends Error {
  constructor(message = "monetary summary contract invalid") {
    super(message);
    this.name = "MonetarySummaryParseError";
  }
}

// ─── Primitive validators ───────────────────────────────────────────────────

// Money is emitted by the backend via TO_CHAR('FM…0.00'): a signed integer part
// (no leading zeros except a lone "0") and EXACTLY two fractional digits. No
// exponent, no "NaN"/"Infinity", no thousands separators.
const DECIMAL_RE = /^-?(?:0|[1-9]\d*)\.\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

function fail(): never {
  throw new MonetarySummaryParseError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  // The backend contract is exact — reject any unexpected key so silent drift
  // cannot smuggle in unvalidated fields.
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail();
  }
}

function requireDecimalString(value: unknown): string {
  if (typeof value !== "string" || !DECIMAL_RE.test(value)) fail();
  return value as string;
}

function requireNullableDecimalString(value: unknown): string | null {
  if (value === null) return null;
  return requireDecimalString(value);
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail();
  return value;
}

function requireNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function requireCurrency(value: unknown): string {
  if (typeof value !== "string" || !CURRENCY_RE.test(value)) fail();
  return value;
}

function requireAmountBasis(value: unknown, expected: AmountBasis): AmountBasis {
  if (value !== expected) fail();
  return expected;
}

function requireNormalizationBasis(value: unknown, expected: NormalizationBasis): NormalizationBasis {
  if (value !== expected) fail();
  return expected;
}

// ─── v1 (pre-Migration-033) parser ──────────────────────────────────────────

const V1_META_KEYS = ["base_currency", "multi_currency", "normalization_basis"];
const V1_SUMMARY_KEYS = ["row_count", "amount_basis", "base_total", "base_currency", "by_currency", "meta"];
const V1_GROUP_KEYS = ["currency", "amount", "base_amount", "count"];

function parseV1Summary(
  raw: unknown,
  amountBasis: AmountBasis,
  normalizationBasis: NormalizationBasis,
): ParsedSummaryV1 {
  if (!isRecord(raw)) fail();
  asExactKeys(raw, V1_SUMMARY_KEYS);
  if (!isRecord(raw.meta)) fail();
  asExactKeys(raw.meta, V1_META_KEYS);

  // v1 meta carries no contract_version.
  if ("contract_version" in raw.meta) fail();

  const rowCount = requireNonNegativeInt(raw.row_count);
  requireAmountBasis(raw.amount_basis, amountBasis);
  requireNormalizationBasis(raw.meta.normalization_basis, normalizationBasis);
  const baseCurrency = requireCurrency(raw.base_currency);
  if (requireCurrency(raw.meta.base_currency) !== baseCurrency) fail();
  const legacyBaseTotal = requireFiniteNumber(raw.base_total);
  if (typeof raw.meta.multi_currency !== "boolean") fail();

  if (!Array.isArray(raw.by_currency)) fail();
  const byCurrency: ParsedCurrencyGroupV1[] = raw.by_currency.map((item) => {
    if (!isRecord(item)) fail();
    asExactKeys(item, V1_GROUP_KEYS);
    return {
      currency: requireCurrency(item.currency),
      amount: requireFiniteNumber(item.amount),
      legacyBaseAmount: requireFiniteNumber(item.base_amount),
      count: requireNonNegativeInt(item.count),
    };
  });
  assertAscendingUnique(byCurrency.map((g) => g.currency));

  return {
    contractVersion: 1,
    amountBasis,
    normalizationBasis,
    baseCurrency,
    rowCount,
    multiCurrency: raw.meta.multi_currency,
    byCurrency,
    legacyBaseTotal,
  };
}

// ─── v2 (Migration-033) parser ──────────────────────────────────────────────

const V2_META_KEYS = ["contract_version", "base_currency", "multi_currency", "normalization_basis", "authority_basis"];
const V2_SUMMARY_KEYS = [
  "row_count",
  "matching_document_count",
  "authoritative_document_count",
  "unavailable_count",
  "base_available",
  "amount_basis",
  "base_currency",
  "base_total",
  "by_currency",
  "unavailable_by_currency",
  "meta",
];
const V2_GROUP_KEYS = [
  "currency",
  "amount",
  "base_amount",
  "count",
  "authoritative_document_count",
  "unavailable_count",
  "base_available",
];
const V2_UNAVAIL_KEYS = ["currency", "document_count"];

function assertAscendingUnique(currencies: string[]): void {
  for (let i = 1; i < currencies.length; i += 1) {
    // Strictly ascending ⇒ ordered AND no duplicates.
    if (!(currencies[i - 1] < currencies[i])) fail();
  }
}

function parseV2Summary(
  raw: unknown,
  amountBasis: AmountBasis,
  normalizationBasis: NormalizationBasis,
): ParsedSummaryV2 {
  if (!isRecord(raw)) fail();
  asExactKeys(raw, V2_SUMMARY_KEYS);
  if (!isRecord(raw.meta)) fail();
  asExactKeys(raw.meta, V2_META_KEYS);

  if (raw.meta.contract_version !== 2) fail();
  if (raw.meta.authority_basis !== AUTHORITY_BASIS) fail();
  requireNormalizationBasis(raw.meta.normalization_basis, normalizationBasis);
  if (typeof raw.meta.multi_currency !== "boolean") fail();

  const rowCount = requireNonNegativeInt(raw.row_count);
  const matchingDocumentCount = requireNonNegativeInt(raw.matching_document_count);
  const authoritativeDocumentCount = requireNonNegativeInt(raw.authoritative_document_count);
  const unavailableCount = requireNonNegativeInt(raw.unavailable_count);
  requireAmountBasis(raw.amount_basis, amountBasis);
  const baseCurrency = requireCurrency(raw.base_currency);
  if (requireCurrency(raw.meta.base_currency) !== baseCurrency) fail();
  if (typeof raw.base_available !== "boolean") fail();
  const baseTotal = requireNullableDecimalString(raw.base_total);

  // Overall invariants.
  if (rowCount !== matchingDocumentCount) fail();
  if (authoritativeDocumentCount + unavailableCount !== matchingDocumentCount) fail();
  if (raw.base_available !== (unavailableCount === 0)) fail();
  // base_total nullability: null iff nothing authoritative; "0.00" only when empty.
  if (authoritativeDocumentCount === 0) {
    if (matchingDocumentCount === 0) {
      if (baseTotal !== "0.00") fail();
    } else if (baseTotal !== null) fail();
  } else if (baseTotal === null) fail();

  if (!Array.isArray(raw.by_currency)) fail();
  if (!Array.isArray(raw.unavailable_by_currency)) fail();

  let groupAuthoritativeSum = 0;
  let groupUnavailableSum = 0;
  const byCurrency: ParsedCurrencyGroupV2[] = raw.by_currency.map((item) => {
    if (!isRecord(item)) fail();
    asExactKeys(item, V2_GROUP_KEYS);
    const currency = requireCurrency(item.currency);
    const amount = requireDecimalString(item.amount);
    const count = requireNonNegativeInt(item.count);
    if (count === 0) fail(); // no zero-count group
    const gAuth = requireNonNegativeInt(item.authoritative_document_count);
    const gUnavail = requireNonNegativeInt(item.unavailable_count);
    if (typeof item.base_available !== "boolean") fail();
    const baseAmount = requireNullableDecimalString(item.base_amount);
    if (gAuth + gUnavail !== count) fail();
    if (item.base_available !== (gUnavail === 0)) fail();
    // group base_amount: null iff none authoritative; non-null (partial/full) otherwise.
    if (gAuth === 0) {
      if (baseAmount !== null) fail();
    } else if (baseAmount === null) fail();
    groupAuthoritativeSum += gAuth;
    groupUnavailableSum += gUnavail;
    return {
      currency,
      amount,
      baseAmount,
      count,
      authoritativeDocumentCount: gAuth,
      unavailableCount: gUnavail,
      baseAvailable: item.base_available,
    };
  });
  assertAscendingUnique(byCurrency.map((g) => g.currency));

  // Group counts reconcile to overall counts.
  if (groupAuthoritativeSum !== authoritativeDocumentCount) fail();
  if (groupUnavailableSum !== unavailableCount) fail();

  const unavailableByCurrency = raw.unavailable_by_currency.map((item) => {
    if (!isRecord(item)) fail();
    asExactKeys(item, V2_UNAVAIL_KEYS);
    const currency = requireCurrency(item.currency);
    const documentCount = requireNonNegativeInt(item.document_count);
    if (documentCount === 0) fail();
    return { currency, documentCount };
  });
  assertAscendingUnique(unavailableByCurrency.map((g) => g.currency));

  // unavailable_by_currency must reconcile exactly with the by_currency unavailable groups.
  const expectedUnavailable = new Map(
    byCurrency.filter((g) => g.unavailableCount > 0).map((g) => [g.currency, g.unavailableCount]),
  );
  if (unavailableByCurrency.length !== expectedUnavailable.size) fail();
  for (const u of unavailableByCurrency) {
    if (expectedUnavailable.get(u.currency) !== u.documentCount) fail();
  }

  return {
    contractVersion: 2,
    amountBasis,
    normalizationBasis,
    authorityBasis: AUTHORITY_BASIS,
    baseCurrency,
    rowCount,
    matchingDocumentCount,
    authoritativeDocumentCount,
    unavailableCount,
    baseAvailable: raw.base_available,
    multiCurrency: raw.meta.multi_currency,
    baseTotal,
    byCurrency,
    unavailableByCurrency,
  };
}

// ─── Collection entrypoint ──────────────────────────────────────────────────

export interface ParseOptions {
  /** The amount basis expected for `current_balance_summary` (invoice vs receipt). */
  currentAmountBasis: Extract<AmountBasis, "current_outstanding" | "current_unallocated">;
}

/**
 * Parse a raw `{ current_balance_summary, document_total_summary }` envelope.
 * Both summaries must be entirely v1 or entirely v2 — a mixed structure fails
 * closed. Throws {@link MonetarySummaryParseError} on any contract violation.
 */
export function parseCollectionSummary(raw: unknown, options: ParseOptions): ParsedCollectionSummary {
  if (!isRecord(raw)) fail();
  asExactKeys(raw, ["current_balance_summary", "document_total_summary"]);
  if (!isRecord(raw.current_balance_summary) || !isRecord(raw.document_total_summary)) fail();

  const currentMeta = isRecord(raw.current_balance_summary.meta) ? raw.current_balance_summary.meta : {};
  const documentMeta = isRecord(raw.document_total_summary.meta) ? raw.document_total_summary.meta : {};
  const currentVersion = (currentMeta as Record<string, unknown>).contract_version;
  const documentVersion = (documentMeta as Record<string, unknown>).contract_version;

  const isV1 = currentVersion === undefined && documentVersion === undefined;
  const isV2 = currentVersion === 2 && documentVersion === 2;
  if (!isV1 && !isV2) fail(); // mixed or unknown version → fail closed

  if (isV2) {
    return {
      contractVersion: 2,
      currentBalance: parseV2Summary(
        raw.current_balance_summary,
        options.currentAmountBasis,
        "current_balance_x_booked_rate",
      ),
      documentTotal: parseV2Summary(
        raw.document_total_summary,
        "original_document_total",
        "original_booked_base_snapshot",
      ),
    };
  }

  return {
    contractVersion: 1,
    currentBalance: parseV1Summary(
      raw.current_balance_summary,
      options.currentAmountBasis,
      "current_balance_x_booked_rate",
    ),
    documentTotal: parseV1Summary(
      raw.document_total_summary,
      "original_document_total",
      "original_booked_base_snapshot",
    ),
  };
}

/** Public, non-leaking fallback copy for a summary that failed to parse. */
export const SUMMARY_UNAVAILABLE_MESSAGE = "Summary data is unavailable.";

/** Format an already-validated decimal string without numeric coercion. */
export function formatExactDecimal(value: string): string {
  const [whole, fraction] = value.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

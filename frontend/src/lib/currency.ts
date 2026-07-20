// ============================================================================
// TSH Synergy AR — Multi-Currency display & aggregation helpers (Batch 9D-D)
//
// Canonical, currency-explicit money formatting plus presentation-only grouping
// guards. Financial authority lives in the backend; nothing here derives a
// mixed-currency company-base total or invents a currency.
// ============================================================================

import type { CurrencyTotal } from "@/types/monetary";

/**
 * Currencies supported for validated multi-currency handling in Batch 9D-D.
 * All are minor-unit-2 (DECIMAL(18,2)). Non-2-decimal currencies (JPY, KWD…)
 * are intentionally out of scope and are NOT listed here.
 */
export const SUPPORTED_CURRENCIES = ["MYR", "SGD", "USD", "EUR", "GBP", "CNY"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Display names for the creation allow-list (B9DD-FEIR-006 §8). */
export const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
  MYR: "Malaysian Ringgit",
  SGD: "Singapore Dollar",
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  CNY: "Chinese Yuan",
};

/**
 * Canonical option list for Invoice and Receipt creation currency selectors.
 * Both document families must offer the SAME operational currencies — deriving
 * both selectors from this single list is what keeps them consistent.
 */
export const SUPPORTED_CURRENCY_OPTIONS: ReadonlyArray<{ value: SupportedCurrency; label: string }> =
  SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: `${code} — ${CURRENCY_LABELS[code]}` }));

/** All Batch 9D-D supported currencies use 2 display decimals. */
export const DISPLAY_DECIMALS = 2;

/** Sentinel shown when a currency code is genuinely absent (never "MYR"). */
export const UNKNOWN_CURRENCY_LABEL = "—";

/**
 * True when `code` is in the Batch 9D-D creation allow-list.
 *
 * NOTE (B9DD-FEIR-006 §9): this gates what may be *created*, not what may be
 * *displayed*. Historical documents may carry any ISO-4217 code (a currency the
 * company has since stopped transacting in), and the display path
 * (`normalizeCurrency` / `formatMoney` / `formatMoneySafe`) deliberately does
 * NOT consult this allow-list — such records still render with their real code.
 */
export function isSupportedCurrency(code: string | null | undefined): code is SupportedCurrency {
  return typeof code === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(code.toUpperCase());
}

/** Normalize a currency code for display/grouping; empty/nullish → null (never MYR). */
export function normalizeCurrency(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Format the numeric part of a money value to the currency's display precision.
 * Presentation only — it must NEVER be used to produce a total or comparison
 * value; the backend supplies authoritative amounts.
 */
export function formatMoneyNumber(amount: number): string {
  return new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: DISPLAY_DECIMALS,
    maximumFractionDigits: DISPLAY_DECIMALS,
  }).format(amount);
}

/**
 * Format a money value WITH an explicit currency code. There is deliberately no
 * currency default — a caller that has no currency must pass one explicitly or
 * use {@link formatMoneySafe}. This is the canonical money formatter.
 * @example formatMoney(1234.5, "USD") → "USD 1,234.50"
 */
export function formatMoney(amount: number, currency: string): string {
  const code = normalizeCurrency(currency);
  return `${code ?? UNKNOWN_CURRENCY_LABEL} ${formatMoneyNumber(amount)}`;
}

/**
 * Like {@link formatMoney} but tolerant of a missing currency: renders the
 * amount with an explicit "no currency" sentinel rather than silently assuming
 * a base/company currency. Use only where a legacy record may lack a code.
 */
export function formatMoneySafe(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) {
    return "Not available";
  }
  const code = normalizeCurrency(currency);
  if (!code) return `${UNKNOWN_CURRENCY_LABEL} ${formatMoneyNumber(Number(amount))}`;
  return `${code} ${formatMoneyNumber(Number(amount))}`;
}

// ─── Presentation-only per-currency grouping ────────────────────────────────

export interface CurrencyGroup<T> {
  currency: string;
  rows: T[];
}

/**
 * Group already-authoritative rows by their transaction currency for display.
 * This performs NO arithmetic across currencies — it only partitions rows. Any
 * per-currency subtotal must come from the backend `by_currency` contract, not
 * from re-summing these rows.
 */
export function groupRowsByCurrency<T>(rows: T[], getCurrency: (row: T) => string | null | undefined): CurrencyGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const code = normalizeCurrency(getCurrency(row)) ?? UNKNOWN_CURRENCY_LABEL;
    const bucket = groups.get(code) ?? [];
    bucket.push(row);
    groups.set(code, bucket);
  }
  return [...groups.entries()]
    .map(([currency, groupedRows]) => ({ currency, rows: groupedRows }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** True when a set of rows spans more than one distinct transaction currency. */
export function isMixedCurrency(currencies: Array<string | null | undefined>): boolean {
  const distinct = new Set(currencies.map((c) => normalizeCurrency(c) ?? UNKNOWN_CURRENCY_LABEL));
  return distinct.size > 1;
}

export interface CurrencySubtotal {
  currency: string;
  amount: number;
  count: number;
}

/**
 * Sum amounts GROUPED BY currency. Amounts are only ever added within the same
 * currency — there is deliberately no cross-currency grand total. This is the
 * safe client-side replacement for a `rows.reduce((s, r) => s + r.amount, 0)`
 * that would otherwise conflate multiple transaction currencies.
 */
export function sumByCurrency<T>(
  rows: T[],
  getCurrency: (row: T) => string | null | undefined,
  getAmount: (row: T) => number,
): CurrencySubtotal[] {
  const totals = new Map<string, CurrencySubtotal>();
  for (const row of rows) {
    const currency = normalizeCurrency(getCurrency(row)) ?? UNKNOWN_CURRENCY_LABEL;
    const existing = totals.get(currency) ?? { currency, amount: 0, count: 0 };
    existing.amount += getAmount(row);
    existing.count += 1;
    totals.set(currency, existing);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Guard used by tests and defensive UI: assert that a backend by_currency
 * breakdown was NOT collapsed into a single cross-currency native total. Returns
 * the distinct currency count; a single native "total" over >1 currency is a
 * contract violation and callers should render per-currency subtotals instead.
 */
export function distinctCurrencyCount(byCurrency: CurrencyTotal[]): number {
  return new Set(byCurrency.map((c) => normalizeCurrency(c.currency) ?? UNKNOWN_CURRENCY_LABEL)).size;
}

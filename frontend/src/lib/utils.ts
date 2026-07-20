import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx and tailwind-merge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Batch 9D-D (B9DD-FEIR-006): the default-MYR `formatCurrency(amount, currency = "MYR")`
// helper has been REMOVED rather than deprecated. A runtime default silently
// mislabels foreign-currency and company-base amounts, and a doc comment cannot
// prevent that. The canonical money formatters now live in `@/lib/currency`:
//
//   formatMoney(amount, currency)      — currency is a REQUIRED parameter
//   formatMoneySafe(amount, currency)  — renders an explicit unavailable state
//
// Both make the currency part of the function signature, so a codeless monetary
// render is a compile-time type error rather than a silent "MYR" assumption.

/**
 * Format a number as a plain amount with NO currency code.
 *
 * Use ONLY where the currency is unambiguously supplied by the immediate
 * surrounding context (e.g. a column header or row that already states the
 * transaction currency). For any standalone monetary value, use `formatMoney`
 * or `formatMoneySafe` from `@/lib/currency` so the currency travels with the
 * number.
 */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a date string to human-readable format.
 * @example formatDate("2026-03-29") → "29 Mar 2026"
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Calculate percentage with 1 decimal.
 */
export function pct(value: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

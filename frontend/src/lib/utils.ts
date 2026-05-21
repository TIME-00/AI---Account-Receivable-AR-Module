import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx and tailwind-merge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as currency with 2 decimal places.
 * @example formatCurrency(1234.5) → "MYR 1,234.50"
 * @example formatCurrency(1234.5, "USD") → "USD 1,234.50"
 */
export function formatCurrency(amount: number, currency: string = "MYR"): string {
  const formatted = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency} ${formatted}`;
}

/**
 * Format a number as plain currency (no currency code).
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

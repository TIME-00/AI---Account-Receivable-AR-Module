"use client";

import { cn } from "@/lib/utils";
import { formatMoneyNumber, type CurrencySubtotal } from "@/lib/currency";
import type { CurrencyTotal } from "@/types/monetary";

interface CurrencySubtotalsProps {
  subtotals: CurrencySubtotal[];
  /** Amount colour class (e.g. "text-amber-600"). */
  color?: string;
  className?: string;
  /** Shown when there are no rows. */
  emptyLabel?: string;
}

interface CurrencyTotalsProps {
  /** Backend-authoritative per-currency breakdown (`by_currency`). */
  byCurrency: CurrencyTotal[];
  color?: string;
  className?: string;
  emptyLabel?: string;
}

/**
 * Renders the backend's authoritative `by_currency` breakdown verbatim: one
 * native subtotal per transaction currency, and never a cross-currency total.
 *
 * Prefer this over {@link CurrencySubtotals} wherever the backend supplies a
 * summary — these numbers are computed server-side over the full filtered
 * collection, so they are exact regardless of how many rows the page shows.
 * A separate company-base total (if wanted) must come from the same summary's
 * `base_total`, rendered as its own clearly-labelled figure.
 */
export function CurrencyTotals({
  byCurrency,
  color = "text-slate-800",
  className,
  emptyLabel = "—",
}: CurrencyTotalsProps) {
  if (byCurrency.length === 0) {
    return <span className="font-mono text-sm text-slate-400">{emptyLabel}</span>;
  }
  return (
    <div className={cn("space-y-0.5", className)}>
      {byCurrency.map((c) => (
        <div key={c.currency} className={cn("font-mono font-semibold tabular-nums", color)}>
          {c.currency} {formatMoneyNumber(c.amount)}
          <span className="ml-1 text-[10px] font-normal text-slate-400">({c.count})</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders per-currency NATIVE subtotals. Deliberately shows no cross-currency
 * grand total — each line is a single-currency sum. Use where a mixed-currency
 * dataset is aggregated client-side without a backend base total.
 */
export function CurrencySubtotals({ subtotals, color = "text-slate-800", className, emptyLabel = "—" }: CurrencySubtotalsProps) {
  if (subtotals.length === 0) {
    return <span className="font-mono text-sm text-slate-400">{emptyLabel}</span>;
  }
  return (
    <div className={cn("space-y-0.5", className)}>
      {subtotals.map((s) => (
        <div key={s.currency} className={cn("font-mono text-sm font-semibold tabular-nums", color)}>
          {s.currency} {formatMoneyNumber(s.amount)}
        </div>
      ))}
    </div>
  );
}

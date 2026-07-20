"use client";

import { cn } from "@/lib/utils";
import { formatMoneyNumber, normalizeCurrency } from "@/lib/currency";
import type { MonetarySummary, NormalizationBasis, SummaryAmountBasis } from "@/types/monetary";

const BASIS_LABELS: Record<NormalizationBasis, string> = {
  current_balance_x_booked_rate: "current balance × booked rate",
  original_booked_base_snapshot: "original booked base snapshot",
  stored_booked_base_snapshot: "stored booked base snapshot",
};

const AMOUNT_BASIS_LABELS: Record<SummaryAmountBasis, string> = {
  current_outstanding: "Outstanding",
  current_unallocated: "Unapplied",
  original_document_total: "Document total",
};

interface MoneySummaryProps {
  summary: MonetarySummary;
  title?: string;
  className?: string;
}

/**
 * Authoritative aggregation display. Shows per-currency NATIVE subtotals and,
 * separately, the company-base total supplied by the backend from stored
 * booking snapshots. It never implies the base total is the arithmetic sum of
 * the native subtotals, and it never sums across currencies in the browser.
 */
export function MoneySummary({ summary, title, className }: MoneySummaryProps) {
  const { by_currency, base_total, base_currency, meta, amount_basis } = summary;
  const baseCode = normalizeCurrency(base_currency) ?? base_currency;
  const multi = meta.multi_currency || by_currency.length > 1;
  const amountLabel = AMOUNT_BASIS_LABELS[amount_basis] ?? "Total";
  const basisLabel = BASIS_LABELS[meta.normalization_basis] ?? meta.normalization_basis;

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-3", className)}>
      {title && <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>}

      {/* Per-currency native subtotals */}
      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {amountLabel} by currency
        </div>
        {by_currency.length === 0 ? (
          <div className="text-sm text-slate-400">No records</div>
        ) : (
          <ul className="space-y-0.5">
            {by_currency.map((c) => (
              <li key={c.currency} className="flex items-center justify-between gap-4 text-sm">
                <span className="text-slate-500">
                  {c.currency}
                  <span className="ml-1 text-[11px] text-slate-400">({c.count})</span>
                </span>
                <span className="font-medium tabular-nums text-slate-800">
                  {c.currency} {formatMoneyNumber(c.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Separate company-base total */}
      <div className="mt-2 border-t border-slate-100 pt-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-slate-500">
            Company-base total
            {multi && <span className="ml-1 text-[11px] text-slate-400">(converted)</span>}
          </span>
          <span className="font-semibold tabular-nums text-slate-900">
            {baseCode} {formatMoneyNumber(base_total)}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-slate-400">
          Basis: {basisLabel}
          {multi && " — not the sum of native subtotals"}
        </div>
      </div>
    </div>
  );
}

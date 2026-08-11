"use client";

import { cn } from "@/lib/utils";
import { formatMoneyNumber, type CurrencySubtotal } from "@/lib/currency";
import { formatExactDecimal } from "@/lib/monetary-summary";
import type {
  CurrencyTotal,
  NormalizedCurrencyGroupV1,
  NormalizedCurrencyGroupV2,
} from "@/types";

interface CurrencySubtotalsProps {
  subtotals: CurrencySubtotal[];
  color?: string;
  className?: string;
  emptyLabel?: string;
}

type NormalizedCurrencyGroup =
  | CurrencyTotal
  | NormalizedCurrencyGroupV1
  | NormalizedCurrencyGroupV2;

interface CurrencyTotalsProps {
  byCurrency: NormalizedCurrencyGroup[];
  baseCurrency?: string;
  showBaseContribution?: boolean;
  color?: string;
  className?: string;
  emptyLabel?: string;
}

function isV2Group(
  group: NormalizedCurrencyGroup,
): group is NormalizedCurrencyGroupV2 {
  return "baseAmount" in group;
}

function nativeAmount(group: NormalizedCurrencyGroup): string {
  return typeof group.amount === "string"
    ? formatExactDecimal(group.amount)
    : formatMoneyNumber(group.amount);
}

function BaseContribution({
  group,
  baseCurrency,
}: {
  group: NormalizedCurrencyGroup;
  baseCurrency?: string;
}) {
  if (!isV2Group(group) || !baseCurrency) return null;
  if (group.authoritativeDocumentCount === 0) {
    return (
      <span
        className="text-xs font-medium text-amber-700"
        title={`No document in this currency has a verified booked FX rate, so none contributes to the authoritative company-base (${baseCurrency}) total. Historical amounts are never re-valued at current rates.`}
      >
        Base amount unavailable
      </span>
    );
  }
  const partial = group.unavailableCount > 0;
  return (
    <span className="text-xs text-slate-500">
      {partial ? "Partial base contribution" : "Base contribution"}:{" "}
      <span className="font-medium tabular-nums text-slate-700">
        {baseCurrency} {formatExactDecimal(group.baseAmount!)}
      </span>
    </span>
  );
}

/** Render normalized server subtotals without aggregating currencies. */
export function CurrencyTotals({
  byCurrency,
  baseCurrency,
  showBaseContribution = false,
  color = "text-slate-800",
  className,
  emptyLabel = "—",
}: CurrencyTotalsProps) {
  if (byCurrency.length === 0) {
    return <span className="font-mono text-sm text-slate-400">{emptyLabel}</span>;
  }
  return (
    <ul className={cn("space-y-1", className)}>
      {byCurrency.map((group) => (
        <li key={group.currency} className="flex items-start justify-between gap-4">
          <span className="text-sm text-slate-500">
            {group.currency}
            <span className="ml-1 text-[11px] text-slate-400">({group.count})</span>
          </span>
          <span className="flex flex-col items-end">
            <span className={cn("font-mono font-semibold tabular-nums", color)}>
              {group.currency} {nativeAmount(group)}
            </span>
            {showBaseContribution && (
              <BaseContribution group={group} baseCurrency={baseCurrency} />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Legacy helper for native page-row subtotals. It remains intentionally
 * currency-separated and is never used to infer a company-base amount.
 */
export function CurrencySubtotals({
  subtotals,
  color = "text-slate-800",
  className,
  emptyLabel = "—",
}: CurrencySubtotalsProps) {
  if (subtotals.length === 0) {
    return <span className="font-mono text-sm text-slate-400">{emptyLabel}</span>;
  }
  return (
    <div className={cn("space-y-0.5", className)}>
      {subtotals.map((subtotal) => (
        <div
          key={subtotal.currency}
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            color,
          )}
        >
          {subtotal.currency} {formatMoneyNumber(subtotal.amount)}
        </div>
      ))}
    </div>
  );
}

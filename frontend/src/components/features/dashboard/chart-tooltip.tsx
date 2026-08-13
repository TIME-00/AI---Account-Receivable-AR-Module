"use client";

import { formatAmount } from "@/lib/utils";
import { useChartTheme } from "@/lib/theme/chart-theme";

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
  /**
   * Explicit currency code for the plotted values (Batch 9D-D). Dashboard
   * charts plot company-base amounts, so callers pass the company base
   * currency. Never hard-code a currency here.
   */
  currency?: string | null;
}

export function ChartTooltip({ active, payload, label, currency }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const code = currency && currency.trim().length > 0 ? currency.toUpperCase() : null;
  return (
    <div className="ds-surface-elevated px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="mt-0.5 text-sm font-semibold text-slate-900">
          {code ? `${code} ` : ""}{formatAmount(entry.value)}
        </p>
      ))}
    </div>
  );
}

/**
 * Shared style for Recharts' own inline tooltip, which renders a plain div
 * outside React's class system and therefore needs explicit themed values.
 */
export function useTooltipStyle() {
  return useChartTheme().tooltip;
}

"use client";

import { formatAmount } from "@/lib/utils";

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
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="mt-0.5 text-sm font-semibold text-slate-900">
          {code ? `${code} ` : ""}{formatAmount(entry.value)}
        </p>
      ))}
    </div>
  );
}

/** Shared tooltip style config for Recharts inline tooltips */
export const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#1e293b",
} as const;

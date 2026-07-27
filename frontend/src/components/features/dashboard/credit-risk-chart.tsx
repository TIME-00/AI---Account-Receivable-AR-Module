"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatMoneySafe } from "@/lib/currency";
import { TOOLTIP_STYLE } from "./chart-tooltip";
import { cn } from "@/lib/utils";
import { ShieldAlert, Check } from "lucide-react";

interface CreditRiskEntry {
  rating: string;
  count: number;
  amount: number;
  fill: string;
}

interface CreditRiskChartProps {
  data: CreditRiskEntry[];
  /** Company base currency (values are company-base); null when unavailable. */
  currency: string | null;
  isLoading?: boolean;
  /**
   * When provided, each rating becomes an actionable drill-down control
   * (keyboard + pointer). Selecting a rating opens the authoritative
   * customer-aging view filtered to that rating — no client-side filtering.
   */
  onSelectRating?: (rating: string) => void;
  /** Currently active rating, rendered with a non-colour-only selected state. */
  activeRating?: string | null;
}

export function CreditRiskChart({
  data,
  currency,
  isLoading = false,
  onSelectRating,
  activeRating = null,
}: CreditRiskChartProps) {
  const hasData = data.some((entry) => entry.count > 0 || entry.amount > 0);
  const interactive = typeof onSelectRating === "function";

  return (
    <div className="chart-container">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Customer Credit Rating Distribution</h3>
          <p className="text-xs text-slate-500">
            {interactive
              ? "Select a rating to drill into its outstanding customers"
              : "Maintained customer credit ratings — not a predictive/AI score"}
          </p>
        </div>
        <ShieldAlert className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </div>
      <div className="h-[240px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : !hasData ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-slate-500">No rated customers with outstanding balances</p>
            <p className="text-xs text-slate-400">Ratings are maintained on the customer master.</p>
          </div>
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={30} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
            <YAxis type="category" dataKey="rating" tick={{ fill: "#64748b", fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              formatter={(value: number) => [formatMoneySafe(value, currency), "Outstanding"]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Bar
              dataKey="amount"
              radius={[0, 6, 6, 0]}
              onClick={interactive ? (entry) => onSelectRating!(String(entry.rating)) : undefined}
              cursor={interactive ? "pointer" : undefined}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.fill} opacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        )}
      </div>

      {/* Accessible drill-down controls — the chart is understandable and
          operable without relying on hover. Each rating is a real button with a
          keyboard-activatable name; the active rating is marked with an icon and
          text, not colour alone. */}
      {interactive && !isLoading && (
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          role="group"
          aria-label="Drill down by credit rating"
        >
          {data.map((entry) => {
            const isActive = activeRating === entry.rating;
            return (
              <button
                key={entry.rating}
                type="button"
                onClick={() => onSelectRating!(entry.rating)}
                aria-pressed={isActive}
                aria-label={`Filter outstanding customers by credit rating ${entry.rating} (${entry.count} customer${entry.count === 1 ? "" : "s"}, ${formatMoneySafe(entry.amount, currency)})`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                  isActive
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {isActive && <Check className="h-3 w-3" aria-hidden="true" />}
                <span className="font-semibold">{entry.rating}</span>
                <span className="text-slate-400">·</span>
                <span className="tabular-nums">{entry.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

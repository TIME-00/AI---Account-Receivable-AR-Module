"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Check, ShieldAlert } from "lucide-react";
import { ChartTooltip } from "./chart-tooltip";
import { useChartTheme } from "@/lib/theme/chart-theme";
import { cn } from "@/lib/utils";

interface CreditRiskEntry {
  rating: string;
  count: number;
  fill: string;
}

interface CreditRiskChartProps {
  data: CreditRiskEntry[];
  /** @deprecated Customer-count chart; retained only for source compatibility. */
  currency?: string | null;
  isLoading?: boolean;
  onSelectRating?: (rating: string) => void;
  onButtonRef?: (rating: string, element: HTMLButtonElement | null) => void;
  activeRating?: string | null;
}

export function CreditRiskChart({
  data,
  isLoading = false,
  onSelectRating,
  onButtonRef,
  activeRating = null,
}: CreditRiskChartProps) {
  const chart = useChartTheme();
  const hasData = data.some((entry) => entry.count > 0);
  const interactive = typeof onSelectRating === "function";

  return (
    <div className="chart-container">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Customer Credit Rating Distribution
          </h3>
          <p className="text-xs text-slate-500">
            All visible customers, including customers with no outstanding balance
          </p>
        </div>
        <ShieldAlert className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </div>
      <div className="h-[240px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
              aria-label="Loading customer rating distribution"
            />
          </div>
        ) : !hasData ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-slate-500">
              No visible rated customers
            </p>
            <p className="text-xs text-slate-400">
              Ratings are maintained on the customer master.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barSize={30} layout="vertical">
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={chart.grid}
                horizontal={false}
              />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: chart.axis, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="rating"
                tick={{ fill: chart.axisStrong, fontSize: 12, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                cursor={{ fill: chart.cursor }}
                content={
                  <ChartTooltip
                    formatValue={(value) => String(value)}
                    formatCaption={(value) =>
                      value === 1 ? "Customer" : "Customers"
                    }
                  />
                }
              />
              <Bar
                dataKey="count"
                radius={[0, 6, 6, 0]}
                onClick={
                  interactive
                    ? (entry) => onSelectRating(String(entry.rating))
                    : undefined
                }
                cursor={interactive ? "pointer" : undefined}
              >
                {data.map((entry) => (
                  <Cell key={entry.rating} fill={entry.fill} opacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {interactive && !isLoading && (
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          role="group"
          aria-label="View customers by credit rating"
        >
          {data.map((entry) => {
            const isActive = activeRating === entry.rating;
            return (
              <button
                key={entry.rating}
                ref={(element) => onButtonRef?.(entry.rating, element)}
                type="button"
                onClick={() => onSelectRating(entry.rating)}
                aria-pressed={isActive}
                aria-label={`View customers rated ${entry.rating}`}
                className={cn(
                  "inline-flex touch-manipulation items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
                  isActive
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-surface text-slate-600 hover:bg-slate-50",
                )}
              >
                {isActive && <Check className="h-3 w-3" aria-hidden="true" />}
                <span className="font-semibold">{entry.rating}</span>
                <span className="text-slate-400" aria-hidden="true">
                  ·
                </span>
                <span className="tabular-nums">{entry.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

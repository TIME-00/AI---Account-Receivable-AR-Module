"use client";

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { formatMoneySafe } from "@/lib/currency";
import { ChartTooltip } from "./chart-tooltip";
import { DONUT_COLORS } from "@/lib/theme/chart-theme";

interface CompositionChartProps {
  data: Array<{ name: string; value: number }>;
  /** Company base currency (values are company-base); null when unavailable. */
  currency: string | null;
  isLoading: boolean;
}

export function CompositionChart({ data, currency, isLoading }: CompositionChartProps) {
  return (
    <div className="chart-container">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900">AR &amp; Cash Position</h3>
        <p className="text-xs text-slate-500">
          Gross outstanding AR, overdue AR, and unapplied cash are shown separately.
        </p>
      </div>
      <div className="h-[280px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-slate-500">No outstanding balance</p>
            <p className="text-xs text-slate-400">Outstanding, overdue and unapplied cash will appear here.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={3} dataKey="value" stroke="none">
                {data.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i]} opacity={0.85} />
                ))}
              </Pie>
              <Tooltip
                content={
                  <ChartTooltip
                    formatValue={(value) => formatMoneySafe(value, currency)}
                  />
                }
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                formatter={(value) => <span className="text-xs text-slate-600">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

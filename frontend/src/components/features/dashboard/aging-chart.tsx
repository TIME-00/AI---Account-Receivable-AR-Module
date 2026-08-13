"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ChartTooltip } from "./chart-tooltip";
import { Clock } from "lucide-react";
import { AGING_COLORS, useChartTheme } from "@/lib/theme/chart-theme";

interface AgingBucket {
  name: string;
  amount: number;
  count: number;
  fill: string;
}

interface AgingChartProps {
  data: AgingBucket[];
  isLoading: boolean;
  /** Company base currency (amounts are company-base). */
  currency: string | null;
}

export function AgingChart({ data, isLoading, currency }: AgingChartProps) {
  const chart = useChartTheme();
  const hasData = data.some((bucket) => bucket.amount > 0 || bucket.count > 0);

  return (
    <div className="chart-container">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Aging Analysis</h3>
          <p className="text-xs text-slate-500">
            Aging Bucket Distribution{currency ? ` — ${currency.toUpperCase()} (company base)` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1">
          <Clock className="h-3 w-3 text-slate-400" />
          <span className="text-[11px] text-slate-500">As of Today</span>
        </div>
      </div>
      <div className="h-[280px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : !hasData ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-slate-500">No outstanding invoices</p>
            <p className="text-xs text-slate-400">Aging buckets will appear here once invoices are outstanding.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barSize={36}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: chart.axis, fontSize: 11 }} axisLine={{ stroke: chart.grid }} tickLine={false} />
              <YAxis tick={{ fill: chart.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
              <Tooltip
                cursor={{ fill: chart.cursor }}
                content={<ChartTooltip currency={currency} />}
              />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export { AGING_COLORS };

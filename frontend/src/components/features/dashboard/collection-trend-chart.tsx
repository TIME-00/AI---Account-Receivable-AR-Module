"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatMoneySafe } from "@/lib/currency";
import { TOOLTIP_STYLE } from "./chart-tooltip";
import { TrendingUp } from "lucide-react";

interface CollectionTrendPoint {
  /** Pre-formatted axis label, e.g. "Jun 26". */
  label: string;
  collected: number;
  receipts: number;
}

interface CollectionTrendChartProps {
  data: CollectionTrendPoint[];
  /** Company base currency (values are company-base); null when unavailable. */
  currency: string | null;
  isLoading?: boolean;
}

export function CollectionTrendChart({ data, currency, isLoading = false }: CollectionTrendChartProps) {
  const hasData = data.some((point) => point.collected > 0);

  return (
    <div className="chart-container">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Collection Trend</h3>
          <p className="text-xs text-slate-500">Receipts collected by month (company base{currency ? ` — ${currency}` : ""})</p>
        </div>
        <TrendingUp className="h-4 w-4 text-emerald-500" />
      </div>
      <div className="h-[280px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : !hasData ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-slate-500">No collections in this period</p>
            <p className="text-xs text-slate-400">Posted receipts will appear here.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="collectionGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
              <Tooltip
                formatter={(value: number) => [formatMoneySafe(value, currency), "Collected"]}
                contentStyle={TOOLTIP_STYLE}
              />
              <Area type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2} fill="url(#collectionGradient)" dot={{ fill: "#10b981", r: 4, strokeWidth: 0 }} activeDot={{ r: 6, fill: "#34d399" }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

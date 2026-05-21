"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TOOLTIP_STYLE } from "./chart-tooltip";
import { TrendingUp } from "lucide-react";

interface DsoTrendChartProps {
  data: Array<{ month: string; dso: number }>;
}

export function DsoTrendChart({ data }: DsoTrendChartProps) {
  return (
    <div className="chart-container">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">DSO Trend</h3>
          <p className="text-xs text-slate-500">Days Sales Outstanding (Last 6 Months)</p>
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          <span className="text-xs font-semibold text-emerald-600">
            {data[data.length - 1]?.dso} Days
          </span>
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="dsoGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, "auto"]} />
            <Tooltip
              formatter={(value: number) => [`${value} Days`, "DSO"]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Area type="monotone" dataKey="dso" stroke="#3b82f6" strokeWidth={2} fill="url(#dsoGradient)" dot={{ fill: "#3b82f6", r: 4, strokeWidth: 0 }} activeDot={{ r: 6, fill: "#60a5fa" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

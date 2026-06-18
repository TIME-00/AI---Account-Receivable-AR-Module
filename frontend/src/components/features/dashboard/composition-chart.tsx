"use client";

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { formatAmount } from "@/lib/utils";
import { TOOLTIP_STYLE } from "./chart-tooltip";

const DONUT_COLORS = ["#3b82f6", "#ef4444", "#22c55e"];

interface CompositionChartProps {
  data: Array<{ name: string; value: number }>;
  currency: string;
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
                formatter={(value: number) => [`${currency} ${formatAmount(value)}`, ""]}
                contentStyle={TOOLTIP_STYLE}
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

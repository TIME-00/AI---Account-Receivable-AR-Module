"use client";

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { formatAmount } from "@/lib/utils";
import { TOOLTIP_STYLE } from "./chart-tooltip";

const DONUT_COLORS = ["#3b82f6", "#ef4444", "#22c55e"];

interface CompositionChartProps {
  data: Array<{ name: string; value: number }>;
  isLoading: boolean;
}

export function CompositionChart({ data, isLoading }: CompositionChartProps) {
  return (
    <div className="chart-container">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900">Outstanding Composition</h3>
        <p className="text-xs text-slate-500">Outstanding Composition</p>
      </div>
      <div className="h-[280px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
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
                formatter={(value: number) => [`MYR ${formatAmount(value)}`, ""]}
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

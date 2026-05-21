"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatAmount } from "@/lib/utils";
import { TOOLTIP_STYLE } from "./chart-tooltip";
import { ShieldAlert } from "lucide-react";

interface CreditRiskEntry {
  rating: string;
  count: number;
  amount: number;
  fill: string;
}

interface CreditRiskChartProps {
  data: CreditRiskEntry[];
}

export function CreditRiskChart({ data }: CreditRiskChartProps) {
  return (
    <div className="chart-container">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Credit Risk Distribution</h3>
          <p className="text-xs text-slate-500">Credit Risk by Outstanding Amount</p>
        </div>
        <ShieldAlert className="h-4 w-4 text-slate-400" />
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={32} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
            <YAxis type="category" dataKey="rating" tick={{ fill: "#64748b", fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              formatter={(value: number) => [`MYR ${formatAmount(value)}`, "Amount"]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.fill} opacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

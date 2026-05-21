"use client";

import { formatCurrency } from "@/lib/utils";
import { Users, TrendingUp, Receipt, DollarSign } from "lucide-react";

interface QuickStatsProps {
  totalCustomers: number | string;
  collectionRate: string;
  totalReceipts: number | string;
  creditBalance: number;
}

export function QuickStats({ totalCustomers, collectionRate, totalReceipts, creditBalance }: QuickStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-brand-500" />
          <span className="text-xs font-medium text-slate-500">Active Customers</span>
        </div>
        <p className="mt-2 text-xl font-bold text-slate-900">{totalCustomers}</p>
      </div>
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          <span className="text-xs font-medium text-slate-500">Collection Rate</span>
        </div>
        <p className="mt-2 text-xl font-bold text-slate-900">{collectionRate}</p>
      </div>
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-medium text-slate-500">Unapplied Receipts</span>
        </div>
        <p className="mt-2 text-xl font-bold text-slate-900">{totalReceipts}</p>
      </div>
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-purple-500" />
          <span className="text-xs font-medium text-slate-500">Credit Balance</span>
        </div>
        <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(creditBalance)}</p>
      </div>
    </div>
  );
}

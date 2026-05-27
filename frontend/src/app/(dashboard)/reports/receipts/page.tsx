"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Banknote, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAllReceipts, formatCurrency, formatDate } from "@/hooks/use-f2-data";
import { PAYMENT_METHOD_NAMES, RECEIPT_STATUSES } from "@/types";

const statusColors: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Posted: "bg-blue-50 text-blue-700",
  "Fully Allocated": "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-500",
  Bounced: "bg-red-50 text-red-700",
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ReceiptSummaryPage() {
  const { data: allReceipts, isLoading, error } = useAllReceipts();

  const thirtyDaysAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return toDateStr(d);
  }, []);
  const todayStr = useMemo(() => toDateStr(new Date()), []);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(todayStr);

  // Client-side date filtering — NO params to backend
  const filtered = useMemo(() => {
    if (!allReceipts) return [];
    return allReceipts.filter((r) => {
      const d = r.receipt_date;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }, [allReceipts, dateFrom, dateTo]);

  // Aggregations
  const stats = useMemo(() => ({
    totalCount: filtered.length,
    totalAmount: filtered.reduce((s, r) => s + r.receipt_amount, 0),
    allocated: filtered.reduce((s, r) => s + r.allocated_amount, 0),
    unallocated: filtered.reduce((s, r) => s + r.unallocated_amount, 0),
  }), [filtered]);

  // Payment method breakdown
  const methodBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    filtered.forEach((r) => {
      const entry = map.get(r.payment_method) ?? { count: 0, amount: 0 };
      entry.count++;
      entry.amount += r.receipt_amount;
      map.set(r.payment_method, entry);
    });
    return Array.from(map.entries())
      .map(([method, data]) => ({ method, name: PAYMENT_METHOD_NAMES[method] ?? method, ...data }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered]);

  // Status breakdown
  const statusBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    RECEIPT_STATUSES.forEach((s) => map.set(s, { count: 0, amount: 0 }));
    filtered.forEach((r) => {
      const entry = map.get(r.status);
      if (entry) { entry.count++; entry.amount += r.receipt_amount; }
    });
    return Array.from(map.entries())
      .map(([status, data]) => ({ status, ...data }))
      .filter((r) => r.count > 0);
  }, [filtered]);

  const recentReceipts = useMemo(() =>
    [...filtered].sort((a, b) => b.receipt_date.localeCompare(a.receipt_date)).slice(0, 10),
    [filtered]
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/reports" className="hover:text-blue-600">Reports</Link><span>/</span>
          <span className="text-slate-800 font-medium">Receipt Summary</span>
        </div>
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading receipts…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/reports" className="hover:text-blue-600">Reports</Link><span>/</span>
          <span className="text-slate-800 font-medium">Receipt Summary</span>
        </div>
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load receipts</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/reports" className="hover:text-blue-600">Reports</Link><span>/</span>
        <span className="text-slate-800 font-medium">Receipt Summary</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Receipt Summary</h1>
        <button disabled className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-xs font-medium text-slate-400 cursor-not-allowed">
          <Download className="h-3.5 w-3.5" /> Export — Coming Soon
        </button>
      </div>

      {/* Date Range */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-medium text-slate-500">From:</label>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        <label className="text-xs font-medium text-slate-500">To:</label>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        <span className="text-[10px] text-slate-400">(Client-side filter — {filtered.length} receipts)</span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total Receipts", value: stats.totalCount.toString(), color: "text-slate-900" },
          { label: "Total Amount", value: formatCurrency(stats.totalAmount), color: "text-blue-600" },
          { label: "Allocated", value: formatCurrency(stats.allocated), color: "text-emerald-600" },
          { label: "Unallocated", value: formatCurrency(stats.unallocated), color: "text-amber-600" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</p>
            <p className={cn("mt-1 text-xl font-bold font-mono", c.color)}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Payment Method Breakdown */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">Payment Method Breakdown</h2>
        </div>
        {methodBreakdown.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No receipts in date range</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Method</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Count</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Total Amount</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {methodBreakdown.map((r) => (
                <tr key={r.method} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2.5 text-slate-700">{r.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{r.count}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatCurrency(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Status Breakdown */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">Status Breakdown</h2>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50/50">
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Count</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Total Amount</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {statusBreakdown.map((r) => (
              <tr key={r.status} className="hover:bg-slate-50/80">
                <td className="px-4 py-2.5"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusColors[r.status])}>{r.status}</span></td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{r.count}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatCurrency(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent Receipts */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">Recent Receipts (Top 10)</h2>
        </div>
        {recentReceipts.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No receipts</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Receipt No</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Customer</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Date</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Amount</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {recentReceipts.map((r) => (
                  <tr key={r.id} className="group hover:bg-slate-50/80">
                    <td className="px-4 py-2.5"><Link href={`/receipts/${r.id}`} className="font-mono text-xs text-blue-600 hover:underline">{r.receipt_no}</Link></td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 truncate max-w-[180px]">{r.customer_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(r.receipt_date)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">{formatCurrency(r.receipt_amount)}</td>
                    <td className="px-4 py-2.5"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusColors[r.status])}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-center text-[10px] text-slate-400">All values are computed client-side from receipt data. Date filtering is applied locally.</p>
    </div>
  );
}

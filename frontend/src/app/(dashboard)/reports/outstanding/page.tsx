"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Users, Search, ArrowUpDown, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgingByCustomerF2, formatCurrency } from "@/hooks/use-f2-data";
import type { CustomerAgingRow } from "@/types";

type SortKey = "customer_name" | "total_outstanding" | "overdue";

export default function CustomerOutstandingPage() {
  const { data: agingRaw, isLoading, error } = useAgingByCustomerF2();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_outstanding");
  const [sortAsc, setSortAsc] = useState(false);

  // Normalize (may be array or { rows })
  const allRows: CustomerAgingRow[] = useMemo(() => {
    if (!agingRaw) return [];
    return Array.isArray(agingRaw) ? agingRaw : (agingRaw as any)?.rows ?? [];
  }, [agingRaw]);

  // Only customers with outstanding > 0
  const withOutstanding = useMemo(
    () => allRows.filter((r) => r.total_outstanding > 0),
    [allRows]
  );

  // Totals
  const totalOutstanding = useMemo(() => withOutstanding.reduce((s, r) => s + r.total_outstanding, 0), [withOutstanding]);
  const totalOverdue = useMemo(
    () => withOutstanding.reduce((s, r) => s + r.bucket_1_30 + r.bucket_31_60 + r.bucket_61_90 + r.bucket_over_90, 0),
    [withOutstanding]
  );

  // Filter + sort
  const rows = useMemo(() => {
    let list = [...withOutstanding];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.customer_name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "customer_name") cmp = a.customer_name.localeCompare(b.customer_name);
      else if (sortKey === "total_outstanding") cmp = a.total_outstanding - b.total_outstanding;
      else {
        const ao = a.bucket_1_30 + a.bucket_31_60 + a.bucket_61_90 + a.bucket_over_90;
        const bo = b.bucket_1_30 + b.bucket_31_60 + b.bucket_61_90 + b.bucket_over_90;
        cmp = ao - bo;
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [withOutstanding, search, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "customer_name"); }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/reports" className="hover:text-blue-600">Reports</Link><span>/</span>
          <span className="text-slate-800 font-medium">Customer Outstanding</span>
        </div>
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading outstanding data…</p>
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
          <span className="text-slate-800 font-medium">Customer Outstanding</span>
        </div>
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/reports" className="hover:text-blue-600">Reports</Link><span>/</span>
        <span className="text-slate-800 font-medium">Customer Outstanding</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Outstanding</h1>
        <button disabled className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-xs font-medium text-slate-400 cursor-not-allowed">
          <Download className="h-3.5 w-3.5" /> Export — Coming Soon
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Customers with Outstanding", value: withOutstanding.length.toString(), color: "text-slate-900" },
          { label: "Total Outstanding", value: formatCurrency(totalOutstanding), color: "text-amber-600" },
          { label: "Total Overdue", value: formatCurrency(totalOverdue), color: "text-red-600" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</p>
            <p className={cn("mt-1 text-xl font-bold font-mono", c.color)}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text" placeholder="Search customer…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Users className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">No customers with outstanding balances</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <button onClick={() => toggleSort("customer_name")} className="inline-flex items-center gap-1 hover:text-slate-700">
                      Customer <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <button onClick={() => toggleSort("total_outstanding")} className="inline-flex items-center gap-1 hover:text-slate-700">
                      Outstanding <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <button onClick={() => toggleSort("overdue")} className="inline-flex items-center gap-1 hover:text-slate-700">
                      Overdue <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">% of Total AR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const overdue = r.bucket_1_30 + r.bucket_31_60 + r.bucket_61_90 + r.bucket_over_90;
                  const pct = totalOutstanding > 0 ? (r.total_outstanding / totalOutstanding) * 100 : 0;
                  return (
                    <tr key={r.customer_id} className="group hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <Link href={`/customers/${r.customer_id}`} className="font-medium text-slate-800 group-hover:text-blue-600">
                          {r.customer_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-amber-600">{formatCurrency(r.total_outstanding)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-red-600">{formatCurrency(overdue)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className="font-mono text-xs text-slate-500">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

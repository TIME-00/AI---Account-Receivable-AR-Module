"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Clock, Search, ArrowUpDown, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgingSummaryF2, useAgingByCustomerF2, formatCurrency } from "@/hooks/use-f2-data";
import type { CustomerAgingRow, AgingBucketResult } from "@/types";

type SortKey = "customer_name" | "current_amount" | "bucket_1_30" | "bucket_31_60" | "bucket_61_90" | "bucket_over_90" | "total_outstanding";

export default function AgingReportPage() {
  const { data: summary, isLoading: loadingSummary, error: errorSummary } = useAgingSummaryF2();
  const { data: agingRaw, isLoading: loadingRows, error: errorRows } = useAgingByCustomerF2();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_outstanding");
  const [sortAsc, setSortAsc] = useState(false);

  const isLoading = loadingSummary || loadingRows;
  const error = errorSummary || errorRows;

  // Normalize rows (may be array or { rows })
  const allRows: CustomerAgingRow[] = useMemo(() => {
    if (!agingRaw) return [];
    return Array.isArray(agingRaw) ? agingRaw : (agingRaw as any)?.rows ?? [];
  }, [agingRaw]);

  // Filter + sort
  const rows = useMemo(() => {
    let list = [...allRows];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.customer_name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const av = a[sortKey as keyof CustomerAgingRow];
      const bv = b[sortKey as keyof CustomerAgingRow];
      const cmp = typeof av === "string" ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [allRows, search, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "customer_name"); }
  };

  // Summary bucket data
  const bucketCards = useMemo(() => {
    const buckets = summary?.aging_summary ?? [];
    const total = summary?.total_outstanding ?? 0;
    const findBucket = (name: string) => buckets.find((b) => b.bucket_name.toLowerCase().includes(name.toLowerCase()))?.total_outstanding ?? 0;
    return [
      { label: "Total Outstanding", value: total, color: "text-slate-900", bg: "bg-slate-50" },
      { label: "Current", value: findBucket("current"), color: "text-emerald-600", bg: "bg-emerald-50" },
      { label: "1–30 Days", value: findBucket("1-30") || findBucket("1 - 30"), color: "text-blue-600", bg: "bg-blue-50" },
      { label: "31–60 Days", value: findBucket("31-60") || findBucket("31 - 60"), color: "text-amber-600", bg: "bg-amber-50" },
      { label: "61–90 Days", value: findBucket("61-90") || findBucket("61 - 90"), color: "text-orange-600", bg: "bg-orange-50" },
      { label: "90+ Days", value: findBucket("90") || findBucket("over 90"), color: "text-red-600", bg: "bg-red-50" },
    ];
  }, [summary]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/reports" className="hover:text-blue-600">Reports</Link><span>/</span>
          <span className="text-slate-800 font-medium">AR Aging Report</span>
        </div>
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading aging data…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/reports" className="hover:text-blue-600">Reports</Link><span>/</span>
          <span className="text-slate-800 font-medium">AR Aging Report</span>
        </div>
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load aging data</p>
          <p className="text-xs text-slate-400">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/reports" className="hover:text-blue-600">Reports</Link><span>/</span>
        <span className="text-slate-800 font-medium">AR Aging Report</span>
      </div>

      {/* Header + Date */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">AR Aging Report</h1>
          <p className="mt-1 text-sm text-slate-500">As of: Today, {today}</p>
        </div>
        <button disabled className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-xs font-medium text-slate-400 cursor-not-allowed" title="Coming Soon">
          <Download className="h-3.5 w-3.5" /> Export — Coming Soon
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {bucketCards.map((b) => (
          <div key={b.label} className={cn("rounded-xl border border-slate-200 p-4", b.bg)}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{b.label}</p>
            <p className={cn("mt-1 font-mono text-lg font-bold", b.color)}>{formatCurrency(b.value)}</p>
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

      {/* Customer Aging Table */}
      <div className="glass-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Clock className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">No aging data available</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  {([
                    ["customer_name", "Customer", "text-left"],
                    ["current_amount", "Current", "text-right"],
                    ["bucket_1_30", "1–30", "text-right"],
                    ["bucket_31_60", "31–60", "text-right"],
                    ["bucket_61_90", "61–90", "text-right"],
                    ["bucket_over_90", "90+", "text-right"],
                    ["total_outstanding", "Total", "text-right"],
                  ] as [SortKey, string, string][]).map(([key, label, align]) => (
                    <th key={key} className={cn("px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500", align)}>
                      <button onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-slate-700">
                        {label} <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.customer_id} className="group hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <Link href={`/customers/${r.customer_id}`} className="font-medium text-slate-800 group-hover:text-blue-600">{r.customer_name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-emerald-600">{formatCurrency(r.current_amount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-blue-600">{formatCurrency(r.bucket_1_30)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-amber-600">{formatCurrency(r.bucket_31_60)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-orange-600">{formatCurrency(r.bucket_61_90)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-red-600">{formatCurrency(r.bucket_over_90)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-800">{formatCurrency(r.total_outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

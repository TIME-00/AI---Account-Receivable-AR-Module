"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Users, Search, ArrowUpDown, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgingByCustomerF2, useAgingSummaryF2 } from "@/hooks/use-f2-data";
import { formatMoneySafe } from "@/lib/currency";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";

type SortKey = "customer_name" | "total_outstanding" | "overdue";

const PAGE_SIZE = 100;

export default function CustomerOutstandingPage() {
  const [page, setPage] = useState(1);

  // B9DD-FEIR-002: company-wide totals come from the AUTHORITATIVE aging summary
  // (`GET /reports/aging` → ARSummary), which covers every customer. The
  // previous code summed `total_outstanding` over the rows it happened to hold —
  // at most the first 100 — and presented that as the company total.
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useAgingSummaryF2();

  // Row table stays server-paginated.
  const { data: agingPage, isLoading, error } = useAgingByCustomerF2(page, PAGE_SIZE);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_outstanding");
  const [sortAsc, setSortAsc] = useState(false);

  // B9DD-FEIR-009: exactly-typed page — no `as any` normalization.
  const allRows = useMemo(() => agingPage?.rows ?? [], [agingPage]);
  const totalRows = agingPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  // `ar_aging_by_customer` already filters `WHERE base_total > 0`.
  const withOutstanding = allRows;

  // Authoritative company-base figures (complete, not page-derived).
  const baseCurrency = summary?.base_currency ?? null;
  const totalOutstanding = summary?.base_total ?? 0;
  const totalOverdue = summary?.total_overdue ?? 0;

  // Search/sort apply to the CURRENT PAGE only — these are presentation-only
  // operations and never change the authoritative totals above.
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
  if (isLoading || summaryLoading) {
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

  if (error || summaryError) {
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

      {/* Authoritative company-wide totals (all customers, not just this page) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Customers with Outstanding", value: totalRows.toString(), color: "text-slate-900" },
          { label: "Total Outstanding (company base)", value: formatMoneySafe(totalOutstanding, baseCurrency), color: "text-amber-600" },
          { label: "Total Overdue (company base)", value: formatMoneySafe(totalOverdue, baseCurrency), color: "text-red-600" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</p>
            <p className={cn("mt-1 font-mono text-xl font-bold", c.color)}>{c.value}</p>
          </div>
        ))}
        {/* Native transaction-currency breakdown, straight from the backend */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Outstanding by currency
          </p>
          {summary && summary.by_currency.length > 0 ? (
            <CurrencyTotals byCurrency={summary.by_currency} color="text-amber-600" className="mt-1 text-sm" />
          ) : (
            <p className="mt-1 text-xs text-slate-400">None</p>
          )}
        </div>
      </div>
      <p className="-mt-3 text-[10px] text-slate-400">
        Totals cover all customers. The table below is paginated; searching and sorting affect the
        current page only.
      </p>

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
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-amber-600">{formatMoneySafe(r.total_outstanding, baseCurrency)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-red-600">{formatMoneySafe(overdue, baseCurrency)}</td>
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
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-500">
                  Page {page} of {totalPages} — {totalRows} customer(s)
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    aria-label="Previous page"
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

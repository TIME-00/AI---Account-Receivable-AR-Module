"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Clock, Search, ArrowUpDown, Download, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgingSummaryF2, useAgingByCustomerF2 } from "@/hooks/use-f2-data";
import { formatMoneySafe } from "@/lib/currency";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import { totalPagesFrom } from "@/hooks/use-invoices";
import type { CustomerAgingRow } from "@/types";

type SortKey = "customer_name" | "current_amount" | "bucket_1_30" | "bucket_31_60" | "bucket_61_90" | "bucket_over_90" | "total_outstanding";

/** Server page size for the customer table (backend clamps to MAX_PAGE_SIZE=100). */
const AGING_PAGE_SIZE = 25;

export default function AgingReportPage() {
  // B9DD-RR-001: two independent datasets.
  //   • summary  — GET /reports/aging: complete, authoritative, page-independent.
  //   • rows     — GET /reports/aging/by-customer: ONE SERVER PAGE.
  // The summary is never recomputed from the page rows.
  const { data: summary, isLoading: loadingSummary, error: errorSummary } = useAgingSummaryF2();

  const [page, setPage] = useState(1);
  const {
    data: agingRaw,
    isLoading: loadingRows,
    error: errorRows,
    isFetching: fetchingRows,
  } = useAgingByCustomerF2(page, AGING_PAGE_SIZE);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_outstanding");
  const [sortAsc, setSortAsc] = useState(false);

  const isLoading = loadingSummary || loadingRows;
  const error = errorSummary || errorRows;

  // Batch 9D-D: all aging figures are backend-authoritative COMPANY-BASE amounts.
  // Label them with the real base currency — never an implicit MYR.
  const baseCurrency = summary?.base_currency ?? null;
  // Named `formatBase` (not `formatCurrency`) so it cannot be confused with the
  // removed default-MYR helper: every value it formats is a company-base amount.
  const formatBase = (v: number) => formatMoneySafe(v, baseCurrency);

  // B9DD-FEIR-009: exactly-typed page — no `as any` normalization of the
  // monetary response. Rows are one SERVER page; the summary above is complete.
  const pageRows: CustomerAgingRow[] = useMemo(() => agingRaw?.rows ?? [], [agingRaw]);

  // B9DD-RR-001: pagination metadata comes from the backend, never invented.
  const total = agingRaw?.total ?? 0;
  const pageSize = agingRaw?.page_size ?? AGING_PAGE_SIZE;
  const currentPage = agingRaw?.page ?? page;
  const totalPages = totalPagesFrom({ total, page: currentPage, page_size: pageSize });
  const firstRowIndex = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRowIndex = Math.min(currentPage * pageSize, total);

  // Search/sort apply to the CURRENT PAGE ONLY. `/reports/aging/by-customer`
  // accepts only `as_of_date` + pagination (backend reports/index.ts ~109), so
  // there is no server-side customer filter to delegate to. This is stated in
  // the UI rather than presented as a whole-report filter.
  const isSearching = search.trim().length > 0;
  const rows = useMemo(() => {
    let list = [...pageRows];
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
  }, [pageRows, search, sortKey, sortAsc]);

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

      {/* Summary Cards — company-base bucket amounts (authoritative, complete).
          B9DD-RR-001: this is the COMPLETE authorized collection and is
          independent of the customer table's page below. */}
      <p className="text-xs text-slate-500">
        Company totals below cover the <strong className="font-semibold text-slate-700">complete authorized
        collection</strong> — they are computed by the backend and do not change as you page the customer
        table.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {bucketCards.map((b) => (
          <div key={b.label} className={cn("rounded-xl border border-slate-200 p-4", b.bg)}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{b.label}</p>
            <p className={cn("mt-1 font-mono text-lg font-bold", b.color)}>{formatBase(b.value)}</p>
          </div>
        ))}
      </div>

      {/* Native transaction-currency breakdown + separate company-base total.
          B9DD-FEIR-002 §8: the bucket cards above are company-base amounts, so
          the underlying native currencies must also be shown — and the base
          total must never read as the sum of them. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Outstanding by transaction currency
          </p>
          {summary && summary.by_currency.length > 0 ? (
            <CurrencyTotals byCurrency={summary.by_currency} color="text-amber-600" className="mt-1 text-sm" />
          ) : (
            <p className="mt-1 text-xs text-slate-400">No outstanding documents</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Company-base total
          </p>
          <p className="mt-1 font-mono text-lg font-bold text-slate-900">
            {formatMoneySafe(summary?.base_total ?? null, baseCurrency)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            From stored booking snapshots
            {summary && summary.by_currency.length > 1 && " — not the sum of the native subtotals"}
          </p>
        </div>
      </div>

      {/* ── Customer aging rows: a SEPARATE server-paginated dataset ───────── */}
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-800">Customer aging rows</h2>
        <p className="text-xs text-slate-500">
          {total > 0
            ? `Showing customers ${firstRowIndex}–${lastRowIndex} of ${total} — this is the current page of customer aging rows, not the whole report.`
            : "No customers with outstanding exposure."}
        </p>
      </div>

      {/* Search — current page only; the backend exposes no customer filter on
          this report, so we must not present this as a whole-report search. */}
      <div className="space-y-1.5">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Filter customers on this page…" value={search} onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter customers on this page"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <p className="inline-flex items-start gap-1 text-[11px] text-slate-500">
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          Filter and sort apply to the current page only — they do not search the whole report.
        </p>
      </div>

      {/* Customer Aging Table */}
      <div className="glass-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Clock className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              {isSearching
                ? "No customers on this page match your filter"
                : "No aging data available"}
            </p>
            {isSearching && total > pageSize && (
              <p className="mt-1 text-xs text-slate-400">
                Other pages may contain matching customers.
              </p>
            )}
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
                    <td className="px-4 py-3 text-right font-mono text-xs text-emerald-600">{formatBase(r.current_amount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-blue-600">{formatBase(r.bucket_1_30)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-amber-600">{formatBase(r.bucket_31_60)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-orange-600">{formatBase(r.bucket_61_90)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-red-600">{formatBase(r.bucket_over_90)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-800">{formatBase(r.total_outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* B9DD-RR-001: real server pagination, derived from backend metadata. */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500">
              {firstRowIndex}–{lastRowIndex} of {total} customers
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || fetchingRows}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs tabular-nums text-slate-600" aria-live="polite">
                Page {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || fetchingRows}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

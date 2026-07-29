"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/features/reports/export-menu";
import { useInvoiceReport, formatDate } from "@/hooks/use-f2-data";
import { formatMoney } from "@/lib/currency";
import {
  CompactCompanyBase,
  MoneySummary,
} from "@/components/ui/money-summary";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import { localTodayISODate } from "@/lib/export";

const statusColors: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Open: "bg-blue-50 text-blue-700",
  Overdue: "bg-red-50 text-red-700",
  "Partially Paid": "bg-amber-50 text-amber-700",
  Paid: "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-500",
  "Written Off": "bg-slate-100 text-slate-400",
};

export default function InvoiceSummaryPage() {
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localTodayISODate(d);
  }, []);
  const todayStr = useMemo(() => localTodayISODate(), []);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(todayStr);

  // B9DD-FEIR-002: the date range is a SERVER filter. Every figure below comes
  // from the backend's authoritative summary over the entire filtered
  // collection — no client-side date filtering, no 100-row cap, no client
  // aggregation.
  const { data, isLoading, isError } = useInvoiceReport({ date_from: dateFrom, date_to: dateTo });

  const overall = data?.overall;
  const documentSummary = overall?.summary.documentTotal;
  const balanceSummary = overall?.summary.currentBalance;
  const paid = data?.byStatus.find((s) => s.status === "Paid")?.summary.documentTotal;

  return (
    <div className="space-y-6">
      <Breadcrumb />

      {/* Header — kept mounted across data (re)loads so a background refetch
          never tears down the export control and cancels an in-flight export. */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Invoice Summary</h1>
        <ExportMenu
          reportType="invoices"
          filters={{ date_from: dateFrom, date_to: dateTo }}
        />
      </div>

      {isLoading ? (
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading invoice summary…</p>
          </div>
        </div>
      ) : (isError || !data || !overall || !documentSummary || !balanceSummary) ? (
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load invoice summary</p>
          <p className="text-xs text-slate-400">The authoritative report contract could not be loaded.</p>
        </div>
      ) : (
      <>
      {/* Date Range (server-side filter) */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="date-from" className="text-xs font-medium text-slate-500">From:</label>
        <input
          id="date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <label htmlFor="date-to" className="text-xs font-medium text-slate-500">To:</label>
        <input
          id="date-to"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <span className="text-[10px] text-slate-400">
          Server-side filter — {overall.total} invoice(s) in range
        </span>
      </div>

      {/* Authoritative summaries: per-currency subtotals + separate base total */}
      <div className="grid gap-3 lg:grid-cols-2">
        <MoneySummary summary={documentSummary} title="Invoiced (document total)" />
        <MoneySummary summary={balanceSummary} title="Outstanding" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Invoices</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900">{overall.total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid (by currency)</p>
          {paid ? (
            <CurrencyTotals byCurrency={paid.byCurrency} color="text-emerald-600" className="mt-1" />
          ) : (
            <p className="mt-1 text-xs text-slate-400">None</p>
          )}
        </div>
      </div>

      {/* Status Breakdown — one authoritative summary per status */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Status Breakdown</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Each row uses the validated server summary for that status over the full filtered range.
          </p>
        </div>
        {data.byStatus.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No invoices in date range</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Count</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">
                    Total Amount (by currency)
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">
                    Company Base
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">% (by count)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byStatus.map((row) => {
                  const s = row.summary.documentTotal;
                  const pct = overall.total > 0 ? (row.total / overall.total) * 100 : 0;
                  return (
                    <tr key={row.status} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusColors[row.status])}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{row.total}</td>
                      <td className="px-4 py-2.5 text-right">
                        <CurrencyTotals byCurrency={s.byCurrency} className="text-xs" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <CompactCompanyBase summary={s} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500">{pct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Invoices — clearly a page, not the whole collection */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Recent Invoices (latest 10)</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">
            A sample of rows — not the basis of the totals above.
          </p>
        </div>
        {data.recent.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No invoices</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Invoice No</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Customer</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Date</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Amount</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent.map((inv) => (
                  <tr key={inv.id} className="group hover:bg-slate-50/80">
                    <td className="px-4 py-2.5">
                      <Link href={`/invoices/${inv.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                        {inv.invoice_no}
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-slate-600">{inv.customer_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(inv.invoice_date)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {formatMoney(inv.total_amount, inv.currency)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusColors[inv.status])}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-center text-[10px] text-slate-400">
        Native totals are supplied by the server over the full filtered collection. Legacy company-base totals are not presented as verified.
      </p>
      </>
      )}
    </div>
  );
}

function Breadcrumb() {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Link href="/reports" className="hover:text-blue-600">
        Reports
      </Link>
      <span>/</span>
      <span className="font-medium text-slate-800">Invoice Summary</span>
    </div>
  );
}

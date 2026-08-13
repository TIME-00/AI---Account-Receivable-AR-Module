"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/features/reports/export-menu";
import { useReceiptReport, formatDate } from "@/hooks/use-f2-data";
import { formatMoney } from "@/lib/currency";
import {
  CompactCompanyBase,
  MoneySummary,
} from "@/components/ui/money-summary";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import {
  PAYMENT_METHOD_NAMES,
  type NormalizedMonetarySummary,
} from "@/types";
import { localTodayISODate } from "@/lib/export";

const statusColors: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Posted: "bg-blue-50 text-blue-700",
  "Fully Allocated": "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-500",
  Bounced: "bg-red-50 text-red-700",
};

export default function ReceiptSummaryPage() {
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localTodayISODate(d);
  }, []);
  const todayStr = useMemo(() => localTodayISODate(), []);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(todayStr);

  // B9DD-FEIR-002: date range, status and payment method are SERVER filters;
  // every total comes from the backend summary over the full filtered
  // collection (not the first 100 rows, and never summed in the browser).
  const { data, isLoading, isError } = useReceiptReport({ date_from: dateFrom, date_to: dateTo });

  const overall = data?.overall;
  const receivedSummary = overall?.summary.documentTotal;
  const unappliedSummary = overall?.summary.currentBalance;

  return (
    <div className="space-y-6">
      <Breadcrumb />

      {/* Header — kept mounted across data (re)loads so a background refetch
          never tears down the export control and cancels an in-flight export. */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Receipt Summary</h1>
        <ExportMenu
          reportType="receipts"
          filters={{ date_from: dateFrom, date_to: dateTo }}
        />
      </div>

      {isLoading ? (
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading receipt summary…</p>
          </div>
        </div>
      ) : (isError || !data || !overall || !receivedSummary || !unappliedSummary) ? (
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load receipt summary</p>
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
          Server-side filter — {overall.total} receipt(s) in range
        </span>
      </div>

      {/* Authoritative summaries */}
      <div className="grid gap-3 lg:grid-cols-2">
        <MoneySummary summary={receivedSummary} title="Received (document total)" />
        <MoneySummary summary={unappliedSummary} title="Unapplied" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-surface p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Receipts</p>
        <p className="mt-1 font-mono text-xl font-bold text-slate-900">{overall.total}</p>
      </div>

      <BreakdownTable
        title="Payment Method Breakdown"
        firstColumn="Method"
        rows={data.byMethod.map((m) => ({
          key: m.method,
          label: PAYMENT_METHOD_NAMES[m.method] ?? m.method,
          count: m.total,
          summary: m.summary.documentTotal,
        }))}
        overallTotal={overall.total}
        emptyLabel="No receipts in date range"
      />

      <BreakdownTable
        title="Status Breakdown"
        firstColumn="Status"
        rows={data.byStatus.map((s) => ({
          key: s.status,
          label: s.status,
          count: s.total,
          summary: s.summary.documentTotal,
          badgeClass: statusColors[s.status],
        }))}
        overallTotal={overall.total}
        emptyLabel="No receipts in date range"
      />

      {/* Recent Receipts */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Recent Receipts (latest 10)</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">
            A sample of rows — not the basis of the totals above.
          </p>
        </div>
        {data.recent.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No receipts</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Receipt No</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Customer</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Date</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Amount</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5">
                      <Link href={`/receipts/${r.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                        {r.receipt_no}
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-slate-600">{r.customer_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(r.receipt_date)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {formatMoney(r.receipt_amount, r.currency)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusColors[r.status])}>
                        {r.status}
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

interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  summary: NormalizedMonetarySummary;
  badgeClass?: string;
}

function BreakdownTable({
  title,
  firstColumn,
  rows,
  overallTotal,
  emptyLabel,
}: {
  title: string;
  firstColumn: string;
  rows: BreakdownRow[];
  overallTotal: number;
  emptyLabel: string;
}) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <p className="mt-0.5 text-[10px] text-slate-400">
          Each row uses a validated server summary over the full filtered range.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">{emptyLabel}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">{firstColumn}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Count</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">
                  Amount (by currency)
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Company Base</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">% (by count)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2.5">
                    {row.badgeClass ? (
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", row.badgeClass)}>
                        {row.label}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-700">{row.label}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{row.count}</td>
                  <td className="px-4 py-2.5 text-right">
                    <CurrencyTotals byCurrency={row.summary.byCurrency} className="text-xs" />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <CompactCompanyBase summary={row.summary} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500">
                    {overallTotal > 0 ? ((row.count / overallTotal) * 100).toFixed(1) : "0.0"}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <span className="font-medium text-slate-800">Receipt Summary</span>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { FileCheck2, Clock, FileMinus, Inbox } from "lucide-react";

interface QuickStatsProps {
  /** Posted invoices in the current business month (kpis.current_month_posted_invoices). */
  postedThisMonth: number | string;
  /** Overdue invoice count (kpis.overdue_invoice_count). */
  overdueInvoices: number | string;
  /** Unpaid invoices total (invoice_status_counts.unpaid_total). */
  unpaidInvoices: number | string;
  /** Import rows awaiting review (kpis.import_rows_needing_review). */
  importReview: number | string;
}

export function QuickStats({
  postedThisMonth,
  overdueInvoices,
  unpaidInvoices,
  importReview,
}: QuickStatsProps) {
  const importPending =
    typeof importReview === "number" ? importReview > 0 : importReview !== "0" && importReview !== "-";

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-emerald-500" />
          <span className="text-xs font-medium text-slate-500">Posted This Month</span>
        </div>
        <p className="mt-2 text-xl font-bold text-slate-900">{postedThisMonth}</p>
      </div>
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-red-500" />
          <span className="text-xs font-medium text-slate-500">Overdue Invoices</span>
        </div>
        <p className="mt-2 text-xl font-bold text-slate-900">{overdueInvoices}</p>
      </div>
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <FileMinus className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-medium text-slate-500">Unpaid Invoices</span>
        </div>
        <p className="mt-2 text-xl font-bold text-slate-900">{unpaidInvoices}</p>
      </div>
      <div className={cn("glass-card p-4", importPending && "ring-1 ring-amber-300")}>
        <div className="flex items-center gap-2">
          <Inbox className={cn("h-4 w-4", importPending ? "text-amber-600" : "text-slate-400")} />
          <span className="text-xs font-medium text-slate-500">Import Rows to Review</span>
        </div>
        <p className={cn("mt-2 text-xl font-bold", importPending ? "text-amber-700" : "text-slate-900")}>
          {importReview}
        </p>
      </div>
    </div>
  );
}

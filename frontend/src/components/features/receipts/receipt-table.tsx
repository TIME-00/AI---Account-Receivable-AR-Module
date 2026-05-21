"use client";

import { cn } from "@/lib/utils";
import { formatCurrency, formatAmount, formatDate, pct } from "@/lib/utils";
import { LoadingButton } from "@/components/ui/loading-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Send, Eye, ChevronLeft, ChevronRight, AlertCircle, Wallet } from "lucide-react";

const PM_NAMES: Record<string, string> = {
  CHQ: "Cheque", TT: "TT", CASH: "Cash", CC: "Credit Card",
  GIRO: "GIRO", OFST: "Offset", ONLN: "Online",
};

interface ReceiptRow {
  id: string;
  receipt_no: string;
  reference_no?: string | null;
  customer_name: string;
  receipt_date: string;
  payment_method: string;
  currency: string;
  receipt_amount: number;
  base_amount: number;
  allocated_amount: number;
  unallocated_amount: number;
  status: string;
}

interface ReceiptTableProps {
  receipts: ReceiptRow[];
  isLoading: boolean;
  isError: boolean;
  page: number;
  totalCount: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPost: (id: string, receiptNo: string) => void;
  postingId: string | null;
  isPostPending: boolean;
}

export function ReceiptTable({
  receipts, isLoading, isError,
  page, totalCount, totalPages, onPageChange,
  onPost, postingId, isPostPending,
}: ReceiptTableProps) {
  const PAGE_SIZE = 15;

  return (
    <div className="glass-card overflow-hidden">
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <AlertCircle className="h-8 w-8 text-red-500" />
          <p className="mt-3 text-sm text-red-500">Failed to load. Please refresh and try again.</p>
        </div>
      ) : receipts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Wallet className="h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm">No matching receipts found</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 text-left">Receipt No.</th>
                  <th className="px-3 py-2.5 text-left">Customer</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-center">Method</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5 text-center w-44">Allocation Progress</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-center w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const allocPct = r.receipt_amount > 0 ? (r.allocated_amount / r.receipt_amount) * 100 : 0;
                  const isDraft = r.status === "Draft";
                  const isPosting = postingId === r.id;

                  return (
                    <tr key={r.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-slate-900">{r.receipt_no}</p>
                        {r.reference_no && <p className="text-[10px] text-slate-400">Ref: {r.reference_no}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm text-slate-700 truncate max-w-[160px]">{r.customer_name}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm text-slate-600">{formatDate(r.receipt_date)}</p>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {PM_NAMES[r.payment_method] ?? r.payment_method}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <p className="font-mono text-sm font-semibold text-slate-900">{formatCurrency(r.receipt_amount, r.currency)}</p>
                        {r.currency !== "MYR" && (
                          <p className="font-mono text-[10px] text-slate-400">≈ {formatCurrency(r.base_amount)}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                allocPct >= 99.5 ? "bg-emerald-500" : allocPct > 0 ? "bg-gradient-to-r from-brand-600 to-brand-400" : "bg-transparent"
                              )}
                              style={{ width: `${Math.min(allocPct, 100)}%` }}
                            />
                          </div>
                          <span className="flex-shrink-0 font-mono text-[10px] text-slate-500 w-12 text-right">
                            {allocPct >= 99.5 ? "100%" : pct(r.allocated_amount, r.receipt_amount)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex justify-between text-[9px] text-slate-400">
                          <span>Applied: {formatAmount(r.allocated_amount)}</span>
                          <span>Avail: {formatAmount(r.unallocated_amount)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isDraft && (
                            <LoadingButton variant="ghost" size="sm" onClick={() => onPost(r.id, r.receipt_no)} isLoading={isPosting} disabled={isPostPending} loadingText="" title="Post">
                              <Send className="h-3.5 w-3.5 text-brand-500" />
                            </LoadingButton>
                          )}
                          <button type="button" className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" title="View Details">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
            <p className="text-xs text-slate-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} records
            </p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-xs text-slate-600">{page} / {totalPages}</span>
              <button type="button" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

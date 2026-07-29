// ============================================================================
// TSH Synergy AR — Invoice List Page
// Filterable, paginated invoice table with status chips, search, and actions.
// ============================================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useInvoiceList, usePostInvoice, totalPagesFrom } from "@/hooks/use-invoices";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { resolveFxRateDisplay, isPostedDocumentStatus } from "@/lib/fx-presentation";
import { useUserRole } from "@/hooks/use-user-role";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { MoneyCell } from "@/components/ui/money-cell";
import { MoneySummary } from "@/components/ui/money-summary";
import { formatMoney } from "@/lib/currency";
import { formatDate, cn } from "@/lib/utils";
import {
  FileText, Plus, Search, Send, Eye, ChevronLeft, ChevronRight,
  AlertCircle, Filter, X, Upload,
} from "lucide-react";
import { INVOICE_STATUSES } from "@/types";

const PAGE_SIZE = 15;

const DOC_TYPE_COLORS: Record<string, string> = {
  Invoice: "bg-blue-50 text-blue-600",
  "Credit Note": "bg-purple-50 text-purple-600",
  "Debit Note": "bg-amber-50 text-amber-600",
};

export default function InvoicesPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  // ── Data ────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useInvoiceList({
    status: statusFilter || undefined,
    search: searchQuery || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  // Rows for the CURRENT PAGE (backend-scoped; no client re-filtering).
  const invoices = data?.rows ?? [];
  // Batch 9D-D authoritative aggregation over the ENTIRE filtered collection
  // (not just this page) — per-currency subtotals + company-base total.
  const summary = data?.summary;
  const summaryUnavailable = data?.summaryUnavailable;
  const { baseCurrency } = useBaseCurrency();

  // B9DD-FEIR-001: real backend pagination. `totalCount` is the filtered
  // COLLECTION size from meta.total; the previous code used the page length and
  // forced totalPages = 1, which hid every page after the first.
  const pagination = data?.pagination;
  const totalCount = pagination?.total ?? 0;
  const totalPages = totalPagesFrom(pagination);

  // ── Role gating ────────────────────────────────────────────────────
  const { canPostInvoice, canCreateInvoice } = useUserRole();

  // ── Post mutation ──────────────────────────────────────────────────
  const postMutation = usePostInvoice();
  const [postingId, setPostingId] = useState<string | null>(null);

  const handlePost = async (e: React.MouseEvent, id: string, invoiceNo: string) => {
    e.stopPropagation();
    setPostingId(id);
    try {
      const result = await postMutation.mutateAsync({ invoiceId: id });
      toast.success("Invoice Posted", {
        description: `${invoiceNo}${result.je_no ? ` · JE: ${result.je_no}` : ""}`,
      });
    } catch {
      // Error handled by useApi
    } finally {
      setPostingId(null);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────
  const isOverdue = (inv: { due_date: string | null; status: string }) => {
    if (!inv.due_date || !["Open", "Overdue", "Partially Paid"].includes(inv.status)) return null;
    const diff = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
    return diff > 0 ? diff : null;
  };

  const resetFilters = () => {
    setStatusFilter("");
    setSearchQuery("");
    setPage(1);
  };

  const hasFilters = statusFilter || searchQuery;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-brand-500" />
            Invoice Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {totalCount} invoice record{totalCount !== 1 ? "s" : ""}
          </p>
        </div>
        {canCreateInvoice && (
          <div className="flex items-center gap-2">
            <Link href="/invoices/import">
              <LoadingButton variant="secondary" size="md">
                <Upload className="h-4 w-4" />
                Import CSV/Excel
              </LoadingButton>
            </Link>
            <Link href="/invoices/new">
              <LoadingButton variant="primary" size="md">
                <Plus className="h-4 w-4" />
                New Invoice
              </LoadingButton>
            </Link>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="glass-card p-4 space-y-3">
        {/* Search */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search invoice no. or customer..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="input-premium w-full pl-9"
            />
          </div>
          {hasFilters && (
            <button
              onClick={resetFilters}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
        </div>

        {/* Status chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <button
            onClick={() => { setStatusFilter(""); setPage(1); }}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-all",
              !statusFilter
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            All statuses
          </button>
          {INVOICE_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(statusFilter === s ? "" : s); setPage(1); }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-all",
                statusFilter === s
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Authoritative multi-currency aggregation (Batch 9D-D).
          These totals cover the whole filtered collection, NOT just this page —
          the heading says so explicitly so a collection total is never mistaken
          for a page subtotal. */}
      {summary && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Totals for all {totalCount} matching document(s) — not just this page
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneySummary summary={summary.currentBalance} title="Outstanding" />
            <MoneySummary summary={summary.documentTotal} title="Invoiced (document total)" />
          </div>
        </div>
      )}
      {summaryUnavailable && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {summaryUnavailable}
        </p>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {isLoading ? (
          /* Loading state */
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
              <p className="text-xs text-slate-400">Loading invoices...</p>
            </div>
          </div>
        ) : isError ? (
          /* Error state */
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="mt-3 text-sm font-medium text-red-600">Failed to load invoices</p>
            <p className="mt-1 text-xs text-slate-500">Please check your connection and try again.</p>
            <LoadingButton variant="secondary" size="sm" className="mt-4" onClick={() => refetch()}>
              Retry
            </LoadingButton>
          </div>
        ) : invoices.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20">
            <FileText className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-600">
              {hasFilters ? "No invoices match your filters" : "No invoices yet"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {hasFilters ? "Try adjusting your search or status filter." : "Create your first invoice to get started."}
            </p>
            {!hasFilters && (
              <Link
                href="/invoices/new"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-brand-900/30 transition-all hover:bg-brand-500"
              >
                <Plus className="h-4 w-4" />
                Create Your First Invoice
              </Link>
            )}
            {hasFilters && (
              <button onClick={resetFilters} className="mt-3 text-xs text-brand-600 hover:underline">
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5 text-left">Invoice No.</th>
                    <th className="px-3 py-2.5 text-left">Customer</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">Due Date</th>
                    <th className="px-3 py-2.5 text-right">Total Amount</th>
                    <th className="px-3 py-2.5 text-right">Outstanding</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                    <th className="px-3 py-2.5 text-center w-28">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const overdueDays = isOverdue(inv);
                    const isDraft = inv.status === "Draft";
                    const isPosting = postingId === inv.id;

                    return (
                      <tr
                        key={inv.id}
                        onClick={() => router.push(`/invoices/${inv.id}`)}
                        className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                      >
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-slate-900">{inv.invoice_no}</p>
                          <span
                            className={cn(
                              "mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
                              DOC_TYPE_COLORS[inv.doc_type] ?? "bg-slate-100 text-slate-600"
                            )}
                          >
                            {inv.doc_type}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-sm text-slate-700 truncate max-w-[180px]">{inv.customer_name}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-sm text-slate-600">{formatDate(inv.invoice_date)}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-sm text-slate-600">{inv.due_date ? formatDate(inv.due_date) : "-"}</p>
                          {overdueDays && (
                            <p className="text-[10px] font-medium text-red-500">
                              {overdueDays} day{overdueDays > 1 ? "s" : ""} overdue
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <MoneyCell
                            amount={inv.total_amount}
                            currency={inv.currency}
                            baseAmount={inv.base_total}
                            baseCurrency={inv.base_currency}
                            baseAvailable={inv.base_available}
                            baseBasis={isDraft ? "estimated" : "booked"}
                            fxRate={resolveFxRateDisplay({
                              currency: inv.currency,
                              baseCurrency: inv.base_currency ?? baseCurrency,
                              documentPosted: isPostedDocumentStatus(inv.status),
                              decision: inv.fx_decision,
                              draftExchangeRate: inv.exchange_rate,
                            })}
                            documentPosted={isPostedDocumentStatus(inv.status)}
                            decisionReason={inv.fx_posting_eligibility?.reason}
                            align="right"
                          />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <p
                            className={cn(
                              "font-mono text-sm font-semibold tabular-nums",
                              inv.outstanding > 0 ? "text-amber-600" : "text-slate-400"
                            )}
                          >
                            {formatMoney(inv.outstanding, inv.currency)}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {canPostInvoice && isDraft && (
                              <LoadingButton
                                variant="ghost"
                                size="sm"
                                onClick={(e) => handlePost(e, inv.id, inv.invoice_no)}
                                isLoading={isPosting}
                                disabled={postMutation.isPending}
                                loadingText=""
                                title="Post Invoice"
                              >
                                <Send className="h-3.5 w-3.5 text-brand-500" />
                              </LoadingButton>
                            )}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); router.push(`/invoices/${inv.id}`); }}
                              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                              title="View Details"
                            >
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
                Showing {totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} records
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous page"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="px-3 text-xs text-slate-600">{page} / {totalPages}</span>
                <button
                  type="button"
                  aria-label="Next page"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

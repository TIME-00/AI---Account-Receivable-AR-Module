// ============================================================================
// TSH Synergy AR — Credit / Debit Notes List (Batch 9A)
// Real, read-only list backed by GET /invoices (filtered to Credit Note and
// Debit Note doc types). Creation/posting happen through the Invoice Workbench
// and existing invoice detail actions — this page does not introduce any new
// financial mutation.
// ============================================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useInvoiceList, totalPagesFrom } from "@/hooks/use-invoices";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { MoneyCell } from "@/components/ui/money-cell";
import { MoneySummary } from "@/components/ui/money-summary";
import { resolveFxRateDisplay, isPostedDocumentStatus } from "@/lib/fx-presentation";
import { formatDate, cn } from "@/lib/utils";
import { CreditCard, Search, Eye, AlertCircle, X, Info, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 20;

/**
 * The backend `doc_type` filter (ar_invoice_collection `p_doc_type`) accepts a
 * SINGLE value, so this page filters by one note type at a time on the SERVER
 * rather than fetching a generic capped invoice page and filtering client-side
 * (B9DD-FEIR-001). Each view therefore gets real pagination and an authoritative
 * summary scoped to exactly the rows it shows.
 */
const NOTE_DOC_TYPES = ["Credit Note", "Debit Note"] as const;
type NoteDocType = (typeof NOTE_DOC_TYPES)[number];

const DOC_TYPE_COLORS: Record<string, string> = {
  "Credit Note": "bg-purple-50 text-purple-600",
  "Debit Note": "bg-amber-50 text-amber-600",
};

export default function CreditNotesPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [docType, setDocType] = useState<NoteDocType>("Credit Note");
  const [page, setPage] = useState(1);
  const { baseCurrency } = useBaseCurrency();

  // Server-side doc_type filter — no client-side document-type filtering.
  const { data, isLoading, isError, refetch } = useInvoiceList({
    search: searchQuery || undefined,
    doc_type: docType,
    page,
    page_size: PAGE_SIZE,
  });

  const notes = data?.rows ?? [];
  const summary = data?.summary;
  const summaryUnavailable = data?.summaryUnavailable;
  const pagination = data?.pagination;
  const totalCount = pagination?.total ?? 0;
  const totalPages = totalPagesFrom(pagination);

  const hasSearch = searchQuery.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          <CreditCard className="h-6 w-6 text-brand-500" />
          Credit &amp; Debit Notes
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {totalCount} {docType.toLowerCase()} record{totalCount !== 1 ? "s" : ""} — read-only view
        </p>
      </div>

      {/* Info banner — honest scope */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <p className="text-xs text-blue-700">
          Credit and debit notes are created through the Invoice Workbench (choose the document type
          when creating) and managed from the invoice detail page. This screen is a read-only list;
          select a note to view its details.
        </p>
      </div>

      {/* Document type — a SERVER filter, one type at a time */}
      <div className="flex flex-wrap items-center gap-2">
        {NOTE_DOC_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setDocType(t); setPage(1); }}
            aria-pressed={docType === t}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              docType === t
                ? "border-brand-200 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-surface text-slate-500 hover:bg-slate-50"
            )}
          >
            {t}s
          </button>
        ))}
      </div>

      {/* Authoritative aggregation for the whole filtered collection */}
      {summary && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Totals for all {totalCount} matching {docType.toLowerCase()}(s) — not just this page
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneySummary summary={summary.documentTotal} title="Note total" />
            <MoneySummary summary={summary.currentBalance} title="Outstanding" />
          </div>
        </div>
      )}
      {summaryUnavailable && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {summaryUnavailable}
        </p>
      )}

      {/* Search */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search note no. or customer..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="input-premium w-full pl-9"
            />
          </div>
          {hasSearch && (
            <button
              onClick={() => setSearchQuery("")}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
              <p className="text-xs text-slate-400">Loading notes...</p>
            </div>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="mt-3 text-sm font-medium text-red-600">Failed to load credit/debit notes</p>
            <p className="mt-1 text-xs text-slate-500">Please check your connection and try again.</p>
            <LoadingButton variant="secondary" size="sm" className="mt-4" onClick={() => refetch()}>
              Retry
            </LoadingButton>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <CreditCard className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-600">
              {hasSearch
                ? "No notes match your search"
                : `No visible ${docType.toLowerCase()}s`}
            </p>
            <p className="mt-1 max-w-sm text-center text-xs text-slate-400">
              {hasSearch
                ? "Try a different search term."
                : `There are no ${docType.toLowerCase()}s you're authorized to view — this is an empty result, not an error. ${docType}s are created from the Invoice Workbench by selecting ${docType}.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 text-left">Note No.</th>
                  <th className="px-3 py-2.5 text-left">Type</th>
                  <th className="px-3 py-2.5 text-left">Customer</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-right">Total Amount</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-center w-16">View</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr
                    key={n.id}
                    onClick={() => router.push(`/invoices/${n.id}`)}
                    className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">{n.invoice_no}</td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
                          DOC_TYPE_COLORS[n.doc_type] ?? "bg-slate-100 text-slate-600"
                        )}
                      >
                        {n.doc_type}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <p className="max-w-[180px] truncate text-sm text-slate-700">{n.customer_name}</p>
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-600">{formatDate(n.invoice_date)}</td>
                    <td className="px-3 py-3 text-right">
                      <MoneyCell
                        amount={n.total_amount}
                        currency={n.currency}
                        baseAmount={n.base_total}
                        baseCurrency={n.base_currency}
                        baseAvailable={n.base_available}
                        baseBasis={n.status === "Draft" ? "estimated" : "booked"}
                        fxRate={resolveFxRateDisplay({
                          currency: n.currency,
                          baseCurrency: n.base_currency ?? baseCurrency,
                          documentPosted: isPostedDocumentStatus(n.status),
                          decision: n.fx_decision,
                          draftExchangeRate: n.exchange_rate,
                        })}
                        documentPosted={isPostedDocumentStatus(n.status)}
                        decisionReason={n.fx_posting_eligibility?.reason}
                        align="right"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <StatusBadge status={n.status} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); router.push(`/invoices/${n.id}`); }}
                        className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        title="View Details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
                <p className="text-xs text-slate-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    aria-label="Previous page"
                    className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-3 text-xs text-slate-600">{page} / {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                    className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
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

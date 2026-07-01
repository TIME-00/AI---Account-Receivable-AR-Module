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
import { useInvoiceList } from "@/hooks/use-invoices";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { CreditCard, Search, Eye, AlertCircle, X, Info } from "lucide-react";

const DOC_TYPE_COLORS: Record<string, string> = {
  "Credit Note": "bg-purple-50 text-purple-600",
  "Debit Note": "bg-amber-50 text-amber-600",
};

export default function CreditNotesPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch a generous page and filter to credit/debit notes client-side.
  const { data: allDocs = [], isLoading, isError, refetch } = useInvoiceList({
    search: searchQuery || undefined,
    page: 1,
    page_size: 100,
  });

  const notes = allDocs.filter(
    (d) => d.doc_type === "Credit Note" || d.doc_type === "Debit Note"
  );

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
          {notes.length} note record{notes.length !== 1 ? "s" : ""} — read-only view
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

      {/* Search */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search note no. or customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
              {hasSearch ? "No notes match your search" : "No credit or debit notes yet"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {hasSearch
                ? "Try a different search term."
                : "Create one from the Invoice Workbench by selecting Credit Note or Debit Note."}
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
                    <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-slate-900">
                      {formatCurrency(n.total_amount, n.currency)}
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
          </div>
        )}
      </div>
    </div>
  );
}

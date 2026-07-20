// ============================================================================
// TSH Synergy AR — Invoice Detail Page
// Read-only invoice view with header, line items, totals, and actions.
// ============================================================================

"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useInvoice, usePostInvoice, useCancelInvoice } from "@/hooks/use-invoices";
import { useUserRole } from "@/hooks/use-user-role";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { AllocationHistoryTable } from "@/components/allocation-history-table";
import { formatAmount, formatDate, cn } from "@/lib/utils";
import { formatMoney, formatMoneySafe, normalizeCurrency } from "@/lib/currency";
import { FxChip } from "@/components/ui/fx-chip";
import {
  fxSourcePresentation,
  fxDecisionStatePresentation,
  resolveFxRateDisplay,
  isPostedDocumentStatus,
} from "@/lib/fx-presentation";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import type { InvoiceLine } from "@/types";
import {
  ChevronRight, Send, XCircle, ArrowLeft,
  AlertCircle, BookOpen, MessageSquare,
} from "lucide-react";

const DOC_TYPE_COLORS: Record<string, string> = {
  Invoice: "bg-blue-50 text-blue-700",
  "Credit Note": "bg-purple-50 text-purple-700",
  "Debit Note": "bg-amber-50 text-amber-700",
};

export default function InvoiceDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: invoice, isLoading, isError } = useInvoice(id);
  // Fallback company base currency when the document row omits base_currency.
  const { baseCurrency } = useBaseCurrency();
  const postMutation = usePostInvoice();
  const cancelMutation = useCancelInvoice();
  const [isPosting, setIsPosting] = useState(false);
  const { canPostInvoice, canCancelInvoice } = useUserRole();

  // ── Post action ────────────────────────────────────────────────────
  const handlePost = async () => {
    if (!invoice) return;
    setIsPosting(true);
    try {
      const result = await postMutation.mutateAsync({ invoiceId: id });
      toast.success("Invoice Posted", {
        description: `${invoice.invoice_no}${result.je_no ? ` · JE: ${result.je_no}` : ""}`,
      });
    } catch {
      // Error handled by useApi
    } finally {
      setIsPosting(false);
    }
  };

  // ── Cancel action ──────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!invoice) return;
    const reason = window.prompt(
      "Enter cancellation reason (minimum 10 characters):"
    );
    if (!reason) return;

    // Backend requires cancel_reason.length >= 10
    if (reason.trim().length < 10) {
      toast.error("Cancel reason too short", {
        description: "Cancel reason must be at least 10 characters.",
      });
      return;
    }

    try {
      await cancelMutation.mutateAsync({
        invoiceId: id,
        cancel_reason: reason.trim(),
      });
      toast.success("Invoice Cancelled", { description: invoice.invoice_no });
    } catch {
      // Error handled by useApi
    }
  };

  // ── Loading state ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-4 w-64 animate-pulse rounded bg-slate-200" />
        <div className="glass-card p-6 space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
                <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
        <div className="glass-card p-6">
          <div className="h-6 w-32 animate-pulse rounded bg-slate-200 mb-4" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-4 py-3">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="h-4 flex-1 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────
  if (isError || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <p className="mt-4 text-lg font-semibold text-slate-700">
          {isError ? "Failed to load invoice" : "Invoice not found"}
        </p>
        <p className="mt-1 text-sm text-slate-500">The invoice may have been deleted or you don&apos;t have access.</p>
        <Link
          href="/invoices"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Link>
      </div>
    );
  }

  // Support both `lines` (expected) and `invoice_lines` (fallback) in case the
  // deployed backend response shape varies. Narrowed explicitly, not cast to any.
  const lines: InvoiceLine[] =
    invoice.lines ?? (invoice as { invoice_lines?: InvoiceLine[] }).invoice_lines ?? [];
  const isDraft = invoice.status === "Draft";
  // B9DD-FEIR-007: lifecycle-aware rate. A posted invoice without an FX booking
  // decision resolves to "Booked rate not available" — the raw `exchange_rate`
  // column is never promoted to a booked rate.
  const fxRate = resolveFxRateDisplay({
    currency: invoice.currency,
    baseCurrency: invoice.base_currency ?? baseCurrency,
    documentPosted: isPostedDocumentStatus(invoice.status),
    decision: invoice.fx_decision,
    draftExchangeRate: invoice.exchange_rate,
  });
  // Issue 6: Conservative — allow cancel only for 'Open' status.
  // Backend may not support cancelling 'Overdue' invoices.
  const canCancel = invoice.status === "Open";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href="/" className="text-slate-400 hover:text-slate-600 transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <Link href="/invoices" className="text-slate-400 hover:text-slate-600 transition-colors">Invoices</Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="font-medium text-slate-700">{invoice.invoice_no}</span>
      </nav>

      {/* Header Card */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{invoice.invoice_no}</h1>
              <StatusBadge status={invoice.status} size="md" />
            </div>
            <span
              className={cn(
                "mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium",
                DOC_TYPE_COLORS[invoice.doc_type] ?? "bg-slate-100 text-slate-600"
              )}
            >
              {invoice.doc_type}
            </span>
          </div>

          {/* Actions — hidden for Auditor and System Admin roles */}
          <div className="flex items-center gap-2">
            {canPostInvoice && isDraft && (
              <LoadingButton
                variant="primary"
                size="md"
                onClick={handlePost}
                isLoading={isPosting}
                loadingText="Posting..."
              >
                <Send className="h-4 w-4" />
                Post Invoice
              </LoadingButton>
            )}
            {canCancelInvoice && canCancel && (
              <LoadingButton
                variant="danger"
                size="md"
                onClick={handleCancel}
                isLoading={cancelMutation.isPending}
                loadingText="Cancelling..."
              >
                <XCircle className="h-4 w-4" />
                Cancel Invoice
              </LoadingButton>
            )}
          </div>
        </div>

        {/* Detail Fields */}
        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <DetailField label="Customer" value={invoice.customer_name} />
          <DetailField label="Invoice Date" value={formatDate(invoice.invoice_date)} />
          <DetailField label="Due Date" value={invoice.due_date ? formatDate(invoice.due_date) : "—"} />
          <DetailField
            label="Currency"
            value={
              fxRate.directionLabel
                ? `${invoice.currency} — ${fxRate.caption}: ${fxRate.directionLabel}`
                : `${invoice.currency} — ${fxRate.caption}`
            }
          />
          {invoice.reference_no && <DetailField label="Reference No." value={invoice.reference_no} />}
          {invoice.posting_period && <DetailField label="Posting Period" value={invoice.posting_period} />}
          {invoice.posted_by && <DetailField label="Posted By" value={invoice.posted_by} />}
          {invoice.posted_at && <DetailField label="Posted At" value={formatDate(invoice.posted_at)} />}
          <DetailField label="Created At" value={formatDate(invoice.created_at)} />
          {invoice.cn_type && <DetailField label="CN Type" value={invoice.cn_type} />}
          {invoice.reason_code && <DetailField label="Reason Code" value={invoice.reason_code} />}
        </div>
      </div>

      {/* Line Items */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 bg-slate-50">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">Line Items</h2>
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700">
              {lines.length}
            </span>
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-slate-400">
            <p>Line item details are not available for this invoice.</p>
            <p className="mt-1 text-[10px] text-slate-300">
              This may occur if the invoice was created without lines or if the data is loading.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 text-center w-12">#</th>
                  <th className="px-3 py-2.5 text-left">Description</th>
                  <th className="px-3 py-2.5 text-left w-20">Item Code</th>
                  <th className="px-3 py-2.5 text-right w-16">Qty</th>
                  <th className="px-3 py-2.5 text-center w-14">UOM</th>
                  {/* B9DD-RR-004: monetary columns name the document's own
                      transaction currency, so no line cell is codeless. */}
                  <th className="px-3 py-2.5 text-right w-24">Unit Price ({invoice.currency})</th>
                  <th className="px-3 py-2.5 text-right w-16">Disc %</th>
                  <th className="px-3 py-2.5 text-right w-20">Disc Amt ({invoice.currency})</th>
                  <th className="px-3 py-2.5 text-right w-16">Tax %</th>
                  <th className="px-3 py-2.5 text-right w-20">Tax Amt ({invoice.currency})</th>
                  <th className="px-3 py-2.5 text-right w-24">Line Total ({invoice.currency})</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-center text-xs text-slate-400">{line.line_no}</td>
                    <td className="px-3 py-3">
                      <p className="text-sm text-slate-800">{line.description}</p>
                      {line.line_remarks && (
                        <p className="mt-0.5 text-[10px] text-slate-400 italic">{line.line_remarks}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-500">{line.item_code || "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">{line.quantity}</td>
                    <td className="px-3 py-3 text-center text-xs text-slate-500">{line.uom || "pcs"}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm text-slate-800">
                      {formatAmount(line.unit_price)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-500">
                      {line.discount_pct > 0 ? `${line.discount_pct}%` : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-500">
                      {line.discount_amt > 0 ? formatAmount(line.discount_amt) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-500">
                      {line.tax_rate > 0 ? `${line.tax_rate}%` : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-500">
                      {line.tax_amount > 0 ? formatAmount(line.tax_amount) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-slate-900">
                      {formatAmount(line.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals Footer */}
        <div className="border-t border-slate-200 bg-slate-50/80 px-5 py-4">
          <div className="flex justify-end">
            <div className="w-72 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-mono font-medium text-slate-800">{formatMoney(invoice.subtotal, invoice.currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Tax Total</span>
                <span className="font-mono font-medium text-slate-800">{formatMoney(invoice.tax_total, invoice.currency)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-300 pt-2 text-sm">
                <span className="font-semibold text-slate-900">Grand Total</span>
                <span className="font-mono text-lg font-bold text-slate-900">
                  {formatMoney(invoice.total_amount, invoice.currency)}
                </span>
              </div>
              {normalizeCurrency(invoice.currency) !== normalizeCurrency(invoice.base_currency) && (
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{isDraft ? "Estimated base" : "Booked base"} ({normalizeCurrency(invoice.base_currency)})</span>
                  <span className="font-mono">
                    {invoice.base_available !== false
                      ? `${isDraft ? "≈ " : ""}${formatMoneySafe(invoice.base_total, invoice.base_currency)}`
                      : "Not available"}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Outstanding</span>
                <span className={cn(
                  "font-mono font-semibold",
                  invoice.outstanding > 0 ? "text-amber-600" : "text-emerald-600"
                )}>
                  {formatMoney(invoice.outstanding, invoice.currency)}
                </span>
              </div>

              {/* FX booking provenance (Batch 9D-D) — posted, non-base documents */}
              {normalizeCurrency(invoice.currency) !== normalizeCurrency(invoice.base_currency) &&
                (invoice.fx_decision || invoice.fx_posting_eligibility) && (
                <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-200 pt-2">
                  <span className="mr-auto text-[11px] uppercase tracking-wide text-slate-400">FX booking</span>
                  {/* B9DD-FEIR-007: explicit direction + lifecycle, never a bare rate. */}
                  {fxRate.directionLabel ? (
                    <span
                      title={fxRate.description}
                      className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-500"
                    >
                      {fxRate.caption}: {fxRate.directionLabel}
                    </span>
                  ) : (
                    <span
                      title={fxRate.description}
                      className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-200"
                    >
                      {fxRate.caption}
                    </span>
                  )}
                  {invoice.fx_decision?.deviation_pct != null && (
                    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                      Δ {Number(invoice.fx_decision.deviation_pct).toFixed(2)}%
                    </span>
                  )}
                  {invoice.fx_decision?.source_category && (
                    <FxChip presentation={fxSourcePresentation(invoice.fx_decision.source_category)} />
                  )}
                  {invoice.fx_posting_eligibility?.reason && (
                    <FxChip presentation={fxDecisionStatePresentation(invoice.fx_posting_eligibility.reason)} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AllocationHistoryTable
        invoiceId={id}
        showReceiptColumn
        showInvoiceColumn={false}
        maxRows={8}
        title="Payment Allocations"
        emptyMessage="No payments allocated yet."
      />

      {/* Remarks */}
      {(invoice.internal_remarks || invoice.invoice_remarks) && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">Remarks</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {invoice.internal_remarks && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-1">Internal Remarks</p>
                <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">{invoice.internal_remarks}</p>
              </div>
            )}
            {invoice.invoice_remarks && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-1">Invoice Remarks</p>
                <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">{invoice.invoice_remarks}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Journal Entry Reference (if posted) */}
      {invoice.posted_at && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-slate-700">Journal Entry</h2>
          </div>
          <p className="text-sm text-slate-600">
            A journal entry was auto-generated when this invoice was posted on{" "}
            <span className="font-medium">{formatDate(invoice.posted_at)}</span>.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            JE numbers appear in the post confirmation toast. See the Journal Entries reference guide for how AR postings map to the general ledger.
          </p>
        </div>
      )}

      {/* Cancellation Info */}
      {invoice.status === "Cancelled" && (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-6">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="h-4 w-4 text-red-500" />
            <h2 className="text-sm font-semibold text-red-700">Cancellation Details</h2>
          </div>
          {invoice.cancel_reason && (
            <p className="text-sm text-red-600">Reason: {invoice.cancel_reason}</p>
          )}
          {invoice.cancelled_at && (
            <p className="mt-1 text-xs text-red-400">
              Cancelled on {formatDate(invoice.cancelled_at)}
              {invoice.cancelled_by ? ` by ${invoice.cancelled_by}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helper Component ─────────────────────────────────────────────────────

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

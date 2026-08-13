// ============================================================================
// TSH Synergy AR — Receipt Detail Page
// Read-only receipt view with amount summary, allocation progress, and actions.
// ============================================================================

"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useReceipt, useCancelReceipt } from "@/hooks/use-receipts";
import { useUserRole } from "@/hooks/use-user-role";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { AllocationHistoryTable } from "@/components/allocation-history-table";
import { formatDate, pct, cn } from "@/lib/utils";
import { formatMoney, formatMoneySafe, normalizeCurrency } from "@/lib/currency";
import { FxChip } from "@/components/ui/fx-chip";
import {
  fxSourcePresentation,
  fxDecisionStatePresentationForDocument,
  resolveFxRateDisplay,
  isPostedDocumentStatus,
} from "@/lib/fx-presentation";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { PAYMENT_METHOD_NAMES } from "@/types";
import {
  ChevronRight, XCircle, ArrowLeft, AlertCircle,
  Banknote, PiggyBank, CreditCard, MessageSquare, BookOpen,
} from "lucide-react";

export default function ReceiptDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: receipt, isLoading, isError } = useReceipt(id);
  // Fallback company base currency when the document row omits base_currency.
  const { baseCurrency } = useBaseCurrency();
  const cancelMutation = useCancelReceipt();
  const { canCancelReceipt } = useUserRole();

  // ── Cancel action ──────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!receipt) return;
    const reason = window.prompt("Enter cancellation reason:");
    if (!reason) return;

    try {
      await cancelMutation.mutateAsync({ id, cancel_reason: reason });
      toast.success("Receipt Cancelled", { description: receipt.receipt_no });
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
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card p-5">
              <div className="h-3 w-24 animate-pulse rounded bg-slate-200 mb-2" />
              <div className="h-7 w-36 animate-pulse rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────
  if (isError || !receipt) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <p className="mt-4 text-lg font-semibold text-slate-700">
          {isError ? "Failed to load receipt" : "Receipt not found"}
        </p>
        <p className="mt-1 text-sm text-slate-500">The receipt may have been deleted or you don&apos;t have access.</p>
        <Link
          href="/receipts"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Receipts
        </Link>
      </div>
    );
  }

  const allocPct = receipt.receipt_amount > 0 ? (receipt.allocated_amount / receipt.receipt_amount) * 100 : 0;
  // B9DD-FEIR-007: lifecycle-aware rate (see invoice detail for rationale).
  const fxRate = resolveFxRateDisplay({
    currency: receipt.currency,
    baseCurrency: receipt.base_currency ?? baseCurrency,
    documentPosted: isPostedDocumentStatus(receipt.status),
    decision: receipt.fx_decision,
    draftExchangeRate: receipt.exchange_rate,
  });
  const fxDecisionPresentation = receipt.fx_posting_eligibility?.reason
    ? fxDecisionStatePresentationForDocument(
        receipt.fx_posting_eligibility.reason,
        isPostedDocumentStatus(receipt.status),
      )
    : null;
  const canCancel = receipt.status === "Posted";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href="/" className="text-slate-400 hover:text-slate-600 transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <Link href="/receipts" className="text-slate-400 hover:text-slate-600 transition-colors">Receipts</Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="font-medium text-slate-700">{receipt.receipt_no}</span>
      </nav>

      {/* Header Card */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{receipt.receipt_no}</h1>
              <StatusBadge status={receipt.status} size="md" />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {PAYMENT_METHOD_NAMES[receipt.payment_method] ?? receipt.payment_method} Payment
            </p>
          </div>

          {/* Actions — hidden for Auditor and System Admin roles */}
          <div className="flex items-center gap-2">
            {canCancelReceipt && canCancel && (
              <LoadingButton
                variant="danger"
                size="md"
                onClick={handleCancel}
                isLoading={cancelMutation.isPending}
                loadingText="Cancelling..."
              >
                <XCircle className="h-4 w-4" />
                Cancel Receipt
              </LoadingButton>
            )}
          </div>
        </div>

        {/* Detail Fields */}
        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <DetailField label="Customer" value={receipt.customer_name} />
          <DetailField label="Receipt Date" value={formatDate(receipt.receipt_date)} />
          <DetailField label="Value Date" value={receipt.value_date ? formatDate(receipt.value_date) : "—"} />
          <DetailField
            label="Payment Method"
            value={PAYMENT_METHOD_NAMES[receipt.payment_method] ?? receipt.payment_method}
          />
          {receipt.reference_no && <DetailField label="Reference / Cheque No." value={receipt.reference_no} />}
          {receipt.cheque_date && receipt.payment_method === "CHQ" && (
            <DetailField label="Cheque Date" value={formatDate(receipt.cheque_date)} />
          )}
          <DetailField label="Bank Account" value={receipt.bank_account_name || "—"} />
          <DetailField
            label="Currency"
            value={
              fxRate.directionLabel
                ? `${receipt.currency} — ${fxRate.caption}: ${fxRate.directionLabel}`
                : `${receipt.currency} — ${fxRate.caption}`
            }
          />
          <DetailField label="Created At" value={formatDate(receipt.created_at)} />
          {receipt.posted_by && <DetailField label="Posted By" value={receipt.posted_by} />}
          {receipt.posted_at && <DetailField label="Posted At" value={formatDate(receipt.posted_at)} />}
        </div>
      </div>

      {/* Amount Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Receipt Amount */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Banknote className="h-4 w-4" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Receipt Amount</p>
          </div>
          <p className="text-xl font-bold font-mono text-slate-900">
            {formatMoney(receipt.receipt_amount, receipt.currency)}
          </p>
          {normalizeCurrency(receipt.currency) !== normalizeCurrency(receipt.base_currency) && (
            <p className="mt-0.5 text-xs font-mono text-slate-400">
              {receipt.status === "Draft" ? "Estimated base" : "Booked base"} ({normalizeCurrency(receipt.base_currency)}):{" "}
              {receipt.base_available !== false
                ? `${receipt.status === "Draft" ? "≈ " : ""}${formatMoneySafe(receipt.base_amount, receipt.base_currency)}`
                : "Not available"}
            </p>
          )}
          {normalizeCurrency(receipt.currency) !== normalizeCurrency(receipt.base_currency) &&
            (receipt.fx_decision || receipt.fx_posting_eligibility) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
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
              {receipt.fx_decision?.source_category && (
                <FxChip presentation={fxSourcePresentation(receipt.fx_decision.source_category)} />
              )}
              {fxDecisionPresentation && <FxChip presentation={fxDecisionPresentation} />}
            </div>
          )}
        </div>

        {/* Allocated */}
        <div className={cn("glass-card p-5", receipt.allocated_amount > 0 && "border-emerald-200/60")}>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <PiggyBank className="h-4 w-4" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Allocated</p>
          </div>
          <p className="text-xl font-bold font-mono text-emerald-700">
            {formatMoney(receipt.allocated_amount, receipt.currency)}
          </p>
        </div>

        {/* Unapplied */}
        <div className={cn("glass-card p-5", receipt.unallocated_amount > 0 && "border-amber-200/60")}>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <CreditCard className="h-4 w-4" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Unapplied Receipt Balance</p>
          </div>
          <p className={cn("text-xl font-bold font-mono", receipt.unallocated_amount > 0 ? "text-amber-600" : "text-slate-400")}>
            {formatMoney(receipt.unallocated_amount, receipt.currency)}
          </p>
          {receipt.unallocated_amount > 0.005 && (
            <p className="mt-1 text-xs text-amber-700">Remaining amount is retained as unapplied cash.</p>
          )}
        </div>
      </div>

      {/* Allocation Progress Bar */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Allocation Progress</h2>
          <span className="text-sm font-mono font-semibold text-slate-600">
            {allocPct >= 99.5 ? "100%" : pct(receipt.allocated_amount, receipt.receipt_amount)}
          </span>
        </div>
        <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700 ease-out",
              allocPct >= 99.5
                ? "bg-emerald-500"
                : allocPct > 0
                ? "bg-gradient-to-r from-brand-600 to-brand-400"
                : "bg-transparent"
            )}
            style={{ width: `${Math.min(allocPct, 100)}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-400">
          {/* B9DD-RR-004: both figures are in the receipt's own currency. */}
          <span>Applied: {formatMoney(receipt.allocated_amount, receipt.currency)}</span>
          <span>Unapplied: {formatMoney(receipt.unallocated_amount, receipt.currency)}</span>
        </div>
      </div>

      <AllocationHistoryTable
        receiptId={id}
        showReceiptColumn={false}
        showInvoiceColumn
        maxRows={8}
        title="Allocation Details"
        emptyMessage="No allocations yet."
      />

      {/* Remarks */}
      {receipt.remarks && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">Remarks</h2>
          </div>
          <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">{receipt.remarks}</p>
        </div>
      )}

      {/* Journal Entry Reference (if posted) */}
      {receipt.posted_at && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-slate-700">Journal Entry</h2>
          </div>
          <p className="text-sm text-slate-600">
            A journal entry was auto-generated when this receipt was posted on{" "}
            <span className="font-medium">{formatDate(receipt.posted_at)}</span>.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            JE numbers appear in the post confirmation toast. See the Journal Entries reference guide for how AR postings map to the general ledger.
          </p>
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

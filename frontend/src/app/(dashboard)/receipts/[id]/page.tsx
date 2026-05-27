// ============================================================================
// TSH Synergy AR — Receipt Detail Page
// Read-only receipt view with amount summary, allocation progress, and actions.
// ============================================================================

"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useReceipt, useCancelReceipt } from "@/hooks/use-receipts";
import { useUserRole } from "@/hooks/use-user-role";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { formatCurrency, formatAmount, formatDate, pct, cn } from "@/lib/utils";
import { PAYMENT_METHOD_NAMES } from "@/types";
import {
  Wallet, ChevronRight, XCircle, ArrowLeft, AlertCircle,
  Banknote, PiggyBank, CreditCard, MessageSquare, BookOpen, ListChecks,
} from "lucide-react";

export default function ReceiptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: receipt, isLoading, isError } = useReceipt(id);
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
        <p className="mt-1 text-sm text-slate-500">The receipt may have been deleted or you don't have access.</p>
        <Link
          href="/receipts"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Receipts
        </Link>
      </div>
    );
  }

  const allocPct = receipt.receipt_amount > 0 ? (receipt.allocated_amount / receipt.receipt_amount) * 100 : 0;
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
          <DetailField label="Currency" value={`${receipt.currency} (Rate: ${receipt.exchange_rate})`} />
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
            {formatCurrency(receipt.receipt_amount, receipt.currency)}
          </p>
          {receipt.currency !== "MYR" && (
            <p className="mt-0.5 text-xs font-mono text-slate-400">≈ {formatCurrency(receipt.base_amount)}</p>
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
            {formatCurrency(receipt.allocated_amount, receipt.currency)}
          </p>
        </div>

        {/* Unallocated */}
        <div className={cn("glass-card p-5", receipt.unallocated_amount > 0 && "border-amber-200/60")}>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <CreditCard className="h-4 w-4" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Unallocated</p>
          </div>
          <p className={cn("text-xl font-bold font-mono", receipt.unallocated_amount > 0 ? "text-amber-600" : "text-slate-400")}>
            {formatCurrency(receipt.unallocated_amount, receipt.currency)}
          </p>
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
          <span>Applied: {formatAmount(receipt.allocated_amount)}</span>
          <span>Available: {formatAmount(receipt.unallocated_amount)}</span>
        </div>
      </div>

      {/* Allocation History */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <ListChecks className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">Allocation History</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center px-6">
          <ListChecks className="h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">
            Allocation details are shown on the Allocation Wizard page.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Navigate to the Allocation page to view or manage allocations for this receipt.
          </p>
          {/* TODO: When allocation detail API is available, show linked invoices here */}
          {receipt.status !== "Draft" && receipt.allocated_amount > 0 && (
            <Link
              href="/allocations"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 transition-colors"
            >
              View Allocations
            </Link>
          )}
        </div>
      </div>

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
            JE numbers appear in the post confirmation toast. Journal Entry detail pages are coming soon.
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

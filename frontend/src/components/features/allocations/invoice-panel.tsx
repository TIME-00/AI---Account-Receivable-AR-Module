"use client";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import type { AllocationInvoice } from "@/hooks/use-allocation-logic";
import { ApiError } from "@/hooks/use-api";
import { AllocationContractError } from "@/lib/allocation-candidate-contract";
import { FileText, ChevronsRight, Plus, CheckCircle2, AlertTriangle, Ban } from "lucide-react";

interface InvoicePanelProps {
  invoices: AllocationInvoice[];
  selectedReceipt: { customer_name: string } | null;
  isLoading: boolean;
  /** The governed candidate read failed, or its contract could not be verified. */
  error?: unknown;
  /**
   * True only when a governed candidate contract for the CURRENTLY selected
   * receipt is resolved, verified and not being refetched. Candidate rows are
   * rendered ONLY in that state.
   */
  isVerified: boolean;
  allocatedInvoiceIds: Set<string>;
  onAddInvoice: (inv: AllocationInvoice) => void;
}

/**
 * Map a governed-candidate failure to safe, state-specific user wording.
 *
 * Deliberately never surfaces schema paths, stack traces, raw database text, or
 * anything that would disclose whether a receipt exists in another tenant — a
 * 404 here is worded identically whether the receipt is missing, hidden,
 * unassigned or owned by another company, because the backend intentionally
 * collapses all four into NOT_FOUND.
 */
function describeCandidateError(error: unknown): { title: string; detail: string } {
  if (error instanceof AllocationContractError) {
    return {
      title: "Eligible invoices could not be verified",
      detail: "The invoice list did not pass validation, so it is not shown. Refresh and try again.",
    };
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case "BR-ALLOC-CANDIDATES":
        return {
          title: "This receipt is not eligible for allocation",
          detail: "It has no unallocated balance, or is not in a state that can be allocated.",
        };
      case "BR-ALLOC-CANDIDATE-LIMIT":
        return {
          title: "Too many eligible invoices to allocate here",
          detail:
            "This customer has more eligible documents than the allocation workbench supports. Please contact your administrator.",
        };
      case "NOT_FOUND":
        return {
          title: "Receipt is not available",
          detail: "It may have been removed, or you may no longer have access to it.",
        };
      case "AUTHORIZATION_ERROR":
        return {
          title: "You cannot view allocation candidates",
          detail: "Your role does not permit this action.",
        };
      case "AUTHENTICATION_ERROR":
        return { title: "Your session has expired", detail: "Please sign in again." };
      case "VALIDATION_ERROR":
        return {
          title: "Eligible invoices could not be loaded",
          detail: "The request was rejected. Refresh and try again.",
        };
      default:
        return {
          title: "Could not load eligible invoices",
          detail: "Please check your connection and try again.",
        };
    }
  }
  return {
    title: "Could not load eligible invoices",
    detail: "Please check your connection and try again.",
  };
}

export function InvoicePanel({
  invoices, selectedReceipt, isLoading, error, isVerified, allocatedInvoiceIds, onAddInvoice,
}: InvoicePanelProps) {
  // Candidate rows may be shown ONLY against a currently verified contract.
  // Everything else — loading, refetching, errored, malformed, mismatched — is
  // a non-actionable state that renders no rows at all.
  const showCandidates = isVerified && !error && !isLoading;

  return (
    <div className="glass-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <FileText className="h-4 w-4 text-amber-400" />
          Eligible Invoices
          {selectedReceipt && <span className="ml-1 text-[10px] text-slate-500">{selectedReceipt.customer_name}</span>}
        </h2>
        {/* A count is a CLAIM about the current contract. It may only be shown
            for a verified one — never carried over from a previous result. */}
        {showCandidates && invoices.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">{invoices.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-auto" style={{ maxHeight: "420px" }}>
        {!selectedReceipt ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <ChevronsRight className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm">Please select a receipt from the left panel</p>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center py-16" role="status" aria-live="polite">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <p className="mt-3 text-xs text-slate-500">Loading eligible invoices…</p>
          </div>
        ) : error ? (
          <ErrorState {...describeCandidateError(error)} />
        ) : !isVerified ? (
          /* Resolved but not verified for the CURRENT selection (e.g. identity
             mismatch). Fail closed rather than render anything. */
          <ErrorState
            title="Eligible invoices could not be verified"
            detail="The invoice list did not match the selected receipt, so it is not shown. Refresh and try again."
          />
        ) : invoices.length === 0 ? (
          /* A VERIFIED zero. This is the only circumstance in which claiming
             "no eligible invoices" is honest. */
          <div className="flex flex-col items-center justify-center py-16 text-slate-500" role="status">
            <FileText className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm">No eligible invoices for this receipt</p>
            <p className="text-[11px] text-slate-400">
              Requires Open, Overdue or Partially Paid documents in {""}
              the receipt&apos;s currency
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {invoices.map((inv) => {
              const isInLines = allocatedInvoiceIds.has(inv.id);
              const isOverdue = inv.overdue_days > 0;

              return (
                <div key={inv.id} className={cn("flex items-center justify-between px-4 py-2.5 transition-colors", isInLines ? "bg-brand-600/5" : "hover:bg-slate-50")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-700">{inv.invoice_no}</p>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">{inv.doc_type}</span>
                      {isOverdue && (
                        <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-500">Overdue {inv.overdue_days}d</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {formatDate(inv.invoice_date)}
                      {inv.due_date && <> · Due {formatDate(inv.due_date)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      {/* B9DD-RR-004: each document's own currency, from the
                          row itself — previously both were codeless. */}
                      <p className="font-mono text-sm text-slate-900">
                        {formatMoney(inv.outstanding, inv.currency)}
                      </p>
                      <p className="font-mono text-[10px] text-slate-500">
                        of {formatMoney(inv.total_amount, inv.currency)}
                      </p>
                    </div>
                    {!isInLines && (
                      <button type="button" onClick={() => onAddInvoice(inv)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600" title="Add to allocation">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isInLines && <CheckCircle2 className="h-4 w-4 text-brand-500" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Safe error presentation: icon + text, no ids, no stacks, no raw DB text. */
function ErrorState({ title, detail }: { title: string; detail: string }) {
  const isBlocked = /not eligible|Too many/i.test(title);
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center" role="alert">
      {isBlocked ? (
        <Ban className="h-10 w-10 text-slate-300" />
      ) : (
        <AlertTriangle className="h-10 w-10 text-amber-400" />
      )}
      <p className="mt-3 text-sm font-medium text-amber-700">{title}</p>
      <p className="mt-1 max-w-[300px] text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

// ============================================================================
// TSH Synergy AR — Import Review Actions (Batch 6C)
// Frontend controls for import rows where mapped_data.review_required === true.
//
// SAFETY: This component performs NO direct Supabase writes and NO financial
// mutation. Every action calls the existing Batch 6B backend route only:
//   POST /imports/:batchId/rows/:rowId/review
// Approve/edit/reject never create/post/allocate and never mark a row Valid.
// Only retry_validation can transition a row to Valid, and only server-side.
// ============================================================================

"use client";

import { useState } from "react";
import {
  Check,
  PencilLine,
  RefreshCw,
  ThumbsDown,
  UserCheck,
  XCircle,
} from "lucide-react";
import { ApiError } from "@/hooks/use-api";
import type {
  ImportCustomerSuggestion,
  ImportInvoiceSuggestion,
  ImportRow,
  ReviewAction,
  ReviewRowPayload,
  ReviewRowResult,
} from "@/hooks/use-import";
import { LoadingButton } from "@/components/ui/loading-button";

type ReviewKind = "customer_suggestion" | "invoice_suggestion" | "both";

export interface ReviewActionsProps {
  batchId: string;
  row: ImportRow;
  /** From useImport(): keyed by `${rowId}:${action}`. */
  reviewLoading: Record<string, boolean>;
  reviewImportRow: (
    batchId: string,
    rowId: string,
    payload: ReviewRowPayload,
  ) => Promise<ReviewRowResult>;
}

function suggestionArray<T>(
  mappedData: Record<string, unknown> | null,
  preferred: string,
  fallback: string,
): T[] {
  const value = mappedData?.[preferred] ?? mappedData?.[fallback];
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Centralized, typed reader for the review metadata stored in mapped_data. */
function getReviewMeta(row: ImportRow) {
  const md = row.mapped_data;
  const reviewKind = (md?.review_kind as ReviewKind | undefined) ?? undefined;
  return {
    reviewRequired: md?.review_required === true,
    reviewKind,
    reviewResult: md?.review_result ? String(md.review_result) : undefined,
    customers: suggestionArray<ImportCustomerSuggestion>(md, "suggested_customers", "customer_candidates"),
    invoices: suggestionArray<ImportInvoiceSuggestion>(md, "suggested_invoices", "invoice_candidates"),
    approvedCustomerCode: md?.approved_customer_code ? String(md.approved_customer_code) : undefined,
    approvedInvoiceNo: md?.approved_invoice_no ? String(md.approved_invoice_no) : undefined,
    editedCustomerCode: md?.edited_customer_code ? String(md.edited_customer_code) : undefined,
    editedInvoiceReference: md?.edited_invoice_reference ? String(md.edited_invoice_reference) : undefined,
  };
}

export function ReviewActions({
  batchId,
  row,
  reviewLoading,
  reviewImportRow,
}: ReviewActionsProps) {
  const meta = getReviewMeta(row);
  const [localError, setLocalError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"none" | "customer" | "invoice">("none");
  const [customerCode, setCustomerCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [invoiceReference, setInvoiceReference] = useState("");

  // Only render for rows the backend still flags for review.
  if (!meta.reviewRequired) return null;

  const isRejected = meta.reviewResult === "rejected";
  const isApproved = meta.reviewResult === "approved_pending_retry";
  const isEdited = meta.reviewResult === "edited_pending_retry";
  const revalidationFailed = meta.reviewResult === "revalidation_failed";
  const pendingRetry = isApproved || isEdited;

  const loading = (action: ReviewAction) => reviewLoading[`${row.id}:${action}`] === true;
  const anyLoading = Object.entries(reviewLoading).some(
    ([key, busy]) => busy && key.startsWith(`${row.id}:`),
  );

  async function run(payload: ReviewRowPayload, options?: { thenRetry?: boolean }) {
    setLocalError(null);
    try {
      await reviewImportRow(batchId, row.id, payload);
      if (options?.thenRetry) {
        // Batch 6C UX Fix: approve/edit never marks the row Valid on its own
        // (backend contract unchanged). We chain an explicit retry_validation so
        // the user does not have to click Retry manually. If this fails, the row
        // stays reviewable/editable and the backend error is shown below.
        await reviewImportRow(batchId, row.id, { action: "retry_validation" });
      }
      setEditMode("none");
      setCustomerCode("");
      setCustomerName("");
      setInvoiceReference("");
    } catch (err) {
      // Hook already toasts; surface inline too so the row keeps its context.
      setLocalError(err instanceof ApiError ? err.message : "Review action failed.");
    }
  }

  const showCustomerApprove = meta.reviewKind === "customer_suggestion" || meta.reviewKind === "both";
  const showInvoiceApprove = meta.reviewKind === "invoice_suggestion" || meta.reviewKind === "both";

  return (
    <div className="mt-2 max-w-full space-y-2 overflow-hidden whitespace-normal break-words rounded-lg border border-amber-200 bg-amber-50/60 p-2">
      {/* ── Rejected state ─────────────────────────────────────────────── */}
      {isRejected ? (
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            <ThumbsDown className="h-3 w-3" />
            Suggestion rejected
          </p>
          <p className="text-[11px] text-slate-500">
            This row was rejected and will not be imported as-is. To correct it, edit the
            {meta.reviewKind === "invoice_suggestion" ? " invoice reference" : " customer"} below, then retry validation.
          </p>
          {/* Allow correction via edit only — never auto re-approve/re-retry. */}
          <EditControls
            kind={meta.reviewKind}
            editMode={editMode}
            setEditMode={setEditMode}
            customerCode={customerCode}
            setCustomerCode={setCustomerCode}
            customerName={customerName}
            setCustomerName={setCustomerName}
            invoiceReference={invoiceReference}
            setInvoiceReference={setInvoiceReference}
            loading={loading}
            disabled={anyLoading}
            run={run}
          />
        </div>
      ) : (
        <>
          {/* ── Pending-retry hint after approve/edit ──────────────────── */}
          {pendingRetry && (
            <p className="rounded bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">
              {isApproved ? "Suggestion approved" : "Correction recorded"}
              {meta.approvedCustomerCode ? ` · customer ${meta.approvedCustomerCode}` : ""}
              {meta.approvedInvoiceNo ? ` · invoice ${meta.approvedInvoiceNo}` : ""}
              {meta.editedCustomerCode ? ` · customer ${meta.editedCustomerCode}` : ""}
              {meta.editedInvoiceReference ? ` · invoice ${meta.editedInvoiceReference}` : ""}
              {" — click Retry Validation to re-check this row."}
            </p>
          )}
          {revalidationFailed && (
            <p className="rounded bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">
              Re-validation did not pass. Adjust the suggestion or correction, then retry again.
            </p>
          )}

          {/* ── Approve suggested customer(s) ──────────────────────────── */}
          {showCustomerApprove && meta.customers.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Approve customer</p>
              {meta.customers.map((c) => (
                <LoadingButton
                  key={c.customer_id}
                  variant="secondary"
                  size="sm"
                  className="h-auto w-full items-start justify-start whitespace-normal break-words py-1.5 text-left"
                  isLoading={loading("approve_suggestion") || loading("retry_validation")}
                  loadingText="Approving & validating..."
                  disabled={anyLoading}
                  title={`Approve ${c.customer_code} · ${c.customer_name}`}
                  onClick={() => run({ action: "approve_suggestion", suggested_customer_id: c.customer_id }, { thenRetry: true })}
                >
                  <UserCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono font-semibold text-slate-700">{c.customer_code}</span>
                    <span className="break-words text-slate-700">{c.customer_name}</span>
                    <span className="text-[10px] text-slate-500">
                      {Math.round(Number(c.confidence) * 100)}% · {c.reason}
                    </span>
                  </span>
                </LoadingButton>
              ))}
            </div>
          )}

          {/* ── Approve suggested invoice(s) ───────────────────────────── */}
          {showInvoiceApprove && meta.invoices.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Approve invoice</p>
              {meta.invoices.map((inv) => {
                const notAllocatable = inv.allocatable === false;
                return (
                  <LoadingButton
                    key={inv.invoice_id}
                    variant="secondary"
                    size="sm"
                    className="h-auto w-full items-start justify-start whitespace-normal break-words py-1.5 text-left"
                    isLoading={loading("approve_suggestion") || loading("retry_validation")}
                    loadingText="Approving & validating..."
                    disabled={anyLoading || notAllocatable}
                    title={notAllocatable ? "Not allocatable (paid, no outstanding, or currency mismatch)" : `Approve ${inv.invoice_no}`}
                    onClick={() => run({ action: "approve_suggestion", suggested_invoice_id: inv.invoice_id }, { thenRetry: true })}
                  >
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono font-semibold text-slate-700">{inv.invoice_no}</span>
                      <span className="text-[10px] text-slate-500">
                        {Math.round(Number(inv.confidence) * 100)}% · {inv.reason}
                      </span>
                      {notAllocatable && (
                        <span className="text-[10px] font-medium text-amber-700">Not allocatable</span>
                      )}
                    </span>
                  </LoadingButton>
                );
              })}
            </div>
          )}

          {/* ── Edit controls ──────────────────────────────────────────── */}
          <EditControls
            kind={meta.reviewKind}
            editMode={editMode}
            setEditMode={setEditMode}
            customerCode={customerCode}
            setCustomerCode={setCustomerCode}
            customerName={customerName}
            setCustomerName={setCustomerName}
            invoiceReference={invoiceReference}
            setInvoiceReference={setInvoiceReference}
            loading={loading}
            disabled={anyLoading}
            run={run}
          />

          {/* ── Retry + Reject ─────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <LoadingButton
              variant="primary"
              size="sm"
              isLoading={loading("retry_validation")}
              loadingText="Retrying..."
              disabled={anyLoading}
              onClick={() => run({ action: "retry_validation" })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry Validation
            </LoadingButton>
            <LoadingButton
              variant="ghost"
              size="sm"
              isLoading={loading("reject_suggestion")}
              loadingText="Rejecting..."
              disabled={anyLoading}
              onClick={() => run({ action: "reject_suggestion" })}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              Reject
            </LoadingButton>
          </div>
        </>
      )}

      {/* ── Inline backend error ─────────────────────────────────────────── */}
      {localError && (
        <p className="inline-flex items-start gap-1 text-[11px] text-red-600">
          <XCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          {localError}
        </p>
      )}
    </div>
  );
}

// ─── Edit sub-controls ────────────────────────────────────────────────────────

interface EditControlsProps {
  kind?: ReviewKind;
  editMode: "none" | "customer" | "invoice";
  setEditMode: (m: "none" | "customer" | "invoice") => void;
  customerCode: string;
  setCustomerCode: (v: string) => void;
  customerName: string;
  setCustomerName: (v: string) => void;
  invoiceReference: string;
  setInvoiceReference: (v: string) => void;
  loading: (action: ReviewAction) => boolean;
  disabled: boolean;
  run: (payload: ReviewRowPayload, options?: { thenRetry?: boolean }) => void;
}

function EditControls({
  kind,
  editMode,
  setEditMode,
  customerCode,
  setCustomerCode,
  customerName,
  setCustomerName,
  invoiceReference,
  setInvoiceReference,
  loading,
  disabled,
  run,
}: EditControlsProps) {
  const canEditCustomer = kind === "customer_suggestion" || kind === "both";
  const canEditInvoice = kind === "invoice_suggestion" || kind === "both";

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {canEditCustomer && (
          <LoadingButton
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setEditMode(editMode === "customer" ? "none" : "customer")}
          >
            <PencilLine className="h-3.5 w-3.5" />
            Edit customer
          </LoadingButton>
        )}
        {canEditInvoice && (
          <LoadingButton
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setEditMode(editMode === "invoice" ? "none" : "invoice")}
          >
            <PencilLine className="h-3.5 w-3.5" />
            Edit invoice reference
          </LoadingButton>
        )}
      </div>

      {/* Customer edit: customer_code / customer_name only — never a raw UUID. */}
      {editMode === "customer" && (
        <div className="flex max-w-full flex-col gap-1.5 rounded-md border border-slate-200 bg-white p-2">
          <label className="flex flex-col gap-0.5 text-[10px] font-medium text-slate-500">
            Customer code
            <input
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder="e.g. CUST-001"
              className="h-7 w-full max-w-full rounded border border-slate-300 px-2 text-xs text-slate-700"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] font-medium text-slate-500">
            or Customer name
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Exact visible customer name"
              className="h-7 w-full max-w-full rounded border border-slate-300 px-2 text-xs text-slate-700"
            />
          </label>
          <LoadingButton
            variant="secondary"
            size="sm"
            className="w-full"
            isLoading={loading("edit_customer") || loading("retry_validation")}
            loadingText="Saving & validating..."
            disabled={disabled || (!customerCode.trim() && !customerName.trim())}
            onClick={() =>
              run(
                {
                  action: "edit_customer",
                  ...(customerCode.trim() ? { customer_code: customerCode.trim() } : {}),
                  ...(!customerCode.trim() && customerName.trim() ? { customer_name: customerName.trim() } : {}),
                },
                { thenRetry: true },
              )
            }
          >
            <Check className="h-3.5 w-3.5" />
            Save customer
          </LoadingButton>
        </div>
      )}

      {/* Invoice reference edit. */}
      {editMode === "invoice" && (
        <div className="flex max-w-full flex-col gap-1.5 rounded-md border border-slate-200 bg-white p-2">
          <label className="flex flex-col gap-0.5 text-[10px] font-medium text-slate-500">
            Invoice reference
            <input
              value={invoiceReference}
              onChange={(e) => setInvoiceReference(e.target.value)}
              placeholder="e.g. INV-202606-00063"
              className="h-7 w-full max-w-full rounded border border-slate-300 px-2 text-xs text-slate-700"
            />
          </label>
          <LoadingButton
            variant="secondary"
            size="sm"
            className="w-full"
            isLoading={loading("edit_invoice_reference") || loading("retry_validation")}
            loadingText="Saving & validating..."
            disabled={disabled || !invoiceReference.trim()}
            onClick={() => run({ action: "edit_invoice_reference", invoice_reference: invoiceReference.trim() }, { thenRetry: true })}
          >
            <Check className="h-3.5 w-3.5" />
            Save reference
          </LoadingButton>
        </div>
      )}
    </div>
  );
}

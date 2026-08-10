"use client";

// ============================================================================
// Gate E — critical-reference exception recovery panel (Migration 040).
//
// A Finance Manager recovers a `critical_identifier_unverified` exception via
// ONE of two GOVERNED, clearly-distinguished actions, then runs a deterministic
// Retry Matching:
//
//   1. Correct Invoice External Reference — the Invoice's stored external
//      reference was wrong. Only `invoices.reference_no` changes; the internal
//      Invoice number and the original AI extraction are never rewritten.
//   2. Confirm Receipt-to-Invoice Match — the Invoice is correct but the
//      Receipt's extracted reference is wrong. The human confirms the intended
//      Invoice after reviewing the source documents; nothing is rewritten.
//
// The frontend supplies NO allocation amount, tenant, customer, or FX. The
// backend re-derives, re-locks, and reconciles all financial authority. The UI
// never implies the AI is auto-correcting anything, and never edits extraction.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, ShieldCheck } from "lucide-react";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import { AutomationDialog } from "@/components/features/automation/dialog";
import {
  AutomationError,
  AutomationLoading,
} from "@/components/features/automation/states";
import {
  type ConfirmMatchInput,
  type CorrectReferenceInput,
  useConfirmReceiptMatch,
  useCorrectInvoiceReference,
  useExceptionRecoveryContext,
  useExceptionSource,
  useRetryExceptionMatching,
} from "@/hooks/use-automation";
import { ApiError } from "@/hooks/use-api";
import { RECOVERY_ACTION_LABEL } from "@/lib/automation/labels";
import type { RecoveryActionType } from "@/lib/automation/contract";

interface RecoveryPanelProps {
  exceptionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only a Finance Manager may record a recovery or run Retry Matching. */
  canMutate: boolean;
}

type PreviewKind = "pdf" | "image" | "other";

function previewKind(mime: string): PreviewKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "other";
}

export function RecoveryPanel({
  exceptionId,
  open,
  onOpenChange,
  canMutate,
}: RecoveryPanelProps) {
  const context = useExceptionRecoveryContext(exceptionId, { enabled: open });
  const correct = useCorrectInvoiceReference();
  const confirm = useConfirmReceiptMatch();
  const retry = useRetryExceptionMatching();
  const source = useExceptionSource();

  const [action, setAction] = useState<RecoveryActionType>(
    "confirm_receipt_invoice_match",
  );
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [correctedReference, setCorrectedReference] = useState<string>("");
  const [note, setNote] = useState<string>("");

  // Source preview state. The object URL is the ONLY place the bytes live; no
  // storage path/token/raw URL is ever kept. It is revoked on replace/close.
  const [preview, setPreview] = useState<
    { url: string; kind: PreviewKind; label: string } | null
  >(null);
  const previewUrlRef = useRef<string | null>(null);

  function clearPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreview(null);
  }

  // Revoke any object URL on unmount — no leaked bytes after navigation.
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  // Reset transient state whenever the panel closes or the exception changes.
  useEffect(() => {
    if (!open) {
      clearPreview();
      setInvoiceId("");
      setCorrectedReference("");
      setNote("");
      correct.reset();
      confirm.reset();
      retry.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exceptionId]);

  const data = context.data;
  const resolved = data?.lifecycle_status === "resolved";
  const latest = data?.latest_recovery ?? null;
  const mutating = correct.isPending || confirm.isPending;

  function loadSource(label: string, targetInvoiceId?: string) {
    source.mutate(
      { exceptionId, invoiceId: targetInvoiceId },
      {
        onSuccess: (blob) => {
          clearPreview();
          const url = URL.createObjectURL(blob);
          previewUrlRef.current = url;
          setPreview({ url, kind: previewKind(blob.type), label });
        },
        onError: () => toast.error("The source document could not be loaded."),
      },
    );
  }

  function submitRecovery() {
    if (!canMutate || !invoiceId || note.trim().length === 0) return;
    if (action === "correct_invoice_external_reference") {
      if (correctedReference.trim().length === 0) return;
      const input: CorrectReferenceInput = {
        invoice_id: invoiceId,
        reference_no: correctedReference.trim(),
        resolution_note: note.trim(),
      };
      correct.mutate(
        { id: exceptionId, input },
        {
          onSuccess: () => toast.success("Invoice external reference corrected."),
          onError: (error) =>
            toast.error(
              error instanceof ApiError ? error.message : "Correction was rejected.",
            ),
        },
      );
    } else {
      const input: ConfirmMatchInput = {
        invoice_id: invoiceId,
        resolution_note: note.trim(),
      };
      confirm.mutate(
        { id: exceptionId, input },
        {
          onSuccess: () => toast.success("Receipt-to-Invoice match confirmed."),
          onError: (error) =>
            toast.error(
              error instanceof ApiError ? error.message : "Confirmation was rejected.",
            ),
        },
      );
    }
  }

  function runRetry() {
    if (!canMutate || retry.isPending) return;
    retry.mutate(exceptionId, {
      onSuccess: (result) =>
        toast.success(
          `Allocation completed — ${result.total_allocated} ${data?.receipt.currency ?? ""} applied.`,
        ),
      onError: (error) =>
        toast.error(
          error instanceof ApiError ? error.message : "Retry Matching was rejected.",
        ),
    });
  }

  return (
    <AutomationDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Recover critical-reference exception"
      description="Automatic allocation was withheld because the Receipt reference could not be resolved safely to one eligible Invoice. Review the source documents, then either correct the Invoice's external reference or confirm the intended match. The internal Invoice number and the original extraction are never changed, and no allocation amount is entered here."
    >
      {context.isLoading
        ? <AutomationLoading label="Loading recovery context" />
        : context.isError || !data
        ? <AutomationError onRetry={() => context.refetch()} />
        : (
          <div className="space-y-4">
            {/* Receipt summary. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Receipt {data.receipt.receipt_no}
                </span>
                <AutomationBadge label={data.receipt.status} tone="info" />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
                <div className="flex justify-between">
                  <dt>Unallocated</dt>
                  <dd className="tabular-nums font-medium">
                    {data.receipt.unallocated_amount} {data.receipt.currency}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Currency</dt>
                  <dd className="font-medium">{data.receipt.currency}</dd>
                </div>
              </dl>
              <div className="mt-2 border-t border-slate-200 pt-2">
                <p className="text-[11px] text-slate-500">
                  Original extracted Invoice reference
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {data.original_invoice_references.map((ref, i) => (
                    <li
                      key={`${ref}-${i}`}
                      className="max-w-full break-all rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
                    >
                      {ref}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => loadSource("Receipt source")}
                  disabled={source.isPending}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  View Receipt source
                </button>
              </div>
            </div>

            {/* Recorded recovery / resolved state. */}
            {resolved
              ? (
                <p
                  role="status"
                  className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  This exception has been resolved. Allocation completed through
                  governed recovery; no further action is required.
                </p>
              )
              : latest
              ? (
                <p
                  role="status"
                  className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"
                >
                  A governed{" "}
                  <strong>{RECOVERY_ACTION_LABEL[latest.action_type]}</strong>
                  {" "}was recorded on{" "}
                  {new Date(latest.created_at).toLocaleString()}. Run Retry
                  Matching to complete allocation from the current financial
                  state.
                </p>
              )
              : null}

            {/* Recovery form — hidden once resolved. */}
            {!resolved && (
              <fieldset
                className="space-y-3"
                disabled={!canMutate || mutating}
              >
                <legend className="text-xs font-semibold text-slate-800">
                  Choose a recovery action
                </legend>

                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      "confirm_receipt_invoice_match",
                      "correct_invoice_external_reference",
                    ] as const
                  ).map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                    >
                      <input
                        type="radio"
                        name="recovery_action"
                        className="mt-0.5"
                        checked={action === value}
                        onChange={() => setAction(value)}
                      />
                      <span>
                        <span className="font-semibold text-slate-800">
                          {RECOVERY_ACTION_LABEL[value]}
                        </span>
                        <span className="mt-0.5 block text-slate-500">
                          {value === "confirm_receipt_invoice_match"
                            ? "The Invoice is correct but the Receipt reference is wrong. Confirms the relationship after document review; nothing is rewritten."
                            : "The Invoice's stored external reference is wrong. Updates only the external reference — the internal Invoice number does not change."}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                {/* Eligible invoice selection. */}
                <div>
                  <p className="text-xs font-medium text-slate-700">
                    Select the eligible Invoice
                  </p>
                  {data.eligible_invoices.length === 0
                    ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        No eligible Invoice is currently available for this
                        customer, currency, and outstanding balance.
                      </p>
                    )
                    : (
                      <ul className="mt-1 space-y-1">
                        {data.eligible_invoices.map((invoice) => (
                          <li
                            key={invoice.invoice_id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-[11px] has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50/40"
                          >
                            <label className="flex flex-1 cursor-pointer items-start gap-2">
                              <input
                                type="radio"
                                name="recovery_invoice"
                                className="mt-0.5"
                                checked={invoiceId === invoice.invoice_id}
                                onChange={() => setInvoiceId(invoice.invoice_id)}
                              />
                              <span className="min-w-0">
                                <span className="font-semibold text-slate-800">
                                  {invoice.invoice_no}
                                </span>
                                <span className="ml-2 text-slate-500">
                                  {invoice.status}
                                </span>
                                <span className="block break-all text-slate-500">
                                  Ext. ref: {invoice.reference_no ?? "—"} ·{" "}
                                  Outstanding {invoice.outstanding}{" "}
                                  {invoice.currency}
                                </span>
                              </span>
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                loadSource(
                                  `Invoice ${invoice.invoice_no} source`,
                                  invoice.invoice_id,
                                )}
                              disabled={source.isPending}
                              className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 font-semibold text-slate-700 disabled:opacity-60"
                            >
                              View source
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>

                {/* Corrected reference (correction action only). */}
                {action === "correct_invoice_external_reference" && (
                  <label className="block text-xs font-medium text-slate-700">
                    Corrected external reference
                    <input
                      type="text"
                      value={correctedReference}
                      maxLength={50}
                      onChange={(e) => setCorrectedReference(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-sm"
                      placeholder="e.g. SUPPLIER-INV-123"
                    />
                    <span className="mt-1 block font-normal text-[11px] text-slate-500">
                      This updates only the Invoice&apos;s external reference. The
                      internal Invoice number will <strong>not</strong> change.
                    </span>
                  </label>
                )}

                {action === "confirm_receipt_invoice_match" && (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                    Confirming records your human decision after reviewing the
                    documents. It does <strong>not</strong> rewrite the Invoice
                    or the original AI extraction.
                  </p>
                )}

                <label className="block text-xs font-medium text-slate-700">
                  Resolution note (required)
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                  />
                </label>

                {!canMutate && (
                  <p className="text-[11px] text-slate-400">
                    Read-only. Only a Finance Manager can record a recovery.
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={submitRecovery}
                    disabled={!canMutate || mutating || !invoiceId ||
                      note.trim().length === 0 ||
                      (action === "correct_invoice_external_reference" &&
                        correctedReference.trim().length === 0)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                  >
                    {mutating ? "Recording…" : "Record recovery"}
                  </button>
                  <button
                    type="button"
                    onClick={runRetry}
                    disabled={!canMutate || retry.isPending || !latest}
                    title={!latest
                      ? "Record a governed correction or confirmation first."
                      : undefined}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {retry.isPending ? "Retrying…" : "Retry Matching"}
                  </button>
                </div>
              </fieldset>
            )}

            {/* Source preview (object-URL bound; revoked on replace/close). */}
            {preview && (
              <div className="rounded-lg border border-slate-200 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-700">
                    {preview.label}
                  </span>
                  <button
                    type="button"
                    onClick={clearPreview}
                    className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Close preview
                  </button>
                </div>
                <div className="mt-2">
                  {preview.kind === "pdf"
                    ? (
                      <iframe
                        title={preview.label}
                        src={preview.url}
                        className="h-80 w-full rounded border border-slate-200"
                      />
                    )
                    : preview.kind === "image"
                    ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.url}
                        alt={preview.label}
                        className="max-h-80 w-auto rounded border border-slate-200"
                      />
                    )
                    : (
                      <a
                        href={preview.url}
                        download
                        className="text-[11px] font-semibold text-brand-600 underline"
                      >
                        Download source document
                      </a>
                    )}
                </div>
              </div>
            )}
          </div>
        )}
    </AutomationDialog>
  );
}

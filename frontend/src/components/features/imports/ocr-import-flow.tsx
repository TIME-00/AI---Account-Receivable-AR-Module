// ============================================================================
// TSH Synergy AR — OCR / PDF-Image Import Flow (Batch 9B-FE invoice, Batch 9C receipt)
//
// Shared review/draft-only intake UI for PDF/image documents, parametrized by
// `importType` ("invoice" | "receipt"). This component makes the safety posture
// explicit at every step: manual intake extracts and reviews values only — it
// does NOT post invoices/receipts, does NOT allocate, and creates no final
// financial records. Role-aware controls come from the real backend /auth/me
// capability response (via useUserRole), never from demo/env assumptions.
// ============================================================================

"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  useOcrImport,
  checkOcrFile,
  ocrFieldsFor,
  rawOcrValue,
  reviewedOcrValue,
  type OcrImportType,
  type OcrReviewFieldDef,
} from "@/hooks/use-ocr-import";
import { useUserRole } from "@/hooks/use-user-role";
import { LoadingButton } from "@/components/ui/loading-button";
import { cn } from "@/lib/utils";
import {
  Upload, FileText, Image as ImageIcon, ShieldCheck, Eye, Loader2,
  AlertTriangle, CheckCircle2, XCircle, Lock, Save, Info, RotateCcw,
  FileSearch, Ban, RefreshCw,
} from "lucide-react";

// ─── Status pill helper ─────────────────────────────────────────────────────

type PillTone = "slate" | "amber" | "emerald" | "red" | "blue";

const PILL_TONES: Record<PillTone, string> = {
  slate: "bg-slate-100 text-slate-600",
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
  blue: "bg-blue-50 text-blue-700",
};

function StatusPill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", PILL_TONES[tone])}>
      {children}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function OcrImportFlow({ importType = "invoice" }: { importType?: OcrImportType }) {
  const {
    step, batch, file, row, lowConfidence,
    isUploading, isSaving, isApproving, isPreviewLoading, isRefreshing, error,
    uploadFile, startOcr, openPreview, refreshReview, saveReview, approveDraft, reset,
  } = useOcrImport(importType);

  // Type-aware copy. No user-facing "OCR" wording anywhere below.
  const isReceipt = importType === "receipt";
  const entityLabel = isReceipt ? "receipt" : "invoice";
  const EntityLabel = isReceipt ? "Receipt" : "Invoice";
  const fields = ocrFieldsFor(importType);

  const {
    isResolved, isLoading: roleLoading, isReadOnly, isAuditor, roles, capabilities,
  } = useUserRole();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Capability-driven gating (backend remains the final authority).
  const canUpload = isResolved && capabilities.can_execute_imports && !isReadOnly;
  const canReview = isResolved && (capabilities.can_review_import_rows || capabilities.can_execute_imports) && !isReadOnly;
  // OCR-disabled rows are always low-confidence, so the backend requires an
  // AR Supervisor / Finance Manager to approve the draft.
  const canApprove = canReview && (roles.includes("AR Supervisor") || roles.includes("Finance Manager"));

  const handleFile = useCallback(
    (f: File) => {
      const check = checkOcrFile(f);
      if (!check.ok) {
        toast.error("File Rejected", { description: check.message });
        return;
      }
      uploadFile(f);
    },
    [uploadFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFile],
  );

  return (
    <div className="space-y-4">
      {/* Persistent safety banner — visible at every step */}
      <SafetyBanner entityLabel={entityLabel} />

      {/* Role notices */}
      {!roleLoading && isAuditor && (
        <RoleNotice tone="blue" icon={<Eye className="h-5 w-5 text-blue-500 mt-0.5" />}>
          <p className="font-medium text-blue-800">Read-only access</p>
          <p className="mt-0.5 text-blue-700">
            Your role can view import review data but cannot upload, edit, or approve drafts.
          </p>
        </RoleNotice>
      )}
      {!roleLoading && !isAuditor && isResolved && !capabilities.can_execute_imports && (
        <RoleNotice tone="amber" icon={<Lock className="h-5 w-5 text-amber-500 mt-0.5" />}>
          <p className="font-medium text-amber-800">You cannot start imports</p>
          <p className="mt-0.5 text-amber-700">
            Your role does not have import permission. Please contact an AR Supervisor or Finance Manager.
          </p>
        </RoleNotice>
      )}

      {/* Inline error surface */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-800">Something went wrong</p>
            <p className="mt-0.5 text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* ── Step: Select / Upload ─────────────────────────────────────── */}
      {step === "select" && (
        <div className="glass-card p-6 space-y-6">
          <div
            className={cn(
              "relative rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-200",
              canUpload ? "cursor-pointer" : "cursor-not-allowed opacity-60",
              dragActive
                ? "border-brand-500 bg-brand-50/50"
                : "border-slate-300 hover:border-brand-400 hover:bg-brand-50/30",
            )}
            onDragOver={(e) => { if (canUpload) { e.preventDefault(); setDragActive(true); } }}
            onDragLeave={() => setDragActive(false)}
            onDrop={canUpload ? onDrop : (e) => e.preventDefault()}
            onClick={() => { if (canUpload) fileInputRef.current?.click(); }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={!canUpload}
              onChange={onInput}
            />
            <div className="flex flex-col items-center gap-4">
              <div className={cn("rounded-2xl p-4 transition-colors", dragActive ? "bg-brand-100" : "bg-slate-100")}>
                <Upload className={cn("h-10 w-10", dragActive ? "text-brand-600" : "text-slate-400")} />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-700">
                  {dragActive ? "Drop document here" : `Drag & drop a ${entityLabel} PDF or image`}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  or <span className="text-brand-600 font-medium">click to browse</span>
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Accepted: <strong>PDF</strong> (10&nbsp;MB), <strong>PNG</strong>, <strong>JPG/JPEG</strong>, <strong>WebP</strong> (8&nbsp;MB)
                </p>
              </div>
            </div>
            {isUploading && (
              <div className="absolute inset-0 rounded-2xl bg-white/80 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-brand-500 animate-spin" />
                <span className="ml-3 text-sm font-medium text-slate-600">Uploading & preparing review…</span>
              </div>
            )}
          </div>

          {/* Accepted / rejected reference */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4" /> Accepted formats
              </p>
              <ul className="mt-2 space-y-1 text-xs text-emerald-700">
                <li>• PDF documents (up to 3 pages, max 10 MB)</li>
                <li>• PNG, JPG/JPEG, WebP images (max 8 MB)</li>
              </ul>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <Ban className="h-4 w-4" /> Rejected by the system
              </p>
              <ul className="mt-2 space-y-1 text-xs text-red-700">
                <li>• <strong>SVG / SVGZ</strong> — not supported</li>
                <li>• Double-extension or MIME/type mismatch files</li>
                <li>• Empty (0-byte) or oversized files</li>
                <li>• PDFs over the page cap, or encrypted / script-bearing PDFs</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Review ──────────────────────────────────────────────── */}
      {step === "review" && batch && file && row && (
        <div className="space-y-4">
          {/* File + status summary */}
          <div className="glass-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-slate-100 p-2.5">
                  {file.file_type === "pdf"
                    ? <FileText className="h-6 w-6 text-slate-500" />
                    : <ImageIcon className="h-6 w-6 text-slate-500" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{file.file_name}</p>
                  <p className="text-xs text-slate-500">
                    {file.file_type.toUpperCase()}
                    {file.page_count ? ` · ${file.page_count} page${file.page_count === 1 ? "" : "s"}` : ""}
                    {file.file_size_bytes ? ` · ${formatBytes(file.file_size_bytes)}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <ScanPill scanStatus={file.scan_status} />
                    <OcrPill ocrStatus={file.ocr_status} />
                    <ReviewPill status={row.status} lowConfidence={lowConfidence} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <LoadingButton
                  variant="secondary"
                  size="sm"
                  isLoading={isPreviewLoading}
                  loadingText="Opening…"
                  onClick={() => openPreview()}
                >
                  <Eye className="h-4 w-4" /> Preview document
                </LoadingButton>
                <LoadingButton
                  variant="secondary"
                  size="sm"
                  isLoading={isRefreshing}
                  loadingText="Refreshing…"
                  onClick={() => refreshReview()}
                  title="Reload the review queue for this batch"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </LoadingButton>
                <LoadingButton variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="h-3.5 w-3.5" /> Start over
                </LoadingButton>
              </div>
            </div>

            {/* Manual review notice */}
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
              <FileSearch className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-700">
                <p className="font-medium text-amber-800">Manual review required</p>
                <p className="mt-0.5">
                  Fields are not auto-filled. Open the document preview, then enter and review each
                  {" "}{entityLabel} value below before approving a draft.
                </p>
                <button
                  type="button"
                  onClick={() => startOcr()}
                  className="mt-1.5 inline-flex items-center gap-1 text-amber-800 font-medium underline decoration-dotted hover:text-amber-900"
                >
                  <FileSearch className="h-3.5 w-3.5" /> Re-check status
                </button>
              </div>
            </div>
          </div>

          {/* Review editor */}
          <ReviewEditor
            key={row.id}
            row={row}
            fields={fields}
            entityLabel={entityLabel}
            canReview={canReview}
            canApprove={canApprove}
            isSaving={isSaving}
            isApproving={isApproving}
            onSave={saveReview}
            onApprove={approveDraft}
          />
        </div>
      )}

      {/* ── Step: Approved (draft only) ──────────────────────────────── */}
      {step === "approved" && batch && (
        <div className="glass-card p-8 text-center space-y-5">
          <div className="inline-flex rounded-2xl bg-emerald-100 p-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Approved as Draft Import</h2>
            <p className="mt-1 text-sm text-slate-500 max-w-lg mx-auto">
              The reviewed {entityLabel} values were saved as draft import data. This did <strong>not</strong> post
              a {entityLabel}, did <strong>not</strong> allocate anything, and created <strong>no</strong> final
              financial records. Any posting happens later through the normal {entityLabel} workflow.
            </p>
          </div>
          <div className="mx-auto max-w-md rounded-xl border border-slate-200 divide-y divide-slate-100 text-left">
            <SummaryRow label="Batch" value={batch.id} mono />
            <SummaryRow label="Status" value={batch.status} />
            <SummaryRow label={`${EntityLabel} posted`} value="No" />
            <SummaryRow label="Allocated" value="No" />
          </div>
          <div className="flex items-center justify-center gap-3 pt-1">
            <LoadingButton variant="secondary" size="md" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Import another document
            </LoadingButton>
            <Link href={isReceipt ? "/receipts" : "/invoices"}>
              <LoadingButton variant="primary" size="md">
                <Eye className="h-4 w-4" /> View {isReceipt ? "receipts" : "invoices"}
              </LoadingButton>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Review editor sub-component ────────────────────────────────────────────

function ReviewEditor({
  row,
  fields,
  entityLabel,
  canReview,
  canApprove,
  isSaving,
  isApproving,
  onSave,
  onApprove,
}: {
  row: import("@/hooks/use-import").ImportRow;
  fields: OcrReviewFieldDef[];
  entityLabel: string;
  canReview: boolean;
  canApprove: boolean;
  isSaving: boolean;
  isApproving: boolean;
  onSave: (fields: Record<string, string>, note?: string) => Promise<unknown>;
  onApprove: (note?: string) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) initial[f.key] = reviewedOcrValue(row, f.key);
    return initial;
  });
  const [note, setNote] = useState<string>("");

  // Re-seed values when the backend returns an updated row (e.g. after save).
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of fields) next[f.key] = reviewedOcrValue(row, f.key);
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const hasReviewedValues = useMemo(
    () => Object.values(values).some((v) => v.trim() !== ""),
    [values],
  );

  const reviewedSaved = useMemo(() => {
    const reviewed = row.mapped_data?.reviewed_fields;
    return reviewed && typeof reviewed === "object" && Object.keys(reviewed).length > 0;
  }, [row]);

  const isApprovedDraft = row.status === "ApprovedDraft";

  const handleSave = () => {
    const trimmed: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim() !== "") trimmed[k] = v.trim();
    }
    if (Object.keys(trimmed).length === 0) {
      toast.error("Nothing to save", { description: "Enter at least one reviewed value first." });
      return;
    }
    onSave(trimmed, note.trim() || undefined);
  };

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Review {entityLabel} fields</h3>
          <p className="text-xs text-slate-500">
            Compare any raw extracted value with your reviewed value. Saving records draft review data only.
          </p>
        </div>
        {isApprovedDraft ? (
          <StatusPill tone="emerald"><CheckCircle2 className="h-3.5 w-3.5" /> Approved draft</StatusPill>
        ) : reviewedSaved ? (
          <StatusPill tone="blue"><Save className="h-3.5 w-3.5" /> Review saved</StatusPill>
        ) : (
          <StatusPill tone="amber"><AlertTriangle className="h-3.5 w-3.5" /> Needs review</StatusPill>
        )}
      </div>

      {/* Field grid */}
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="hidden sm:grid grid-cols-[1fr_1fr_1.4fr] bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <div className="px-3 py-2">Field</div>
          <div className="px-3 py-2">Imported value</div>
          <div className="px-3 py-2">Reviewed value</div>
        </div>
        <div className="divide-y divide-slate-100">
          {fields.map((f) => {
            const raw = rawOcrValue(row, f.key);
            return (
              <div key={f.key} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.4fr] items-center gap-1 px-3 py-2.5">
                <div className="text-sm font-medium text-slate-700">
                  {f.label}
                  {f.hint && <span className="block text-[11px] font-normal text-slate-400">{f.hint}</span>}
                </div>
                <div className="text-sm text-slate-500">
                  {raw ?? <span className="text-slate-400 italic">No value</span>}
                </div>
                <div>
                  <input
                    type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                    inputMode={f.type === "number" ? "decimal" : undefined}
                    value={values[f.key] ?? ""}
                    disabled={!canReview || isApprovedDraft}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className={cn(
                      "w-full rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
                      "border-slate-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100",
                      (!canReview || isApprovedDraft) && "bg-slate-50 text-slate-400 cursor-not-allowed",
                    )}
                    placeholder={canReview ? "Enter reviewed value" : "—"}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reviewer note */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Reviewer note (optional)</label>
        <textarea
          value={note}
          disabled={!canReview || isApprovedDraft}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={cn(
            "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100",
            (!canReview || isApprovedDraft) && "bg-slate-50 text-slate-400 cursor-not-allowed",
          )}
          placeholder="Add context for the reviewer/approver…"
        />
      </div>

      {/* Actions */}
      {!isApprovedDraft && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-500 max-w-md">
            Approving creates <strong>draft import data only</strong> — it does not post the {entityLabel},
            does not allocate, and does not create final financial records.
          </p>
          <div className="flex items-center gap-2">
            <LoadingButton
              variant="secondary"
              size="md"
              isLoading={isSaving}
              loadingText="Saving…"
              disabled={!canReview}
              onClick={handleSave}
            >
              <Save className="h-4 w-4" /> Save review
            </LoadingButton>
            <LoadingButton
              variant="primary"
              size="md"
              isLoading={isApproving}
              loadingText="Approving…"
              disabled={!canApprove || !reviewedSaved}
              onClick={() => onApprove(note.trim() || undefined)}
              title={
                !canApprove
                  ? "Only an AR Supervisor or Finance Manager can approve a draft"
                  : !reviewedSaved
                    ? "Save your reviewed values before approving"
                    : undefined
              }
            >
              <ShieldCheck className="h-4 w-4" /> Approve as draft
            </LoadingButton>
          </div>
        </div>
      )}

      {!canApprove && !isApprovedDraft && canReview && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Draft approval requires an AR Supervisor or Finance Manager. You can save reviewed values for them.
        </p>
      )}
      {!hasReviewedValues && canReview && !reviewedSaved && (
        <p className="text-xs text-slate-400">Enter at least one reviewed value, then save before approval.</p>
      )}
    </div>
  );
}

// ─── Small presentational helpers ───────────────────────────────────────────

function SafetyBanner({ entityLabel }: { entityLabel: string }) {
  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-indigo-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-indigo-800">PDF/Image import — review &amp; draft only</p>
          <ul className="mt-1 space-y-0.5 text-indigo-700">
            <li>• PDF/Image {entityLabel} import creates <strong>reviewable draft data only</strong>.</li>
            <li>• It <strong>does not post {entityLabel}s</strong>, <strong>does not allocate</strong>, and does <strong>not</strong> create final financial records.</li>
            <li>• Please review and approve the imported fields before creating draft data.</li>
            <li>• Supported formats: PDF, PNG, JPG/JPEG, WebP. SVG is not supported.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function RoleNotice({
  tone, icon, children,
}: {
  tone: "blue" | "amber";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const border = tone === "blue" ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50";
  return (
    <div className={cn("rounded-xl border p-4 flex items-start gap-3 text-sm", border)}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

function ScanPill({ scanStatus }: { scanStatus: string | null }) {
  const s = (scanStatus ?? "").toLowerCase();
  if (s === "rejected" || s === "quarantined") {
    return <StatusPill tone="red"><Ban className="h-3.5 w-3.5" /> {s === "quarantined" ? "Quarantined" : "Rejected"}</StatusPill>;
  }
  if (s === "clean" || s === "passed") {
    return <StatusPill tone="emerald"><ShieldCheck className="h-3.5 w-3.5" /> Scan passed</StatusPill>;
  }
  // e.g. 'unavailable' — v1 has no external scanner configured
  return <StatusPill tone="slate"><ShieldCheck className="h-3.5 w-3.5" /> Scan: {scanStatus ?? "n/a"}</StatusPill>;
}

function OcrPill({ ocrStatus }: { ocrStatus: string | null }) {
  const s = (ocrStatus ?? "").toLowerCase();
  if (s === "failed") return <StatusPill tone="red"><XCircle className="h-3.5 w-3.5" /> Processing failed</StatusPill>;
  if (s === "completed") return <StatusPill tone="emerald"><CheckCircle2 className="h-3.5 w-3.5" /> Fields imported</StatusPill>;
  return <StatusPill tone="slate"><FileSearch className="h-3.5 w-3.5" /> Manual entry</StatusPill>;
}

function ReviewPill({ status, lowConfidence }: { status: string; lowConfidence: boolean }) {
  if (status === "ApprovedDraft") return <StatusPill tone="emerald"><CheckCircle2 className="h-3.5 w-3.5" /> Approved draft</StatusPill>;
  if (status === "Rejected") return <StatusPill tone="red"><XCircle className="h-3.5 w-3.5" /> Rejected</StatusPill>;
  if (lowConfidence) return <StatusPill tone="amber"><AlertTriangle className="h-3.5 w-3.5" /> Low confidence · review</StatusPill>;
  return <StatusPill tone="blue"><FileSearch className="h-3.5 w-3.5" /> Needs review</StatusPill>;
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={cn("text-sm font-medium text-slate-800", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

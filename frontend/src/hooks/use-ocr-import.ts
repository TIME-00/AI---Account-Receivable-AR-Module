// ============================================================================
// TSH Synergy AR — OCR / PDF-Image Import Intake Hook (Batch 9B-FE)
//
// Wraps the Batch 9B-I1 backend OCR intake routes. This flow is REVIEW / DRAFT
// ONLY — it never posts an invoice, never allocates a receipt, and never mutates
// a protected financial balance. OCR provider is disabled by default, so upload
// lands the file in a manual-review fallback state and the user reviews/approves
// extracted (currently manually-entered) values before a draft import is created.
//
// Backend routes (all under the existing `imports` Edge Function):
//   POST   /imports/ocr/upload                                (multipart)
//   GET    /imports/:batchId/files/:fileId/preview-url        (signed URL)
//   POST   /imports/:batchId/files/:fileId/ocr/start          (manual fallback)
//   GET    /imports/:batchId/ocr-review                       (review queue)
//   PATCH  /imports/:batchId/rows/:rowId/ocr-review           (save review)
//   POST   /imports/:batchId/rows/:rowId/approve-draft        (draft only)
//
// Client-side file checks are UX-only. The backend remains the authoritative
// validator (MIME/magic-number/extension/size/page-cap/encrypted/script checks).
// ============================================================================

"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApi, ApiError } from "@/hooks/use-api";
import type { ImportBatch, ImportRow } from "@/hooks/use-import";

// ─── Types ────────────────────────────────────────────────────────────────

/** Backend `import_files` row extended with Batch 9B-I1 OCR/file-safety metadata. */
export interface ImportFileRecord {
  id: string;
  batch_id: string;
  file_name: string;
  file_path: string;
  file_type: "pdf" | "image" | "csv" | "xlsx";
  file_size_bytes: number | null;
  content_mime_type: string | null;
  detected_mime_type: string | null;
  file_sha256: string | null;
  page_count: number | null;
  scan_status: string | null;
  scan_result: Record<string, unknown> | null;
  ocr_status: string | null;
  ocr_provider: string | null;
  ocr_result: OcrResult | null;
  retention_expires_at: string | null;
  created_at: string;
}

export interface OcrResult {
  provider?: string;
  status?: string;
  raw_text?: string | null;
  fields?: Array<{ name: string; value: unknown; confidence?: number }> | null;
  confidence?: number | null;
  manual_fallback?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface OcrUploadResult {
  batch: ImportBatch;
  file: ImportFileRecord;
  row: ImportRow;
  manual_fallback: boolean;
}

export interface OcrReviewList {
  batch: ImportBatch;
  files: ImportFileRecord[];
  rows: ImportRow[];
}

export interface OcrStartResult {
  status: string;
  provider: string;
  manual_fallback: boolean;
  message: string;
}

/** OCR intake wizard state. All states are pre-financial (review/draft only). */
export type OcrImportStep = "select" | "review" | "approved";

/** File classification for the multipart `file_type` field. */
export type OcrFileType = "pdf" | "image";

// ─── Client-side pre-validation (UX only — backend is authoritative) ────────

const PDF_MAX_BYTES = 10 * 1024 * 1024; // mirrors backend PDF cap
const IMAGE_MAX_BYTES = 8 * 1024 * 1024; // mirrors backend image cap

const ACCEPTED_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
/** Segments that make a multi-dot name look like a disguised double extension. */
const SUSPICIOUS_INNER_EXTS = new Set([
  "pdf", "png", "jpg", "jpeg", "webp", "svg", "svgz",
  "exe", "js", "mjs", "html", "htm", "php", "sh", "bat", "zip", "gz",
]);

export interface ClientFileCheck {
  ok: boolean;
  fileType?: OcrFileType;
  /** Machine-ish reason key for UX copy. */
  reason?:
    | "svg_unsupported"
    | "double_extension"
    | "unsupported_type"
    | "empty_file"
    | "too_large";
  message?: string;
}

/**
 * Best-effort client validation to give fast, friendly feedback before the
 * upload round-trip. Never a substitute for backend validation.
 */
export function checkOcrFile(file: File): ClientFileCheck {
  const lower = file.name.toLowerCase();
  const parts = lower.split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";

  if (ext === "svg" || ext === "svgz") {
    return {
      ok: false,
      reason: "svg_unsupported",
      message: "SVG files are not supported. Please upload a PDF, PNG, JPG/JPEG, or WebP.",
    };
  }

  // Disguised double extension, e.g. invoice.pdf.exe or scan.png.js
  if (parts.length >= 3 && SUSPICIOUS_INNER_EXTS.has(parts[parts.length - 2])) {
    return {
      ok: false,
      reason: "double_extension",
      message: "This file appears to use a double extension, which is not allowed. Rename it to a single valid extension.",
    };
  }

  const isPdf = ext === "pdf";
  const isImage = ACCEPTED_IMAGE_EXTS.has(ext);
  if (!isPdf && !isImage) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: "Unsupported file type. Only PDF, PNG, JPG/JPEG, and WebP are accepted.",
    };
  }

  if (file.size === 0) {
    return {
      ok: false,
      reason: "empty_file",
      message: "This file is empty (0 bytes). Please choose a valid document.",
    };
  }

  const max = isPdf ? PDF_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > max) {
    return {
      ok: false,
      reason: "too_large",
      message: `File is too large. Maximum size is ${isPdf ? "10 MB" : "8 MB"} for ${isPdf ? "PDF" : "image"} files.`,
    };
  }

  return { ok: true, fileType: isPdf ? "pdf" : "image" };
}

// ─── Invoice review field model ─────────────────────────────────────────────
// The backend accepts a freeform `reviewed_fields` object. For invoice intake
// v1 we present a fixed, review-friendly field set that mirrors the CSV/XLSX
// invoice columns so reviewed values are consistent across import channels.

export interface OcrReviewFieldDef {
  key: string;
  label: string;
  type: "text" | "date" | "number";
  hint?: string;
}

export const OCR_INVOICE_FIELDS: OcrReviewFieldDef[] = [
  { key: "customer_name", label: "Customer Name", type: "text", hint: "Existing visible customer or new customer name" },
  { key: "invoice_date", label: "Invoice Date", type: "date", hint: "YYYY-MM-DD" },
  { key: "currency", label: "Currency", type: "text", hint: "3-letter ISO code (e.g. SGD, MYR)" },
  { key: "reference_no", label: "Reference No", type: "text", hint: "External reference number" },
  { key: "description", label: "Line Description", type: "text" },
  { key: "quantity", label: "Quantity", type: "number" },
  { key: "unit_price", label: "Unit Price", type: "number" },
  { key: "tax_rate", label: "Tax Rate (%)", type: "number", hint: "0–100; 0 for non-taxable" },
];

/** Extract the raw (OCR-suggested) value for a field, if any was captured. */
export function rawOcrValue(row: ImportRow | null, key: string): string | null {
  const ocrFields = row?.raw_data?.ocr_fields;
  if (ocrFields && typeof ocrFields === "object" && !Array.isArray(ocrFields)) {
    const v = (ocrFields as Record<string, unknown>)[key];
    if (v != null && v !== "") return String(v);
  }
  return null;
}

/** Extract the currently-saved reviewed value for a field, if any. */
export function reviewedOcrValue(row: ImportRow | null, key: string): string {
  const reviewed = row?.mapped_data?.reviewed_fields;
  if (reviewed && typeof reviewed === "object" && !Array.isArray(reviewed)) {
    const v = (reviewed as Record<string, unknown>)[key];
    if (v != null) return String(v);
  }
  return "";
}

// ─── Hook ────────────────────────────────────────────────────────────────

export function useOcrImport() {
  const api = useApi();

  const [step, setStep] = useState<OcrImportStep>("select");
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [file, setFile] = useState<ImportFileRecord | null>(null);
  const [row, setRow] = useState<ImportRow | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Low-confidence / manual-fallback flag drives the "needs review" messaging. */
  const lowConfidence = useMemo(() => {
    return row?.mapped_data?.low_confidence !== false;
  }, [row]);

  /** True once the row has been approved into a draft import state (not posted). */
  const isApprovedDraft = row?.status === "ApprovedDraft";

  /**
   * Upload a PDF/image file. Creates import batch/file/review-row metadata only.
   * Uses rawFetch for multipart. Does NOT post or allocate anything.
   */
  const uploadFile = useCallback(
    async (rawFile: File) => {
      const check = checkOcrFile(rawFile);
      if (!check.ok || !check.fileType) {
        const msg = check.message ?? "Unsupported file.";
        setError(msg);
        toast.error("File Rejected", { description: msg });
        return;
      }

      setIsUploading(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append("file", rawFile);
        formData.append("import_type", "invoice");
        formData.append("file_type", check.fileType);
        formData.append("batch_name", `OCR Invoice Intake — ${rawFile.name}`);

        const res = await api.rawFetch("/imports/ocr/upload", {
          method: "POST",
          body: formData,
        });

        const text = await res.text();
        let json: unknown = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          /* non-JSON */
        }

        if (!res.ok) {
          const msg = extractApiError(json, `Upload failed (HTTP ${res.status})`);
          throw new Error(msg);
        }

        const payload = unwrap<OcrUploadResult>(json);
        setBatch(payload.batch);
        setFile(payload.file);
        setRow(payload.row);
        setStep("review");
        toast.success("File Uploaded", {
          description: payload.manual_fallback
            ? "OCR is disabled — review the invoice fields manually before approving a draft."
            : "File uploaded. Review the extracted fields before approving a draft.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
        toast.error("Upload Failed", { description: msg });
      } finally {
        setIsUploading(false);
      }
    },
    [api],
  );

  /**
   * Request/start OCR. With the provider disabled this returns a controlled
   * manual-fallback result; it never invokes a real OCR provider.
   */
  const startOcr = useCallback(async () => {
    if (!batch || !file) return;
    setError(null);
    try {
      const result = await api.post<OcrStartResult>(
        `/imports/${batch.id}/files/${file.id}/ocr/start`,
      );
      toast.info(
        result.manual_fallback ? "Manual Review Required" : "OCR Started",
        { description: result.message },
      );
      return result;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not start OCR";
      setError(msg);
    }
  }, [api, batch, file]);

  /**
   * Fetch a short-lived signed preview URL and open it. Never constructs a
   * public storage URL.
   */
  const openPreview = useCallback(async () => {
    if (!batch || !file) return;
    setIsPreviewLoading(true);
    setError(null);
    try {
      const result = await api.get<{ signed_url: string; expires_in_seconds: number }>(
        `/imports/${batch.id}/files/${file.id}/preview-url`,
      );
      if (result?.signed_url) {
        window.open(result.signed_url, "_blank", "noopener,noreferrer");
      } else {
        throw new Error("No preview URL was returned.");
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not open preview";
      setError(msg);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [api, batch, file]);

  /**
   * Save reviewed invoice field values. Persists to review metadata only — no
   * invoice is created or posted here.
   */
  const saveReview = useCallback(
    async (reviewedFields: Record<string, string>, reviewNote?: string) => {
      if (!batch || !row) return;
      setIsSaving(true);
      setError(null);
      try {
        const result = await api.patch<{ row: ImportRow; decisions_recorded: number }>(
          `/imports/${batch.id}/rows/${row.id}/ocr-review`,
          { reviewed_fields: reviewedFields, review_note: reviewNote },
        );
        if (result?.row) setRow(result.row);
        toast.success("Review Saved", {
          description: "Reviewed values were saved as draft review data. Nothing was posted.",
        });
        return result;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Could not save review";
        setError(msg);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [api, batch, row],
  );

  /**
   * Approve the reviewed row to a DRAFT import state only. Backend requires an
   * AR Supervisor / Finance Manager when the row is low-confidence. This never
   * posts an invoice and never allocates a receipt.
   */
  const approveDraft = useCallback(
    async (reviewNote?: string) => {
      if (!batch || !row) return;
      setIsApproving(true);
      setError(null);
      try {
        const result = await api.post<{ batch: ImportBatch; row: ImportRow; message: string }>(
          `/imports/${batch.id}/rows/${row.id}/approve-draft`,
          { review_note: reviewNote },
        );
        if (result?.batch) setBatch(result.batch);
        if (result?.row) setRow(result.row);
        setStep("approved");
        toast.success("Approved as Draft", {
          description: "Draft import data was created. No invoice was posted and no receipt was allocated.",
        });
        return result;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Could not approve draft";
        setError(msg);
        throw err;
      } finally {
        setIsApproving(false);
      }
    },
    [api, batch, row],
  );

  const reset = useCallback(() => {
    setStep("select");
    setBatch(null);
    setFile(null);
    setRow(null);
    setIsUploading(false);
    setIsSaving(false);
    setIsApproving(false);
    setIsPreviewLoading(false);
    setError(null);
  }, []);

  return {
    // state
    step,
    batch,
    file,
    row,
    lowConfidence,
    isApprovedDraft,
    isUploading,
    isSaving,
    isApproving,
    isPreviewLoading,
    error,
    // actions
    uploadFile,
    startOcr,
    openPreview,
    saveReview,
    approveDraft,
    reset,
  };
}

// ─── Response helpers ───────────────────────────────────────────────────────

/** Unwrap the `{ success, data }` envelope (rawFetch path parses manually). */
function unwrap<T>(json: unknown): T {
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

/** Pull a friendly message out of an error envelope. */
function extractApiError(json: unknown, fallback: string): string {
  if (json && typeof json === "object") {
    const err = (json as { error?: { message?: string } }).error;
    if (err?.message) return err.message;
    const msg = (json as { message?: string }).message;
    if (msg) return msg;
  }
  return fallback;
}

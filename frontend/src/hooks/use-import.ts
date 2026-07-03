// ============================================================================
// TSH Synergy AR — Import API Hook (Phase A: CSV Invoice Import, Draft Only)
// Wraps imports Edge Function endpoints for CSV upload, parse, validate, execute.
// ============================================================================

"use client";

import { useCallback, useState } from "react";
import { useApi, ApiError } from "@/hooks/use-api";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ImportBatch {
  id: string;
  company_id: string;
  batch_name: string;
  import_type: "invoice" | "receipt";
  file_type: "csv" | "xlsx" | "pdf" | "image";
  file_name: string;
  status: ImportBatchStatus;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  created_count: number;
  matched_customers_count: number;
  created_customers_count: number;
  posted_count: number;
  allocated_count: number;
  skipped_count: number;
  unmatched_count: number;
  auto_post: boolean;
  auto_allocate: boolean;
  error_summary: ImportRowError[] | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export type ImportBatchStatus =
  | "Uploaded"
  | "Parsing"
  | "Parsed"
  | "Validating"
  | "Validated"
  | "Executing"
  | "Completed"
  | "Failed"
  | "Cancelled"
  // Batch 9B OCR/PDF-image intake lifecycle (review/draft only — never posts)
  | "NeedsReview"
  | "ApprovedDraft"
  | "Rejected";

export interface ImportRow {
  id: string;
  batch_id: string;
  row_number: number;
  raw_data: Record<string, unknown>;
  mapped_data: Record<string, unknown> | null;
  status: ImportRowStatus;
  validation_errors: ImportRowError[] | null;
  invoice_id: string | null;
  receipt_id: string | null;
  je_no: string | null;
  duplicate_of: string | null;
  created_at: string;
}

export interface ImportCustomerResolution {
  action: "Matched Existing" | "Create New" | "Review Required";
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  matched_by: "customer_code" | "normalized_name" | "created_in_batch" | "fuzzy_suggestion" | null;
}

export interface ImportCustomerSuggestion {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  confidence: number;
  reason: string;
}

export interface ImportInvoiceSuggestion {
  invoice_id: string;
  invoice_no: string;
  confidence: number;
  reason: string;
  outstanding?: number;
  currency?: string;
  status?: string;
  allocatable?: boolean;
}

export type ImportRowStatus =
  | "Pending"
  | "Valid"
  | "Error"
  | "Skipped"
  | "Created"
  | "Posted"
  | "Allocated"
  | "Unmatched"
  // Batch 9B OCR/PDF-image intake row lifecycle (review/draft only)
  | "NeedsReview"
  | "ApprovedDraft"
  | "Rejected";

export interface ImportRowError {
  field?: string;
  row?: number;
  /** Backend may return `message` or `error` — UI should check both */
  message?: string;
  error?: string;
}

/**
 * Backend parse/validate/execute endpoints return a wrapper:
 * { batch: ImportBatch, rows: ImportRow[] }
 */
export interface ImportBatchResponse {
  batch: ImportBatch;
  rows: ImportRow[];
}

export type ImportType = "invoice" | "receipt";

// ─── Review (Batch 6C) ────────────────────────────────────────────────────────

export type ReviewAction =
  | "approve_suggestion"
  | "reject_suggestion"
  | "edit_customer"
  | "edit_invoice_reference"
  | "retry_validation";

export type ReviewResult =
  | "approved_pending_retry"
  | "rejected"
  | "edited_pending_retry"
  | "revalidated_valid"
  | "revalidation_failed"
  | "rejected_invalid_selection";

/**
 * Payload for POST /imports/:batchId/rows/:rowId/review.
 * Only the fields relevant to `action` are sent. The frontend never writes
 * a raw customer UUID into raw_data — edit_customer uses customer_code /
 * customer_name (or an approved suggestion's customer_id), and the backend
 * resolves and translates it to the canonical raw_data.customer_code.
 */
export interface ReviewRowPayload {
  action: ReviewAction;
  suggested_customer_id?: string;
  suggested_invoice_id?: string;
  customer_id?: string;
  customer_code?: string;
  customer_name?: string;
  invoice_reference?: string;
  review_note?: string;
}

/** Backend response shape from ImportService.reviewRow(). */
export interface ReviewRowResult {
  row: ImportRow;
  action: ReviewAction;
  review_result: ReviewResult;
  revalidated: boolean;
  messages: string[];
}

// ─── Validation summary counts (presentation-only) ────────────────────────────
// These derive non-overlapping display counts from the row list. They do NOT
// change the backend contract or reinterpret persisted statuses — they only
// bucket rows for the wizard summary. A row that is still an *active* review
// item must not also be counted as an error, and an auto-rejected /
// correction-only row (review_required stays true) must not be counted as an
// active review item.

/**
 * `review_result` values that are terminal/handled — the row is no longer an
 * *active* "Needs Review" item: resolved to Valid, approved, or rejected
 * (including server-side auto-reject / correction-only). Rows that are still
 * actionable (fresh review rows, edited-pending-retry, revalidation-failed)
 * remain "Needs Review".
 */
const RESOLVED_REVIEW_RESULTS = new Set<string>([
  "revalidated_valid",
  "approved_pending_retry",
  "rejected",
  "rejected_invalid_selection",
]);

/** True when the row still needs a reviewer to act on it. */
export function isActiveReviewRow(row: ImportRow): boolean {
  if (row.mapped_data?.review_required !== true) return false;
  const result = row.mapped_data?.review_result;
  return !(typeof result === "string" && RESOLVED_REVIEW_RESULTS.has(result));
}

/**
 * Non-overlapping presentation counts for the import validation summary.
 * `needsReview` counts only *active* review items; `errors` counts
 * error/unmatched/skipped rows that are not active review items (so an
 * auto-rejected row shows under Errors, not Needs Review).
 */
export function summarizeValidationCounts(rows: ImportRow[]): { needsReview: number; errors: number } {
  let needsReview = 0;
  let errors = 0;
  for (const row of rows) {
    if (isActiveReviewRow(row)) {
      needsReview += 1;
    } else if (row.status === "Error" || row.status === "Unmatched" || row.status === "Skipped") {
      errors += 1;
    }
  }
  return { needsReview, errors };
}

// ─── Step tracking ──────────────────────────────────────────────────────────

// Batch 6C UX Fix — simplified 4-step user flow. Parse + Preview are no longer
// user-visible steps; the hook parses and validates automatically after upload.
export type ImportStep =
  | "upload"
  | "validate"
  | "execute"
  | "result";

export const IMPORT_STEPS: { key: ImportStep; label: string; number: number }[] = [
  { key: "upload", label: "Upload File", number: 1 },
  { key: "validate", label: "Validate", number: 2 },
  { key: "execute", label: "Create Drafts", number: 3 },
  { key: "result", label: "Result", number: 4 },
];

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useImport(importType: ImportType = "invoice") {
  const api = useApi();

  const [step, setStep] = useState<ImportStep>("upload");
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row/per-action loading map keyed by `${rowId}:${action}` (Batch 6C).
  const [reviewLoading, setReviewLoading] = useState<Record<string, boolean>>({});

  /**
   * Step 1: Upload CSV or Excel file to imports Edge Function.
   * Uses rawFetch for multipart/form-data upload.
   * Detects file_type from extension: .csv → 'csv', .xlsx → 'xlsx'.
   */
  const uploadFile = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setError(null);
      try {
        // Detect file type from extension
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext !== "csv" && ext !== "xlsx") {
          throw new Error("Unsupported file type. Only .csv and .xlsx files are allowed.");
        }
        const fileType = ext === "xlsx" ? "xlsx" : "csv";
        const label = fileType === "xlsx" ? "Excel" : "CSV";
        const noun = importType === "receipt" ? "Receipt" : "Invoice";

        const formData = new FormData();
        formData.append("file", file);
        formData.append("import_type", importType);
        formData.append("file_type", fileType);
        formData.append("batch_name", `${label} ${noun} Import — ${file.name}`);

        const res = await api.rawFetch("/imports/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const text = await res.text();
          let msg = `Upload failed (HTTP ${res.status})`;
          try {
            const json = JSON.parse(text);
            msg = json?.error?.message || json?.message || msg;
          } catch { /* non-JSON response */ }
          throw new Error(msg);
        }

        const json = await res.json();
        // Backend may return { data: { batch, rows } } or { batch } or bare ImportBatch
        const payload = json.data ?? json;
        const batchData: ImportBatch = payload.batch ?? payload;
        setBatch(batchData);
        if (payload.rows && Array.isArray(payload.rows)) {
          setRows(payload.rows);
        }
        // Batch 6C UX Fix: stay on the "upload" step; the caller chains
        // parse + validate automatically and lands the user on "validate".
        toast.success("File Uploaded", { description: `Batch: ${batchData.id?.slice(0, 8)}...` });
        return batchData;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
        toast.error("Upload Failed", { description: msg });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api, importType]
  );

  /**
   * Step 2: Parse uploaded CSV file.
   */
  const parseBatch = useCallback(
    async (batchId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        // Backend returns { batch, rows } wrapper
        const result = await api.post<ImportBatchResponse>(`/imports/${batchId}/parse`);
        const batchData = result.batch ?? (result as unknown as ImportBatch);
        const parsedRows = result.rows ?? [];
        setBatch(batchData);
        setRows(Array.isArray(parsedRows) ? parsedRows : []);
        // Batch 6C UX Fix: parsing is now an internal step (no user-visible
        // Preview screen and no separate toast); validation follows immediately.
        return batchData;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Parse failed";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api]
  );

  /**
   * Step 3: Validate parsed rows.
   */
  const validateBatch = useCallback(
    async (batchId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        // Backend returns { batch, rows } wrapper
        const result = await api.post<ImportBatchResponse>(`/imports/${batchId}/validate`);
        const batchData = result.batch ?? (result as unknown as ImportBatch);
        const validatedRows = result.rows ?? [];
        setBatch(batchData);
        setRows(Array.isArray(validatedRows) ? validatedRows : []);
        setStep("validate");
        toast.success("Validation Complete", {
          description: `${batchData.valid_rows} valid, ${batchData.error_rows} errors`,
        });
        return batchData;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Validation failed";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api]
  );

  /**
   * Batch 6C UX Fix — upload → auto parse → auto validate in one user action.
   * Lands the user on the "validate" step (validation results) regardless of
   * outcome. Parse/validate errors surface via the shared `error` state on the
   * Validate screen. No financial document is created here.
   */
  const uploadAndValidate = useCallback(
    async (file: File) => {
      const uploaded = await uploadFile(file);
      if (!uploaded) return undefined;
      try {
        await parseBatch(uploaded.id);
        await validateBatch(uploaded.id);
      } catch {
        // Surface the parse/validate error on the Validate step; `error` is
        // already set by the failing call. (Re-thrown errors are non-fatal here.)
        setStep("validate");
      }
      return uploaded;
    },
    [uploadFile, parseBatch, validateBatch]
  );

  /**
   * Step 4: Execute import — create draft invoices only (Phase A).
   */
  const executeBatch = useCallback(
    async (batchId: string, options?: { autoPost?: boolean }) => {
      setIsLoading(true);
      setError(null);
      try {
        // Backend returns { batch, rows } wrapper
        const result = await api.post<ImportBatchResponse>(`/imports/${batchId}/execute`, {
          auto_post: options?.autoPost === true,
        });
        const batchData = result.batch ?? (result as unknown as ImportBatch);
        const executedRows = result.rows ?? [];
        setBatch(batchData);
        setRows(Array.isArray(executedRows) ? executedRows : []);
        setStep("result");
        const noun = importType === "receipt" ? "receipts" : "invoices";
        toast.success(importType === "receipt" ? "Draft Receipts Created" : "Draft Invoices Created", {
          description: `${batchData.created_count} draft ${noun} created`,
        });
        return batchData;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Execution failed";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api, importType]
  );

  /**
   * Refresh batch status.
   */
  const refreshBatch = useCallback(
    async (batchId: string) => {
      try {
        const result = await api.get<ImportBatch>(`/imports/${batchId}`, { silent: true });
        setBatch(result);
        return result;
      } catch {
        // Silent refresh failure
      }
    },
    [api]
  );

  /**
   * Batch 6C — Resolve a single review_required row via the Batch 6B backend
   * route. The frontend NEVER mutates financial state directly: this only calls
   * POST /imports/:batchId/rows/:rowId/review and renders the row the backend
   * returns. Approve/edit never mark a row Valid — only retry_validation can,
   * and only on the backend.
   */
  const reviewImportRow = useCallback(
    async (batchId: string, rowId: string, payload: ReviewRowPayload): Promise<ReviewRowResult> => {
      const key = `${rowId}:${payload.action}`;
      setReviewLoading((prev) => ({ ...prev, [key]: true }));
      try {
        const result = await api.post<ReviewRowResult>(
          `/imports/${batchId}/rows/${rowId}/review`,
          payload,
        );
        // Replace only the acted row from the backend response so other rows'
        // in-progress review decisions are preserved (mirrors the backend's
        // refreshBatchCounters, which never re-derives sibling rows).
        if (result?.row) {
          setRows((prev) => prev.map((r) => (r.id === result.row.id ? result.row : r)));
        }
        // After retry_validation the batch counters change server-side; refresh
        // the batch summary so valid/error counts are not stale.
        if (payload.action === "retry_validation") {
          await refreshBatch(batchId);
        }
        if (result?.messages?.length) {
          toast.success("Review Updated", { description: result.messages[0] });
        }
        return result;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Review action failed";
        toast.error("Review Failed", { description: msg });
        throw err;
      } finally {
        setReviewLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [api, refreshBatch]
  );

  /**
   * Reset all state back to initial.
   */
  const reset = useCallback(() => {
    setStep("upload");
    setBatch(null);
    setRows([]);
    setIsLoading(false);
    setError(null);
    setReviewLoading({});
  }, []);

  return {
    // State
    step,
    setStep,
    batch,
    rows,
    isLoading,
    error,
    reviewLoading,
    // Actions
    uploadFile,
    uploadAndValidate,
    parseBatch,
    validateBatch,
    executeBatch,
    refreshBatch,
    reviewImportRow,
    reset,
  };
}

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
  | "Cancelled";

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
  action: "Matched Existing" | "Create New";
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  matched_by: "customer_code" | "normalized_name" | "created_in_batch" | null;
}

export type ImportRowStatus =
  | "Pending"
  | "Valid"
  | "Error"
  | "Skipped"
  | "Created"
  | "Posted"
  | "Allocated"
  | "Unmatched";

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

// ─── Step tracking ──────────────────────────────────────────────────────────

export type ImportStep =
  | "upload"
  | "parse"
  | "preview"
  | "validate"
  | "execute"
  | "result";

export const IMPORT_STEPS: { key: ImportStep; label: string; number: number }[] = [
  { key: "upload", label: "Upload File", number: 1 },
  { key: "parse", label: "Parse", number: 2 },
  { key: "preview", label: "Preview & Edit", number: 3 },
  { key: "validate", label: "Validate", number: 4 },
  { key: "execute", label: "Create Drafts", number: 5 },
  { key: "result", label: "Result", number: 6 },
];

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useImport() {
  const api = useApi();

  const [step, setStep] = useState<ImportStep>("upload");
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        const formData = new FormData();
        formData.append("file", file);
        formData.append("import_type", "invoice");
        formData.append("file_type", fileType);
        formData.append("batch_name", `${label} Import — ${file.name}`);

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
        setStep("parse");
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
    [api]
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
        setStep("preview");
        toast.success("File Parsed", { description: `${parsedRows.length} rows extracted` });
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
        setStep("execute");
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
   * Step 4: Execute import — create draft invoices only (Phase A).
   */
  const executeBatch = useCallback(
    async (batchId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        // Backend returns { batch, rows } wrapper
        const result = await api.post<ImportBatchResponse>(`/imports/${batchId}/execute`);
        const batchData = result.batch ?? (result as unknown as ImportBatch);
        const executedRows = result.rows ?? [];
        setBatch(batchData);
        setRows(Array.isArray(executedRows) ? executedRows : []);
        setStep("result");
        toast.success("Draft Invoices Created", {
          description: `${batchData.created_count} draft invoices created`,
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
    [api]
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
   * Reset all state back to initial.
   */
  const reset = useCallback(() => {
    setStep("upload");
    setBatch(null);
    setRows([]);
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    // State
    step,
    setStep,
    batch,
    rows,
    isLoading,
    error,
    // Actions
    uploadFile,
    parseBatch,
    validateBatch,
    executeBatch,
    refreshBatch,
    reset,
  };
}

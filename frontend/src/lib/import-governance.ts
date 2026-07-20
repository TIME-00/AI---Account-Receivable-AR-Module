// ============================================================================
// TSH Synergy AR — Import / OCR FX & governance provenance (Batch 9D-D)
//
// B9DD-FEIR-008, corrected by B9DD-RR-005.
//
// ORIGIN CONTRACT (established from the committed backend source, not assumed):
//
//   * `backend/supabase/functions/imports/service.ts::importOriginPayload()`
//     (line ~299) builds `{ source: 'csv_xlsx_import', batch_id, row_id, ... }`,
//     but it is constructed at POSTING time and passed to the FX booking RPC as
//     `p_import_origin`. It is NEVER written into `import_rows.mapped_data`.
//     A row therefore never carries `mapped_data.source === 'csv_xlsx_import'`
//     in production, and `'ocr'` is not emitted anywhere at all.
//
//   * The only `mapped_data.source` value production actually writes is
//     `'ocr_manual_fallback'` (service.ts line ~589, the OCR-disabled review row).
//
//   * The authoritative origin for the review UI is therefore the BATCH
//     envelope, which `GET /imports/:id` returns and which every import page
//     already holds: `import_type` ('invoice' | 'receipt') and `file_type`
//     ('csv' | 'xlsx' | 'pdf' | 'image'). CSV/XLSX intake is constrained to
//     csv|xlsx (ALLOWED_IMPORT_FILE_TYPES, service.ts line 53); OCR intake
//     carries pdf|image.
//
// Origin is consequently supplied to this module SEPARATELY from `mapped_data`,
// and is `null` when the caller genuinely has no batch envelope — in which case
// the UI states "Origin not available" rather than inventing CSV/XLSX or OCR.
//
// CONTRACT LIMITATION (documented, not worked around): `mapped_data` carries the
// DETECTED/MAPPED transaction currency, amount, exchange rate, override reason
// and posting status — but NOT a company-base amount and NOT an `fx_decision`.
// Those are created by FX booking governance only when the document is POSTED.
// Import review therefore shows an explicit "not booked yet" state for base
// amounts rather than computing one.
// ============================================================================

import { normalizeCurrency } from "@/lib/currency";

/** `mapped_data.posting_status` values emitted by imports/service.ts. */
export type ImportPostingStatus = "not_posted" | "HeldGovernance" | "Posted" | "Error";

/**
 * The authoritative origin envelope: the import BATCH.
 *
 * Structurally typed so `ImportBatch` (use-import.ts) and the OCR batch type
 * (use-ocr-import.ts) both satisfy it without either importing the other.
 */
export interface ImportOriginEnvelope {
  import_type: "invoice" | "receipt";
  file_type: "csv" | "xlsx" | "pdf" | "image";
}

export type ImportOriginKind = "csv_xlsx_import" | "ocr_intake" | "unavailable";

export interface ImportOriginDisplay {
  kind: ImportOriginKind;
  /** Human label; for `unavailable` this states the absence explicitly. */
  label: string;
  /** Null when the origin is unavailable — never guessed. */
  documentKind: "invoice" | "receipt" | null;
}

/**
 * Resolve the origin from the batch envelope.
 *
 * `batch` is null whenever the caller has no authoritative envelope for the row
 * (e.g. a row rendered outside a loaded batch). That is a real state and is
 * reported as such.
 */
export function resolveImportOrigin(
  batch: ImportOriginEnvelope | null | undefined,
): ImportOriginDisplay {
  if (!batch) {
    return { kind: "unavailable", label: "Origin not available", documentKind: null };
  }
  const documentKind = batch.import_type;
  if (batch.file_type === "csv" || batch.file_type === "xlsx") {
    return {
      kind: "csv_xlsx_import",
      label: `CSV/XLSX import (${batch.file_type.toUpperCase()})`,
      documentKind,
    };
  }
  if (batch.file_type === "pdf" || batch.file_type === "image") {
    return {
      kind: "ocr_intake",
      label: `OCR intake (${batch.file_type.toUpperCase()})`,
      documentKind,
    };
  }
  return { kind: "unavailable", label: "Origin not available", documentKind };
}

function readString(data: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(data: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = data?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export interface ImportRowGovernance {
  /**
   * Detected/mapped transaction currency, or null when the file supplied none.
   * Null is a real state and must be shown as such — never defaulted to MYR.
   */
  currency: string | null;
  /** Mapped transaction amount, when the row carries a single scalar amount. */
  amount: number | null;
  /** Imported exchange rate, when explicitly supplied in the file. */
  exchangeRate: number | null;
  /** Override justification; its presence is what makes the rate governed. */
  overrideReason: string | null;
  /**
   * True when the file supplied an explicit FX rate. The backend governs such a
   * rate as MANUAL_OVERRIDE and holds the row before posting.
   */
  isManualOverride: boolean;
  postingStatus: ImportPostingStatus;
  /** Reason a row could not post (governance hold or a posting failure). */
  postingError: string | null;
  /**
   * The ONLY `mapped_data.source` marker production emits (service.ts ~589):
   * the OCR-disabled manual-fallback review row. Null for every other row.
   * This is a row-level marker, NOT the batch origin — see `resolveImportOrigin`.
   */
  manualFallback: boolean;
  /** True while the row still needs human review before it may be created. */
  reviewRequired: boolean;
  /** True when OCR confidence was low for this row. */
  lowConfidence: boolean;
}

function readPostingStatus(data: Record<string, unknown> | null | undefined): ImportPostingStatus {
  const raw = readString(data, "posting_status");
  if (raw === "HeldGovernance" || raw === "Posted" || raw === "Error" || raw === "not_posted") {
    return raw;
  }
  return "not_posted";
}

/**
 * Read the FX/governance provenance a single import row actually carries.
 *
 * Only real `mapped_data` fields are read. The batch origin is deliberately NOT
 * an argument here — callers resolve it via `resolveImportOrigin(batch)`.
 */
export function readImportGovernance(
  mappedData: Record<string, unknown> | null | undefined,
): ImportRowGovernance {
  const exchangeRate = readNumber(mappedData, "exchange_rate");

  return {
    currency: normalizeCurrency(readString(mappedData, "currency")),
    // Receipts map a scalar amount; invoices map `lines`, whose total is derived
    // server-side at creation — so a single row amount may legitimately be null.
    amount: readNumber(mappedData, "receipt_amount") ?? readNumber(mappedData, "total_amount"),
    exchangeRate,
    overrideReason: readString(mappedData, "fx_override_reason"),
    isManualOverride: exchangeRate !== null,
    postingStatus: readPostingStatus(mappedData),
    postingError: readString(mappedData, "posting_error"),
    manualFallback: readString(mappedData, "source") === "ocr_manual_fallback",
    reviewRequired: mappedData?.review_required === true,
    lowConfidence: mappedData?.low_confidence === true,
  };
}

export interface ImportPostingPresentation {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  icon: string;
  description: string;
}

export const IMPORT_POSTING_PRESENTATION: Record<ImportPostingStatus, ImportPostingPresentation> = {
  not_posted: {
    label: "Not posted",
    tone: "neutral",
    icon: "Circle",
    description: "This row has not been posted, so no FX rate has been booked yet.",
  },
  Posted: {
    label: "Posted",
    tone: "success",
    icon: "CheckCircle2",
    description: "The document was posted; its booked FX snapshot is on the document itself.",
  },
  HeldGovernance: {
    label: "Held — governance",
    tone: "warning",
    icon: "ShieldAlert",
    description:
      "The imported FX rate is governed as a manual override and must be reviewed and approved before this document can post.",
  },
  Error: {
    label: "Posting error",
    tone: "danger",
    icon: "XCircle",
    description: "The document was created but could not be posted.",
  },
};

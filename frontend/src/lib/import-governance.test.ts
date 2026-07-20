// ============================================================================
// B9DD-FEIR-008 / B9DD-RR-005 — import governance + ORIGIN contract.
//
// Every fixture here is shaped like the committed backend really emits it:
//
//   * origin lives on the BATCH envelope (import_type + file_type), which
//     `GET /imports/:id` returns — NOT in mapped_data;
//   * the only mapped_data.source production writes is 'ocr_manual_fallback'
//     (imports/service.ts ~589);
//   * 'csv_xlsx_import' exists only inside importOriginPayload() at posting
//     time (service.ts ~299) and is never stored on the row.
//
// No test here injects mapped_data.source = 'csv_xlsx_import' or 'ocr'.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  readImportGovernance,
  resolveImportOrigin,
  IMPORT_POSTING_PRESENTATION,
  type ImportOriginEnvelope,
} from "@/lib/import-governance";

const csvInvoiceBatch: ImportOriginEnvelope = { import_type: "invoice", file_type: "csv" };
const xlsxReceiptBatch: ImportOriginEnvelope = { import_type: "receipt", file_type: "xlsx" };
const ocrInvoiceBatch: ImportOriginEnvelope = { import_type: "invoice", file_type: "pdf" };
const ocrReceiptBatch: ImportOriginEnvelope = { import_type: "receipt", file_type: "image" };

// ─── Origin: from the batch envelope only ───────────────────────────────────

describe("resolveImportOrigin — authoritative batch envelope", () => {
  it("resolves an Invoice CSV batch", () => {
    const o = resolveImportOrigin(csvInvoiceBatch);
    expect(o.kind).toBe("csv_xlsx_import");
    expect(o.label).toBe("CSV/XLSX import (CSV)");
    expect(o.documentKind).toBe("invoice");
  });

  it("resolves a Receipt XLSX batch", () => {
    const o = resolveImportOrigin(xlsxReceiptBatch);
    expect(o.kind).toBe("csv_xlsx_import");
    expect(o.documentKind).toBe("receipt");
  });

  it("resolves an Invoice OCR (PDF) batch", () => {
    const o = resolveImportOrigin(ocrInvoiceBatch);
    expect(o.kind).toBe("ocr_intake");
    expect(o.label).toBe("OCR intake (PDF)");
    expect(o.documentKind).toBe("invoice");
  });

  it("resolves a Receipt OCR (image) batch", () => {
    const o = resolveImportOrigin(ocrReceiptBatch);
    expect(o.kind).toBe("ocr_intake");
    expect(o.documentKind).toBe("receipt");
  });

  // REGRESSION for B9DD-RR-005: the pre-remediation reader inferred origin from
  // mapped_data.source and would have reported "CSV/XLSX import" here. With no
  // batch envelope there is no authoritative origin, so it must say so.
  it("reports origin as unavailable when no batch envelope is supplied", () => {
    const o = resolveImportOrigin(null);
    expect(o.kind).toBe("unavailable");
    expect(o.label).toBe("Origin not available");
    expect(o.documentKind).toBeNull();
  });

  it("never infers an origin from mapped_data, even if a row carries a source-like field", () => {
    // A legacy/hostile row cannot fabricate an origin: resolveImportOrigin has
    // no access to mapped_data, and readImportGovernance exposes no `source`.
    const g = readImportGovernance({ source: "csv_xlsx_import", currency: "USD" });
    expect("source" in g).toBe(false);
    // 'csv_xlsx_import' is not the manual-fallback marker, so it stays false.
    expect(g.manualFallback).toBe(false);
    expect(resolveImportOrigin(undefined).kind).toBe("unavailable");
  });
});

// ─── Row-level marker: only 'ocr_manual_fallback' is real ───────────────────

describe("readImportGovernance — mapped_data.source", () => {
  it("recognises the one source value production actually writes", () => {
    // imports/service.ts ~589 — the OCR-disabled manual review row.
    const g = readImportGovernance({
      source: "ocr_manual_fallback",
      review_required: true,
      low_confidence: true,
    });
    expect(g.manualFallback).toBe(true);
    expect(g.reviewRequired).toBe(true);
    expect(g.lowConfidence).toBe(true);
  });

  it("does not treat an absent source as a manual fallback", () => {
    expect(readImportGovernance({ currency: "MYR" }).manualFallback).toBe(false);
  });
});

// ─── Real mapped_data fields ────────────────────────────────────────────────

describe("readImportGovernance — real mapped_data fields", () => {
  it("reads a CSV/XLSX receipt row's mapped fields", () => {
    const g = readImportGovernance({
      currency: "sgd",
      receipt_amount: 250.5,
      posting_status: "not_posted",
    });
    expect(g.currency).toBe("SGD");
    expect(g.amount).toBe(250.5);
    expect(g.postingStatus).toBe("not_posted");
    expect(g.exchangeRate).toBeNull();
    expect(g.isManualOverride).toBe(false);
  });

  it("returns a null currency rather than defaulting to MYR", () => {
    expect(readImportGovernance({ receipt_amount: 10 }).currency).toBeNull();
    expect(readImportGovernance(null).currency).toBeNull();
    expect(readImportGovernance(undefined).currency).toBeNull();
  });

  it("treats an explicit imported rate as a manual override", () => {
    const g = readImportGovernance({
      currency: "USD",
      exchange_rate: 4.5,
      fx_override_reason: "Contract rate per PO-991",
    });
    expect(g.exchangeRate).toBe(4.5);
    expect(g.isManualOverride).toBe(true);
    expect(g.overrideReason).toBe("Contract rate per PO-991");
  });

  it("reads a HeldGovernance row with its verbatim reason", () => {
    const g = readImportGovernance({
      currency: "USD",
      exchange_rate: 4.5,
      posting_status: "HeldGovernance",
      posting_error: "Explicit imported FX rate is governed as MANUAL_OVERRIDE.",
    });
    expect(g.postingStatus).toBe("HeldGovernance");
    expect(g.postingError).toContain("MANUAL_OVERRIDE");
    expect(IMPORT_POSTING_PRESENTATION.HeldGovernance.tone).toBe("warning");
  });

  it("reads a posting error row", () => {
    const g = readImportGovernance({ posting_status: "Error", posting_error: "Credit limit exceeded" });
    expect(g.postingStatus).toBe("Error");
    expect(g.postingError).toBe("Credit limit exceeded");
  });

  it("falls back to not_posted for an unknown posting_status", () => {
    expect(readImportGovernance({ posting_status: "Wat" }).postingStatus).toBe("not_posted");
  });

  it("reads an invoice row's total_amount when no receipt_amount exists", () => {
    expect(readImportGovernance({ currency: "MYR", total_amount: "1200.00" }).amount).toBe(1200);
  });
});

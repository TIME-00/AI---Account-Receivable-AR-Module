// ============================================================================
// B9DD-RR-005 / RR-006 §9.2 — Invoice & Receipt import page composition.
//
// These prove the REAL pages thread the authoritative origin envelope (the
// batch) into ImportGovernanceCell, rather than letting the cell guess an
// origin from mapped_data — which production never populates.
//
// `useImport` holds the batch/rows in local state after an upload, so the hook
// is stubbed to place each page at its review step; everything below that (the
// rows table, the governance cell, the origin resolution) is real code.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";
import type { ImportBatch, ImportRow } from "@/hooks/use-import";

const importState = vi.hoisted(() => ({
  step: "validate" as string,
  batch: null as unknown,
  rows: [] as unknown[],
}));

vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({ baseCurrency: "MYR", isLoading: false, isUnavailable: false }),
}));

vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({
    role: "AR Clerk",
    isLoading: false,
    email: "t@test",
    canPostInvoice: true,
    canCreateInvoice: true,
    canPostReceipt: true,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

vi.mock("@/hooks/use-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-import")>();
  return {
    ...actual,
    useImport: () => ({
      step: importState.step,
      setStep: vi.fn(),
      batch: importState.batch,
      rows: importState.rows,
      isLoading: false,
      error: null,
      reviewLoading: {},
      uploadFile: vi.fn(),
      uploadAndValidate: vi.fn(),
      parseBatch: vi.fn(),
      validateBatch: vi.fn(),
      executeBatch: vi.fn(),
      refreshBatch: vi.fn(),
      reviewImportRow: vi.fn(),
      reset: vi.fn(),
    }),
  };
});

import InvoiceImportPage from "@/app/(dashboard)/invoices/import/page";
import ReceiptImportPage from "@/app/(dashboard)/receipts/import/page";

function batchFixture(over: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: "batch-1",
    company_id: "co-1",
    batch_name: "July invoices",
    import_type: "invoice",
    file_type: "csv",
    file_name: "invoices.csv",
    status: "Validated",
    total_rows: 1,
    valid_rows: 1,
    error_rows: 0,
    created_count: 0,
    matched_customers_count: 0,
    created_customers_count: 0,
    posted_count: 0,
    allocated_count: 0,
    skipped_count: 0,
    unmatched_count: 0,
    auto_post: false,
    auto_allocate: false,
    error_summary: null,
    created_by: "u1",
    created_at: "2026-07-16T00:00:00Z",
    completed_at: null,
    updated_at: "2026-07-16T00:00:00Z",
    ...over,
  } as ImportBatch;
}

function rowFixture(mapped: Record<string, unknown>): ImportRow {
  return {
    id: "row-1",
    batch_id: "batch-1",
    row_number: 1,
    raw_data: {},
    mapped_data: mapped,
    status: "Valid",
    validation_errors: null,
    invoice_id: null,
    receipt_id: null,
    je_no: null,
    duplicate_of: null,
    created_at: "2026-07-16T00:00:00Z",
    updated_at: "2026-07-16T00:00:00Z",
  } as unknown as ImportRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  importState.step = "validate";
});

// ─── Invoice import ─────────────────────────────────────────────────────────

describe("Invoice import page — governance + origin (B9DD-RR-005)", () => {
  it("threads the CSV batch envelope through to the governance cell", async () => {
    importState.batch = batchFixture({ import_type: "invoice", file_type: "csv" });
    importState.rows = [rowFixture({ currency: "USD", total_amount: 100, exchange_rate: 4.45 })];

    renderWithProviders(<InvoiceImportPage />);

    // Origin comes from the batch (import_type + file_type) — NOT mapped_data.
    await waitFor(() => expect(screen.getByText("CSV/XLSX import (CSV)")).toBeInTheDocument());
    // Detected currency and the imported rate's direction.
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText(/1 USD = 4\.4500 MYR/)).toBeInTheDocument();
    // Base is not booked until posting.
    expect(screen.getByText(/Base amount not booked yet/i)).toBeInTheDocument();
  });

  it("reports an XLSX batch's origin from its real file_type", async () => {
    importState.batch = batchFixture({ import_type: "invoice", file_type: "xlsx" });
    importState.rows = [rowFixture({ currency: "MYR" })];

    renderWithProviders(<InvoiceImportPage />);
    await waitFor(() => expect(screen.getByText("CSV/XLSX import (XLSX)")).toBeInTheDocument());
  });

  it("surfaces a HeldGovernance row on the real page", async () => {
    importState.batch = batchFixture();
    importState.rows = [
      rowFixture({
        currency: "USD",
        exchange_rate: 4.45,
        posting_status: "HeldGovernance",
        posting_error: "Explicit imported FX rate is governed as MANUAL_OVERRIDE.",
      }),
    ];

    renderWithProviders(<InvoiceImportPage />);
    await waitFor(() => expect(screen.getByText(/Held — governance/i)).toBeInTheDocument());
    expect(screen.getByText(/MANUAL_OVERRIDE/)).toBeInTheDocument();
  });

  it("states 'currency not detected' rather than assuming MYR", async () => {
    importState.batch = batchFixture();
    importState.rows = [rowFixture({ total_amount: 100 })];

    renderWithProviders(<InvoiceImportPage />);
    await waitFor(() => expect(screen.getByText(/Currency not detected/i)).toBeInTheDocument());
  });
});

// ─── Receipt import ─────────────────────────────────────────────────────────

describe("Receipt import page — governance + origin (B9DD-RR-005)", () => {
  it("threads the receipt CSV batch envelope through to the governance cell", async () => {
    importState.batch = batchFixture({ import_type: "receipt", file_type: "csv" });
    importState.rows = [rowFixture({ currency: "SGD", receipt_amount: 250.5 })];

    renderWithProviders(<ReceiptImportPage />);
    await waitFor(() => expect(screen.getByText("CSV/XLSX import (CSV)")).toBeInTheDocument());
    expect(screen.getByText("SGD 250.50")).toBeInTheDocument();
  });

  // REMOVED (B9DD-FR-003): a test here previously injected a PDF/OCR batch into
  // `useImport` state while the page stayed in CSV mode, then claimed to cover
  // "OCR". It rendered the CSV wizard's rows table, never OcrImportFlow, and
  // never touched useOcrImport — a combination production cannot produce. Real
  // OCR coverage now lives in `ocr-import.test.tsx`, which switches the page
  // into OCR mode through the actual UI control and drives the real hook.

  it("surfaces a posting error row", async () => {
    importState.batch = batchFixture({ import_type: "receipt", file_type: "csv" });
    importState.rows = [
      rowFixture({ currency: "MYR", posting_status: "Error", posting_error: "Credit limit exceeded" }),
    ];

    renderWithProviders(<ReceiptImportPage />);
    await waitFor(() => expect(screen.getByText(/Posting error/i)).toBeInTheDocument());
    expect(screen.getByText(/Credit limit exceeded/i)).toBeInTheDocument();
  });
});

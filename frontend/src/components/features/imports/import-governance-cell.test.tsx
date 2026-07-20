// ============================================================================
// B9DD-FEIR-008 / FEIR-010, corrected by B9DD-RR-005.
//
// Origin is supplied through the `batch` prop — the real envelope returned by
// `GET /imports/:id`. No fixture injects mapped_data.source = 'csv_xlsx_import'
// or 'ocr', because production never writes those.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";
import type { ImportOriginEnvelope } from "@/lib/import-governance";

vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({ baseCurrency: "MYR", isLoading: false, isUnavailable: false }),
}));

import { ImportGovernanceCell } from "@/components/features/imports/import-governance-cell";

const csvInvoiceBatch: ImportOriginEnvelope = { import_type: "invoice", file_type: "csv" };
const xlsxReceiptBatch: ImportOriginEnvelope = { import_type: "receipt", file_type: "xlsx" };
const ocrInvoiceBatch: ImportOriginEnvelope = { import_type: "invoice", file_type: "pdf" };
const ocrReceiptBatch: ImportOriginEnvelope = { import_type: "receipt", file_type: "image" };

describe("ImportGovernanceCell — CSV/XLSX review", () => {
  it("shows the detected transaction currency and amount explicitly", () => {
    renderWithProviders(
      <ImportGovernanceCell
        mappedData={{ currency: "SGD", receipt_amount: 250.5 }}
        batch={xlsxReceiptBatch}
      />,
    );
    expect(screen.getByText("SGD")).toBeInTheDocument();
    expect(screen.getByText("SGD 250.50")).toBeInTheDocument();
    // Origin comes from the batch envelope, not the row.
    expect(screen.getByText("CSV/XLSX import (XLSX)")).toBeInTheDocument();
  });

  it("shows an explicit 'currency not detected' state instead of assuming MYR", () => {
    renderWithProviders(
      <ImportGovernanceCell mappedData={{ receipt_amount: 100 }} batch={csvInvoiceBatch} />,
    );
    expect(screen.getByText(/Currency not detected/i)).toBeInTheDocument();
    // The company base currency is named as context, never as the row's currency.
    expect(screen.getByText(/company base is MYR/i)).toBeInTheDocument();
  });

  it("states the base amount is not booked yet for an unposted row", () => {
    renderWithProviders(
      <ImportGovernanceCell mappedData={{ currency: "USD", receipt_amount: 100 }} batch={csvInvoiceBatch} />,
    );
    expect(screen.getByText(/Base amount not booked yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Not posted/i)).toBeInTheDocument();
  });

  it("renders an imported rate with an explicit direction", () => {
    renderWithProviders(
      <ImportGovernanceCell
        mappedData={{ currency: "USD", exchange_rate: 4.5, receipt_amount: 100 }}
        batch={csvInvoiceBatch}
      />,
    );
    expect(screen.getByText(/1 USD = 4\.5000 MYR/)).toBeInTheDocument();
    expect(screen.getByText(/Imported rate/i)).toBeInTheDocument();
  });

  it("makes a HeldGovernance row visually AND textually explicit", () => {
    renderWithProviders(
      <ImportGovernanceCell
        mappedData={{
          currency: "USD",
          exchange_rate: 4.5,
          posting_status: "HeldGovernance",
          posting_error:
            "Explicit imported FX rate is governed as MANUAL_OVERRIDE and requires review before posting.",
        }}
        batch={csvInvoiceBatch}
      />,
    );
    // Text, not colour alone.
    expect(screen.getByText(/Held — governance/i)).toBeInTheDocument();
    expect(screen.getByText(/requires review before posting/i)).toBeInTheDocument();
  });

  it("shows the manual override reason", () => {
    renderWithProviders(
      <ImportGovernanceCell
        mappedData={{ currency: "USD", exchange_rate: 4.5, fx_override_reason: "Contract rate per PO-991" }}
        batch={csvInvoiceBatch}
      />,
    );
    expect(screen.getByText(/Contract rate per PO-991/i)).toBeInTheDocument();
  });

  it("surfaces a posting error row", () => {
    renderWithProviders(
      <ImportGovernanceCell
        mappedData={{ currency: "MYR", posting_status: "Error", posting_error: "Credit limit exceeded" }}
        batch={csvInvoiceBatch}
      />,
    );
    expect(screen.getByText(/Posting error/i)).toBeInTheDocument();
    expect(screen.getByText(/Credit limit exceeded/i)).toBeInTheDocument();
  });

  it("marks a posted row as carrying its booked base on the document", () => {
    renderWithProviders(
      <ImportGovernanceCell mappedData={{ currency: "USD", posting_status: "Posted" }} batch={csvInvoiceBatch} />,
    );
    expect(screen.getByText(/Booked base recorded on the document \(MYR\)/i)).toBeInTheDocument();
  });
});

describe("ImportGovernanceCell — OCR review", () => {
  it("shows OCR batch origin and the manual-fallback row marker", () => {
    renderWithProviders(
      <ImportGovernanceCell
        // 'ocr_manual_fallback' is the one source value the backend really writes.
        mappedData={{ source: "ocr_manual_fallback", review_required: true, low_confidence: true, currency: "MYR" }}
        batch={ocrInvoiceBatch}
      />,
    );
    expect(screen.getByText("OCR intake (PDF)")).toBeInTheDocument();
    expect(screen.getByText(/Manual entry \(OCR disabled\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Low OCR confidence/i)).toBeInTheDocument();
  });

  it("does not present an OCR-derived amount as booked", () => {
    renderWithProviders(
      <ImportGovernanceCell mappedData={{ currency: "USD", receipt_amount: 900 }} batch={ocrReceiptBatch} />,
    );
    expect(screen.getByText("OCR intake (IMAGE)")).toBeInTheDocument();
    expect(screen.getByText(/Base amount not booked yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Booked base recorded/i)).toBeNull();
  });

  it("handles a null mapped_data without crashing", () => {
    renderWithProviders(<ImportGovernanceCell mappedData={null} batch={ocrReceiptBatch} />);
    expect(screen.getByText(/Currency not detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Not posted/i)).toBeInTheDocument();
  });
});

describe("ImportGovernanceCell — origin unavailable", () => {
  // REGRESSION for B9DD-RR-005: the pre-remediation cell read origin from
  // mapped_data.source and would have printed "CSV/XLSX import" for this row.
  it("states origin is unavailable rather than inventing CSV/XLSX or OCR", () => {
    renderWithProviders(<ImportGovernanceCell mappedData={{ currency: "USD", receipt_amount: 100 }} />);
    expect(screen.getByText("Origin not available")).toBeInTheDocument();
    expect(screen.queryByText(/CSV\/XLSX import/i)).toBeNull();
    expect(screen.queryByText(/OCR intake/i)).toBeNull();
  });

  it("ignores an impossible mapped_data.source and still reports origin unavailable", () => {
    renderWithProviders(
      <ImportGovernanceCell mappedData={{ source: "csv_xlsx_import", currency: "USD" }} batch={null} />,
    );
    expect(screen.getByText("Origin not available")).toBeInTheDocument();
    expect(screen.queryByText(/CSV\/XLSX import/i)).toBeNull();
  });
});

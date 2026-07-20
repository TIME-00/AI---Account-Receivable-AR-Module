// ============================================================================
// B9DD-FR-003 — REAL OCR route integration.
//
// What this replaces: the previous "OCR" coverage mocked `useImport`, left the
// page in its default CSV mode, and injected a PDF batch into CSV hook state.
// It never rendered OcrImportFlow and never touched useOcrImport, so it proved
// nothing about the OCR route at all.
//
// These tests drive the PRODUCTION composition:
//   • the real import page, switched into OCR mode with the real UI control;
//   • the real OcrImportFlow;
//   • the real useOcrImport hook;
//   • mocked ONLY at the external API boundary (`useApi`), exactly as the OCR
//     upload route would answer.
//
// Nothing here performs a real network, staging or production request.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/harness";
import type { ImportBatch, ImportRow } from "@/hooks/use-import";
import type { ImportFileRecord } from "@/hooks/use-ocr-import";

// ─── Boundary mocks ─────────────────────────────────────────────────────────

const apiMock = vi.hoisted(() => ({
  rawFetch: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  getWithMeta: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => apiMock };
});

vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({ baseCurrency: "MYR", isLoading: false, isUnavailable: false }),
}));

// Capability-shaped exactly like the real /auth/me response consumed by
// useUserRole — the OCR flow gates upload/review/approve on these.
vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({
    role: "AR Supervisor",
    roles: ["AR Supervisor"],
    isLoading: false,
    isResolved: true,
    isError: false,
    isOperational: true,
    isReadOnly: false,
    isAuditor: false,
    isSystemAdmin: false,
    canCreateInvoice: true,
    canPostInvoice: true,
    canPostReceipt: true,
    capabilities: {
      can_execute_imports: true,
      can_review_import_rows: true,
      is_read_only: false,
      is_system_admin_only: false,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import InvoiceImportPage from "@/app/(dashboard)/invoices/import/page";
import ReceiptImportPage from "@/app/(dashboard)/receipts/import/page";

// ─── Backend-shaped OCR fixtures ────────────────────────────────────────────

function ocrBatch(over: Partial<ImportBatch> = {}): ImportBatch {
  // Shaped as imports/service.ts inserts it on the OCR upload path (~494):
  // import_type + file_type come from the validated upload, not from the UI.
  return {
    id: "batch-ocr-1",
    company_id: "co-1",
    batch_name: "PDF/Image Invoice Import — scan.pdf",
    import_type: "invoice",
    file_type: "pdf",
    file_name: "scan.pdf",
    status: "Pending",
    total_rows: 1,
    valid_rows: 0,
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

function ocrFile(over: Partial<ImportFileRecord> = {}): ImportFileRecord {
  return {
    id: "file-1",
    batch_id: "batch-ocr-1",
    file_name: "scan.pdf",
    file_path: "co-1/batch-ocr-1/scan.pdf",
    file_type: "pdf",
    file_size_bytes: 12345,
    content_mime_type: "application/pdf",
    detected_mime_type: "application/pdf",
    file_sha256: "abc",
    page_count: 1,
    scan_status: "unavailable",
    scan_result: null,
    ocr_status: "manual_fallback",
    ocr_provider: "disabled",
    ocr_result: { manual_fallback: true, status: "manual_fallback" },
    retention_expires_at: null,
    created_at: "2026-07-16T00:00:00Z",
    ...over,
  };
}

/**
 * The OCR-disabled review row the backend really writes (imports/service.ts
 * ~589): `mapped_data.source === 'ocr_manual_fallback'` is the ONLY source
 * marker production emits, and no base amount / fx_decision exists pre-posting.
 */
function ocrRow(mapped: Record<string, unknown> = {}): ImportRow {
  return {
    id: "row-ocr-1",
    batch_id: "batch-ocr-1",
    row_number: 1,
    raw_data: { ocr_fields: {} },
    mapped_data: {
      source: "ocr_manual_fallback",
      review_required: true,
      low_confidence: true,
      ...mapped,
    },
    status: "PendingReview",
    validation_errors: null,
    invoice_id: null,
    receipt_id: null,
    je_no: null,
    duplicate_of: null,
    created_at: "2026-07-16T00:00:00Z",
  } as unknown as ImportRow;
}

/** Script `POST /imports/ocr/upload` — the multipart route useOcrImport calls. */
function mockUpload(payload: { batch: ImportBatch; file: ImportFileRecord; row: ImportRow }) {
  apiMock.rawFetch.mockImplementation(async (path: string) => {
    if (path === "/imports/ocr/upload") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { ...payload, manual_fallback: true } }),
      };
    }
    throw new Error(`Unexpected rawFetch: ${path}`);
  });
}

const pdfFile = (name = "scan.pdf") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
const pngFile = (name = "receipt.png") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

/**
 * Enter OCR mode through the REAL control, then upload through the REAL hidden
 * file input. `fireEvent.change` is used rather than userEvent.upload because
 * the production input is `className="hidden"`; the React onChange handler it
 * fires is the same production path either way.
 */
async function enterOcrModeAndUpload(file: File) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /PDF\/Image Import/i }));

  // The real OcrImportFlow is now mounted. "Rejected by the system" is rendered
  // ONLY by OcrImportFlow's select step, so it cannot be confused with the
  // import page's own heading.
  await waitFor(() => expect(screen.getByText(/Rejected by the system/i)).toBeInTheDocument());

  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({});
  apiMock.post.mockResolvedValue({});
  apiMock.patch.mockResolvedValue({});
});

// ─── Invoice OCR ────────────────────────────────────────────────────────────

describe("Invoice import — REAL OCR route (B9DD-FR-003)", () => {
  it("switches into OCR mode, renders OcrImportFlow and drives useOcrImport", async () => {
    mockUpload({ batch: ocrBatch(), file: ocrFile(), row: ocrRow() });
    renderWithProviders(<InvoiceImportPage />);

    // The CSV wizard is what the page shows by default.
    expect(screen.queryByText(/Rejected by the system/i)).toBeNull();

    await enterOcrModeAndUpload(pdfFile());

    // useOcrImport really called the OCR upload route with multipart form data.
    await waitFor(() => expect(apiMock.rawFetch).toHaveBeenCalled());
    const [path, init] = apiMock.rawFetch.mock.calls[0];
    expect(path).toBe("/imports/ocr/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("import_type")).toBe("invoice");
    expect((init.body as FormData).get("file_type")).toBe("pdf");

    // The hook advanced to its review step, so the real review UI is rendered.
    await waitFor(() => expect(screen.getByText(/Review invoice fields/i)).toBeInTheDocument());
    expect(screen.getByText("scan.pdf")).toBeInTheDocument();
  });

  it("labels a PDF batch's origin from the authoritative envelope", async () => {
    mockUpload({ batch: ocrBatch({ file_type: "pdf" }), file: ocrFile(), row: ocrRow({ currency: "USD" }) });
    renderWithProviders(<InvoiceImportPage />);
    await enterOcrModeAndUpload(pdfFile());

    // import_type + file_type from the BATCH — not from the UI's local mode,
    // and not from mapped_data.
    await waitFor(() => expect(screen.getByText("OCR intake (PDF)")).toBeInTheDocument());
    expect(screen.getByText("USD")).toBeInTheDocument();
  });

  it("labels an image batch's origin as an image intake", async () => {
    mockUpload({
      batch: ocrBatch({ file_type: "image", file_name: "scan.png" }),
      file: ocrFile({ file_type: "image", file_name: "scan.png" }),
      row: ocrRow(),
    });
    renderWithProviders(<InvoiceImportPage />);
    await enterOcrModeAndUpload(pngFile("scan.png"));

    await waitFor(() => expect(screen.getByText("OCR intake (IMAGE)")).toBeInTheDocument());
  });

  it("shows the manual-fallback marker and low-confidence review state", async () => {
    mockUpload({ batch: ocrBatch(), file: ocrFile(), row: ocrRow({ currency: "MYR" }) });
    renderWithProviders(<InvoiceImportPage />);
    await enterOcrModeAndUpload(pdfFile());

    // The ONE mapped_data.source marker production actually writes.
    await waitFor(() => expect(screen.getByText(/Manual entry \(OCR disabled\)/i)).toBeInTheDocument());
    expect(screen.getByText(/Low OCR confidence/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Low confidence · review|Manual review required/i).length).toBeGreaterThan(0);
  });

  it("fabricates no pre-posting base amount or booked FX decision", async () => {
    mockUpload({
      batch: ocrBatch(),
      file: ocrFile(),
      row: ocrRow({ currency: "USD", total_amount: 100 }),
    });
    renderWithProviders(<InvoiceImportPage />);
    await enterOcrModeAndUpload(pdfFile());

    // FX is booked at POSTING; this channel never posts, so no base figure and
    // no booked rate may appear.
    await waitFor(() => expect(screen.getByText(/Base amount not booked yet/i)).toBeInTheDocument());
    expect(screen.getByText(/company base is MYR/i)).toBeInTheDocument();
    expect(screen.queryByText(/Booked base recorded/i)).toBeNull();
    expect(screen.queryByText("MYR 445.00")).toBeNull();
    // The draft-only guarantee is stated on screen.
    expect(screen.getAllByText(/does not post/i).length).toBeGreaterThan(0);
  });

  it("states 'Origin not available' rather than guessing when the envelope is absent", async () => {
    // A batch with no usable file_type — the origin is genuinely unknown.
    mockUpload({
      batch: ocrBatch({ file_type: undefined as unknown as ImportBatch["file_type"] }),
      file: ocrFile(),
      row: ocrRow(),
    });
    renderWithProviders(<InvoiceImportPage />);
    await enterOcrModeAndUpload(pdfFile());

    await waitFor(() => expect(screen.getByText("Origin not available")).toBeInTheDocument());
    expect(screen.queryByText(/OCR intake/)).toBeNull();
    expect(screen.queryByText(/CSV\/XLSX import/)).toBeNull();
  });
});

// ─── Receipt OCR ────────────────────────────────────────────────────────────

describe("Receipt import — REAL OCR route (B9DD-FR-003)", () => {
  it("switches into OCR mode and renders the real receipt OcrImportFlow", async () => {
    mockUpload({
      batch: ocrBatch({ import_type: "receipt", file_type: "image", file_name: "receipt.png" }),
      file: ocrFile({ file_type: "image", file_name: "receipt.png" }),
      row: ocrRow({ currency: "SGD", receipt_amount: 250.5 }),
    });
    renderWithProviders(<ReceiptImportPage />);
    await enterOcrModeAndUpload(pngFile());

    // The receipt variant of the real flow, driven by useOcrImport.
    const [, init] = apiMock.rawFetch.mock.calls[0];
    expect((init.body as FormData).get("import_type")).toBe("receipt");
    expect((init.body as FormData).get("file_type")).toBe("image");

    await waitFor(() => expect(screen.getByText(/Review receipt fields/i)).toBeInTheDocument());
    expect(screen.getByText("OCR intake (IMAGE)")).toBeInTheDocument();
    // The transaction currency is explicit; the amount carries its code.
    expect(screen.getByText("SGD 250.50")).toBeInTheDocument();
  });

  it("keeps receipt OCR intake free of allocation intent", async () => {
    mockUpload({
      batch: ocrBatch({ import_type: "receipt", file_type: "pdf" }),
      file: ocrFile(),
      row: ocrRow({ currency: "MYR" }),
    });
    renderWithProviders(<ReceiptImportPage />);
    await enterOcrModeAndUpload(pdfFile());

    await waitFor(() => expect(screen.getByText(/Review receipt fields/i)).toBeInTheDocument());
    // Intake-only: no allocation fields are offered in this channel.
    expect(screen.queryByLabelText(/invoice_reference/i)).toBeNull();
    expect(screen.queryByText(/allocation_amount/i)).toBeNull();
    expect(screen.getAllByText(/does not allocate/i).length).toBeGreaterThan(0);
    // No allocation endpoint is touched.
    expect(apiMock.post).not.toHaveBeenCalledWith(
      expect.stringContaining("/allocations"),
      expect.anything(),
    );
  });

  it("reports the receipt PDF origin from the batch envelope", async () => {
    mockUpload({
      batch: ocrBatch({ import_type: "receipt", file_type: "pdf" }),
      file: ocrFile(),
      row: ocrRow({ currency: "MYR" }),
    });
    renderWithProviders(<ReceiptImportPage />);
    await enterOcrModeAndUpload(pdfFile());

    await waitFor(() => expect(screen.getByText("OCR intake (PDF)")).toBeInTheDocument());
  });
});

// ─── Adversarial fixtures ───────────────────────────────────────────────────
//
// NOTE: the fixtures in this block are DELIBERATELY IMPOSSIBLE — production
// never writes these values into mapped_data. They exist only to prove the UI
// ignores them, and are labelled as adversarial/negative fixtures rather than
// presented as production truth (B9DD-FR-003 §5).

describe("OCR route — adversarial mapped_data (negative fixtures, B9DD-FR-003)", () => {
  it("ignores an impossible mapped_data.source and trusts the batch envelope", async () => {
    // `csv_xlsx_import` is built by importOriginPayload() at POSTING time for
    // the FX RPC (imports/service.ts ~299) and is NEVER written to mapped_data.
    // If a hostile or corrupted row carried it, the origin must still come from
    // the batch — which here is a PDF OCR intake.
    mockUpload({
      batch: ocrBatch({ import_type: "invoice", file_type: "pdf" }),
      file: ocrFile(),
      row: ocrRow({ source: "csv_xlsx_import", currency: "USD" }),
    });
    renderWithProviders(<InvoiceImportPage />);
    await enterOcrModeAndUpload(pdfFile());

    await waitFor(() => expect(screen.getByText("OCR intake (PDF)")).toBeInTheDocument());
    // The impossible value did not win, and did not produce a CSV label.
    expect(screen.queryByText(/CSV\/XLSX import/)).toBeNull();
    // It is also not treated as the manual-fallback marker.
    expect(screen.queryByText(/Manual entry \(OCR disabled\)/i)).toBeNull();
  });

  it("ignores a bare 'ocr' source, which production never emits", async () => {
    mockUpload({
      batch: ocrBatch({ import_type: "invoice", file_type: "image" }),
      file: ocrFile({ file_type: "image" }),
      row: ocrRow({ source: "ocr", currency: "USD" }),
    });
    renderWithProviders(<InvoiceImportPage />);
    await enterOcrModeAndUpload(pngFile());

    await waitFor(() => expect(screen.getByText("OCR intake (IMAGE)")).toBeInTheDocument());
    expect(screen.queryByText(/Manual entry \(OCR disabled\)/i)).toBeNull();
  });
});

// ─── CSV/XLSX must not regress ──────────────────────────────────────────────

describe("Import pages — CSV/XLSX channel is unaffected (B9DD-FR-003)", () => {
  it("starts in CSV mode and does not render the OCR flow", async () => {
    renderWithProviders(<InvoiceImportPage />);
    expect(screen.queryByText(/Rejected by the system/i)).toBeNull();
    expect(document.querySelector('input[type="file"][accept*=".pdf"]')).toBeNull();
    expect(apiMock.rawFetch).not.toHaveBeenCalled();
  });

  it("returns to the CSV wizard when the CSV control is re-selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceImportPage />);

    await user.click(screen.getByRole("button", { name: /PDF\/Image Import/i }));
    await waitFor(() => expect(screen.getByText(/Rejected by the system/i)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /CSV \/ Excel/i }));
    // The two channels are mutually exclusive.
    await waitFor(() => expect(screen.queryByText(/Rejected by the system/i)).toBeNull());
  });

  it("keeps the receipt CSV channel reachable alongside OCR mode", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptImportPage />);

    await user.click(screen.getByRole("button", { name: /PDF\/Image Import/i }));
    await waitFor(() =>
      expect(screen.getByText(/Receipt PDF\/Image Import is intake \/ review-draft only/i)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /CSV \/ Excel/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Receipt PDF\/Image Import is intake \/ review-draft only/i)).toBeNull(),
    );
  });
});

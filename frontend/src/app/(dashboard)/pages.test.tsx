// ============================================================================
// B9DD-FEIR-010 — representative PAGE integration coverage.
//
// These render real pages against contract-shaped API responses, mocking only
// the API / router / auth boundary.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  renderWithProviders,
  createFakeApi,
  route,
  routePrefix,
  invoiceFixture,
  receiptFixture,
  agingRowFixture,
  arSummaryFixture,
  collectionSummary,
  monetarySummary,
  currencyTotal,
  ANCHOR_BY_CURRENCY,
  ANCHOR_BASE_TOTAL,
  type FakeApi,
} from "@/test/harness";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({ baseCurrency: "MYR", isLoading: false, isUnavailable: false }),
}));

vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({ role: "AR Clerk", isLoading: false, email: "t@test", canPostInvoice: true, canCreateInvoice: true, canPostReceipt: true }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: "cust-1" }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import InvoiceListPage from "@/app/(dashboard)/invoices/page";
import InvoiceSummaryPage from "@/app/(dashboard)/reports/invoices/page";
import AgingReportPage from "@/app/(dashboard)/reports/aging/page";
import CustomerOutstandingPage from "@/app/(dashboard)/reports/outstanding/page";

const anchorSummary = collectionSummary(
  monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL, "MYR", "current_outstanding"),
  monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL, "MYR", "original_document_total", "original_booked_base_snapshot"),
);

beforeEach(() => vi.clearAllMocks());

// ─── Invoice list ───────────────────────────────────────────────────────────

describe("Invoice list page", () => {
  it("shows the authoritative collection summary and labels its scope, not the page's", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => ({
        data: [invoiceFixture()],
        meta: { total: 1001, page: 1, page_size: 15, summary: anchorSummary },
      })),
    ]);

    renderWithProviders(<InvoiceListPage />);
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    // Collection scope stated explicitly.
    expect(screen.getByText(/Totals for all 1001 matching document\(s\) — not just this page/i)).toBeInTheDocument();
    // MYR 545 anchor rendered from the backend base_total.
    expect(screen.getAllByText("MYR 545.00").length).toBeGreaterThan(0);
    // Native subtotals stay separate — no 200 native "total".
    expect(screen.queryByText("MYR 200.00")).toBeNull();
  });

  it("shows real pagination derived from backend metadata", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => ({
        data: [invoiceFixture()],
        meta: { total: 1001, page: 1, page_size: 15, summary: anchorSummary },
      })),
    ]);

    renderWithProviders(<InvoiceListPage />);
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    // ceil(1001 / 15) = 67 pages. The old code forced totalPages = 1.
    // React splits "{page} / {totalPages}" into separate text nodes, so assert
    // on the rendered footer text as a whole.
    const footer = screen.getByText(/of 1001 records/i).parentElement as HTMLElement;
    expect(footer.textContent).toMatch(/1–15 of 1001 records/);
    expect(footer.parentElement?.textContent).toContain("1 / 67");
  });

  it("renders each row amount with its explicit transaction currency", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => ({
        data: [invoiceFixture({ currency: "USD", total_amount: 100 })],
        meta: { total: 1, page: 1, page_size: 15, summary: anchorSummary },
      })),
    ]);
    renderWithProviders(<InvoiceListPage />);
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    expect(screen.getAllByText("USD").length).toBeGreaterThan(0);
  });

  it("shows an error state without inventing figures", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => {
        throw new Error("boom");
      }),
    ]);
    renderWithProviders(<InvoiceListPage />);
    await waitFor(() => expect(screen.getByText(/Failed to load invoices/i)).toBeInTheDocument());
  });
});

// ─── Invoice Summary report ─────────────────────────────────────────────────

describe("Invoice Summary report page", () => {
  it("renders authoritative per-currency subtotals and a separate company-base total", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => ({
        data: [invoiceFixture()],
        meta: { total: params.status ? 1 : 1001, page: 1, page_size: Number(params.page_size), summary: anchorSummary },
      })),
    ]);

    renderWithProviders(<InvoiceSummaryPage />);
    await waitFor(() => expect(screen.getByText("Invoice Summary")).toBeInTheDocument());

    // Full filtered collection size, from the backend — not a 100-row cap.
    await waitFor(() => expect(screen.getByText(/Server-side filter — 1001 invoice\(s\) in range/i)).toBeInTheDocument());
    // MYR 545 anchor present; native 200 sum never rendered as a total.
    expect(screen.getAllByText("MYR 545.00").length).toBeGreaterThan(0);
    // Both summary panels (Invoiced + Outstanding) carry the disclaimer.
    expect(screen.getAllByText(/not the sum of native subtotals/i).length).toBeGreaterThan(0);
  });

  it("labels percentages as count-based, not amount-based", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => ({
        data: [invoiceFixture()],
        meta: { total: params.status ? 1 : 4, page: 1, page_size: Number(params.page_size), summary: anchorSummary },
      })),
    ]);
    renderWithProviders(<InvoiceSummaryPage />);
    await waitFor(() => expect(screen.getByText(/% \(by count\)/i)).toBeInTheDocument());
  });
});

// ─── Aging report ───────────────────────────────────────────────────────────

describe("Aging report page", () => {
  it("shows the complete backend summary plus a native by_currency breakdown", async () => {
    fakeApi = createFakeApi([
      route("/reports/aging", () => ({ data: arSummaryFixture() })),
      route("/reports/aging/by-customer", () => ({
        data: [agingRowFixture()],
        meta: { total: 1, page: 1, page_size: 100 },
      })),
    ]);

    renderWithProviders(<AgingReportPage />);
    // The breadcrumb renders during loading too, so wait for real content.
    await waitFor(() => expect(screen.getByText(/Outstanding by transaction currency/i)).toBeInTheDocument());

    expect(screen.getByText(/Company-base total/i)).toBeInTheDocument();
    // 545 base total; natives shown separately with an explicit disclaimer.
    expect(screen.getAllByText("MYR 545.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/not the sum of the native subtotals/i)).toBeInTheDocument();
  });
});

// ─── Customer Outstanding report ────────────────────────────────────────────

describe("Customer Outstanding report page", () => {
  it("takes company totals from the aging SUMMARY, not from the visible page rows", async () => {
    fakeApi = createFakeApi([
      // The summary reports a far larger company total than the single page row.
      route("/reports/aging", () => ({ data: arSummaryFixture({ base_total: 9_999_999, total_overdue: 12_345 }) })),
      route("/reports/aging/by-customer", () => ({
        data: [agingRowFixture({ total_outstanding: 545 })],
        meta: { total: 250, page: 1, page_size: 100 },
      })),
    ]);

    renderWithProviders(<CustomerOutstandingPage />);
    await waitFor(() => expect(screen.getByText("MYR 9,999,999.00")).toBeInTheDocument());

    // Company totals come from the authoritative summary...
    expect(screen.getByText("MYR 12,345.00")).toBeInTheDocument();
    // ...and the customer count is the backend total (250), not rows.length (1).
    expect(screen.getByText("250")).toBeInTheDocument();
    expect(screen.getByText(/Totals cover all customers/i)).toBeInTheDocument();
  });

  it("shows the native currency breakdown for outstanding", async () => {
    fakeApi = createFakeApi([
      route("/reports/aging", () => ({
        data: arSummaryFixture({
          by_currency: [currencyTotal("SGD", 300, 960, 2), currencyTotal("USD", 100, 445, 1)],
        }),
      })),
      route("/reports/aging/by-customer", () => ({
        data: [agingRowFixture()],
        meta: { total: 1, page: 1, page_size: 100 },
      })),
    ]);

    renderWithProviders(<CustomerOutstandingPage />);
    await waitFor(() => expect(screen.getByText("SGD 300.00")).toBeInTheDocument());
    expect(screen.getByText("USD 100.00")).toBeInTheDocument();
  });
});

// ─── Receipt list (summary panel) ───────────────────────────────────────────

describe("Receipt list page", () => {
  it("renders the authoritative received/unapplied summaries", async () => {
    const ReceiptsPage = (await import("@/app/(dashboard)/receipts/page")).default;
    fakeApi = createFakeApi([
      route("/receipts", () => ({
        data: [receiptFixture()],
        meta: { total: 1, page: 1, page_size: 15, summary: anchorSummary },
      })),
      routePrefix("/customers", () => ({ data: [] })),
    ]);

    renderWithProviders(<ReceiptsPage />);
    await waitFor(() => expect(screen.getByText("RCP-0001")).toBeInTheDocument());
    expect(screen.getAllByText("MYR 545.00").length).toBeGreaterThan(0);
  });
});

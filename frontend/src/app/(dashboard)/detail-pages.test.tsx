// ============================================================================
// B9DD-RR-006 §9.2 — mandatory route coverage: Invoice detail, Receipt detail,
// Receipt report, and the Customer Statement ROUTE (not just StatementView).
//
// Each exercises real page composition against contract-shaped responses at the
// API/hook boundary. No network, no staging.
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
  collectionSummary,
  monetarySummary,
  fxDecision,
  ANCHOR_BY_CURRENCY,
  ANCHOR_BASE_TOTAL,
  type FakeApi,
} from "@/test/harness";
import type { CustomerStatement, Invoice, InvoiceLine } from "@/types";

let fakeApi: FakeApi;
const routeParams = { id: "inv-1" };

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

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
  useParams: () => routeParams,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import InvoiceDetailPage from "@/app/(dashboard)/invoices/[id]/page";
import ReceiptDetailPage from "@/app/(dashboard)/receipts/[id]/page";
import ReceiptSummaryPage from "@/app/(dashboard)/reports/receipts/page";
import StatementRoutePage from "@/app/(dashboard)/customers/[id]/statement/page";


/**
 * `GET /invoices/:id` returns `Invoice & { lines: InvoiceLine[] }`
 * (use-invoices.ts::useInvoice), so the detail fixture is typed to match.
 */
function invoiceDetailFixture(
  over: Partial<Invoice> = {},
  lines: InvoiceLine[] = [],
): Invoice & { lines: InvoiceLine[] } {
  return { ...invoiceFixture(over), lines };
}

/** Exactly the committed InvoiceLine contract — no invented fields. */
const widgetLine: InvoiceLine = {
  id: "l1",
  invoice_id: "inv-1",
  line_no: 1,
  description: "Widget",
  item_code: "W1",
  quantity: 1,
  uom: "EA",
  unit_price: 100,
  discount_pct: 0,
  discount_amt: 0,
  line_amount: 100,
  tax_code_id: null,
  tax_rate: 0,
  tax_amount: 0,
  line_total: 100,
  gl_account_id: null,
  cost_center: null,
  line_remarks: null,
};

beforeEach(() => vi.clearAllMocks());

// ─── Invoice detail ─────────────────────────────────────────────────────────

describe("Invoice detail page (B9DD-RR-006)", () => {
  beforeEach(() => {
    routeParams.id = "inv-1";
  });

  it("renders a posted USD invoice with an explicit currency and directed booked rate", async () => {
    fakeApi = createFakeApi([
      route("/invoices/inv-1", () => ({
        data: invoiceDetailFixture(
          {
            currency: "USD",
            total_amount: 100,
            outstanding: 100,
            exchange_rate: 4.45,
            status: "Open",
            base_currency: "MYR",
            base_total: 445,
            fx_decision: fxDecision({ booked_rate: 4.45, source_category: "CATALOG" }),
            fx_posting_eligibility: { gate: "fx_governance", eligible: false, reason: "blocked" },
          },
          [widgetLine],
        ),
      })),
      routePrefix("/", () => ({ data: [] })),
    ]);

    renderWithProviders(<InvoiceDetailPage />);
    await waitFor(() => expect(screen.getAllByText("INV-0001").length).toBeGreaterThan(0));

    // Transaction amount with explicit currency.
    expect(screen.getAllByText(/USD 100\.00/).length).toBeGreaterThan(0);
    // Booked base, labelled with the real base currency.
    expect(screen.getAllByText(/MYR 445\.00/).length).toBeGreaterThan(0);
    // Directed rate: 1 USD = 4.4500 MYR (base = transaction x rate, migration 027).
    expect(screen.getAllByText(/1 USD = 4\.4500 MYR/).length).toBeGreaterThan(0);
    // The inverse direction must never appear.
    expect(screen.queryByText(/1 MYR = 4\.4500 USD/)).toBeNull();
    // It is presented as the BOOKED snapshot, not a live rate.
    expect(screen.getAllByText(/Booked rate/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Blocked$/i)).toBeNull();
  });

  it("names the transaction currency on every monetary line column", async () => {
    fakeApi = createFakeApi([
      route("/invoices/inv-1", () => ({
        data: invoiceDetailFixture({ currency: "USD" }, [widgetLine]),
      })),
      routePrefix("/", () => ({ data: [] })),
    ]);
    renderWithProviders(<InvoiceDetailPage />);
    await waitFor(() => expect(screen.getAllByText("INV-0001").length).toBeGreaterThan(0));

    // B9DD-RR-004: line cells use formatAmount, so the HEADER must carry the code.
    expect(screen.getByText(/Unit Price \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText(/Line Total \(USD\)/)).toBeInTheDocument();
  });

  it("shows an error state without inventing figures", async () => {
    fakeApi = createFakeApi([
      route("/invoices/inv-1", () => {
        throw new Error("boom");
      }),
      routePrefix("/", () => ({ data: [] })),
    ]);
    renderWithProviders(<InvoiceDetailPage />);
    await waitFor(() => expect(screen.getByText(/not found|failed|error/i)).toBeInTheDocument());
  });
});

// ─── Receipt detail ─────────────────────────────────────────────────────────

describe("Receipt detail page (B9DD-RR-006)", () => {
  beforeEach(() => {
    routeParams.id = "rcp-1";
  });

  it("renders applied/unapplied with the receipt's own currency", async () => {
    fakeApi = createFakeApi([
      route("/receipts/rcp-1", () => ({
        data: receiptFixture({
          currency: "USD",
          receipt_amount: 100,
          allocated_amount: 60,
          unallocated_amount: 40,
          status: "Posted",
          base_currency: "MYR",
          base_amount: 445,
          exchange_rate: 4.45,
          fx_decision: fxDecision({ booked_rate: 4.45 }),
          fx_posting_eligibility: { gate: "fx_governance", eligible: false, reason: "blocked" },
        }),
      })),
      routePrefix("/", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20 } })),
    ]);

    renderWithProviders(<ReceiptDetailPage />);
    await waitFor(() => expect(screen.getAllByText("RCP-0001").length).toBeGreaterThan(0));

    // B9DD-RR-004: these two were codeless before.
    expect(screen.getByText(/Applied: USD 60\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Unapplied: USD 40\.00/)).toBeInTheDocument();
    expect(screen.getAllByText(/Booked rate/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Blocked$/i)).toBeNull();
  });

  it("labels the booked base amount with the real base currency", async () => {
    fakeApi = createFakeApi([
      route("/receipts/rcp-1", () => ({
        data: receiptFixture({
          currency: "USD",
          receipt_amount: 100,
          status: "Posted",
          base_currency: "MYR",
          base_amount: 445,
          exchange_rate: 4.45,
          fx_decision: fxDecision({ booked_rate: 4.45 }),
        }),
      })),
      routePrefix("/", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20 } })),
    ]);
    renderWithProviders(<ReceiptDetailPage />);
    await waitFor(() => expect(screen.getAllByText("RCP-0001").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/MYR 445\.00/).length).toBeGreaterThan(0);
  });
});

// ─── Receipt report ─────────────────────────────────────────────────────────

describe("Receipt report page (B9DD-RR-006)", () => {
  it("renders authoritative collection totals and never sums the page rows", async () => {
    const anchor = collectionSummary(
      monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL, "MYR", "current_outstanding"),
      monetarySummary(
        ANCHOR_BY_CURRENCY,
        ANCHOR_BASE_TOTAL,
        "MYR",
        "original_document_total",
        "original_booked_base_snapshot",
      ),
    );
    fakeApi = createFakeApi([
      route("/receipts", (params) => ({
        data: [receiptFixture()],
        // A 1,001-row collection summarised exactly from ONE tiny request.
        meta: { total: 1001, page: 1, page_size: Number(params.page_size), summary: anchor },
      })),
    ]);

    renderWithProviders(<ReceiptSummaryPage />);
    await waitFor(() => expect(screen.getAllByText(/MYR 545\.00/).length).toBeGreaterThan(0));

    // The native sum (200) is never presented as a total.
    expect(screen.queryByText("MYR 200.00")).toBeNull();
    // Every request stayed within the backend page limit.
    for (const call of fakeApi.calls) {
      expect(Number(call.params.page_size)).toBeLessThanOrEqual(100);
    }
  });

  it("pushes the date range to the server", async () => {
    fakeApi = createFakeApi([
      route("/receipts", (params) => ({
        data: [receiptFixture()],
        meta: {
          total: 1,
          page: 1,
          page_size: Number(params.page_size),
          summary: collectionSummary(
            monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL, "MYR"),
            monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL, "MYR"),
          ),
        },
      })),
    ]);
    renderWithProviders(<ReceiptSummaryPage />);
    await waitFor(() => expect(fakeApi.calls.length).toBeGreaterThan(0));
    expect(fakeApi.calls.some((c) => "date_from" in c.params && "date_to" in c.params)).toBe(true);
  });
});

// ─── Customer Statement ROUTE + hook composition ────────────────────────────

describe("Customer Statement route (B9DD-RR-006 §9.2)", () => {
  beforeEach(() => {
    routeParams.id = "cust-1";
  });

  /** Contract-shaped: mirrors `GET /reports/statement/:id` exactly. */
  const singleCurrencyStatement: CustomerStatement = {
    customer_id: "cust-1",
    customer_name: "Acme Sdn Bhd",
    customer_code: "CUST-001",
    address: "1 Jalan Test, KL",
    period_from: "2026-07-01",
    period_to: "2026-07-31",
    opening_balance: 0,
    lines: [
      {
        date: "2026-07-05",
        doc_type: "Invoice",
        doc_no: "INV-0001",
        description: "Consulting",
        currency: "MYR",
        exchange_rate: 1,
        transaction_debit: 300,
        transaction_credit: 0,
        transaction_balance: 300,
        debit: 300,
        credit: 0,
        balance: 300,
        base_currency: "MYR",
        base_debit: 300,
        base_credit: 0,
        base_balance: 300,
        amount_basis: "stored_booked_base_snapshot",
      },
    ],
    closing_balance: 300,
    total_debit: 300,
    total_credit: 0,
    base_currency: "MYR",
    opening_balance_base: 0,
    closing_balance_base: 300,
    total_debit_base: 300,
    total_credit_base: 0,
    by_currency: [{ currency: "MYR", opening_balance: 0, total_debit: 300, total_credit: 0, closing_balance: 300 }],
    meta: { base_currency: "MYR", multi_currency: false, normalization_basis: "stored_booked_base_snapshot" },
    legacy_amount_basis: "transaction_currency_legacy",
    legacy_transaction_fields_valid: true,
    legacy_transaction_currency: "MYR",
  };

  it("fetches the statement for the routed customer with the period range", async () => {
    fakeApi = createFakeApi([
      route("/reports/statement/cust-1", () => ({ data: singleCurrencyStatement })),
    ]);
    renderWithProviders(<StatementRoutePage />);
    await waitFor(() => expect(screen.getAllByText(/Acme/).length).toBeGreaterThan(0));

    const call = fakeApi.calls.find((c) => c.path === "/reports/statement/cust-1");
    expect(call).toBeDefined();
    expect(call?.params.period_from).toBeTruthy();
    expect(call?.params.period_to).toBeTruthy();
  });

  it("renders authoritative base totals from the route", async () => {
    fakeApi = createFakeApi([
      route("/reports/statement/cust-1", () => ({ data: singleCurrencyStatement })),
    ]);
    renderWithProviders(<StatementRoutePage />);
    await waitFor(() => expect(screen.getAllByText(/MYR 300\.00/).length).toBeGreaterThan(0));
    expect(screen.getAllByText("INV-0001").length).toBeGreaterThan(0);
  });

  it("marks mixed-currency movements as n/a rather than substituting the base balance", async () => {
    // The backend nulls transaction_balance/closing_balance when the period
    // spans >1 currency (legacy_transaction_fields_valid = false).
    fakeApi = createFakeApi([
      route("/reports/statement/cust-1", () => ({
        data: {
          ...singleCurrencyStatement,
          opening_balance: null,
          closing_balance: null,
          total_debit: null,
          total_credit: null,
          legacy_transaction_fields_valid: false,
          legacy_transaction_currency: null,
          meta: { base_currency: "MYR", multi_currency: true, normalization_basis: "stored_booked_base_snapshot" },
          by_currency: [
            { currency: "MYR", opening_balance: 0, total_debit: 100, total_credit: 0, closing_balance: 100 },
            { currency: "USD", opening_balance: 0, total_debit: 100, total_credit: 0, closing_balance: 100 },
          ],
          lines: [
            { ...singleCurrencyStatement.lines[0], transaction_balance: null, balance: null },
          ],
        } satisfies CustomerStatement,
      })),
    ]);
    renderWithProviders(<StatementRoutePage />);
    await waitFor(() => expect(screen.getAllByText(/Acme/).length).toBeGreaterThan(0));

    // The legacy single-currency balance is NOT substituted with the base one.
    expect(screen.getAllByText(/n\/a — mixed currency/i).length).toBeGreaterThan(0);
    // The company-base closing balance remains authoritative and is shown.
    expect(screen.getAllByText(/MYR 300\.00/).length).toBeGreaterThan(0);
  });

  it("shows a safe error state", async () => {
    fakeApi = createFakeApi([
      route("/reports/statement/cust-1", () => {
        throw new Error("statement unavailable");
      }),
    ]);
    renderWithProviders(<StatementRoutePage />);
    await waitFor(() => expect(screen.getByText(/unavailable|failed|not found/i)).toBeInTheDocument());
  });
});

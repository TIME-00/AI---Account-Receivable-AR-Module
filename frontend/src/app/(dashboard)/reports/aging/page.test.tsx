// ============================================================================
// B9DD-RR-001 — Aging report: server pagination of the customer table, with the
// company summary staying complete and page-independent.
//
// The pre-remediation page fetched ONE default page of up to 100 customer rows
// and exposed no pagination at all. Each test below fails against that source.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  createFakeApi,
  route,
  agingRowFixture,
  arSummaryFixture,
  type FakeApi,
} from "@/test/harness";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/reports/aging",
}));

import AgingReportPage from "@/app/(dashboard)/reports/aging/page";

/** 101+ customers spread across server pages of 25. */
const TOTAL_CUSTOMERS = 101;

function pageOfRows(page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, TOTAL_CUSTOMERS);
  return Array.from({ length: Math.max(0, end - start) }, (_, i) =>
    agingRowFixture({
      customer_id: `cust-${start + i + 1}`,
      customer_name: `Customer ${start + i + 1}`,
      total_outstanding: 100 + start + i,
    }),
  );
}

/** Company summary is deliberately far larger than any page's rows. */
const COMPANY_SUMMARY = arSummaryFixture({ base_total: 9_999_999, total_outstanding: 9_999_999 });

function apiWithPages() {
  return createFakeApi([
    route("/reports/aging", () => ({ data: COMPANY_SUMMARY })),
    route("/reports/aging/by-customer", (params) => {
      const page = Number(params.page ?? 1);
      const pageSize = Number(params.page_size ?? 25);
      return {
        data: pageOfRows(page, pageSize),
        meta: { total: TOTAL_CUSTOMERS, page, page_size: pageSize },
      };
    }),
  ]);
}

const agingCalls = () => fakeApi.calls.filter((c) => c.path === "/reports/aging/by-customer");

beforeEach(() => {
  vi.clearAllMocks();
  fakeApi = apiWithPages();
});

describe("Aging report — server pagination (B9DD-RR-001)", () => {
  it("paginates 101 customer rows instead of showing only the first page", async () => {
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    // ceil(101 / 25) = 5 pages. The old page had no pagination at all.
    expect(screen.getByText(/Page 1 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText(/Showing customers 1–25 of 101/)).toBeInTheDocument();
    // Only the page's rows are rendered.
    expect(screen.queryByText("Customer 26")).toBeNull();
  });

  it("never requests a page_size above the backend maximum", async () => {
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(agingCalls().length).toBeGreaterThan(0));
    for (const call of agingCalls()) {
      expect(Number(call.params.page_size)).toBeLessThanOrEqual(100);
    }
  });

  it("requests the correct server page when navigating to page 2", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Next/i }));

    await waitFor(() => expect(screen.getByText("Customer 26")).toBeInTheDocument());
    // The request actually carried page=2 — not a client-side slice.
    expect(agingCalls().some((c) => Number(c.params.page) === 2)).toBe(true);
    expect(screen.getByText(/Page 2 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText(/Showing customers 26–50 of 101/)).toBeInTheDocument();
    expect(screen.queryByText("Customer 1")).toBeNull();
  });

  it("keeps the complete company summary unchanged between pages", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    // Company total is the authoritative summary figure, not the sum of rows.
    expect(screen.getAllByText("MYR 9,999,999.00").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => expect(screen.getByText("Customer 26")).toBeInTheDocument());

    // Identical after paging — it is page-independent.
    expect(screen.getAllByText("MYR 9,999,999.00").length).toBeGreaterThan(0);
    // The summary endpoint was not refetched per page.
    expect(fakeApi.calls.filter((c) => c.path === "/reports/aging").length).toBe(1);
  });

  it("does not compute company totals from the current page's rows", async () => {
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    // Page rows sum to ~2,800; the company total must remain 9,999,999.
    const pageSum = pageOfRows(1, 25).reduce((s, r) => s + r.total_outstanding, 0);
    expect(screen.queryByText(`MYR ${pageSum.toLocaleString("en-US")}.00`)).toBeNull();
    expect(screen.getAllByText("MYR 9,999,999.00").length).toBeGreaterThan(0);
  });

  it("labels the summary as complete and the table as the current page", async () => {
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    expect(screen.getByText(/complete authorized/i)).toBeInTheDocument();
    expect(
      screen.getByText(/current page of customer aging rows, not the whole report/i),
    ).toBeInTheDocument();
  });

  it("states that search applies only to the current page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    expect(
      screen.getByText(/apply to the current page only — they do not search the whole report/i),
    ).toBeInTheDocument();

    // Filtering does not silently claim to have searched the report.
    await user.type(screen.getByLabelText(/Filter customers on this page/i), "Customer 7");
    await waitFor(() => expect(screen.queryByText("Customer 1")).toBeNull());
    expect(screen.getByText("Customer 7")).toBeInTheDocument();
    // No filter request was sent — the backend exposes none for this report.
    expect(agingCalls().every((c) => !("search" in c.params))).toBe(true);
  });

  it("keeps native by_currency and company-base totals separate", async () => {
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    expect(screen.getByText(/Outstanding by transaction currency/i)).toBeInTheDocument();
    const baseCard = screen.getByText(/Company-base total/i).parentElement as HTMLElement;
    expect(within(baseCard).getByText(/not the sum of the native subtotals/i)).toBeInTheDocument();
  });

  it("shows a safe empty state with no pagination controls", async () => {
    fakeApi = createFakeApi([
      route("/reports/aging", () => ({ data: arSummaryFixture({ base_total: 0, by_currency: [] }) })),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 25 } })),
    ]);
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText(/No aging data available/i)).toBeInTheDocument());

    expect(screen.getByText(/No customers with outstanding exposure/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next/i })).toBeNull();
  });

  it("shows an error state without inventing figures", async () => {
    fakeApi = createFakeApi([
      route("/reports/aging", () => ({ data: arSummaryFixture() })),
      route("/reports/aging/by-customer", () => {
        throw new Error("aging rows unavailable");
      }),
    ]);
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText(/Failed to load aging data/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Next/i })).toBeNull();
  });
});

// ============================================================================
// B9DD-RR-006 §9.2 — Dashboard page composition at the API boundary.
//
// The dashboard renders company-BASE amounts (`*_base`, meta.base_currency).
// It must label them with the real base currency and never assume MYR.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createDeferred,
  renderWithProviders,
  createFakeApi,
  route,
  customerFixture,
  type FakeApi,
} from "@/test/harness";
import type { LiveDashboardMetrics } from "@/types";
import { useCompanyStore } from "@/stores/company-store";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({
    data: { user: { id: "user-1", email: "test@example.invalid" } },
    isSuccess: true,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

// Recharts needs layout; give its ResponsiveContainer a deterministic size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 400 }}>{children}</div>
    ),
  };
});

import DashboardPage from "@/app/(dashboard)/page";

/** An SGD-base company — so an assumed "MYR" would be visibly wrong. */
function metricsFixture(over: Partial<LiveDashboardMetrics> = {}): LiveDashboardMetrics {
  return {
    meta: {
      company_id: "co-1",
      base_currency: "SGD",
      as_of_date: "2026-07-16",
      calculated_at: "2026-07-16T02:00:00Z",
      scope: "company",
      trend_months: 6,
    },
    kpis: {
      total_outstanding_ar: 545,
      overdue_outstanding: 120,
      overdue_invoice_count: 2,
      unapplied_cash: 80,
      current_month_collections: 900,
      current_month_posted_invoices: 5,
      import_rows_needing_review: 1,
    },
    invoice_status_counts: { open: 3, partially_paid: 1, overdue_status: 2, paid: 4, unpaid_total: 6 },
    aging_buckets: [
      { key: "current", label: "Current", invoice_count: 1, outstanding_base: 425, percentage: 78 },
      { key: "1_30", label: "1-30", invoice_count: 1, outstanding_base: 120, percentage: 22 },
    ],
    collection_trend: [{ month: "2026-07", collected_base: 900, receipt_count: 3 }],
    top_outstanding_customers: [
      {
        customer_id: "cust-1",
        customer_code: "C0001",
        customer_name: "Acme",
        outstanding_base: 545,
        overdue_base: 120,
        overdue_invoice_count: 2,
      },
    ],
    credit_rating_distribution: [{ rating: "A", customer_count: 1, outstanding_base: 545 }],
    customer_credit_rating_distribution: {
      population: "VISIBLE_CUSTOMERS",
      included_statuses: ["Active", "Inactive", "Blocked", "On Hold"],
      rows: [
        { rating: "AAA", customer_count: 0 },
        { rating: "AA", customer_count: 0 },
        { rating: "A", customer_count: 1 },
        { rating: "B", customer_count: 0 },
        { rating: "C", customer_count: 0 },
        { rating: "D", customer_count: 0 },
      ],
    },
    total_invoices: 10,
    ...over,
  } as LiveDashboardMetrics;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCompanyStore.getState().setCompany("co-1", "Company One", "SGD");
  fakeApi = createFakeApi([route("/reports/dashboard", () => ({ data: metricsFixture() }))]);
});

describe("Dashboard page (B9DD-RR-006)", () => {
  it("does not retain one company's cached dashboard metrics after a company switch", async () => {
    const secondCompany = createDeferred<{ data: LiveDashboardMetrics }>();
    let calls = 0;
    fakeApi = createFakeApi([
      route("/reports/dashboard", () => {
        calls += 1;
        return calls === 1
          ? { data: metricsFixture() }
          : secondCompany.promise;
      }),
    ]);

    renderWithProviders(<DashboardPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/SGD 545\.00/).length).toBeGreaterThan(0),
    );

    act(() => {
      useCompanyStore.getState().setCompany("co-2", "Company Two", "MYR");
    });
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.queryByText(/SGD 545\.00/)).toBeNull();

    await act(async () => {
      secondCompany.resolve({
        data: metricsFixture({
          meta: {
            ...metricsFixture().meta,
            company_id: "co-2",
            base_currency: "MYR",
          },
          kpis: {
            ...metricsFixture().kpis,
            total_outstanding_ar: 777,
          },
        }),
      });
    });
    await waitFor(() =>
      expect(screen.getAllByText(/MYR 777\.00/).length).toBeGreaterThan(0),
    );
  });

  it("labels base KPIs with the company's REAL base currency, not MYR", async () => {
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getAllByText(/SGD 545\.00/).length).toBeGreaterThan(0));
    // An assumed MYR would render "MYR 545.00" — it must not appear anywhere.
    expect(screen.queryByText(/MYR/)).toBeNull();
  });

  it("renders overdue and unapplied cash in the base currency", async () => {
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getAllByText(/SGD 120\.00/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/SGD 80\.00/).length).toBeGreaterThan(0);
  });

  it("requests the dashboard contract with the trend window", async () => {
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(fakeApi.calls.length).toBeGreaterThan(0));
    const call = fakeApi.calls.find((c) => c.path === "/reports/dashboard");
    expect(call).toBeDefined();
    expect(Number(call?.params.trend_months)).toBe(6);
  });

  it("shows an error state without inventing figures", async () => {
    fakeApi = createFakeApi([
      route("/reports/dashboard", () => {
        throw new Error("dashboard unavailable");
      }),
    ]);
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getByText(/unavailable|failed|error/i)).toBeInTheDocument());
    expect(screen.queryByText(/MYR/)).toBeNull();
  });

  it("opens the all-visible customer dialog instead of navigating directly", async () => {
    fakeApi = createFakeApi([
      route("/reports/dashboard", () => ({ data: metricsFixture() })),
      route("/customers", () => ({
        data: [
          customerFixture({
            customer_name: "Zero Balance Customer",
            credit_rating: "A",
          }),
        ],
        meta: { total: 1, page: 1, page_size: 25 },
      })),
    ]);
    renderWithProviders(<DashboardPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "View customers rated A" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Customers rated A" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Zero Balance Customer")).toBeInTheDocument();
    expect(
      screen.getAllByText(/including customers with no outstanding balance/i)
        .length,
    ).toBeGreaterThan(0);
    const call = fakeApi.calls.find((entry) => entry.path === "/customers");
    expect(call?.params).toEqual({
      credit_rating: "A",
      page: 1,
      page_size: 25,
    });
  });

  it("performs one synchronized refetch when counts first mismatch", async () => {
    let dashboardCalls = 0;
    let customerCalls = 0;
    fakeApi = createFakeApi([
      route("/reports/dashboard", () => {
        dashboardCalls += 1;
        return {
          data: metricsFixture({
            customer_credit_rating_distribution: {
              ...metricsFixture().customer_credit_rating_distribution,
              rows: metricsFixture().customer_credit_rating_distribution.rows.map(
                (row) =>
                  row.rating === "A"
                    ? {
                        ...row,
                        customer_count: dashboardCalls === 1 ? 1 : 2,
                      }
                    : row,
              ),
            },
          }),
        };
      }),
      route("/customers", () => {
        customerCalls += 1;
        return {
          data: [
            customerFixture({ id: "c-1" }),
            customerFixture({ id: "c-2", customer_id: "C0002" }),
          ],
          meta: { total: 2, page: 1, page_size: 25 },
        };
      }),
    ]);
    renderWithProviders(<DashboardPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "View customers rated A" }),
    );

    await waitFor(() => expect(dashboardCalls).toBe(2));
    await waitFor(() => expect(customerCalls).toBe(2));
    expect(
      screen.queryByText(/refresh to view the latest list/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2 matching customers")).toBeInTheDocument();
  });

  it("stops after a persistent mismatch and allows one manual cycle", async () => {
    let dashboardCalls = 0;
    let customerCalls = 0;
    fakeApi = createFakeApi([
      route("/reports/dashboard", () => {
        dashboardCalls += 1;
        return { data: metricsFixture() };
      }),
      route("/customers", () => {
        customerCalls += 1;
        return {
          data: [
            customerFixture({ id: "c-1" }),
            customerFixture({ id: "c-2", customer_id: "C0002" }),
          ],
          meta: { total: 2, page: 1, page_size: 25 },
        };
      }),
    ]);
    renderWithProviders(<DashboardPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "View customers rated A" }),
    );
    expect(
      await screen.findByText(
        "Customer data changed. Refresh to view the latest list.",
      ),
    ).toBeInTheDocument();
    expect(dashboardCalls).toBe(2);
    expect(customerCalls).toBe(2);

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(dashboardCalls).toBe(3));
    await waitFor(() => expect(customerCalls).toBe(3));
    expect(
      screen.getByText("Customer data changed. Refresh to view the latest list."),
    ).toBeInTheDocument();
  });
});

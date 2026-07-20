// ============================================================================
// B9DD-RR-006 §9.2 — Dashboard page composition at the API boundary.
//
// The dashboard renders company-BASE amounts (`*_base`, meta.base_currency).
// It must label them with the real base currency and never assume MYR.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, createFakeApi, route, type FakeApi } from "@/test/harness";
import type { LiveDashboardMetrics } from "@/types";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

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
    total_invoices: 10,
    ...over,
  } as LiveDashboardMetrics;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeApi = createFakeApi([route("/reports/dashboard", () => ({ data: metricsFixture() }))]);
});

describe("Dashboard page (B9DD-RR-006)", () => {
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
});

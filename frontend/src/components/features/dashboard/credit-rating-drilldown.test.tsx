// ============================================================================
// Gate B — Dashboard credit-rating drill-down tests (chart controls + aging
// page rating filter authority, reconciliation and clear behaviour).
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
import { CreditRiskChart } from "@/components/features/dashboard/credit-risk-chart";
import { useCompanyStore } from "@/stores/company-store";

// ── Router / search-param controls (mutable per test) ────────────────────────
let searchParamsValue: URLSearchParams;
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => searchParamsValue,
  usePathname: () => "/reports/aging",
}));

let fakeApi: FakeApi;
vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({
    data: { user: { id: "user-1", email: null } },
  }),
}));

// recharts' ResponsiveContainer relies on ResizeObserver, absent in jsdom.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 400 }}>{children}</div>
    ),
  };
});

import AgingReportPage from "@/app/(dashboard)/reports/aging/page";

const RATINGS = ["AAA", "AA", "A", "B", "C", "D"] as const;

const chartData = RATINGS.map((rating, i) => ({
  rating,
  count: i + 1,
  amount: (i + 1) * 1000,
  fill: "#000000",
}));

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsValue = new URLSearchParams();
  useCompanyStore.getState().setCompany("co-1", "Company One", "MYR");
});

describe("CreditRiskChart drill-down controls", () => {
  it("exposes a keyboard- and pointer-activatable control for every supported rating", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <CreditRiskChart data={chartData} currency="MYR" onSelectRating={onSelect} />,
    );
    const group = screen.getByRole("group", { name: /drill down by credit rating/i });

    for (const rating of RATINGS) {
      const btn = within(group).getByRole("button", {
        name: new RegExp(`credit rating ${rating}\\b`, "i"),
      });
      expect(btn).toBeInTheDocument();
    }

    // pointer
    await userEvent.click(
      within(group).getByRole("button", { name: /credit rating A\b/i }),
    );
    expect(onSelect).toHaveBeenCalledWith("A");

    // keyboard (Enter activates a focused native button)
    const dButton = within(group).getByRole("button", { name: /credit rating D\b/i });
    dButton.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("D");

    const aaButton = within(group).getByRole("button", {
      name: /credit rating AA\b/i,
    });
    aaButton.focus();
    await userEvent.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("AA");
  });

  it("marks the active rating with a pressed state (not colour alone)", () => {
    renderWithProviders(
      <CreditRiskChart
        data={chartData}
        currency="MYR"
        onSelectRating={vi.fn()}
        activeRating="B"
      />,
    );
    const active = screen.getByRole("button", { name: /credit rating B\b/i });
    expect(active).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Aging page — credit-rating filter authority", () => {
  function apiForRating(expectedTotal: number, rows: number) {
    return createFakeApi([
      route("/reports/aging", () => ({ data: arSummaryFixture() })),
      route("/reports/aging/by-customer", (params) => ({
        data: Array.from({ length: rows }, (_, i) =>
          agingRowFixture({ customer_id: `c-${i}`, customer_name: `Rated Customer ${i}`, credit_rating: "A" }),
        ),
        meta: { total: expectedTotal, page: Number(params.page ?? 1), page_size: Number(params.page_size ?? 25) },
      })),
    ]);
  }

  it("sends credit_rating to the server and shows the active-rating chip", async () => {
    searchParamsValue = new URLSearchParams("credit_rating=A");
    fakeApi = apiForRating(2, 2);
    renderWithProviders(<AgingReportPage />);

    await waitFor(() => expect(screen.getByText("Rated Customer 0")).toBeInTheDocument());
    const call = fakeApi.calls.find((c) => c.path === "/reports/aging/by-customer");
    expect(call?.params.credit_rating).toBe("A");
    expect(screen.getByText(/credit rating: A/i)).toBeInTheDocument();
    // reconciliation wording references the authoritative rating-filtered total
    expect(screen.getByText(/reconciles with the dashboard credit-rating distribution/i)).toBeInTheDocument();
  });

  it("fails closed without requesting rows for an unknown rating", async () => {
    searchParamsValue = new URLSearchParams("credit_rating=ZZZ");
    fakeApi = apiForRating(5, 5);
    renderWithProviders(<AgingReportPage />);
    await waitFor(() =>
      expect(screen.getByText(/invalid credit rating filter/i)).toBeInTheDocument(),
    );
    expect(
      fakeApi.calls.find((c) => c.path === "/reports/aging/by-customer"),
    ).toBeUndefined();
    expect(screen.queryByText("Rated Customer 0")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /clear invalid filter/i }),
    );
    expect(routerPush).toHaveBeenCalledWith("/reports/aging");
  });

  it("clears the rating filter by navigating back to the unfiltered report", async () => {
    searchParamsValue = new URLSearchParams("credit_rating=A");
    fakeApi = apiForRating(2, 2);
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText(/credit rating: A/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /clear credit rating filter/i }));
    expect(routerPush).toHaveBeenCalledWith("/reports/aging");
  });

  it("shows a controlled empty state when a rating has no outstanding customers", async () => {
    searchParamsValue = new URLSearchParams("credit_rating=D");
    fakeApi = createFakeApi([
      route("/reports/aging", () => ({ data: arSummaryFixture() })),
      route("/reports/aging/by-customer", (params) => ({
        data: [],
        meta: { total: 0, page: Number(params.page ?? 1), page_size: 25 },
      })),
    ]);
    renderWithProviders(<AgingReportPage />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/no outstanding customers with credit rating D/i).length,
      ).toBeGreaterThan(0),
    );
  });

  it("does not retain one company's rating rows after a company switch", async () => {
    searchParamsValue = new URLSearchParams("credit_rating=A");
    let customerName = "Company One Customer";
    fakeApi = createFakeApi([
      route("/reports/aging", () => ({ data: arSummaryFixture() })),
      route("/reports/aging/by-customer", (params) => ({
        data: [
          agingRowFixture({
            customer_id: customerName.startsWith("Company One") ? "c-1" : "c-2",
            customer_name: customerName,
            credit_rating: "A",
          }),
        ],
        meta: {
          total: 1,
          page: Number(params.page ?? 1),
          page_size: Number(params.page_size ?? 25),
        },
      })),
    ]);
    renderWithProviders(<AgingReportPage />);
    await waitFor(() =>
      expect(screen.getByText("Company One Customer")).toBeInTheDocument(),
    );

    customerName = "Company Two Customer";
    useCompanyStore.getState().setCompany("co-2", "Company Two", "SGD");
    await waitFor(() =>
      expect(screen.getByText("Company Two Customer")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Company One Customer")).not.toBeInTheDocument();
  });
});

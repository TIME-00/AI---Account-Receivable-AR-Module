// ============================================================================
// B9DD-RR-002 — Customer list & detail authority.
//
// Pre-remediation behaviour these tests pin down:
//   • useAllCustomers fetched page 1 (page_size=100) and called it "all";
//   • the list joined Customer page 1 with Aging page 1 and rendered
//     `outstandingMap.get(c.id) ?? 0` — a FALSE ZERO for anyone off aging p1;
//   • detail located the customer inside that capped list, so a valid customer
//     beyond the first 100 rendered a FALSE "Customer not found".
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  createFakeApi,
  createDeferred,
  route,
  routePrefix,
  agingRowFixture,
  currencyTotal,
  type FakeApi,
  type FakeResponse,
} from "@/test/harness";
import { ApiError } from "@/hooks/use-api";
import type { Customer } from "@/types";

let fakeApi: FakeApi;
const currentCustomerId = { id: "cust-150" };

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({ baseCurrency: "MYR", isLoading: false, isUnavailable: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: currentCustomerId.id }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/customers",
}));

import CustomersPage from "@/app/(dashboard)/customers/page";
import CustomerDetailPage from "@/app/(dashboard)/customers/[id]/page";

// 250 customers — well beyond the old 100-row cap.
const TOTAL_CUSTOMERS = 250;

function customerFixture(n: number, over: Partial<Customer> = {}): Customer {
  return {
    id: `cust-${n}`,
    customer_id: `C${String(n).padStart(4, "0")}`,
    customer_name: `Customer ${n}`,
    short_name: `C${n}`,
    customer_type: "Corporate",
    status: "Active",
    credit_rating: "A",
    credit_limit: 100000,
    default_currency: "MYR",
    payment_terms: "Net 30",
    contact_email: `c${n}@test.example`,
    contact_phone: "+60123456789",
    bill_country: "MY",
    is_hidden: false,
    is_deleted: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Customer;
}

function customerPage(page: number, pageSize: number): Customer[] {
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, TOTAL_CUSTOMERS);
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => customerFixture(start + i + 1));
}

const customersRoute = () =>
  route("/customers", (params) => {
    const page = Number(params.page ?? 1);
    const pageSize = Number(params.page_size ?? 25);
    return {
      data: customerPage(page, pageSize),
      meta: { total: TOTAL_CUSTOMERS, page, page_size: pageSize },
    };
  });

const agingCalls = () => fakeApi.calls.filter((c) => c.path === "/reports/aging/by-customer");
const customerCalls = () => fakeApi.calls.filter((c) => c.path === "/customers");

beforeEach(() => {
  vi.clearAllMocks();
  currentCustomerId.id = "cust-150";
});

// ─── Customer list ──────────────────────────────────────────────────────────

describe("Customer list — server pagination (B9DD-RR-002)", () => {
  it("paginates 250 customers using backend metadata", async () => {
    fakeApi = createFakeApi([
      customersRoute(),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    // The backend total drives the count — not rows.length (25).
    expect(screen.getByText(/250 customers found — showing 1–25/)).toBeInTheDocument();
    // ceil(250 / 25) = 10 pages. The old page had none.
    expect(screen.getByText(/Page 1 \/ 10/)).toBeInTheDocument();
    expect(screen.queryByText("Customer 26")).toBeNull();
  });

  it("never requests a page_size above the backend maximum", async () => {
    fakeApi = createFakeApi([
      customersRoute(),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(customerCalls().length).toBeGreaterThan(0));
    for (const call of customerCalls()) {
      expect(Number(call.params.page_size)).toBeLessThanOrEqual(100);
    }
  });

  it("requests the correct server page when opening page 2", async () => {
    const user = userEvent.setup();
    fakeApi = createFakeApi([
      customersRoute(),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => expect(screen.getByText("Customer 26")).toBeInTheDocument());

    expect(customerCalls().some((c) => Number(c.params.page) === 2)).toBe(true);
    expect(screen.getByText(/Page 2 \/ 10/)).toBeInTheDocument();
  });

  it("pushes search to the server instead of filtering a capped page", async () => {
    const user = userEvent.setup();
    fakeApi = createFakeApi([
      route("/customers", (params) => {
        if (params.search) {
          return { data: [customerFixture(150)], meta: { total: 1, page: 1, page_size: 25 } };
        }
        return {
          data: customerPage(Number(params.page ?? 1), 25),
          meta: { total: TOTAL_CUSTOMERS, page: Number(params.page ?? 1), page_size: 25 },
        };
      }),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Search by name/i), "Customer 150");

    // The search text reached the SERVER as a query param — it was not applied
    // as a client-side filter over a capped page.
    await waitFor(() => expect(customerCalls().some((c) => c.params.search === "Customer 150")).toBe(true));
    // Customer 150 is NOT on page 1, so only a real server search can show them.
    await waitFor(() => expect(screen.getByText("Customer 150")).toBeInTheDocument());
  });

  it("pushes the status filter to the server", async () => {
    const user = userEvent.setup();
    fakeApi = createFakeApi([
      route("/customers", (params) => ({
        data: params.status === "Blocked" ? [customerFixture(9, { status: "Blocked" })] : customerPage(1, 25),
        meta: { total: params.status === "Blocked" ? 1 : TOTAL_CUSTOMERS, page: 1, page_size: 25 },
      })),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Blocked" }));
    await waitFor(() => expect(customerCalls().some((c) => c.params.status === "Blocked")).toBe(true));
  });
});

// ─── Exposure authority: the false-zero defect ──────────────────────────────

describe("Customer list — exposure authority (B9DD-RR-002)", () => {
  it("resolves exposure found on aging PAGE 2 rather than reporting zero", async () => {
    // Customer 1 is visible on the customer page, but their aging row is on
    // aging page 2. Pre-remediation this rendered "MYR 0.00".
    fakeApi = createFakeApi([
      customersRoute(),
      route("/reports/aging/by-customer", (params) => {
        const page = Number(params.page ?? 1);
        if (page === 1) {
          // 100 rows of OTHER customers — none of the visible ones.
          return {
            data: Array.from({ length: 100 }, (_, i) => agingRowFixture({ customer_id: `other-${i}` })),
            meta: { total: 101, page: 1, page_size: 100 },
          };
        }
        return {
          data: [
            agingRowFixture({
              customer_id: "cust-1",
              base_total: 545,
              by_currency: [currencyTotal("MYR", 100, 100, 1), currencyTotal("USD", 100, 445, 1)],
            }),
          ],
          meta: { total: 101, page: 2, page_size: 100 },
        };
      }),
    ]);

    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    const row = screen.getByText("Customer 1").closest("tr") as HTMLElement;
    await waitFor(() => expect(within(row).getByText("MYR 545.00")).toBeInTheDocument());
    // The critical regression: no false zero.
    expect(within(row).queryByText("MYR 0.00")).toBeNull();
    // It really did page the aging report.
    expect(agingCalls().some((c) => Number(c.params.page) === 2)).toBe(true);
  });

  it("reports zero exposure ONLY after the aging set is exhausted", async () => {
    fakeApi = createFakeApi([
      customersRoute(),
      // Exhausted immediately: total 0 means no customer has exposure.
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    const row = screen.getByText("Customer 1").closest("tr") as HTMLElement;
    await waitFor(() => expect(within(row).getByText(/No outstanding exposure/i)).toBeInTheDocument());
    // Stated as absence of exposure, not as a monetary zero.
    expect(within(row).queryByText("MYR 0.00")).toBeNull();
  });

  it("shows exposure as unavailable — never zero — when the lookup fails", async () => {
    fakeApi = createFakeApi([
      customersRoute(),
      route("/reports/aging/by-customer", () => {
        throw new Error("aging unavailable");
      }),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    const row = screen.getByText("Customer 1").closest("tr") as HTMLElement;
    await waitFor(() => expect(within(row).getByText(/Exposure unavailable/i)).toBeInTheDocument());
    expect(within(row).queryByText("MYR 0.00")).toBeNull();
    expect(within(row).queryByText(/No outstanding exposure/i)).toBeNull();
  });

  it("renders the credit limit with its own explicit currency", async () => {
    fakeApi = createFakeApi([
      route("/customers", () => ({
        data: [customerFixture(1, { credit_limit: 50000, default_currency: "SGD" })],
        meta: { total: 1, page: 1, page_size: 25 },
      })),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("SGD 50,000.00")).toBeInTheDocument());
  });
});

// ─── B9DD-FR-001: placeholder rows must never speak for the new filter ──────
//
// `placeholderData: keepPreviousData` keeps the previous response on screen
// while the newly-selected filter is in flight — which is what keeps the search
// box from unmounting mid-keystroke. The defect was that nothing told the user
// (or assistive tech) that those rows, that total and that exposure belonged to
// the OLD filter. These tests hold the new response open with a deferred promise
// and assert on exactly that window.

/** Page 1 unfiltered resolves at once; any FILTERED request is held open. */
function deferredFilterApi() {
  const pending: Array<{ params: Record<string, unknown>; resolve: (r: FakeResponse) => void; reject: (e: unknown) => void }> = [];

  const api = createFakeApi([
    route("/customers", (params) => {
      const filtered =
        Boolean(params.search || params.status || params.credit_rating) || Number(params.page ?? 1) !== 1;
      if (!filtered) {
        return { data: customerPage(1, 25), meta: { total: TOTAL_CUSTOMERS, page: 1, page_size: 25 } };
      }
      const d = createDeferred<FakeResponse>();
      pending.push({ params, resolve: d.resolve, reject: d.reject });
      return d.promise;
    }),
    route("/reports/aging/by-customer", () => ({
      data: [agingRowFixture({ customer_id: "cust-1", base_total: 545 })],
      meta: { total: 1, page: 1, page_size: 100 },
    })),
  ]);
  return { api, pending };
}

const ratingGroup = () => screen.getByText("Rating:").closest("div") as HTMLElement;
const statusGroup = () => screen.getByText("Status:").closest("div") as HTMLElement;

/** Render the settled, unfiltered page 1 with cust-1's exposure resolved. */
async function renderSettledList(api: FakeApi) {
  fakeApi = api;
  renderWithProviders(<CustomersPage />);
  await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText("MYR 545.00")).toBeInTheDocument());
}

describe("Customer list — stale-filter safety (B9DD-FR-001)", () => {
  it("announces an explicit updating state and keeps the search control mounted", async () => {
    const user = userEvent.setup();
    const { api } = deferredFilterApi();
    await renderSettledList(api);

    // Settled: no updating state is claimed.
    expect(screen.queryByText(/Updating results/i)).toBeNull();

    await user.type(screen.getByPlaceholderText(/Search by name/i), "Zeta");

    // The control survives the refetch — the whole point of keepPreviousData.
    const box = screen.getByPlaceholderText(/Search by name/i) as HTMLInputElement;
    expect(box).toBeInTheDocument();
    expect(box.value).toBe("Zeta");

    // ...and the stale rows are announced, not silently presented.
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Updating results/i);
    expect(status).toHaveTextContent(/previous filter/i);
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("marks the stale rows semantically, not by opacity alone", async () => {
    const user = userEvent.setup();
    const { api } = deferredFilterApi();
    await renderSettledList(api);

    await user.type(screen.getByPlaceholderText(/Search by name/i), "Zeta");

    await waitFor(() => {
      const table = screen.getByText("Customer 1").closest("table") as HTMLElement;
      // A <caption> is real text in the accessibility tree — not a CSS class.
      expect(within(table).getByText(/not confirmed results for your current selection/i)).toBeInTheDocument();
    });
    // And the container is marked busy for assistive tech.
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
  });

  it("withholds the OLD exposure figure while the new filter is in flight", async () => {
    const user = userEvent.setup();
    const { api } = deferredFilterApi();
    await renderSettledList(api);

    // Settled: the authoritative figure is shown.
    expect(screen.getByText("MYR 545.00")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Search by name/i), "Zeta");

    // THE REGRESSION: the old exposure must not stand under the new filter.
    await waitFor(() => expect(screen.queryByText("MYR 545.00")).toBeNull());
    const row = screen.getByText("Customer 1").closest("tr") as HTMLElement;
    expect(within(row).getByText(/Updating…/)).toBeInTheDocument();
    // Never substituted with a zero, either.
    expect(within(row).queryByText("MYR 0.00")).toBeNull();
  });

  it("does not restate the old total or page footer under the new filter", async () => {
    const user = userEvent.setup();
    const { api } = deferredFilterApi();
    await renderSettledList(api);
    expect(screen.getByText(/250 customers found/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Search by name/i), "Zeta");

    // "250 customers found" was a claim about the UNFILTERED collection.
    await waitFor(() => expect(screen.queryByText(/250 customers found/)).toBeNull());
    expect(screen.getByText(/Counting customers for the new filter/i)).toBeInTheDocument();
  });

  it("disables pagination while the rows on screen are superseded", async () => {
    const user = userEvent.setup();
    const { api } = deferredFilterApi();
    await renderSettledList(api);

    expect(screen.getByRole("button", { name: /Next/i })).toBeEnabled();
    await user.type(screen.getByPlaceholderText(/Search by name/i), "Zeta");

    // A click here would combine the NEW filter with a page count derived from
    // the OLD result set.
    await waitFor(() => expect(screen.getByRole("button", { name: /Next/i })).toBeDisabled());
    expect(screen.getByRole("button", { name: /Previous/i })).toBeDisabled();
  });

  it("shows the new authoritative result once the refetch settles", async () => {
    const user = userEvent.setup();
    const { api, pending } = deferredFilterApi();
    await renderSettledList(api);

    await user.type(screen.getByPlaceholderText(/Search by name/i), "Zeta");
    await screen.findByRole("status");

    // Release the held response.
    const held = pending[pending.length - 1];
    held.resolve({
      data: [customerFixture(150, { customer_name: "Zeta Holdings" })],
      meta: { total: 1, page: 1, page_size: 25 },
    });

    await waitFor(() => expect(screen.getByText("Zeta Holdings")).toBeInTheDocument());
    // Old rows are gone, and the updating state is withdrawn.
    expect(screen.queryByText("Customer 1")).toBeNull();
    expect(screen.queryByText(/Updating results/i)).toBeNull();
    expect(screen.getByText(/1 customer found/)).toBeInTheDocument();
  });

  it("does not retain old rows as final when the new filter errors", async () => {
    const user = userEvent.setup();
    const { api, pending } = deferredFilterApi();
    await renderSettledList(api);

    await user.type(screen.getByPlaceholderText(/Search by name/i), "Zeta");
    await screen.findByRole("status");

    pending[pending.length - 1].reject(new Error("filter query failed"));

    // The failure is surfaced; the old result set is NOT left standing as if it
    // answered the new filter.
    await waitFor(() => expect(screen.getByText(/Failed to load customers/i)).toBeInTheDocument());
    expect(screen.queryByText("Customer 1")).toBeNull();
    expect(screen.queryByText(/250 customers found/)).toBeNull();
  });

  it("does not mark a settled, unchanged filter as stale", async () => {
    // Negative control: the updating state must mean something. A page whose
    // data matches its own query key is authoritative and must render normally.
    const { api } = deferredFilterApi();
    await renderSettledList(api);

    expect(screen.queryByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByText("MYR 545.00")).toBeInTheDocument();
    expect(screen.getByText(/250 customers found/)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("applies the same stale treatment to a status change", async () => {
    const user = userEvent.setup();
    const { api } = deferredFilterApi();
    await renderSettledList(api);

    await user.click(within(statusGroup()).getByRole("button", { name: "Blocked" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Updating results/i);
    await waitFor(() => expect(screen.queryByText("MYR 545.00")).toBeNull());
    expect(screen.queryByText(/250 customers found/)).toBeNull();
  });

  it("applies the same stale treatment to a credit_rating change", async () => {
    const user = userEvent.setup();
    const { api } = deferredFilterApi();
    await renderSettledList(api);

    await user.click(within(ratingGroup()).getByRole("button", { name: "AAA" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Updating results/i);
    await waitFor(() => expect(screen.queryByText("MYR 545.00")).toBeNull());
  });
});

// ─── B9DD-FR-005: credit_rating propagation ─────────────────────────────────

describe("Customer list — credit_rating propagation (B9DD-FR-005)", () => {
  const listApi = () =>
    createFakeApi([
      route("/customers", (params) => ({
        data: [customerFixture(1, { credit_rating: (params.credit_rating as Customer["credit_rating"]) ?? "A" })],
        meta: { total: 1, page: Number(params.page ?? 1), page_size: 25 },
      })),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);

  const lastCustomerCall = () => customerCalls()[customerCalls().length - 1];

  // Exactly the six values the backend accepts
  // (customers/index.ts ~110 validates against CREDIT_RATINGS).
  it.each(["AAA", "AA", "A", "B", "C", "D"])("selecting %s sends credit_rating=%s", async (rating) => {
    const user = userEvent.setup();
    fakeApi = listApi();
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    await user.click(within(ratingGroup()).getByRole("button", { name: rating }));

    await waitFor(() => expect(lastCustomerCall().params.credit_rating).toBe(rating));
    // The exact value — never a coerced or lowercased variant.
    expect(customerCalls().some((c) => c.params.credit_rating === rating)).toBe(true);
  });

  it("omits credit_rating entirely when All is selected", async () => {
    const user = userEvent.setup();
    fakeApi = listApi();
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    // Every request so far is unfiltered: the param must be ABSENT, not "All".
    for (const c of customerCalls()) {
      expect(c.params).not.toHaveProperty("credit_rating");
    }

    await user.click(within(ratingGroup()).getByRole("button", { name: "B" }));
    await waitFor(() => expect(lastCustomerCall().params.credit_rating).toBe("B"));

    // Returning to All must not send `credit_rating=All` — the backend would
    // reject it (validateEnum), and it is not a rating.
    await user.click(within(ratingGroup()).getByRole("button", { name: "All" }));
    await waitFor(() => expect(lastCustomerCall().params).not.toHaveProperty("credit_rating"));
  });

  it("sends search, status and credit_rating together", async () => {
    const user = userEvent.setup();
    fakeApi = listApi();
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Search by name/i), "Acme");
    await user.click(within(statusGroup()).getByRole("button", { name: "Active" }));
    await user.click(within(ratingGroup()).getByRole("button", { name: "AA" }));

    await waitFor(() => {
      const c = lastCustomerCall();
      expect(c.params.search).toBe("Acme");
      expect(c.params.status).toBe("Active");
      expect(c.params.credit_rating).toBe("AA");
      expect(Number(c.params.page)).toBe(1);
      expect(Number(c.params.page_size)).toBe(25);
    });
  });

  it("isolates the query key per rating — a rating switch refetches", async () => {
    const user = userEvent.setup();
    fakeApi = listApi();
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    await user.click(within(ratingGroup()).getByRole("button", { name: "C" }));
    await waitFor(() => expect(customerCalls().some((c) => c.params.credit_rating === "C")).toBe(true));

    await user.click(within(ratingGroup()).getByRole("button", { name: "D" }));
    // A shared key would have served C's cached result for D.
    await waitFor(() => expect(customerCalls().some((c) => c.params.credit_rating === "D")).toBe(true));

    const ratings = customerCalls().map((c) => c.params.credit_rating);
    expect(ratings).toContain("C");
    expect(ratings).toContain("D");
  });

  it("resets to page 1 and never requests page 2 under a new rating", async () => {
    const user = userEvent.setup();
    fakeApi = createFakeApi([
      route("/customers", (params) => ({
        data: customerPage(Number(params.page ?? 1), 25),
        meta: { total: TOTAL_CUSTOMERS, page: Number(params.page ?? 1), page_size: 25 },
      })),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Customer 1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => expect(screen.getByText(/Page 2 \/ 10/)).toBeInTheDocument());

    await user.click(within(ratingGroup()).getByRole("button", { name: "B" }));
    await waitFor(() => expect(customerCalls().some((c) => c.params.credit_rating === "B")).toBe(true));

    // Page 2 of the OLD filter says nothing about where page 2 of the new one
    // begins, so the request must never be made.
    const bad = customerCalls().filter((c) => c.params.credit_rating === "B" && Number(c.params.page) !== 1);
    expect(bad).toEqual([]);
    await waitFor(() => expect(screen.getByText(/Page 1 \/ 10/)).toBeInTheDocument());
  });

  it("applies no contradictory client-side rating filter", async () => {
    const user = userEvent.setup();
    // A deliberately contrary server: asked for D, it answers with an AAA row.
    // The page must render exactly what the backend returned — the backend is
    // the filter authority. A client-side re-filter would blank this row.
    fakeApi = createFakeApi([
      route("/customers", () => ({
        data: [customerFixture(7, { customer_name: "Server Says AAA", credit_rating: "AAA" })],
        meta: { total: 1, page: 1, page_size: 25 },
      })),
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomersPage />);
    await waitFor(() => expect(screen.getByText("Server Says AAA")).toBeInTheDocument());

    await user.click(within(ratingGroup()).getByRole("button", { name: "D" }));
    await waitFor(() => expect(customerCalls().some((c) => c.params.credit_rating === "D")).toBe(true));

    await waitFor(() => expect(screen.getByText("Server Says AAA")).toBeInTheDocument());
    expect(screen.queryByText(/No customers match your filters/i)).toBeNull();
  });
});

// ─── Customer detail ────────────────────────────────────────────────────────

describe("Customer detail — governed endpoint (B9DD-RR-002)", () => {
  const detailApi = (over: Partial<Customer> = {}) =>
    createFakeApi([
      route("/customers/cust-150", () => ({ data: customerFixture(150, over) })),
      route("/invoices", (params) => ({
        data: [],
        meta: { total: 137, page: Number(params.page ?? 1), page_size: Number(params.page_size ?? 20) },
      })),
      route("/receipts", (params) => ({
        data: [],
        meta: { total: 42, page: Number(params.page ?? 1), page_size: Number(params.page_size ?? 20) },
      })),
      routePrefix("/reports/aging/by-customer", () => ({
        data: [agingRowFixture({ customer_id: "cust-150", base_total: 545 })],
        meta: { total: 1, page: 1, page_size: 100 },
      })),
    ]);

  it("loads a customer beyond the first 100 via GET /customers/:id", async () => {
    fakeApi = detailApi();
    renderWithProviders(<CustomerDetailPage />);

    // Pre-remediation this rendered "Customer not found" (cust-150 was off page 1).
    await waitFor(() => expect(screen.getAllByText("Customer 150").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Customer not found/i)).toBeNull();
    // The governed detail endpoint was actually used.
    expect(fakeApi.calls.some((c) => c.path === "/customers/cust-150")).toBe(true);
    // And no capped list was fetched to find them.
    expect(fakeApi.calls.some((c) => c.path === "/customers")).toBe(false);
  });

  it("shows 'Customer not found' only for the governed 404", async () => {
    fakeApi = createFakeApi([
      route("/customers/cust-150", () => {
        throw new ApiError("NOT_FOUND", "Customer not found", 404);
      }),
      routePrefix("/invoices", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20 } })),
      routePrefix("/receipts", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20 } })),
      routePrefix("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomerDetailPage />);
    await waitFor(() => expect(screen.getByText(/Customer not found/i)).toBeInTheDocument());
  });

  it("does not present a transient failure as 'not found'", async () => {
    fakeApi = createFakeApi([
      route("/customers/cust-150", () => {
        throw new ApiError("INTERNAL", "Upstream timeout", 500);
      }),
      routePrefix("/invoices", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20 } })),
      routePrefix("/receipts", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20 } })),
      routePrefix("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);
    renderWithProviders(<CustomerDetailPage />);
    await waitFor(() => expect(screen.getByText(/Failed to load customer data/i)).toBeInTheDocument());
    expect(screen.queryByText(/Customer not found/i)).toBeNull();
  });

  it("keeps Invoice/Receipt collection totals distinct from the current page", async () => {
    fakeApi = detailApi();
    renderWithProviders(<CustomerDetailPage />);
    await waitFor(() => expect(screen.getAllByText("Customer 150").length).toBeGreaterThan(0));

    // The tab badge shows the backend COLLECTION total (137), not 20 rows.
    expect(screen.getByText("137")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    // Server pagination was requested, within the backend limit.
    const invoiceCalls = fakeApi.calls.filter((c) => c.path === "/invoices");
    expect(invoiceCalls.length).toBeGreaterThan(0);
    for (const c of invoiceCalls) {
      expect(Number(c.params.page_size)).toBeLessThanOrEqual(100);
      expect(c.params.customer_id).toBe("cust-150");
    }
  });
});

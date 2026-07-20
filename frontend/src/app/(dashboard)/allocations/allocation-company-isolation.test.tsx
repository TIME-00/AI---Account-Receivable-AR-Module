// ============================================================================
// B9DD-FDR-002 — Company (tenant) isolation of allocation candidate authority.
//
// The defect, reproduced against the receipt-only query key before this gate:
//
//   currentCompany: COMPANY_B          candidateRequests: 1  (no refetch)
//   boundCustomerName: "Company A"     <- A's contract shown under B
//   COMPANY_A_CALLBACK_STILL_AUTHORIZED: true
//   COMPANY_A_PAYLOAD_NOT_NULL: true   canSubmit: true
//
// The header's company switcher updates the Zustand store in place and `useApi`
// immediately sends the new `X-Company-Id` — but TanStack does not refetch just
// because a queryFn closure changed. Same key, same enabled state, no refetch.
// So Company A's cached candidate contract stayed on screen, and stayed locally
// actionable, under Company B. The backend would have rejected the eventual
// Company-B-header mutation, but frontend tenant context had already failed: the
// user was reading another company's financial data.
//
// Everything here uses the REAL company store (via the real `setCompany` used by
// the header), the REAL page, the REAL company-scoped key, the REAL live
// verifier and the REAL allocation logic.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  Providers,
  createTestQueryClient,
  createFakeApi,
  route,
  type FakeApi,
  type FakeResponse,
} from "@/test/harness";
import { ALLOCATION_CANDIDATE_MAX } from "@/lib/allocation-candidate-contract";
import { allocationCandidateQueryKey, useAllocationCandidates } from "@/hooks/use-allocations";
import { useCompanyStore } from "@/stores/company-store";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({ baseCurrency: "MYR", isLoading: false, isUnavailable: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/allocations",
}));

import AllocationsPage from "@/app/(dashboard)/allocations/page";

const COMPANY_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const COMPANY_B = "bbbbbbbb-0000-0000-0000-00000000000b";
// DELIBERATELY the same receipt id in both tenants: this is what proves the
// COMPANY key — not the receipt id — is what separates them.
const RCP = "11111111-1111-1111-1111-111111111111";
const CUST_A = "22222222-2222-2222-2222-222222222222";
const CUST_B = "44444444-4444-4444-4444-444444444444";
const invId = (n: number) => `33333333-3333-3333-3333-${String(n).padStart(12, "0")}`;

const listReceipt = (customerName: string) => ({
  id: RCP,
  receipt_no: "RCP-SHARED",
  receipt_date: "2026-07-01",
  customer_id: CUST_A,
  customer_name: customerName,
  currency: "USD",
  exchange_rate: 4.4,
  receipt_amount: 1000,
  allocated_amount: 700,
  unallocated_amount: 300,
  payment_method: "TT",
  status: "Posted",
});

/** A governed contract whose CONTENT identifies the tenant it came from. */
function contractFor(companyId: string) {
  const isA = companyId === COMPANY_A;
  return {
    contract_version: "allocation_candidates.v1",
    complete: true,
    max_candidates: ALLOCATION_CANDIDATE_MAX,
    ordering: ["due_date ASC NULLS LAST", "invoice_no ASC", "id ASC"],
    receipt: {
      id: RCP,
      receipt_no: "RCP-SHARED",
      receipt_date: "2026-07-01",
      customer_id: isA ? CUST_A : CUST_B,
      customer_name: isA ? "Acme (Company A)" : "Beta (Company B)",
      currency: "USD",
      exchange_rate: 4.4,
      receipt_amount: 1000,
      allocated_amount: 700,
      unallocated_amount: 300,
      payment_method: "TT",
      status: "Posted",
      version: 1,
    },
    customer_id: isA ? CUST_A : CUST_B,
    currency: "USD",
    total: 1,
    candidates: [
      {
        id: invId(isA ? 1 : 2),
        invoice_no: isA ? "INV-A0001" : "INV-B0002",
        doc_type: "Invoice",
        invoice_date: "2026-06-01",
        due_date: "2026-07-01",
        currency: "USD",
        exchange_rate: 4.4,
        total_amount: 1000,
        outstanding: 400,
        status: "Open",
        version: 1,
      },
    ],
  };
}

/** Records the `X-Company-Id` context each candidate read was issued under. */
let candidateRequestCompanies: string[] = [];

function tenantApi() {
  return createFakeApi([
    route("/receipts", () => ({
      data: [listReceipt(useCompanyStore.getState().companyName)],
      meta: { total: 1, page: 1, page_size: 50 },
    })),
    route("/allocations", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20 } })),
    route("/allocations/candidates", (): FakeResponse => {
      // The real `useApi` resolves the tenant from the store at request time;
      // this fake mirrors that so the response matches the request context.
      const company = useCompanyStore.getState().companyId;
      candidateRequestCompanies.push(company);
      return { data: contractFor(company) };
    }),
  ]);
}

const selectSharedReceipt = async () => {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByText("RCP-SHARED")).toBeInTheDocument());
  await user.click(screen.getByText("RCP-SHARED"));
  return user;
};

beforeEach(() => {
  vi.clearAllMocks();
  candidateRequestCompanies = [];
  useCompanyStore.setState({ companyId: COMPANY_A, companyName: "Company A" });
  fakeApi = tenantApi();
});

describe("B9DD-FDR-002 — company-scoped candidate key", () => {
  it("gives the SAME receipt a different cache key per tenant", () => {
    expect(allocationCandidateQueryKey(COMPANY_A, RCP)).not.toEqual(
      allocationCandidateQueryKey(COMPANY_B, RCP),
    );
    expect(allocationCandidateQueryKey(COMPANY_A, RCP)).toEqual([
      "allocations",
      "candidates",
      COMPANY_A,
      RCP,
    ]);
  });

  it("refetches under the new tenant while the SAME query stays mounted", async () => {
    // This isolates what the KEY alone is responsible for, and it is the exact
    // shape of the original defect.
    //
    // The page-level test below cannot prove it: two other mechanisms mask it
    // there — the derived selection unmounts the query on switch, and `gcTime: 0`
    // then evicts it, so the next read refetches regardless of the key. The leak
    // needed the observer to stay MOUNTED across the switch, which is precisely
    // what happened before: same key, same enabled state, so TanStack never
    // refetched even though `useApi` had already started sending Company B's
    // `X-Company-Id`. Company A's contract simply stayed.
    //
    // So this drives the candidate hook directly with a FIXED receipt id and
    // switches only the tenant. With a receipt-only key the hook would not
    // refetch and would still hold Company A's contract.
    const client = createTestQueryClient();
    const { result } = renderHook(() => useAllocationCandidates(RCP), {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.receipt.customer_name).toBe("Acme (Company A)");
    expect(candidateRequestCompanies).toEqual([COMPANY_A]);

    // The real production path, with the query still mounted throughout.
    await act(async () => {
      useCompanyStore.getState().setCompany(COMPANY_B, "Company B", "SGD");
    });

    // The key changed, so this is a DIFFERENT query: it refetches under B's
    // context and resolves to B's governed contract.
    await waitFor(() => expect(result.current.data?.receipt.customer_name).toBe("Beta (Company B)"));
    expect(candidateRequestCompanies).toEqual([COMPANY_A, COMPANY_B]);
    // Company A's contract is not what this tenant is reading.
    expect(result.current.data!.customer_id).toBe(CUST_B);
  });

  it("disables the query without an active company", async () => {
    useCompanyStore.setState({ companyId: "", companyName: "" });
    renderWithProviders(<AllocationsPage />);
    // No tenant => no governed read may be issued at all.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(candidateRequestCompanies).toEqual([]);
  });
});

describe("B9DD-FDR-002 — switching company via the real store", () => {
  it("clears the workbench, refetches under B, and never shows A's data as B's", async () => {
    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectSharedReceipt();

    // (1)-(3) Company A is active, its contract is bound, and a line is entered.
    await waitFor(() => expect(screen.getByText("INV-A0001")).toBeInTheDocument());
    expect(screen.getByText("Acme (Company A)")).toBeInTheDocument();
    await user.click(screen.getByTitle("Add to allocation"));
    await user.click(screen.getByTitle("Fill max allocatable amount"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());
    expect(candidateRequestCompanies).toEqual([COMPANY_A]);

    // (5) The REAL production path: the header's switcher calls setCompany.
    await act(async () => {
      useCompanyStore.getState().setCompany(COMPANY_B, "Company B", "SGD");
    });

    // (7) Company A's rows, lines and Confirm are gone — and A's contract is
    // never relabelled as B's data.
    await waitFor(() => expect(screen.queryByText("INV-A0001")).not.toBeInTheDocument());
    expect(screen.queryByText("Acme (Company A)")).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument();
    // The receipt selection itself is cleared: the new tenant starts unselected.
    expect(screen.queryByRole("button", { name: /Reselect/i })).not.toBeInTheDocument();

    // (6) No mutation escaped during the transition.
    expect(fakeApi.post).not.toHaveBeenCalled();

    // (8)+(9) A read for Company B goes out under B's context, against B's key,
    // and only B's governed contract can become actionable.
    const user2 = await selectSharedReceipt();
    await waitFor(() => expect(screen.getByText("INV-B0002")).toBeInTheDocument());
    expect(screen.getByText("Beta (Company B)")).toBeInTheDocument();
    expect(candidateRequestCompanies).toEqual([COMPANY_A, COMPANY_B]);
    expect(client.getQueryData(allocationCandidateQueryKey(COMPANY_B, RCP))).toBeDefined();

    await user2.click(screen.getByTitle("Add to allocation"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(0\)/)).toBeInTheDocument());
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("switching BACK to Company A does not silently restore A's old lines", async () => {
    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectSharedReceipt();
    await waitFor(() => expect(screen.getByText("INV-A0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));
    await user.click(screen.getByTitle("Fill max allocatable amount"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());

    await act(async () => {
      useCompanyStore.getState().setCompany(COMPANY_B, "Company B", "SGD");
    });
    await waitFor(() => expect(screen.queryByText("INV-A0001")).not.toBeInTheDocument());

    // (10) Back to A. A's cache namespace is intact, but the workbench must
    // still require a fresh governed bind — the previous lines are NOT restored.
    await act(async () => {
      useCompanyStore.getState().setCompany(COMPANY_A, "Company A", "MYR");
    });
    expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument();

    await selectSharedReceipt();
    await waitFor(() => expect(screen.getByText("INV-A0001")).toBeInTheDocument());
    // Rebound from A's contract with NO carried-over line.
    expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

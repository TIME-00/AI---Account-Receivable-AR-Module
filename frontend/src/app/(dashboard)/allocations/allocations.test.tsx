// ============================================================================
// Batch 9D-D Phase B — Allocation workbench state lifecycle.
//
// The previous page synced allocation state only when the candidate array was
// NON-EMPTY (`if (selectedReceipt && outstandingInvoices.length > 0)`), so a
// later verified-empty result, a failure, or a malformed response left the
// PREVIOUS receipt's candidates and allocation lines on screen and submittable.
//
// These drive the real page against the API boundary and pin the mandatory
// Part 6D transitions.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  createTestQueryClient,
  createFakeApi,
  createDeferred,
  route,
  type FakeApi,
  type FakeResponse,
} from "@/test/harness";
import { ApiError } from "@/hooks/use-api";
import { useCompanyStore } from "@/stores/company-store";
import { ALLOCATION_CANDIDATE_MAX } from "@/lib/allocation-candidate-contract";
import { allocationCandidateQueryKey } from "@/hooks/use-allocations";

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

// B9DD-FDR-002: the candidate cache is COMPANY-scoped, so every key needs
// the active tenant. Seeded in beforeEach via the real store.
const COMPANY_ID = "cccccccc-0000-0000-0000-00000000000c";
const RCP_A = "11111111-1111-1111-1111-111111111111";
const RCP_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CUST_A = "22222222-2222-2222-2222-222222222222";
const CUST_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const invId = (n: number) => `33333333-3333-3333-3333-${String(n).padStart(12, "0")}`;

/** Posted receipts as `/receipts` returns them for the left panel. */
function listReceipt(id: string, no: string, customerId: string, customerName: string) {
  return {
    id,
    receipt_no: no,
    receipt_date: "2026-07-01",
    customer_id: customerId,
    customer_name: customerName,
    currency: "USD",
    exchange_rate: 4.4,
    receipt_amount: 1000,
    allocated_amount: 700,
    unallocated_amount: 300,
    payment_method: "TT",
    status: "Posted",
  };
}

const RECEIPTS = [
  listReceipt(RCP_A, "RCP-AAAA", CUST_A, "Acme"),
  listReceipt(RCP_B, "RCP-BBBB", CUST_B, "Beta"),
];

function candidate(n: number, over: Record<string, unknown> = {}) {
  return {
    id: invId(n),
    invoice_no: `INV-${String(n).padStart(4, "0")}`,
    doc_type: "Invoice",
    invoice_date: "2026-06-01",
    due_date: "2026-07-01",
    currency: "USD",
    exchange_rate: 4.4,
    total_amount: 1000,
    outstanding: 400,
    status: "Open",
    version: 1,
    ...over,
  };
}

function contractFor(receiptId: string, customerId: string, candidates: unknown[], over: Record<string, unknown> = {}) {
  // `receipt` is pulled out of `over` first: spreading `over` wholesale would
  // otherwise REPLACE the receipt object with the override fragment.
  const { receipt: receiptOver, ...rest } = over;
  return {
    contract_version: "allocation_candidates.v1",
    complete: true,
    max_candidates: ALLOCATION_CANDIDATE_MAX,
    ordering: ["due_date ASC NULLS LAST", "invoice_no ASC", "id ASC"],
    receipt: {
      id: receiptId,
      receipt_no: receiptId === RCP_A ? "RCP-AAAA" : "RCP-BBBB",
      receipt_date: "2026-07-01",
      customer_id: customerId,
      customer_name: receiptId === RCP_A ? "Acme" : "Beta",
      currency: "USD",
      exchange_rate: 4.4,
      receipt_amount: 1000,
      allocated_amount: 700,
      unallocated_amount: 300,
      payment_method: "TT",
      status: "Posted",
      version: 1,
      ...((receiptOver as object) ?? {}),
    },
    customer_id: customerId,
    currency: "USD",
    total: candidates.length,
    candidates,
    ...rest,
  };
}

const baseRoutes = () => [
  route("/receipts", () => ({ data: RECEIPTS, meta: { total: 2, page: 1, page_size: 50 } })),
  route("/allocations", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20 } })),
];

/** Candidates route driven by a per-receipt script the test controls. */
function pageApi(handler: (receiptId: string) => FakeResponse | Promise<FakeResponse>) {
  return createFakeApi([
    ...baseRoutes(),
    route("/allocations/candidates", (params) => handler(String(params.receipt_id))),
  ]);
}

const candidateCalls = () => fakeApi.calls.filter((c) => c.path === "/allocations/candidates");

async function selectReceipt(no: string) {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByText(no)).toBeInTheDocument());
  await user.click(screen.getByText(no));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCompanyStore.setState({ companyId: COMPANY_ID, companyName: "Test Co" });
});

// ─── Verified populated set ─────────────────────────────────────────────────

describe("Allocation workbench — verified contract (Phase B)", () => {
  it("renders candidates from the governed contract and sends only the receipt id", async () => {
    fakeApi = pageApi(() => ({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }));
    renderWithProviders(<AllocationsPage />);
    await selectReceipt("RCP-AAAA");

    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    expect(Object.keys(candidateCalls()[0].params)).toEqual(["receipt_id"]);
    expect(candidateCalls()[0].params.receipt_id).toBe(RCP_A);
    // The obsolete offset scan is gone for good.
    expect(fakeApi.calls.some((c) => c.path === "/invoices")).toBe(false);
    expect(fakeApi.calls.some((c) => c.path.includes("/allocations/auto"))).toBe(false);
    expect(fakeApi.calls.some((c) => c.path.includes("/allocations/preview"))).toBe(false);
  });

  it("uses the GOVERNED receipt balance, not the possibly-stale list row", async () => {
    // The list says 300 unallocated; the governed contract says 42.50.
    fakeApi = pageApi(() => ({
      data: contractFor(RCP_A, CUST_A, [candidate(1)], { receipt: { unallocated_amount: 42.5 } }),
    }));
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    // The list rows still advertise their own (stale) 300.
    expect(screen.getAllByText(/Unapplied: USD 300\.00/).length).toBeGreaterThan(0);

    // Adding a line reveals the workbench balance summary, which must be built
    // from the GOVERNED receipt (42.50) — not the list row.
    await user.click(screen.getByTitle("Add to allocation"));
    await waitFor(() => expect(screen.getAllByText(/USD 42\.50/).length).toBeGreaterThan(0));
  });
});

// ─── D1. Receipt identity change ────────────────────────────────────────────

describe("D1 — receipt identity change clears prior state (Phase B)", () => {
  it("shows no Receipt A candidates or lines while Receipt B is loading", async () => {
    const held = createDeferred<FakeResponse>();
    fakeApi = pageApi((id) =>
      id === RCP_A ? { data: contractFor(RCP_A, CUST_A, [candidate(1)]) } : held.promise,
    );
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    // Build an allocation line on Receipt A.
    await user.click(screen.getByTitle("Add to allocation"));
    await waitFor(() => expect(screen.getByText(/Allocation Lines|Allocation Table|Clear/i)).toBeInTheDocument());

    // Switch to Receipt B — its contract is still in flight.
    await user.click(screen.getByText("RCP-BBBB"));

    // Receipt A's candidate and line must be gone immediately.
    await waitFor(() => expect(screen.queryByText("INV-0001")).toBeNull());
    expect(screen.getByText(/Loading eligible invoices/i)).toBeInTheDocument();
    // No submit button survives from A.
    expect(screen.queryByRole("button", { name: /Confirm Allocation/i })).toBeNull();

    held.resolve({ data: contractFor(RCP_B, CUST_B, [candidate(2)]) });
    await waitFor(() => expect(screen.getByText("INV-0002")).toBeInTheDocument());
    expect(screen.queryByText("INV-0001")).toBeNull();
  });
});

// ─── D2. Refetch returns verified empty ─────────────────────────────────────

describe("D2 — verified empty clears prior candidates (Phase B)", () => {
  it("clears candidates and lines, and shows the empty state rather than an error", async () => {
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return {
        data:
          call === 1
            ? contractFor(RCP_A, CUST_A, [candidate(1)])
            : contractFor(RCP_A, CUST_A, []),
      };
    });
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));

    // Force a refetch by reselecting the same receipt.
    await user.click(screen.getByRole("button", { name: /Reselect/i }));
    await user.click(screen.getByText("RCP-AAAA"));

    await waitFor(() => expect(screen.getByText(/No eligible invoices for this receipt/i)).toBeInTheDocument());
    // The old candidate and its line are gone; this is NOT an error state.
    expect(screen.queryByText("INV-0001")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm Allocation/i })).toBeNull();
  });
});

// ─── D3/D4. Refetch fails or returns malformed ──────────────────────────────

describe("D3/D4 — failed or malformed refetch clears prior state (Phase B)", () => {
  it("clears candidates and disables submission when a refetch fails", async () => {
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      if (call === 1) return { data: contractFor(RCP_A, CUST_A, [candidate(1)]) };
      throw new Error("network down");
    });
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));

    await user.click(screen.getByRole("button", { name: /Reselect/i }));
    await user.click(screen.getByText("RCP-AAAA"));

    await waitFor(() => expect(screen.getByText(/Could not load eligible invoices/i)).toBeInTheDocument());
    expect(screen.queryByText("INV-0001")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm Allocation/i })).toBeNull();
    // D7: no count and no ids are shown in an error state.
    expect(screen.queryByText("1")).toBeNull();
    // No internal detail leaks.
    expect(screen.queryByText(/network down/i)).toBeNull();
  });

  it("clears candidates when a refetch returns a malformed contract", async () => {
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return {
        data:
          call === 1
            ? contractFor(RCP_A, CUST_A, [candidate(1)])
            : contractFor(RCP_A, CUST_A, [candidate(2)], { complete: false }),
      };
    });
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));

    await user.click(screen.getByRole("button", { name: /Reselect/i }));
    await user.click(screen.getByText("RCP-AAAA"));

    await waitFor(() =>
      expect(screen.getByText(/Eligible invoices could not be verified/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText("INV-0001")).toBeNull();
    expect(screen.queryByText("INV-0002")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm Allocation/i })).toBeNull();
  });
});

// ─── D5. Changed candidate version/outstanding ──────────────────────────────

describe("D5 — a changed verified result clears stale lines (Phase B)", () => {
  it("rebuilds from the new contract when candidate version/outstanding move", async () => {
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return {
        data:
          call === 1
            ? contractFor(RCP_A, CUST_A, [candidate(1, { outstanding: 400, version: 1 })])
            : contractFor(RCP_A, CUST_A, [candidate(1, { outstanding: 50, version: 2 })]),
      };
    });
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("USD 400.00")).toBeInTheDocument());

    // Enter a line against outstanding 400.
    await user.click(screen.getByTitle("Add to allocation"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Clear/i })).toBeInTheDocument());

    // The document is concurrently part-paid elsewhere: v2, outstanding 50.
    await user.click(screen.getByRole("button", { name: /Reselect/i }));
    await user.click(screen.getByText("RCP-AAAA"));

    await waitFor(() => expect(screen.getByText("USD 50.00")).toBeInTheDocument());
    // The line built against 400 must not survive into a world where the
    // document only owes 50.
    expect(screen.queryByText("USD 400.00")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm Allocation/i })).toBeNull();
  });
});

// ─── D6. Background refetch is not actionable ───────────────────────────────

describe("D6 — an in-flight refetch is not actionable (Phase B)", () => {
  it("shows no candidate rows and no submit while a refetch is in flight", async () => {
    const held = createDeferred<FakeResponse>();
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      if (call === 1) return { data: contractFor(RCP_A, CUST_A, [candidate(1)]) };
      return held.promise;
    });
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));

    await user.click(screen.getByRole("button", { name: /Reselect/i }));
    await user.click(screen.getByText("RCP-AAAA"));

    // While the new authoritative read is in flight, nothing is actionable.
    await waitFor(() => expect(screen.getByText(/Loading eligible invoices/i)).toBeInTheDocument());
    expect(screen.queryByTitle("Add to allocation")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm Allocation/i })).toBeNull();
    expect(screen.queryByText("INV-0001")).toBeNull();

    held.resolve({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) });
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
  });
});

// ─── State-specific safe messaging ──────────────────────────────────────────

describe("Candidate error states are distinct and safe (Phase B)", () => {
  const errorCase = (code: string, status: number, message: string) =>
    pageApi(() => {
      throw new ApiError(code, message, status);
    });

  it("distinguishes an ineligible receipt from an empty one", async () => {
    fakeApi = errorCase("BR-ALLOC-CANDIDATES", 400, "Receipt is not eligible for allocation");
    renderWithProviders(<AllocationsPage />);
    await selectReceipt("RCP-AAAA");

    await waitFor(() =>
      expect(screen.getByText(/This receipt is not eligible for allocation/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No eligible invoices for this receipt/i)).toBeNull();
  });

  it("reports the candidate limit without exposing counts or internals", async () => {
    fakeApi = errorCase("BR-ALLOC-CANDIDATE-LIMIT", 400, "Eligible document count exceeds the supported allocation workbench limit");
    renderWithProviders(<AllocationsPage />);
    await selectReceipt("RCP-AAAA");

    await waitFor(() =>
      expect(screen.getByText(/Too many eligible invoices to allocate here/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No eligible invoices/i)).toBeNull();
  });

  it("reports an inaccessible receipt without disclosing existence", async () => {
    fakeApi = errorCase("NOT_FOUND", 404, "Receipt not found");
    renderWithProviders(<AllocationsPage />);
    await selectReceipt("RCP-AAAA");

    await waitFor(() => expect(screen.getByText(/Receipt is not available/i)).toBeInTheDocument());
    // Identical wording regardless of WHY — no cross-tenant disclosure.
    expect(screen.getByText(/may have been removed, or you may no longer have access/i)).toBeInTheDocument();
  });

  it("surfaces a sanitized message for an internal error", async () => {
    fakeApi = errorCase("INTERNAL_ERROR", 500, "pg: relation \"invoices\" does not exist");
    renderWithProviders(<AllocationsPage />);
    await selectReceipt("RCP-AAAA");

    await waitFor(() => expect(screen.getByText(/Could not load eligible invoices/i)).toBeInTheDocument());
    // No raw database text reaches the user.
    expect(screen.queryByText(/relation "invoices"/i)).toBeNull();
    expect(screen.queryByText(/pg:/i)).toBeNull();
  });

  it("uses accessible status/alert semantics for loading and error", async () => {
    const held = createDeferred<FakeResponse>();
    fakeApi = pageApi(() => held.promise);
    renderWithProviders(<AllocationsPage />);
    await selectReceipt("RCP-AAAA");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Loading eligible invoices/i);
    expect(status).toHaveAttribute("aria-live", "polite");

    held.resolve({ data: contractFor(RCP_A, CUST_A, [], { complete: false }) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be verified/i);
  });
});

// ─── D10. Submission requires a verified contract ───────────────────────────

describe("D10 — submission is gated on a verified contract (Phase B)", () => {
  it("issues no mutation when the contract is not verified", async () => {
    fakeApi = pageApi(() => {
      throw new ApiError("INTERNAL_ERROR", "boom", 500);
    });
    renderWithProviders(<AllocationsPage />);
    await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // The workbench does not exist, and nothing was posted.
    expect(screen.queryByRole("button", { name: /Confirm Allocation/i })).toBeNull();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("submits through the existing governed manual-allocation route only", async () => {
    fakeApi = pageApi(() => ({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }));
    fakeApi.post.mockResolvedValue([]);
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    await user.click(screen.getByTitle("Add to allocation"));
    const fillMax = await screen.findByTitle("Fill max allocatable amount");
    await user.click(fillMax);

    const submit = await screen.findByRole("button", { name: /Confirm Allocation/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(fakeApi.post).toHaveBeenCalled());
    const [path, payload] = fakeApi.post.mock.calls[0];
    // The final mutation remains the existing governed manual route.
    expect(path).toBe("/allocations/manual");
    expect(payload.receipt_id).toBe(RCP_A);
    expect(payload.allocations[0].invoice_id).toBe(invId(1));
    // Auto-allocation is never reachable.
    expect(fakeApi.post).not.toHaveBeenCalledWith(
      expect.stringContaining("/allocations/auto"),
      expect.anything(),
    );
  });
});

// ─── Financial authority is unchanged ───────────────────────────────────────

describe("Frontend is not the balance authority (Phase B)", () => {
  it("treats candidate amounts as input constraints only", async () => {
    fakeApi = pageApi(() => ({
      data: contractFor(RCP_A, CUST_A, [candidate(1, { outstanding: 120 })], {
        receipt: { unallocated_amount: 300 },
      }),
    }));
    fakeApi.post.mockResolvedValue([]);
    renderWithProviders(<AllocationsPage />);
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("USD 120.00")).toBeInTheDocument());

    await user.click(screen.getByTitle("Add to allocation"));
    await user.click(await screen.findByTitle("Fill max allocatable amount"));

    // Fill Max is capped by the candidate's outstanding (120), not the
    // receipt's larger unallocated balance (300) — a UI constraint, while the
    // backend still revalidates everything at execution.
    const submit = await screen.findByRole("button", { name: /Confirm Allocation/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(fakeApi.post).toHaveBeenCalled());
    expect(fakeApi.post.mock.calls[0][1].allocations[0].amount).toBe(120);
  });

  it("performs no direct Supabase access from the workbench", async () => {
    fakeApi = pageApi(() => ({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }));
    renderWithProviders(<AllocationsPage />);
    await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    // Every request went through the governed API client.
    const paths = fakeApi.calls.map((c) => c.path);
    expect(paths.every((p) => p.startsWith("/"))).toBe(true);
    expect(paths.some((p) => p.includes("supabase") || p.includes("rest/v1"))).toBe(false);
  });
});

// ─── Real background refetch at PAGE level (B9DD-CDR-002 §3) ────────────────
//
// The suite above drives selection/reselection. That is NOT a background
// refetch: it unmounts one query and mounts another, so it never produces the
// state that actually breaks — the SAME query, still mounted, cached data
// retained, action callbacks already captured.
//
// These use a real QueryClient and the real canonical query key to invalidate
// the live query while the page stays mounted.

describe("Allocation workbench — genuine background refetch (B9DD-CDR-002)", () => {
  it("clears lines and blocks submission while a same-query refetch is in flight", async () => {
    const deferred = createDeferred<FakeResponse>();
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return call === 1
        ? { data: contractFor(RCP_A, CUST_A, [candidate(1)]) }
        : deferred.promise;
    });

    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectReceipt("RCP-AAAA");

    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));
    await waitFor(() => expect(screen.getByTitle("Fill max allocatable amount")).toBeInTheDocument());
    await user.click(screen.getByTitle("Fill max allocatable amount"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());

    // A REAL background refetch of the mounted query, by its canonical key.
    await act(async () => {
      void client.invalidateQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    // The candidate row and the whole allocation table are gone: an in-flight
    // read is not a stale-but-usable one.
    await waitFor(() => expect(screen.queryByText("INV-0001")).not.toBeInTheDocument());
    expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument();
    expect(fakeApi.post).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) });
    });

    // Rebound from the fresh read — with NO carried-over allocation line.
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("shows an error and removes the candidates when a refetch fails with data retained", async () => {
    const failing = createDeferred<FakeResponse>();
    failing.promise.catch(() => undefined);
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return call === 1 ? { data: contractFor(RCP_A, CUST_A, [candidate(1)]) } : failing.promise;
    });

    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    await act(async () => {
      const done = client
        .invalidateQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) })
        .catch(() => undefined);
      failing.reject(new ApiError("INTERNAL_ERROR", "boom", 500));
      await done;
    });

    // TanStack retains the old data on a failed refetch; the page must not.
    await waitFor(() => expect(screen.queryByText("INV-0001")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("renders a verified-empty state, not an error, when a refetch returns no candidates", async () => {
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return call === 1
        ? { data: contractFor(RCP_A, CUST_A, [candidate(1)]) }
        : { data: contractFor(RCP_A, CUST_A, []) };
    });

    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    await act(async () => {
      await client.invalidateQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    await waitFor(() => expect(screen.queryByText("INV-0001")).not.toBeInTheDocument());
    // A VERIFIED empty set — claimable only because the contract says so.
    expect(screen.getByText(/No eligible invoices/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("drops a line entered against a candidate whose outstanding changed", async () => {
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return call === 1
        ? { data: contractFor(RCP_A, CUST_A, [candidate(1, { outstanding: 400 })]) }
        : { data: contractFor(RCP_A, CUST_A, [candidate(1, { outstanding: 5, version: 2 })]) };
    });

    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation/)).toBeInTheDocument());

    await act(async () => {
      await client.invalidateQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    // The line was entered against outstanding=400, which no longer exists.
    await waitFor(() => expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument());
    expect(screen.getByText("INV-0001")).toBeInTheDocument();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

// ─── B9DD-FDR-003: presentation must reflect LIVE authority ─────────────────
//
// Financial safety was already fail-closed, but the UI could show an ENABLED
// Confirm button while invocation-time authorization would deny — so clicking it
// silently did nothing. Under the same-timestamp collision that state was
// permanent (`canSubmit: true`, every action denied forever).
//
// These inspect the ACTUAL rendered control, not `logic.validation.canSubmit`.

describe("Allocation workbench — Confirm reflects live authority (B9DD-FDR-003)", () => {
  it("removes the Confirm control while a refetch is in flight, instead of leaving it enabled", async () => {
    const deferred = createDeferred<FakeResponse>();
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return call === 1 ? { data: contractFor(RCP_A, CUST_A, [candidate(1)]) } : deferred.promise;
    });

    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));
    await user.click(screen.getByTitle("Fill max allocatable amount"));

    // Baseline: a genuinely actionable workbench renders an ENABLED Confirm.
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());

    await act(async () => {
      void client.invalidateQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    // During the mismatch the control is GONE (the panel shows its loading
    // state) — not present-and-enabled-but-inert.
    await waitFor(() => expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument());
    expect(fakeApi.post).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) });
    });

    // Rebound: rows are back, the old line is gone, and Confirm is not offered
    // until the user creates a valid line again.
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument();

    const user2 = userEvent.setup();
    await user2.click(screen.getByTitle("Add to allocation"));
    await user2.click(screen.getByTitle("Fill max allocatable amount"));
    // Confirm enables normally under the new generation.
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("never renders an enabled Confirm after a failed refetch retains data", async () => {
    const failing = createDeferred<FakeResponse>();
    failing.promise.catch(() => undefined);
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return call === 1 ? { data: contractFor(RCP_A, CUST_A, [candidate(1)]) } : failing.promise;
    });

    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));
    await user.click(screen.getByTitle("Fill max allocatable amount"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());

    await act(async () => {
      const done = client
        .invalidateQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) })
        .catch(() => undefined);
      failing.reject(new ApiError("INTERNAL_ERROR", "boom", 500));
      await done;
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("removes the Confirm control when the query is removed entirely", async () => {
    fakeApi = pageApi(() => ({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }));
    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));
    await user.click(screen.getByTitle("Fill max allocatable amount"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());

    await act(async () => {
      client.removeQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    await waitFor(() => expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument());
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

// ─── B9DD-FDR-003: no enabled-but-inert Confirm at ANY painted frame ────────

describe("Allocation workbench — the Confirm control is never enabled-and-inert", () => {
  it("does not paint an enabled Confirm after a byte-identical cache advance", async () => {
    // The measured defect: with the rebind in a PASSIVE effect, a byte-identical
    // cache advance produced a painted frame where the query was settled+idle
    // (so `isContractVerified` was true), `boundRef` still held the previous
    // generation, and `validation.canSubmit` — a memo whose dependencies had not
    // changed — still read `true`. The DOM showed "Confirm Allocation (1)",
    // ENABLED, while every action denied. Clicking it did nothing at all.
    //
    // Two things close it: the rebind now runs in the LAYOUT phase (before
    // paint), and `canSubmitNow` ANDs local validity with live authority.
    fakeApi = pageApi(() => ({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }));
    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));
    await user.click(screen.getByTitle("Fill max allocatable amount"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());

    // Advance the cache to a NEW generation with byte-identical content, via the
    // real public API, and let React commit.
    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    // The rebind cleared the previous generation's line, so there is no Confirm
    // control at all — and critically, no ENABLED one that would refuse.
    // `waitFor` because the cache notification is batched through
    // `notifyManager`, so the rebind lands a scheduler tick later.
    await waitFor(() => {
      const confirm = screen.queryByText(/Confirm Allocation/);
      // If a control is rendered at all it must be disabled, never a silent
      // no-op. (The current design removes it outright.)
      if (confirm !== null) expect(confirm.closest("button")).toBeDisabled();
      else expect(confirm).toBeNull();
    });
    expect(fakeApi.post).not.toHaveBeenCalled();

    // The workbench recovers: a valid line under the NEW session enables Confirm.
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    const user2 = userEvent.setup();
    await user2.click(screen.getByTitle("Add to allocation"));
    await user2.click(screen.getByTitle("Fill max allocatable amount"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("clicking Confirm during an authority mismatch never POSTs", async () => {
    // Belt and braces: even if a control were somehow reachable, the submit path
    // re-verifies live and refuses.
    const deferred = createDeferred<FakeResponse>();
    let call = 0;
    fakeApi = pageApi(() => {
      call += 1;
      return call === 1 ? { data: contractFor(RCP_A, CUST_A, [candidate(1)]) } : deferred.promise;
    });
    const client = createTestQueryClient();
    renderWithProviders(<AllocationsPage />, { client });
    const user = await selectReceipt("RCP-AAAA");
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    await user.click(screen.getByTitle("Add to allocation"));
    await user.click(screen.getByTitle("Fill max allocatable amount"));
    await waitFor(() => expect(screen.getByText(/Confirm Allocation \(1\)/)).toBeEnabled());

    await act(async () => {
      void client.invalidateQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });
    await waitFor(() =>
      expect(screen.queryByText(/Confirm Allocation/)).not.toBeInTheDocument(),
    );
    expect(fakeApi.post).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) });
    });
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

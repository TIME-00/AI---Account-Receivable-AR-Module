// ============================================================================
// B9DD-CDR-002 — Live query-generation enforcement.
//
// The defect this file exists to prove is fixed:
//
//   `isContractVerified` was computed during RENDER and then captured by every
//   `useCallback`. TanStack Query mutates its cache SYNCHRONOUSLY and notifies
//   observers, but React commits the resulting render LATER. In that window a
//   callback captured from the last verified render is still live and still
//   believes it is authorized, while the cache has already moved on.
//
// The previous suite tested receipt DESELECTION/RESELECTION and called it a
// refetch. It is not: unmounting the query and mounting a different one never
// produces the state that actually breaks — same query, still mounted, cached
// data retained, callbacks already captured.
//
// Everything here uses the REAL QueryClient, the REAL canonical query key, the
// REAL hook, the REAL contract parser and the REAL allocation logic. The
// background fetches are genuine (`invalidateQueries` / `refetch()`), and the
// stale callbacks are genuinely captured before the cache moves.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { defaultScheduler, notifyManager, QueryClient } from "@tanstack/react-query";
import {
  Providers,
  createTestQueryClient,
  createFakeApi,
  createDeferred,
  route,
  type FakeApi,
  type FakeResponse,
} from "@/test/harness";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

import { useCompanyStore } from "@/stores/company-store";
import {
  useAllocationCandidates,
  useLiveAllocationContract,
  useAllocationCandidateQueryRevision,
  allocationCandidateLifecycleEventEpoch,
  allocationCandidateQueryRevision,
  allocationCandidateQueryKey,
  toAllocationInvoice,
  toAllocationReceipt,
} from "@/hooks/use-allocations";
import {
  useAllocationLogic,
  createReceiptSelectionHandler,
  type AllocationInvoice,
  type AllocationReceipt,
} from "@/hooks/use-allocation-logic";
import {
  ALLOCATION_CANDIDATE_MAX,
  bindingsMatch,
  type AllocationContractBinding,
} from "@/lib/allocation-candidate-contract";

// B9DD-FDR-002: the candidate cache is COMPANY-scoped, so every key needs
// the active tenant. Seeded in beforeEach via the real store.
const COMPANY_ID = "cccccccc-0000-0000-0000-00000000000c";
const RCP_A = "11111111-1111-1111-1111-111111111111";
const RCP_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CUST_A = "22222222-2222-2222-2222-222222222222";
const CUST_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const invId = (n: number) => `33333333-3333-3333-3333-${String(n).padStart(12, "0")}`;

/**
 * A binding whose company, Query-instance epoch and generation can each be
 * varied INDEPENDENTLY while every other field stays byte-identical. That is
 * what lets each authority rule be proved on its own, rather than inferred
 * from a scenario where several fields move together.
 */
const bindingAt = (
  dataUpdateCount: number,
  dataUpdatedAt: number,
  queryEpoch = 1,
  companyId = COMPANY_ID,
  queryLifecycleEpoch = 1,
): AllocationContractBinding => ({
  companyId,
  queryEpoch,
  queryLifecycleEpoch,
  receiptId: RCP_A,
  receiptVersion: 1,
  unallocatedAmount: 300,
  customerId: CUST_A,
  currency: "USD",
  fingerprint: "fp-identical",
  queryGeneration: { dataUpdateCount, dataUpdatedAt },
  generation: 0,
  candidates: [{ id: invId(1), version: 1 }],
});

const FROZEN = 1_800_000_000_000;

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

function contractFor(
  receiptId: string,
  customerId: string,
  candidates: unknown[],
  over: Record<string, unknown> = {},
) {
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

/**
 * The workbench wiring under test: the real candidate query, the real live
 * verifier and the real allocation logic, bound exactly as the page binds them.
 */
/**
 * As `useWorkbench`, but owning the receipt SELECTION exactly as the page does —
 * via the shared `createReceiptSelectionHandler`. This is what lets a test
 * invoke the REAL selection handler inside one synchronous event, rather than
 * simulating it with `rerender({ id: RCP_B })` (which would skip the very window
 * B9DD-CRR-002 is about).
 */
function useSelectableWorkbench(initialId: string | null) {
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(initialId);
  const wb = useWorkbench(selectedReceiptId);
  // The SAME factory the page uses — not a re-implementation of its ordering.
  const selectReceiptId = useMemo(
    () => createReceiptSelectionHandler(wb.logic.clearSelection, setSelectedReceiptId),
    [wb.logic.clearSelection],
  );
  return { ...wb, selectedReceiptId, selectReceiptId };
}

function useWorkbench(receiptId: string | null) {
  const query = useAllocationCandidates(receiptId);
  // B9DD-FRR-001: mirrors the page — the rebind is driven by the collision-free
  // QueryCache revision, never by `dataUpdatedAt` or any render-visible value.
  const queryRevision = useAllocationCandidateQueryRevision(receiptId);
  const readLiveContract = useLiveAllocationContract(receiptId);
  const verifyLiveContract = useCallback(
    () => readLiveContract()?.binding ?? null,
    [readLiveContract],
  );
  const logic = useAllocationLogic({ verifyLiveContract });

  const contract = query.data;
  const isVerified =
    query.isSuccess && !query.isFetching && contract !== undefined && contract.receipt.id === receiptId;

  const { bindVerifiedContract, revokeContractAuthority, clearSelection } = logic;
  useLayoutEffect(() => {
    if (!receiptId) {
      clearSelection();
      return;
    }
    // Mirrors the page: bind from ONE atomic live read so the contract and its
    // fetch generation always come from the same snapshot (B9DD-CRR-001).
    const live = readLiveContract();
    if (live) {
      bindVerifiedContract(
        toAllocationReceipt(live.contract.receipt),
        live.contract.candidates.map((c) => toAllocationInvoice(c)),
        live.binding,
      );
      return;
    }
    revokeContractAuthority();
  }, [
    receiptId,
    queryRevision,
    readLiveContract,
    bindVerifiedContract,
    revokeContractAuthority,
    clearSelection,
  ]);

  return { query, logic, isVerified, queryRevision, readLiveContract };
}

/** Script the candidates route response-by-response. */
let script: Array<FakeResponse | Promise<FakeResponse>> = [];
function nextResponse(): FakeResponse | Promise<FakeResponse> {
  const next = script.shift();
  if (!next) throw new Error("candidates route called more times than scripted");
  return next;
}

function makeApi() {
  return createFakeApi([route("/allocations/candidates", () => nextResponse())]);
}

/** Every candidate request actually issued — used to prove no refetch loop. */
const candidateCalls = () => fakeApi.calls.filter((c) => c.path === "/allocations/candidates");

function renderWorkbench(receiptId: string | null = RCP_A) {
  const client: QueryClient = createTestQueryClient();
  const view = renderHook(({ id }: { id: string | null }) => useWorkbench(id), {
    initialProps: { id: receiptId },
    wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
  });
  return { ...view, client };
}

/** Settle into a verified contract with one allocation line entered. */
async function verifiedWithLine(client: QueryClient, result: { current: ReturnType<typeof useWorkbench> }) {
  await waitFor(() => expect(result.current.isVerified).toBe(true));
  await waitFor(() => expect(result.current.logic.invoices).toHaveLength(1));

  const invoice = result.current.logic.invoices[0];
  act(() => result.current.logic.addInvoice(invoice));
  act(() => result.current.logic.updateAmount(invoice.id, 100));
  expect(result.current.logic.lines).toHaveLength(1);
  expect(result.current.logic.validation.canSubmit).toBe(true);
  return invoice;
}

/** Everything a stale render captured, frozen at the moment it was verified. */
function captureStaleCallbacks(result: { current: ReturnType<typeof useWorkbench> }) {
  const l = result.current.logic;
  return {
    addInvoice: l.addInvoice,
    removeInvoice: l.removeInvoice,
    updateAmount: l.updateAmount,
    updateDiscount: l.updateDiscount,
    fillMax: l.fillMax,
    runFifoPreview: l.runFifoPreview,
    buildPayload: l.buildPayload,
    isActionAuthorized: l.isActionAuthorized,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCompanyStore.setState({ companyId: COMPANY_ID, companyName: "Test Co" });
  script = [];
  fakeApi = makeApi();
});

// ─── 3.1 Refetch starts ─────────────────────────────────────────────────────

describe("B9DD-CDR-002 §3.1 — background refetch STARTS", () => {
  it("rejects stale callbacks the moment a same-query refetch begins, before React re-renders", async () => {
    const deferred = createDeferred<FakeResponse>();
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, deferred.promise];

    const { result, client } = renderWorkbench();
    const invoice = await verifiedWithLine(client, result);
    const stale = captureStaleCallbacks(result);
    const generationBefore = result.current.logic.boundGeneration;
    const other: AllocationInvoice = { ...invoice, id: invId(9), invoice_no: "INV-0009" };

    // Start a REAL background refetch on the SAME mounted query. The response
    // is HELD by a deferred, so the query stays in flight; initiating inside
    // act() lets React commit the fetching render without any un-acted update.
    // The window is real and reachable, not manufactured: the cache reports
    // `fetching` while the previous data is still cached.
    await act(async () => {
      void client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    const state = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A));
    expect(state?.fetchStatus).toBe("fetching");
    // Cached data is RETAINED during a background refetch — this is the trap.
    expect(state?.data).toBeDefined();
    expect(state?.status).toBe("success");

    // Every captured action must now refuse, from the live cache read alone:
    // `fetchStatus !== "idle"` means these figures are already being replaced.
    expect(stale.isActionAuthorized()).toBe(false);
    expect(stale.buildPayload()).toBeNull();
    act(() => {
      stale.addInvoice(other);
      stale.updateAmount(invoice.id, 250);
      stale.updateDiscount(invoice.id, 5);
      stale.fillMax(invoice.id);
      stale.runFifoPreview();
      stale.removeInvoice(invoice.id);
    });

    // No mutation was ever constructed, let alone sent.
    expect(fakeApi.post).not.toHaveBeenCalled();

    // Let the refetch land, then confirm the committed UI is non-actionable and
    // the previous read's lines are gone.
    await act(async () => {
      deferred.resolve({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) });
    });
    // Wait for the REBIND, not for `isVerified` — which was already true and
    // would make this assertion pass without the refetch ever landing.
    await waitFor(() =>
      expect(result.current.logic.boundGeneration).toBeGreaterThan(generationBefore),
    );
    expect(result.current.isVerified).toBe(true);
    expect(result.current.logic.lines).toEqual([]);
    expect(result.current.logic.validation.canSubmit).toBe(false);
  });

  it("clears candidates and lines while the refetch is in flight", async () => {
    const deferred = createDeferred<FakeResponse>();
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, deferred.promise];

    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);

    await act(async () => {
      void client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });
    await waitFor(() => expect(result.current.query.isFetching).toBe(true));

    // The in-flight render is a LOADING state, not a stale-but-usable one.
    expect(result.current.isVerified).toBe(false);
    expect(result.current.logic.invoices).toEqual([]);
    expect(result.current.logic.lines).toEqual([]);
    expect(result.current.logic.validation.canSubmit).toBe(false);

    await act(async () => {
      deferred.resolve({ data: contractFor(RCP_A, CUST_A, [candidate(1)]) });
    });
    await waitFor(() => expect(result.current.isVerified).toBe(true));
  });
});

// ─── B9DD-CRR-001: identical-content refetch generation window ──────────────

describe("B9DD-CRR-001 — byte-IDENTICAL background refetch", () => {
  it("advances the bound generation and discards the old lines", async () => {
    // The defect this pins, reproduced against the content-only binding:
    //
    //   status: "success", fetchStatus: "idle", dataUpdateCount: 1 -> 2,
    //   sameDataRef: true, boundGeneration: still 1,
    //   STALE_AUTHORIZED: true, STALE_PAYLOAD_NOT_NULL: true
    //
    // Content-based binding could not see it: the refetch is byte-identical, so
    // every content field compares EQUAL. Only the authoritative fetch
    // generation distinguishes "the read you bound" from "a newer read".
    //
    // B9DD-FRR-001 note: this test formerly asserted denial in the window
    // between the cache settling and React rebinding. The QueryCache
    // subscription now notifies React synchronously with that same cache event,
    // so the window is closed at the source and cannot be staged here. The
    // mismatch RULE is asserted directly in "Generation mismatch denies" above.
    const identical = () => contractFor(RCP_A, CUST_A, [candidate(1)]);
    script = [{ data: identical() }, { data: identical() }];

    const { result, client } = renderWorkbench();
    const invoice = await verifiedWithLine(client, result);
    const stale = captureStaleCallbacks(result);
    const boundGenerationBefore = result.current.logic.boundGeneration;
    const stateBefore = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A));
    const other: AllocationInvoice = { ...invoice, id: invId(9), invoice_no: "INV-0009" };

    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    const stateAfter = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A));
    expect(stateAfter?.status).toBe("success");
    expect(stateAfter?.fetchStatus).toBe("idle");
    expect(stateAfter!.dataUpdateCount).toBeGreaterThan(stateBefore!.dataUpdateCount);
    // Structural sharing: the data reference is literally unchanged, which is
    // exactly why content comparison alone was blind here.
    expect(stateAfter!.data).toBe(stateBefore!.data);

    // The workbench followed the generation, and the old lines are gone.
    await waitFor(() =>
      expect(result.current.logic.boundGeneration).toBeGreaterThan(boundGenerationBefore),
    );
    expect(result.current.logic.lines).toEqual([]);
    expect(result.current.isVerified).toBe(true);

    // Callbacks captured against the old generation cannot resurrect its work.
    stale.addInvoice(other);
    stale.runFifoPreview();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("binds the exact fetch generation, and rejects any later one", async () => {
    const identical = () => contractFor(RCP_A, CUST_A, [candidate(1)]);
    script = [{ data: identical() }, { data: identical() }];

    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);

    const before = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A))!;
    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });
    const after = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A))!;

    // `dataUpdateCount` is the load-bearing field: monotonic, collision-free.
    expect(after.dataUpdateCount).toBe(before.dataUpdateCount + 1);
    // `dataUpdatedAt` is carried too, but is only millisecond-resolution — two
    // fetches inside one millisecond would collide, which is precisely why it is
    // not relied upon alone.
    expect(typeof after.dataUpdatedAt).toBe("number");
  });
});

// ─── 3.2 Failed refetch with retained data ──────────────────────────────────

describe("B9DD-CDR-002 §3.2 — background refetch FAILS with retained data", () => {
  it("refuses to act on cached data that survived a failed refetch", async () => {
    const failing = createDeferred<FakeResponse>();
    // Attach a catch immediately so the rejection is never "unhandled" before
    // the query consumes it.
    failing.promise.catch(() => undefined);
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, failing.promise];

    const { result, client } = renderWorkbench();
    const invoice = await verifiedWithLine(client, result);
    const stale = captureStaleCallbacks(result);

    await act(async () => {
      const refetch = client
        .refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) })
        .catch(() => undefined);
      failing.reject(new Error("network down"));
      await refetch;
    });
    await waitFor(() => expect(result.current.query.isError).toBe(true));

    const state = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A));
    // TanStack RETAINS the old data and reports a refetch error. Believing the
    // retained data here is precisely the failure mode being closed.
    expect(state?.data).toBeDefined();
    expect(state?.status).toBe("error");
    expect(state?.error).toBeTruthy();

    // Live verifier rejects the retained data.
    expect(stale.isActionAuthorized()).toBe(false);
    expect(result.current.logic.isActionAuthorized()).toBe(false);

    // Candidates and lines are gone; nothing remains to submit.
    expect(result.current.logic.invoices).toEqual([]);
    expect(result.current.logic.lines).toEqual([]);
    expect(result.current.logic.validation.canSubmit).toBe(false);

    // Captured stale payload/submit callbacks are inert.
    expect(stale.buildPayload()).toBeNull();
    expect(result.current.logic.buildPayload()).toBeNull();
    stale.updateAmount(invoice.id, 999);
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

// ─── 3.3 Malformed refetch ──────────────────────────────────────────────────

describe("B9DD-CDR-002 §3.3 — background refetch returns a MALFORMED contract", () => {
  it("does not let the previous valid contract remain actionable", async () => {
    script = [
      { data: contractFor(RCP_A, CUST_A, [candidate(1)]) },
      // `complete: false` is a refusal, not a degraded success.
      { data: contractFor(RCP_A, CUST_A, [candidate(1)], { complete: false }) },
    ];

    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);
    const stale = captureStaleCallbacks(result);

    await act(async () => {
      await client
        .refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) })
        .catch(() => undefined);
    });

    // The parser rejected it, so the query is errored — the old valid contract
    // must NOT be promoted back into authority.
    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.isVerified).toBe(false);
    expect(result.current.logic.invoices).toEqual([]);
    expect(result.current.logic.lines).toEqual([]);
    expect(stale.isActionAuthorized()).toBe(false);
    expect(stale.buildPayload()).toBeNull();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

// ─── 3.4 Verified-empty refetch ─────────────────────────────────────────────

describe("B9DD-CDR-002 §3.4 — background refetch returns VERIFIED EMPTY", () => {
  it("clears the old line and reports a verified empty set, not an error", async () => {
    script = [
      { data: contractFor(RCP_A, CUST_A, [candidate(1)]) },
      { data: contractFor(RCP_A, CUST_A, []) },
    ];

    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);

    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    await waitFor(() => expect(result.current.logic.invoices).toEqual([]));
    // Verified — this is a TRUE empty, and the distinction matters: an empty
    // list is only claimable when the contract says so.
    expect(result.current.isVerified).toBe(true);
    expect(result.current.query.isError).toBe(false);
    expect(result.current.query.data!.total).toBe(0);
    expect(result.current.logic.lines).toEqual([]);
    expect(result.current.logic.validation.canSubmit).toBe(false);
    expect(result.current.logic.buildPayload()).toBeNull();
  });
});

// ─── 3.5 Changed candidate refetch ──────────────────────────────────────────

describe("B9DD-CDR-002 §3.5 — background refetch returns a CHANGED contract", () => {
  const CHANGES: Array<[string, () => unknown]> = [
    ["candidate version", () => contractFor(RCP_A, CUST_A, [candidate(1, { version: 2 })])],
    ["candidate outstanding", () => contractFor(RCP_A, CUST_A, [candidate(1, { outstanding: 50 })])],
    ["candidate status", () => contractFor(RCP_A, CUST_A, [candidate(1, { status: "Partially Paid" })])],
    [
      "receipt version",
      () => contractFor(RCP_A, CUST_A, [candidate(1)], { receipt: { version: 2 } }),
    ],
    [
      "receipt unallocated amount",
      () => contractFor(RCP_A, CUST_A, [candidate(1)], { receipt: { unallocated_amount: 25 } }),
    ],
    [
      "currency",
      () =>
        contractFor(RCP_A, CUST_A, [candidate(1, { currency: "SGD" })], {
          currency: "SGD",
          receipt: { currency: "SGD" },
        }),
    ],
    [
      "customer identity",
      () =>
        contractFor(RCP_A, CUST_B, [candidate(1)], {
          receipt: { customer_id: CUST_B, customer_name: "Beta" },
        }),
    ],
    ["candidate set", () => contractFor(RCP_A, CUST_A, [candidate(2)])],
  ];

  it.each(CHANGES)(
    "discards the old generation's lines when %s changed",
    async (_name, build) => {
      // B9DD-FRR-001 note: this test previously asserted denial in the
      // "changed data arrived, not yet rebound" window. Since the rebind is now
      // driven by a QueryCache subscription, React is notified synchronously by
      // the same event that lands the new contract, so that window no longer
      // exists to observe here — it is closed at the source. The
      // generation/content mismatch RULE it was probing is asserted directly in
      // "Generation mismatch denies (direct rule)" above; what remains
      // observable end-to-end, and is what actually protects the user, is that
      // the old generation's lines never survive into the new one.
      script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, { data: build() }];

      const { result, client } = renderWorkbench();
      const boundBefore = result.current.logic.boundGeneration;
      await verifiedWithLine(client, result);
      const stale = captureStaleCallbacks(result);

      await act(async () => {
        await client
          .refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) })
          .catch(() => undefined);
      });

      // The workbench moved to the new generation and dropped the old lines.
      // `waitFor` because the QueryCache notification is batched through
      // `notifyManager`, so the rebind lands a scheduler tick after the refetch
      // resolves. Safety does not depend on this timing -- invocation-time
      // authorization denies throughout -- so waiting for the committed state is
      // exactly the right assertion here.
      await waitFor(() =>
        expect(result.current.logic.boundGeneration).toBeGreaterThan(boundBefore),
      );
      await waitFor(() => expect(result.current.logic.lines).toEqual([]));
      expect(result.current.logic.validation.canSubmit).toBe(false);

      // A callback captured against the old generation cannot resurrect it.
      stale.runFifoPreview();
      expect(fakeApi.post).not.toHaveBeenCalled();
    },
  );

  it("rebinds to the new contract and drops the old lines once React commits", async () => {
    script = [
      { data: contractFor(RCP_A, CUST_A, [candidate(1)]) },
      { data: contractFor(RCP_A, CUST_A, [candidate(2, { outstanding: 77 })]) },
    ];

    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);
    const firstGeneration = result.current.logic.boundGeneration;

    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    // Wait for the REBIND itself, not for a length that was already true.
    await waitFor(() => expect(result.current.logic.invoices[0]?.invoice_no).toBe("INV-0002"));
    // Old lines are gone; the new candidate is what is shown.
    expect(result.current.logic.lines).toEqual([]);
    expect(result.current.logic.invoices).toHaveLength(1);
    expect(result.current.logic.invoices[0].outstanding).toBe(77);
    expect(result.current.logic.boundGeneration).toBeGreaterThan(firstGeneration);

    // New actions work against the NEW binding only.
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    expect(result.current.logic.lines).toHaveLength(1);
    expect(result.current.logic.lines[0].invoice_no).toBe("INV-0002");
    expect(result.current.logic.isActionAuthorized()).toBe(true);
  });
});

// ─── 3.6 Query-key transition ───────────────────────────────────────────────

describe("B9DD-CDR-002 §3.6 — query-key transition A -> B", () => {
  it("rejects receipt A's callbacks while B loads, and only B becomes actionable", async () => {
    const deferredB = createDeferred<FakeResponse>();
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, deferredB.promise];

    const { result, rerender, client } = renderWorkbench(RCP_A);
    const invoiceA = await verifiedWithLine(client, result);
    const staleA = captureStaleCallbacks(result);

    // Select receipt B — a different query key entirely.
    rerender({ id: RCP_B });

    // A's callbacks are addressed to A's key; the live verifier is now scoped to
    // B, so A's captured callbacks have no authority at all.
    expect(staleA.isActionAuthorized()).toBe(false);
    expect(staleA.buildPayload()).toBeNull();
    staleA.updateAmount(invoiceA.id, 300);
    expect(result.current.isVerified).toBe(false);
    expect(result.current.logic.lines).toEqual([]);

    await act(async () => {
      deferredB.resolve({ data: contractFor(RCP_B, CUST_B, [candidate(3)]) });
    });

    await waitFor(() => expect(result.current.isVerified).toBe(true));
    expect(result.current.logic.selectedReceipt!.id).toBe(RCP_B);
    expect(result.current.logic.invoices[0].invoice_no).toBe("INV-0003");
    // A's callbacks stay dead even after B is verified.
    expect(staleA.buildPayload()).toBeNull();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

// ─── Generation-mismatch rule, tested DIRECTLY (B9DD-CRR-001 safety) ────────
//
// Why this exists as a direct test rather than only as an integration one:
//
// B9DD-FRR-001 replaced the rebind trigger with a `useSyncExternalStore`
// subscription to the QueryCache. React is now notified SYNCHRONOUSLY by the
// same cache event that settles a new generation, and it re-renders and rebinds
// before an awaiting test can observe anything in between. That is strictly
// safer — the "settled generation but not yet rebound" window is closed at the
// source rather than merely policed — but it also means an integration test can
// no longer reproduce that window, and a test that cannot reproduce its own
// premise proves nothing.
//
// So the RULE is asserted here, deterministically, with no dependence on React's
// scheduling: a bound generation that no longer matches the live one denies.
// It remains load-bearing as defence in depth for any deferred/concurrent commit
// (and is what the mutation check in the report targets).

describe("Generation mismatch denies (direct rule, B9DD-CRR-001)", () => {
  const receipt: AllocationReceipt = {
    id: RCP_A,
    receipt_no: "RCP-AAAA",
    receipt_date: "2026-07-01",
    customer_id: CUST_A,
    customer_name: "Acme",
    currency: "USD",
    exchange_rate: 4.4,
    receipt_amount: 1000,
    unallocated_amount: 300,
    payment_method: "TT",
    status: "Posted",
  };
  const invoice: AllocationInvoice = {
    id: invId(1),
    invoice_no: "INV-0001",
    doc_type: "Invoice",
    invoice_date: "2026-06-01",
    due_date: "2026-07-01",
    currency: "USD",
    exchange_rate: 4.4,
    total_amount: 1000,
    outstanding: 400,
    overdue_days: 0,
  };


  function renderBound(live: { current: AllocationContractBinding | null }) {
    const view = renderHook(
      () => useAllocationLogic({ verifyLiveContract: () => live.current }),
      { wrapper: ({ children }) => <Providers>{children}</Providers> },
    );
    act(() => view.result.current.bindVerifiedContract(receipt, [invoice], bindingAt(1, FROZEN)));
    act(() => view.result.current.addInvoice(invoice));
    act(() => view.result.current.updateAmount(invoice.id, 100));
    return view;
  }

  it("authorizes while the live generation matches the bound one", () => {
    const live = { current: bindingAt(1, FROZEN) };
    const { result } = renderBound(live);
    expect(result.current.isActionAuthorized()).toBe(true);
    expect(result.current.buildPayload()).not.toBeNull();
  });

  it("denies when ONLY dataUpdateCount advanced and the timestamp is identical", () => {
    // The exact same-millisecond collision, at the rule level: every content
    // field is equal and `dataUpdatedAt` is byte-for-byte the same. Only the
    // collision-free counter distinguishes the generations. A content-only or
    // timestamp-only rule would authorize here.
    const live = { current: bindingAt(1, FROZEN) };
    const { result } = renderBound(live);
    expect(result.current.isActionAuthorized()).toBe(true);

    live.current = bindingAt(2, FROZEN);
    expect(result.current.isActionAuthorized()).toBe(false);
    expect(result.current.buildPayload()).toBeNull();
  });

  it("denies when the live query is gone", () => {
    const live = { current: bindingAt(1, FROZEN) } as { current: AllocationContractBinding | null };
    const { result } = renderBound(live);
    live.current = null;
    expect(result.current.isActionAuthorized()).toBe(false);
    expect(result.current.buildPayload()).toBeNull();
  });

  it("denies when the timestamp advanced but the counter did not", () => {
    // Defence in depth in the other direction: both fields must agree.
    const live = { current: bindingAt(1, FROZEN) };
    const { result } = renderBound(live);
    live.current = bindingAt(1, FROZEN + 1);
    expect(result.current.isActionAuthorized()).toBe(false);
    expect(result.current.buildPayload()).toBeNull();
  });

  // ── B9DD-FDR-001: Query INSTANCE identity ─────────────────────────────────

  it("denies a DIFFERENT Query instance even when every other field repeats", () => {
    // The exact remove/reset/recreate collision, isolated: same company, same
    // receipt, same content, same `dataUpdateCount`, same `dataUpdatedAt` — only
    // the Query instance differs. A generation-only rule authorizes here, because
    // `dataUpdateCount` restarts at zero on a new instance and re-reaches the
    // same value.
    const live = { current: bindingAt(1, FROZEN, 1) };
    const { result } = renderBound(live);
    expect(result.current.isActionAuthorized()).toBe(true);

    live.current = bindingAt(1, FROZEN, 2); // recreated Query, identical tokens
    expect(result.current.isActionAuthorized()).toBe(false);
    expect(result.current.buildPayload()).toBeNull();
  });

  // ── B9DD-FDR-002: tenant identity ─────────────────────────────────────────

  it("denies a DIFFERENT company even when every other field repeats", () => {
    const live = { current: bindingAt(1, FROZEN, 1, COMPANY_ID) };
    const { result } = renderBound(live);
    expect(result.current.isActionAuthorized()).toBe(true);

    live.current = bindingAt(1, FROZEN, 1, "dddddddd-0000-0000-0000-00000000000d");
    expect(result.current.isActionAuthorized()).toBe(false);
    expect(result.current.buildPayload()).toBeNull();
  });

  it("checks tenant before instance, and instance before generation", () => {
    // The ordering the review asked for, asserted rather than assumed: a later
    // instance or a different tenant must fail BEFORE any repeated
    // generation/content value is considered.
    const bound = bindingAt(1, FROZEN, 1, COMPANY_ID);
    // Different company, everything else identical.
    expect(bindingsMatch(bound, bindingAt(1, FROZEN, 1, "eeeeeeee-0000-0000-0000-00000000000e"))).toBe(false);
    // Different instance, everything else identical.
    expect(bindingsMatch(bound, bindingAt(1, FROZEN, 2, COMPANY_ID))).toBe(false);
    // Same instance and QueryState generation, but a later cache lifecycle.
    expect(bindingsMatch(bound, bindingAt(1, FROZEN, 1, COMPANY_ID, 2))).toBe(false);
    // Different generation, everything else identical.
    expect(bindingsMatch(bound, bindingAt(2, FROZEN, 1, COMPANY_ID))).toBe(false);
    // All equal.
    expect(bindingsMatch(bound, bindingAt(1, FROZEN, 1, COMPANY_ID))).toBe(true);
  });
});

// ─── Binding-session identity (old-callback hardening) ──────────────────────

describe("Binding session — old callbacks cannot ride a newer binding", () => {
  it("denies a callback whose session has been superseded", () => {
    // The rule at its most isolated: the CURRENT binding is perfectly valid, so
    // company/instance/generation/content all pass. Only the callback's session
    // is stale — and that alone must deny, because that callback's captured
    // `invoices`/`lines` belong to the previous generation.
    const live = { current: bindingAt(1, FROZEN) };
    const { result } = renderHook(
      () => useAllocationLogic({ verifyLiveContract: () => live.current }),
      { wrapper: ({ children }) => <Providers>{children}</Providers> },
    );

    const receipt: AllocationReceipt = {
      id: RCP_A,
      receipt_no: "RCP-AAAA",
      receipt_date: "2026-07-01",
      customer_id: CUST_A,
      customer_name: "Acme",
      currency: "USD",
      exchange_rate: 4.4,
      receipt_amount: 1000,
      unallocated_amount: 300,
      payment_method: "TT",
      status: "Posted",
    };
    const invoice: AllocationInvoice = {
      id: invId(1),
      invoice_no: "INV-0001",
      doc_type: "Invoice",
      invoice_date: "2026-06-01",
      due_date: "2026-07-01",
      currency: "USD",
      exchange_rate: 4.4,
      total_amount: 1000,
      outstanding: 400,
      overdue_days: 0,
    };

    act(() => result.current.bindVerifiedContract(receipt, [invoice], bindingAt(1, FROZEN)));
    const sessionN = result.current.bindingSession;
    expect(result.current.isActionAuthorized(sessionN)).toBe(true);

    // Rebind: a NEW session, byte-identical content.
    act(() => result.current.bindVerifiedContract(receipt, [invoice], bindingAt(1, FROZEN)));
    const sessionNext = result.current.bindingSession;
    expect(sessionNext).not.toBe(sessionN);

    // The current binding is valid...
    expect(result.current.isActionAuthorized(sessionNext)).toBe(true);
    // ...but session N is dead, forever.
    expect(result.current.isActionAuthorized(sessionN)).toBe(false);
  });

  it("shows why validation.canSubmit alone is NOT live authority (B9DD-FDR-003)", () => {
    // The premise of FDR-003, demonstrated rather than asserted.
    //
    // `validation.canSubmit` is a useMemo over [lines, selectedReceipt,
    // invoices, isActionAuthorized, session]. When the LIVE authority changes
    // without any of those changing, the memo does not recompute — so it keeps
    // reporting `true` while invocation-time authorization already denies. That
    // is exactly the enabled-but-inert Confirm button the user experienced.
    //
    // This is why the page computes `canSubmitNow = validation.canSubmit &&
    // presentationAuthorityValid`, where the second term is recomputed from the
    // live query revision.
    const live = { current: bindingAt(1, FROZEN) };
    const { result } = renderHook(
      () => useAllocationLogic({ verifyLiveContract: () => live.current }),
      { wrapper: ({ children }) => <Providers>{children}</Providers> },
    );

    const receipt: AllocationReceipt = {
      id: RCP_A,
      receipt_no: "RCP-AAAA",
      receipt_date: "2026-07-01",
      customer_id: CUST_A,
      customer_name: "Acme",
      currency: "USD",
      exchange_rate: 4.4,
      receipt_amount: 1000,
      unallocated_amount: 300,
      payment_method: "TT",
      status: "Posted",
    };
    const invoice: AllocationInvoice = {
      id: invId(1),
      invoice_no: "INV-0001",
      doc_type: "Invoice",
      invoice_date: "2026-06-01",
      due_date: "2026-07-01",
      currency: "USD",
      exchange_rate: 4.4,
      total_amount: 1000,
      outstanding: 400,
      overdue_days: 0,
    };

    act(() => result.current.bindVerifiedContract(receipt, [invoice], bindingAt(1, FROZEN)));
    act(() => result.current.addInvoice(invoice));
    act(() => result.current.updateAmount(invoice.id, 100));
    expect(result.current.validation.canSubmit).toBe(true);

    // The live authority moves — a new generation, a recreated Query, or a
    // tenant switch — with no local state change to trigger the memo.
    live.current = bindingAt(2, FROZEN);

    // The memo is STALE: it still says the user may submit...
    expect(result.current.validation.canSubmit).toBe(true);
    // ...while the live authority already denies, and no payload can be built.
    expect(result.current.isActionAuthorized(result.current.bindingSession)).toBe(false);
    expect(result.current.buildPayload()).toBeNull();
  });

  it("denies every session once authority is revoked", () => {
    const live = { current: bindingAt(1, FROZEN) } as { current: AllocationContractBinding | null };
    const { result } = renderHook(
      () => useAllocationLogic({ verifyLiveContract: () => live.current }),
      { wrapper: ({ children }) => <Providers>{children}</Providers> },
    );
    act(() => result.current.revokeContractAuthority());
    expect(result.current.bindingSession).toBeNull();
    expect(result.current.isActionAuthorized(null)).toBe(false);
    expect(result.current.isActionAuthorized(1)).toBe(false);
  });
});

// ─── B9DD-FRR-001: same-timestamp generation collision (liveness) ───────────

describe("B9DD-FRR-001 — byte-identical refetch in the SAME millisecond", () => {
  const FROZEN_NOW = 1_800_000_000_000;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still rebinds, clears lines and recovers when dataUpdatedAt cannot change", async () => {
    // Deterministic reproduction of the exact Codex case. TanStack stamps
    // `dataUpdatedAt: dataUpdatedAt ?? Date.now()` (query-core ~414), so freezing
    // `Date.now` forces BOTH successful reads to share a timestamp — the real
    // same-millisecond collision, made reliable rather than hoped for.
    //
    // Against the previous `dataUpdatedAt`-only effect this reproduced as:
    //   dataUpdateCount: 1 -> 2   dataUpdatedAtEqual: true   sameDataRef: true
    //   boundGeneration: 1 -> 1   REBOUND: false             lines: 1 (retained)
    //   ACTIONABLE_NOW: false     canSubmit: true
    // i.e. permanently denied, while the Confirm button still rendered enabled.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(FROZEN_NOW);

    const identical = () => contractFor(RCP_A, CUST_A, [candidate(1)]);
    script = [{ data: identical() }, { data: identical() }];

    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);

    const stateBefore = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A))!;
    const boundGenerationBefore = result.current.logic.boundGeneration;
    const revisionBefore = result.current.queryRevision;
    // (2)+(3): generation N is bound.
    expect(stateBefore.dataUpdateCount).toBe(1);

    // (5): capture the pre-refetch callbacks. They are not invoked after the
    // rebind: with handlers rewired on every commit, a post-rebind invocation of
    // a pre-rebind closure is not a path the page can take, and staging one here
    // would only assert an artificial scenario. The pre-rebind denial rule is
    // asserted directly in "Generation mismatch denies" above.
    captureStaleCallbacks(result);

    // (6)+(7): a real same-key background refetch returning byte-identical data.
    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });

    const stateAfter = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A))!;
    // (8): structural sharing keeps the very same data reference.
    expect(stateAfter.data).toBe(stateBefore.data);
    // (9): the timestamp is EXACTLY equal — the collision, reproduced.
    expect(stateAfter.dataUpdatedAt).toBe(stateBefore.dataUpdatedAt);
    // (10): only the collision-free counter advanced.
    expect(stateAfter.dataUpdateCount).toBe(stateBefore.dataUpdateCount + 1);

    // (11)-(13): React observes the collision-free revision and rebinds to N+1.
    //
    // Note on the "before rebind" step: with the QueryCache subscription, React
    // is notified SYNCHRONOUSLY by the same cache event that settles the new
    // generation, so it has already rebound by the time this line runs. That
    // window is now closed at the source rather than merely policed — which is
    // why the generation-mismatch RULE is asserted directly above instead of
    // being staged through React's scheduler here.
    await waitFor(() =>
      expect(result.current.logic.boundGeneration).toBeGreaterThan(boundGenerationBefore),
    );
    // The revision itself changed even though the timestamp did not.
    expect(result.current.queryRevision).not.toBe(revisionBefore);
    expect(result.current.queryRevision).toContain("|2|");

    // (14): the previous generation's lines are gone.
    expect(result.current.logic.lines).toEqual([]);

    // (15)+(16): the workbench is actionable again — NOT permanently denied.
    expect(result.current.isVerified).toBe(true);
    await waitFor(() => expect(result.current.logic.invoices).toHaveLength(1));
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    act(() => result.current.logic.updateAmount(invId(1), 50));
    expect(result.current.logic.isActionAuthorized()).toBe(true);
    expect(result.current.logic.validation.canSubmit).toBe(true);
    expect(result.current.logic.buildPayload()).toEqual({
      receipt_id: RCP_A,
      allocations: [{ invoice_id: invId(1), amount: 50 }],
    });

    // (17): no mutation POST at any point in the transition.
    expect(fakeApi.post).not.toHaveBeenCalled();
    expect(nowSpy).toHaveBeenCalled();
  });

  it("produces exactly one bind per successful generation (no rebind loop)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FROZEN_NOW);
    const identical = () => contractFor(RCP_A, CUST_A, [candidate(1)]);
    script = [{ data: identical() }, { data: identical() }];

    const { result, client } = renderWorkbench();
    await waitFor(() => expect(result.current.isVerified).toBe(true));
    const genAfterFirst = result.current.logic.boundGeneration;

    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });
    await waitFor(() => expect(result.current.logic.boundGeneration).toBe(genAfterFirst + 1));

    // Settle: no further binds and no further network calls without a new
    // revision. A revision-driven effect that re-triggered itself would keep
    // incrementing here.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(result.current.logic.boundGeneration).toBe(genAfterFirst + 1);
    expect(candidateCalls()).toHaveLength(2);
    expect(script).toHaveLength(0);
  });

  it("ignores unrelated QueryCache activity", async () => {
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }];
    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);

    const revisionBefore = result.current.queryRevision;
    const generationBefore = result.current.logic.boundGeneration;

    // The QueryCache subscription is GLOBAL, so it fires for every query. The
    // revision is derived only from the candidate key, so an unrelated write
    // must not read as an allocation generation change (which would wrongly
    // clear the user's lines).
    await act(async () => {
      client.setQueryData(["some", "unrelated", "query"], { hello: "world" });
      client.setQueryData(["receipts", "posted", undefined], []);
    });

    expect(result.current.queryRevision).toBe(revisionBefore);
    expect(result.current.logic.boundGeneration).toBe(generationBefore);
    expect(result.current.logic.lines).toHaveLength(1);
    expect(result.current.logic.isActionAuthorized()).toBe(true);
  });

  it("revokes authority when the query is removed, and rebinds when it is recreated", async () => {
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, { data: contractFor(RCP_A, CUST_A, [candidate(1)]) }];
    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);
    const stale = captureStaleCallbacks(result);
    const sessionAtRemoval = result.current.logic.bindingSession;

    // Removal is an observable revision, so authority is revoked rather than
    // left dangling on a query that no longer exists.
    //
    // The revision reports `missing` the instant the query is gone. Read it from
    // the pure helper against the cache BEFORE the mounted observer recreates
    // the query -- `removeQueries` itself is wrapped in act() because it
    // re-renders the observer.
    let revisionAtRemoval = "";
    await act(async () => {
      client.removeQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
      revisionAtRemoval = allocationCandidateQueryRevision(client, RCP_A);
    });
    expect(revisionAtRemoval).toContain("missing");
    // Session-scoped: callbacks captured before the removal are dead, and stay
    // dead however fast the mounted observer recreates the query.
    expect(stale.isActionAuthorized(sessionAtRemoval)).toBe(false);
    expect(stale.buildPayload()).toBeNull();
    await waitFor(() => expect(result.current.logic.lines).toEqual([]));

    // The recreated query restarts `dataUpdateCount` from zero, so it will soon
    // reach the same numeric value the removed one had. That cannot resurrect
    // anything: there is only ever ONE bound binding, and removal revoked it
    // (above) BEFORE recreation — so no stale binding survives to match.

    // The observer refetches the recreated query; it must bind normally again.
    await waitFor(() => expect(result.current.isVerified).toBe(true));
    await waitFor(() => expect(result.current.logic.invoices).toHaveLength(1));
    // The recreated query's bind created a NEW session.
    expect(result.current.logic.bindingSession).not.toBe(sessionAtRemoval);
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    expect(result.current.logic.isActionAuthorized(result.current.logic.bindingSession)).toBe(true);
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

// ─── Old callbacks after a rebind (binding-session hardening) ───────────────

describe("Stale callbacks cannot act under a LATER binding", () => {
  /** Everything session N captured, invoked after N+1 is active. */
  const CASES: Array<[string, () => unknown]> = [
    ["byte-identical", () => contractFor(RCP_A, CUST_A, [candidate(1)])],
    ["changed outstanding", () => contractFor(RCP_A, CUST_A, [candidate(1, { outstanding: 77, version: 2 })])],
  ];

  it.each(CASES)("denies every session-N callback after an N+1 %s bind", async (_name, build) => {
    // Before the session rule, an old callback read the newest `boundRef` and
    // therefore PASSED against N+1 — while acting on N's captured `invoices` and
    // `lines`. A stale FIFO closure could repopulate the workbench with the old
    // generation's rows, producing a duplicate line for the same invoice.
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, { data: build() }];

    const { result, client } = renderWorkbench();
    const invoice = await verifiedWithLine(client, result);
    const sessionN = result.current.logic.bindingSession;
    const stale = captureStaleCallbacks(result);
    const other: AllocationInvoice = { ...invoice, id: invId(9), invoice_no: "INV-0009" };

    // Bind N+1.
    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });
    await waitFor(() => expect(result.current.logic.bindingSession).not.toBe(sessionN));
    const sessionNext = result.current.logic.bindingSession;
    expect(result.current.logic.lines).toEqual([]);

    // Session N is dead even though the CURRENT binding is perfectly valid.
    expect(stale.isActionAuthorized(sessionN)).toBe(false);
    expect(result.current.logic.isActionAuthorized(sessionNext)).toBe(true);

    // Every N callback is inert: nothing added, nothing repopulated, no
    // duplicate, no payload, no POST.
    act(() => {
      stale.addInvoice(other);
      stale.addInvoice(invoice);
      stale.runFifoPreview();
      stale.updateAmount(invoice.id, 999);
      stale.updateDiscount(invoice.id, 5);
      stale.fillMax(invoice.id);
      stale.removeInvoice(invoice.id);
    });
    expect(result.current.logic.lines).toEqual([]);
    expect(result.current.logic.isFifoPreview).toBe(false);
    expect(stale.buildPayload()).toBeNull();
    expect(fakeApi.post).not.toHaveBeenCalled();

    // N+1's own callbacks work normally.
    await waitFor(() => expect(result.current.logic.invoices).toHaveLength(1));
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    act(() => result.current.logic.updateAmount(result.current.logic.invoices[0].id, 25));
    expect(result.current.logic.lines).toHaveLength(1);
    // Exactly one line — the stale adds above contributed nothing.
    expect(result.current.logic.validation.canSubmit).toBe(true);
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("does not let a stale FIFO closure resurrect the previous generation's rows", async () => {
    // The concrete duplicate-line scenario, pinned.
    script = [
      { data: contractFor(RCP_A, CUST_A, [candidate(1)]) },
      { data: contractFor(RCP_A, CUST_A, [candidate(1)]) },
    ];
    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);
    const stale = captureStaleCallbacks(result);
    const sessionN = result.current.logic.bindingSession;

    await act(async () => {
      await client.refetchQueries({ queryKey: allocationCandidateQueryKey(COMPANY_ID, RCP_A) });
    });
    await waitFor(() => expect(result.current.logic.bindingSession).not.toBe(sessionN));

    act(() => stale.runFifoPreview());
    expect(result.current.logic.lines).toEqual([]);

    // The CURRENT session's FIFO still works.
    act(() => result.current.logic.runFifoPreview());
    expect(result.current.logic.lines).toHaveLength(1);
    expect(result.current.logic.isFifoPreview).toBe(true);
    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

// ─── B9DD-FDR-001: Query instance removal / recreation ──────────────────────

describe("B9DD-FDR-001 — removed and recreated Query with IDENTICAL tokens", () => {
  const FROZEN_NOW = 1_800_000_000_000;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives the recreated Query a different epoch, so the old binding cannot revive", async () => {
    // Reproduced against the pre-fix (generation-only) design:
    //
    //   q1IsQ2_objectIdentity: false      <- genuinely a new Query object
    //   dataUpdateCount: 1 -> 1           <- SAME
    //   dataUpdatedAtEqual: true          <- SAME (frozen clock)
    //   contentEqualByFingerprint: true   <- SAME
    //   OLD_BINDING_AUTHORIZED_AGAINST_Q2: true
    //
    // Every token field repeated, because `dataUpdateCount` is monotonic only
    // WITHIN one Query instance and restarts at zero on recreation. Only the
    // instance epoch distinguishes them.
    vi.spyOn(Date, "now").mockReturnValue(FROZEN_NOW);
    const identical = () => contractFor(RCP_A, CUST_A, [candidate(1)]);
    script = [{ data: identical() }, { data: identical() }];

    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);

    const key = allocationCandidateQueryKey(COMPANY_ID, RCP_A);
    const q1 = client.getQueryCache().find({ queryKey: key });
    const s1 = client.getQueryState(key)!;
    const boundGenerationBeforeRemoval = result.current.logic.boundGeneration;
    const revision1 = result.current.queryRevision;
    expect(s1.dataUpdateCount).toBe(1);

    // (5)+(6) Remove Q1; the mounted observer recreates and refetches Q2.
    // `removeQueries` is inside act() (it re-renders the observer); `waitFor` is
    // deliberately OUTSIDE it -- waiting from inside act() nests act scopes and
    // is what React warns about.
    await act(async () => {
      client.removeQueries({ queryKey: key });
    });
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe("success"));

    const q2 = client.getQueryCache().find({ queryKey: key });
    const s2 = client.getQueryState(key)!;

    // (7) Q2 reached the SAME count, timestamp and content as Q1.
    expect(q2).not.toBe(q1);
    expect(s2.dataUpdateCount).toBe(s1.dataUpdateCount);
    expect(s2.dataUpdatedAt).toBe(s1.dataUpdatedAt);
    expect(JSON.stringify(s2.data)).toBe(JSON.stringify(s1.data));

    // (8) The load-bearing assertion: the EPOCH differs, so the revision differs
    // even though every state field above is byte-identical.
    expect(result.current.queryRevision).not.toBe(revision1);

    // (10)+(11) Q2 bound normally and Q1's lines did not survive.
    await waitFor(() =>
      expect(result.current.logic.boundGeneration).toBeGreaterThan(boundGenerationBeforeRemoval),
    );
    expect(result.current.logic.lines).toEqual([]);

    // (12) Only Q2's session is actionable, and it works normally.
    await waitFor(() => expect(result.current.logic.invoices).toHaveLength(1));
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    expect(result.current.logic.lines).toHaveLength(1);
    expect(result.current.logic.isActionAuthorized(result.current.logic.bindingSession)).toBe(true);
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("stays fail-closed when resetQueries reuses the SAME Query object (B9DD-FCR-001)", async () => {
    // The complement of the remove/recreate case above, and the reason the
    // Query-object epoch is NOT the whole story.
    //
    // TanStack 5.95.2 `resetQueries()` calls `query.reset()` on the EXISTING
    // Query object: the object identity — and therefore the WeakMap epoch —
    // is unchanged. State resets to pending/count-zero, the active observer
    // refetches, and a byte-identical response can land on exactly the same
    // dataUpdateCount, dataUpdatedAt and content it had before. The QueryState
    // fields and Query-object epoch repeat; the lifecycle epoch must not.
    //
    // Safety does not come from the Query-object epoch. QueryCache events advance
    // the lifecycle epoch synchronously, then the observed pending/fetching
    // revision rolls the binding session and final success starts a NEW session
    // that the old callbacks do not belong to.
    vi.spyOn(Date, "now").mockReturnValue(FROZEN_NOW);
    const contractC = () => contractFor(RCP_A, CUST_A, [candidate(1)]);
    const held = createDeferred<FakeResponse>();
    script = [{ data: contractC() }, held.promise];

    const { result, client } = renderWorkbench();
    const invoice = await verifiedWithLine(client, result);

    // (6) Record the full authority identity BEFORE the reset.
    const key = allocationCandidateQueryKey(COMPANY_ID, RCP_A);
    const queryBefore = client.getQueryCache().find({ queryKey: key });
    const stateBefore = client.getQueryState(key)!;
    const queryEpochBefore = result.current.readLiveContract()!.binding.queryEpoch;
    const lifecycleEpochBefore = result.current.readLiveContract()!.binding.queryLifecycleEpoch;
    const revisionBefore = result.current.queryRevision;
    const bindingSessionBefore = result.current.logic.bindingSession;
    const boundGenerationBefore = result.current.logic.boundGeneration;
    expect(stateBefore.dataUpdateCount).toBe(1);
    expect(result.current.logic.lines).toHaveLength(1);

    // (7) Capture every action callback from the pre-reset session.
    const stale = captureStaleCallbacks(result);
    const other: AllocationInvoice = { ...invoice, id: invId(9), invoice_no: "INV-0009" };

    // (8) Reset the exact company-scoped candidate query. The response is held,
    // so the intermediate pending/fetching state is observable rather than raced.
    await act(async () => {
      void client.resetQueries({ queryKey: key });
    });

    // (11) The load-bearing intermediate lifecycle.
    const queryDuringReset = client.getQueryCache().find({ queryKey: key });
    // Same Query OBJECT — this is what makes the epoch useless here.
    expect(queryDuringReset).toBe(queryBefore);
    const resetState = client.getQueryState(key)!;
    expect(resetState.dataUpdateCount).toBe(0);
    expect(resetState.status).not.toBe("success");
    // Old authority is gone IMMEDIATELY: the live reader is a synchronous cache
    // read, so it denies the instant the reset lands - before any render.
    expect(result.current.readLiveContract()).toBeNull();
    // The revision observes the reset, so React sees it and rebinds/clears.
    // `waitFor` because the cache notification is batched through
    // `notifyManager`; the DENIAL above never waits for it.
    await waitFor(() => expect(result.current.queryRevision).not.toBe(revisionBefore));
    await waitFor(() => expect(result.current.logic.bindingSession).toBeNull());
    expect(stale.isActionAuthorized(bindingSessionBefore)).toBe(false);
    expect(stale.buildPayload()).toBeNull();
    await waitFor(() => expect(result.current.logic.lines).toEqual([]));

    // (9) The refetch returns the byte-identical contract C.
    await act(async () => {
      held.resolve({ data: contractC() });
    });
    await waitFor(() => expect(result.current.isVerified).toBe(true));
    await waitFor(() => expect(result.current.logic.bindingSession).not.toBeNull());

    // (10) QueryState fields and the Query epoch repeated. The lifecycle epoch
    // deliberately did not.
    const queryAfter = client.getQueryCache().find({ queryKey: key });
    const stateAfter = client.getQueryState(key)!;
    expect(queryAfter).toBe(queryBefore); // SAME Query object
    expect(result.current.readLiveContract()!.binding.queryEpoch).toBe(queryEpochBefore);
    expect(result.current.readLiveContract()!.binding.queryLifecycleEpoch).toBeGreaterThan(
      lifecycleEpochBefore,
    );
    expect(stateAfter.dataUpdateCount).toBe(stateBefore.dataUpdateCount); // 1 -> 0 -> 1
    expect(stateAfter.dataUpdatedAt).toBe(stateBefore.dataUpdatedAt); // frozen clock
    expect(JSON.stringify(stateAfter.data)).toBe(JSON.stringify(stateBefore.data));

    // (12) Despite ALL of that repeating, the old session is dead.
    const bindingSessionAfter = result.current.logic.bindingSession;
    expect(bindingSessionAfter).not.toBe(bindingSessionBefore);
    expect(result.current.logic.boundGeneration).toBeGreaterThan(boundGenerationBefore);
    expect(result.current.logic.lines).toEqual([]);

    expect(stale.isActionAuthorized(bindingSessionBefore)).toBe(false);
    expect(stale.buildPayload()).toBeNull();
    act(() => {
      stale.addInvoice(other);
      stale.addInvoice(invoice);
      stale.runFifoPreview();
      stale.updateAmount(invoice.id, 999);
      stale.updateDiscount(invoice.id, 5);
      stale.fillMax(invoice.id);
      stale.removeInvoice(invoice.id);
    });
    expect(result.current.logic.lines).toEqual([]);
    expect(result.current.logic.isFifoPreview).toBe(false);
    expect(fakeApi.post).not.toHaveBeenCalled();

    // (13) The NEW session works normally.
    await waitFor(() => expect(result.current.logic.invoices).toHaveLength(1));
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    act(() => result.current.logic.updateAmount(invId(1), 25));
    expect(result.current.logic.lines).toHaveLength(1);
    expect(result.current.logic.isActionAuthorized(bindingSessionAfter)).toBe(true);
    expect(result.current.logic.validation.canSubmit).toBe(true);
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("observes an immediate same-object reset even when success settles before scheduled React notification", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FROZEN_NOW);
    const contractC = () => contractFor(RCP_A, CUST_A, [candidate(1)]);
    script = [{ data: contractC() }, { data: contractC() }];

    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);

    const key = allocationCandidateQueryKey(COMPANY_ID, RCP_A);
    const queryBefore = client.getQueryCache().find({ queryKey: key });
    const stateBefore = client.getQueryState(key)!;
    const liveBefore = result.current.readLiveContract()!;
    const queryEpochBefore = liveBefore.binding.queryEpoch;
    const lifecycleEpochBefore = liveBefore.binding.queryLifecycleEpoch;
    const revisionBefore = allocationCandidateQueryRevision(client, RCP_A);
    const bindingSessionBefore = result.current.logic.bindingSession;
    const boundGenerationBefore = result.current.logic.boundGeneration;
    const stale = captureStaleCallbacks(result);
    const invoice = result.current.logic.invoices[0];

    // Hold TanStack's public notification scheduler, NOT the API response. The
    // reset and its byte-identical success both finish before React can receive
    // any scheduled QueryCache/observer callback.
    const scheduled: Array<() => void> = [];
    notifyManager.setScheduler((callback) => scheduled.push(callback));

    try {
      await act(async () => {
        await client.resetQueries({ queryKey: key });
      });

      const queryAfter = client.getQueryCache().find({ queryKey: key });
      const stateAfter = client.getQueryState(key)!;
      expect(queryAfter).toBe(queryBefore);
      expect(result.current.readLiveContract()!.binding.queryEpoch).toBe(queryEpochBefore);
      expect(stateAfter.dataUpdateCount).toBe(stateBefore.dataUpdateCount);
      expect(stateAfter.dataUpdatedAt).toBe(stateBefore.dataUpdatedAt);
      expect(JSON.stringify(stateAfter.data)).toBe(JSON.stringify(stateBefore.data));
      // React still holds the old session and line, but the synchronous cache
      // lifecycle epoch has already invalidated every captured action.
      expect(result.current.logic.bindingSession).toBe(bindingSessionBefore);
      expect(result.current.logic.lines).toHaveLength(1);
      expect(stale.isActionAuthorized(bindingSessionBefore)).toBe(false);
      expect(stale.buildPayload()).toBeNull();
      expect(allocationCandidateLifecycleEventEpoch(client, COMPANY_ID, RCP_A)).toBeGreaterThan(
        lifecycleEpochBefore,
      );
      expect(allocationCandidateQueryRevision(client, RCP_A)).not.toBe(revisionBefore);
      act(() => {
        stale.addInvoice(invoice);
        stale.removeInvoice(invoice.id);
        stale.updateAmount(invoice.id, 999);
        stale.updateDiscount(invoice.id, 5);
        stale.fillMax(invoice.id);
        stale.runFifoPreview();
      });
      expect(result.current.logic.lines).toHaveLength(1);
      expect(result.current.logic.lines[0].amount).toBe(100);
      expect(result.current.logic.lines[0].discount_amount).toBe(0);
      expect(result.current.logic.isFifoPreview).toBe(false);
      expect(fakeApi.post).not.toHaveBeenCalled();
    } finally {
      notifyManager.setScheduler(defaultScheduler);
      await act(async () => {
        while (scheduled.length > 0) scheduled.shift()!();
      });
    }

    await waitFor(() => expect(result.current.logic.bindingSession).not.toBe(bindingSessionBefore));
    await waitFor(() => expect(result.current.logic.lines).toEqual([]));
    expect(result.current.logic.boundGeneration).toBeGreaterThan(boundGenerationBefore);
    expect(stale.isActionAuthorized(bindingSessionBefore)).toBe(false);
    expect(stale.buildPayload()).toBeNull();

    const currentSession = result.current.logic.bindingSession;
    expect(currentSession).not.toBeNull();
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    act(() => result.current.logic.updateAmount(invId(1), 25));
    expect(result.current.logic.lines).toHaveLength(1);
    expect(result.current.logic.isActionAuthorized(currentSession)).toBe(true);
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("assigns one stable epoch per Query object and a new one after recreation", async () => {
    // The WeakMap contract, asserted through the revision (its observable form):
    // repeated reads of the SAME Query yield an equal revision — no epoch churn,
    // which would spin the render loop.
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }];
    const { result, client } = renderWorkbench();
    await waitFor(() => expect(result.current.isVerified).toBe(true));

    const r1 = allocationCandidateQueryRevision(client, RCP_A);
    const r2 = allocationCandidateQueryRevision(client, RCP_A);
    const r3 = allocationCandidateQueryRevision(client, RCP_A);
    expect(r2).toBe(r1);
    expect(r3).toBe(r1);
  });
});

// ─── B9DD-CRR-002: selection handler / pre-commit window ────────────────────

describe("B9DD-FNC-001 — synchronous candidate lifecycle subscription", () => {
  const FROZEN_NOW = 1_800_000_000_000;

  function renderRevision(client: QueryClient, receiptId: string = RCP_A) {
    return renderHook(() => useAllocationCandidateQueryRevision(receiptId), {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    });
  }

  it("advances exactly once per relevant QueryCache event", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(FROZEN_NOW);
    // This lower-level subscription test intentionally has no QueryObserver.
    // Keep the seeded Query resident so the same public Query object can be
    // reset and repopulated; the workbench integration tests use real mounted
    // observers for the equivalent lifecycle.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: 0 },
        mutations: { retry: false },
      },
    });
    const key = allocationCandidateQueryKey(COMPANY_ID, RCP_A);
    // Two consumers subscribe to the same canonical key. QueryCache delivers
    // the same event object to both; the authority epoch must still advance once.
    const view = renderHook(
      () => [
        useAllocationCandidateQueryRevision(RCP_A),
        useAllocationCandidateQueryRevision(RCP_A),
      ],
      { wrapper: ({ children }) => <Providers client={client}>{children}</Providers> },
    );
    const beforeEpoch = allocationCandidateLifecycleEventEpoch(client, COMPANY_ID, RCP_A);
    const beforeRevision = view.result.current[0];
    expect(view.result.current[1]).toBe(beforeRevision);
    let relevantEvents = 0;
    const unsubscribeAudit = client.getQueryCache().subscribe((event) => {
      if (
        (event.type === "added" || event.type === "removed" || event.type === "updated") &&
        JSON.stringify(event.query.queryKey) === JSON.stringify(key)
      ) {
        relevantEvents += 1;
      }
    });

    act(() => {
      client.setQueryData(key, contractFor(RCP_A, CUST_A, [candidate(1)]));
    });

    expect(relevantEvents).toBeGreaterThan(0);
    expect(allocationCandidateLifecycleEventEpoch(client, COMPANY_ID, RCP_A)).toBe(
      beforeEpoch + relevantEvents,
    );
    await waitFor(() => expect(view.result.current[0]).not.toBe(beforeRevision));
    expect(view.result.current[1]).toBe(view.result.current[0]);

    // Independent lower-level probe (not the workbench reset test): the exact
    // production subscriber must retain lifecycle meaning when TanStack's same
    // Query object resets and immediately returns to identical QueryState.
    const queryBeforeReset = client.getQueryCache().find({ queryKey: key })!;
    const stateBeforeReset = client.getQueryState(key)!;
    const revisionBeforeReset = allocationCandidateQueryRevision(client, RCP_A);
    act(() => {
      queryBeforeReset.reset();
      client.setQueryData(
        key,
        contractFor(RCP_A, CUST_A, [candidate(1)]),
        { updatedAt: stateBeforeReset.dataUpdatedAt },
      );
    });
    const queryAfterReset = client.getQueryCache().find({ queryKey: key })!;
    const stateAfterReset = client.getQueryState(key)!;
    expect(queryAfterReset).toBe(queryBeforeReset);
    expect(stateAfterReset.dataUpdateCount).toBe(stateBeforeReset.dataUpdateCount);
    expect(stateAfterReset.dataUpdatedAt).toBe(stateBeforeReset.dataUpdatedAt);
    expect(JSON.stringify(stateAfterReset.data)).toBe(JSON.stringify(stateBeforeReset.data));
    expect(allocationCandidateLifecycleEventEpoch(client, COMPANY_ID, RCP_A)).toBe(
      beforeEpoch + relevantEvents,
    );
    expect(allocationCandidateQueryRevision(client, RCP_A)).not.toBe(revisionBeforeReset);

    unsubscribeAudit();
    view.unmount();
    client.clear();
    nowSpy.mockRestore();
  });

  it("ignores unrelated and stale-company QueryCache events", async () => {
    const client = createTestQueryClient();
    const view = renderRevision(client);
    const beforeEpoch = allocationCandidateLifecycleEventEpoch(client, COMPANY_ID, RCP_A);
    const beforeRevision = view.result.current;

    act(() => {
      client.setQueryData(["unrelated", "query"], 1);
      client.setQueryData(
        allocationCandidateQueryKey("dddddddd-0000-0000-0000-00000000000d", RCP_A),
        contractFor(RCP_A, CUST_A, [candidate(1)]),
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(allocationCandidateLifecycleEventEpoch(client, COMPANY_ID, RCP_A)).toBe(beforeEpoch);
    expect(view.result.current).toBe(beforeRevision);

    view.unmount();
    client.clear();
  });

  it("stops recording and notifying after unsubscribe", async () => {
    const client = createTestQueryClient();
    const key = allocationCandidateQueryKey(COMPANY_ID, RCP_A);
    const view = renderRevision(client);
    const beforeEpoch = allocationCandidateLifecycleEventEpoch(client, COMPANY_ID, RCP_A);

    view.unmount();
    act(() => {
      client.setQueryData(key, contractFor(RCP_A, CUST_A, [candidate(1)]));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(allocationCandidateLifecycleEventEpoch(client, COMPANY_ID, RCP_A)).toBe(beforeEpoch);

    client.clear();
  });
});

describe("B9DD-CRR-002 — the selection handler revokes BEFORE it schedules", () => {
  it("calls revoke() synchronously, before setSelectedReceiptId", () => {
    // The load-bearing rule, isolated from React entirely: the ordering inside
    // `createReceiptSelectionHandler`. Observing it through a rendered component
    // would require an un-acted state update, which React rightly warns about —
    // and which would prove nothing this does not.
    const calls: string[] = [];
    const revoke = vi.fn(() => {
      calls.push("revoke");
    });
    const setId = vi.fn(() => {
      calls.push("setSelectedReceiptId");
    });

    const handler = createReceiptSelectionHandler(revoke, setId);
    handler(RCP_B);

    // Revocation is a ref write: it has already taken effect by the time the new
    // selection is even scheduled.
    expect(calls).toEqual(["revoke", "setSelectedReceiptId"]);
    expect(setId).toHaveBeenCalledWith(RCP_B);

    // Every transition path goes through the same factory, including clearing.
    calls.length = 0;
    handler(null);
    expect(calls).toEqual(["revoke", "setSelectedReceiptId"]);
    expect(setId).toHaveBeenLastCalledWith(null);
  });
});

describe("B9DD-CRR-002 — receipt selection revokes authority (committed behaviour)", () => {
  it("denies receipt A's captured callbacks from inside the selection event itself", async () => {
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, { data: contractFor(RCP_B, CUST_B, [candidate(3)]) }];

    const client: QueryClient = createTestQueryClient();
    const { result } = renderHook(() => useSelectableWorkbench(RCP_A), {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    });

    await waitFor(() => expect(result.current.isVerified).toBe(true));
    await waitFor(() => expect(result.current.logic.invoices).toHaveLength(1));
    const invoiceA = result.current.logic.invoices[0];
    act(() => result.current.logic.addInvoice(invoiceA));
    act(() => result.current.logic.updateAmount(invoiceA.id, 100));
    expect(result.current.logic.lines).toHaveLength(1);
    expect(result.current.logic.validation.canSubmit).toBe(true);

    const staleA = captureStaleCallbacks(result);
    const otherA: AllocationInvoice = { ...invoiceA, id: invId(9), invoice_no: "INV-0009" };

    // Invoke the REAL selection handler — not `rerender({ id: RCP_B })`, which
    // would skip the handler entirely. It updates React state, so it runs inside
    // act(); the ordering rule it relies on is asserted directly above.
    act(() => {
      result.current.selectReceiptId(RCP_B);
    });

    // Receipt A's cache entry is still perfectly valid — success, idle, matching
    // content and generation. Content-based authority alone would still pass it.
    const stateA = client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A));
    expect(stateA?.status).toBe("success");
    expect(stateA?.fetchStatus).toBe("idle");

    // Authority was nevertheless revoked synchronously, inside the event.
    expect(staleA.isActionAuthorized()).toBe(false);
    expect(staleA.buildPayload()).toBeNull();
    staleA.addInvoice(otherA);
    staleA.updateAmount(invoiceA.id, 300);
    staleA.updateDiscount(invoiceA.id, 5);
    staleA.fillMax(invoiceA.id);
    staleA.runFifoPreview();
    expect(fakeApi.post).not.toHaveBeenCalled();

    // After React renders B, nothing of A survives and only B can act.
    await waitFor(() => expect(result.current.selectedReceiptId).toBe(RCP_B));
    await waitFor(() => expect(result.current.isVerified).toBe(true));
    expect(result.current.logic.selectedReceipt!.id).toBe(RCP_B);
    expect(result.current.logic.invoices).toHaveLength(1);
    expect(result.current.logic.invoices[0].invoice_no).toBe("INV-0003");
    expect(result.current.logic.lines).toEqual([]);
    // A's callbacks stay dead even after B is verified.
    expect(staleA.buildPayload()).toBeNull();
    expect(fakeApi.post).not.toHaveBeenCalled();

    // B becomes actionable only through a verified bind.
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    expect(result.current.logic.lines).toHaveLength(1);
    expect(result.current.logic.isActionAuthorized()).toBe(true);
  });

  it("revokes synchronously when the selection is cleared", async () => {
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }];

    const client: QueryClient = createTestQueryClient();
    const { result } = renderHook(() => useSelectableWorkbench(RCP_A), {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    });
    await waitFor(() => expect(result.current.isVerified).toBe(true));
    await waitFor(() => expect(result.current.logic.invoices).toHaveLength(1));
    act(() => result.current.logic.addInvoice(result.current.logic.invoices[0]));
    const stale = captureStaleCallbacks(result);

    // Reselect/clear uses the same transition helper, so it revokes identically.
    act(() => {
      result.current.selectReceiptId(null);
    });

    expect(stale.isActionAuthorized()).toBe(false);
    expect(stale.buildPayload()).toBeNull();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("does not bind the receipt-list row when authority is revoked", async () => {
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }, { data: contractFor(RCP_B, CUST_B, [candidate(3)]) }];

    const client: QueryClient = createTestQueryClient();
    const { result } = renderHook(() => useSelectableWorkbench(RCP_A), {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    });
    await waitFor(() => expect(result.current.isVerified).toBe(true));

    act(() => {
      result.current.selectReceiptId(RCP_B);
    });

    // §2.2: revocation must not create actionable state for the NEW receipt.
    // Nothing is bound until B's governed contract is verified.
    //
    // AUTHORITY is revoked synchronously (a ref write), so this is true inside
    // the event. The displayed `invoices`/`lines` are React STATE and therefore
    // still show A's rows for one more render — that is presentation lag, not
    // authority, and it is exactly why authority may never be inferred from what
    // is on screen. Nothing on screen is actionable in the meantime.
    expect(result.current.logic.isActionAuthorized()).toBe(false);
    expect(result.current.logic.buildPayload()).toBeNull();
    expect(result.current.logic.validation.canSubmit).toBe(false);
    // Critically: revoking did NOT bind receipt B's list row. Nothing became
    // actionable as a side effect of the transition itself.
    expect(result.current.logic.selectedReceipt?.id).not.toBe(RCP_B);

    // Authority returns only when B's GOVERNED contract verifies — and the bound
    // receipt then comes from that contract, never from the list row.
    await waitFor(() => expect(result.current.logic.isActionAuthorized()).toBe(true));
    expect(result.current.logic.selectedReceipt!.id).toBe(RCP_B);
    expect(result.current.logic.selectedReceipt!.customer_name).toBe("Beta");
    expect(result.current.logic.invoices[0].invoice_no).toBe("INV-0003");
    // No allocation line survived the transition.
    expect(result.current.logic.lines).toEqual([]);
  });
});

// ─── 3.7 Default-deny ───────────────────────────────────────────────────────

describe("B9DD-CDR-002 §3.7 — default-deny allocation logic", () => {
  const anInvoice: AllocationInvoice = {
    id: invId(1),
    invoice_no: "INV-0001",
    doc_type: "Invoice",
    invoice_date: "2026-06-01",
    due_date: "2026-07-01",
    currency: "USD",
    exchange_rate: 4.4,
    total_amount: 1000,
    outstanding: 400,
    overdue_days: 0,
  };

  it("denies every action when NO verifier is configured", () => {
    // The previous default was `isContractVerified ?? true` — forgetting to wire
    // verification produced a fully actionable financial workbench, silently.
    const { result } = renderHook(() => useAllocationLogic(), {
      wrapper: ({ children }) => <Providers>{children}</Providers>,
    });

    act(() => result.current.addInvoice(anInvoice));
    expect(result.current.lines).toEqual([]);

    act(() => result.current.runFifoPreview());
    expect(result.current.lines).toEqual([]);
    expect(result.current.isFifoPreview).toBe(false);

    act(() => result.current.updateAmount(anInvoice.id, 100));
    act(() => result.current.updateDiscount(anInvoice.id, 5));
    act(() => result.current.fillMax(anInvoice.id));
    expect(result.current.lines).toEqual([]);

    expect(result.current.buildPayload()).toBeNull();
    expect(result.current.isActionAuthorized()).toBe(false);
    expect(result.current.validation.canSubmit).toBe(false);
  });

  it("denies every action when the verifier returns null", () => {
    const { result } = renderHook(
      () => useAllocationLogic({ verifyLiveContract: () => null }),
      { wrapper: ({ children }) => <Providers>{children}</Providers> },
    );

    act(() => result.current.addInvoice(anInvoice));
    expect(result.current.lines).toEqual([]);
    expect(result.current.buildPayload()).toBeNull();
    expect(result.current.validation.canSubmit).toBe(false);
  });

  it("permits actions only with an explicitly authorized live verifier", async () => {
    // The complementary control: the deny-by-default tests above would pass on a
    // hook that denies EVERYTHING, so authorization must be shown to work.
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }];
    const { result, client } = renderWorkbench();
    await verifiedWithLine(client, result);

    expect(result.current.logic.isActionAuthorized()).toBe(true);
    expect(result.current.logic.buildPayload()).toEqual({
      receipt_id: RCP_A,
      allocations: [{ invoice_id: invId(1), amount: 100 }],
    });
  });

  it("keeps safe destructive operations available without verification", () => {
    // §2.6: clearing only ever REMOVES local state. Gating it would strand a
    // user with lines the app itself has decided are untrustworthy.
    const { result } = renderHook(() => useAllocationLogic(), {
      wrapper: ({ children }) => <Providers>{children}</Providers>,
    });
    act(() => result.current.clearLines());
    act(() => result.current.revokeContractAuthority());
    act(() => result.current.clearSelection());
    expect(result.current.lines).toEqual([]);
    expect(result.current.selectedReceipt).toBeNull();
    // They cannot grant authority.
    expect(result.current.isActionAuthorized()).toBe(false);
  });
});

// ─── 2.1 / 2.5 structural guarantees ────────────────────────────────────────

describe("B9DD-CDR-002 §2.1/§2.5 — key authority and ungoverned binding", () => {
  it("uses one canonical query key everywhere", () => {
    // B9DD-FDR-002: the key is COMPANY-scoped. The tenant sits ahead of the
    // receipt id, so the same receipt in two companies is two cache entries.
    expect(allocationCandidateQueryKey(COMPANY_ID, RCP_A)).toEqual([
      "allocations",
      "candidates",
      COMPANY_ID,
      RCP_A,
    ]);
    // Same receipt, different tenant => different key. This is the property that
    // actually enforces isolation; the receipt id alone never could.
    expect(allocationCandidateQueryKey("other-company", RCP_A)).not.toEqual(
      allocationCandidateQueryKey(COMPANY_ID, RCP_A),
    );
    // The hook must write the key the verifier reads, or verification would fail
    // OPEN by silently checking an entry nobody writes.
    script = [{ data: contractFor(RCP_A, CUST_A, [candidate(1)]) }];
    const { client } = renderWorkbench();
    return waitFor(() =>
      expect(client.getQueryState(allocationCandidateQueryKey(COMPANY_ID, RCP_A))?.status).toBe("success"),
    );
  });

  it("exposes no ungoverned receipt-binding action", () => {
    // §2.5: `selectReceipt(receipt, invoices)` bound a receipt-LIST row — user
    // intent with a possibly stale balance — straight into authoritative state,
    // with no governed contract. It is removed, not merely guarded.
    const { result } = renderHook(() => useAllocationLogic(), {
      wrapper: ({ children }) => <Providers>{children}</Providers>,
    });
    expect("selectReceipt" in result.current).toBe(false);
    expect(Object.keys(result.current)).toContain("bindVerifiedContract");
  });
});

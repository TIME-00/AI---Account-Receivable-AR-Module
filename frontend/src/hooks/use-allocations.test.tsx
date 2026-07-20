// ============================================================================
// Batch 9D-D Phase B — Governed allocation-candidate contract.
//
// REPLACES the OFFSET-scan suite. That scan paged `/invoices`, a mutable offset
// window it could never prove complete; its tests necessarily asserted on
// mitigation (immutable totals, duplicate detection) rather than correctness.
// `GET /allocations/candidates` removes the problem at the source: migration
// 030's RPC is read-only and non-paginated, so the candidate set comes from ONE
// PostgreSQL statement snapshot.
//
// These tests drive the REAL hook and the REAL Zod contract schema against the
// API boundary — not a parallel simplified implementation.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import {
  Providers,
  createTestQueryClient,
  createFakeApi,
  route,
  type FakeApi,
} from "@/test/harness";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

import { useAllocationCandidates } from "@/hooks/use-allocations";
import {
  AllocationContractError,
  ALLOCATION_CANDIDATE_MAX,
} from "@/lib/allocation-candidate-contract";

const RECEIPT_ID = "11111111-1111-1111-1111-111111111111";
const CUSTOMER_ID = "22222222-2222-2222-2222-222222222222";
const candidateId = (n: number) => `33333333-3333-3333-3333-${String(n).padStart(12, "0")}`;

/** A backend-shaped governed candidate. */
function candidate(n: number, over: Record<string, unknown> = {}) {
  return {
    id: candidateId(n),
    invoice_no: `INV-${String(n).padStart(4, "0")}`,
    doc_type: "Invoice",
    invoice_date: "2026-06-01",
    due_date: `2026-07-${String((n % 28) + 1).padStart(2, "0")}`,
    currency: "USD",
    exchange_rate: 4.4,
    total_amount: 1000,
    outstanding: 400,
    status: "Open",
    version: 1,
    ...over,
  };
}

/** The governed receipt the contract returns — the authoritative context. */
function receipt(over: Record<string, unknown> = {}) {
  return {
    id: RECEIPT_ID,
    receipt_no: "RCP-0001",
    receipt_date: "2026-07-01",
    customer_id: CUSTOMER_ID,
    customer_name: "Acme Sdn Bhd",
    currency: "USD",
    exchange_rate: 4.4,
    receipt_amount: 1000,
    allocated_amount: 700,
    unallocated_amount: 300,
    payment_method: "TT",
    status: "Posted",
    version: 1,
    ...over,
  };
}

/** A complete, valid contract — the shape allocations/service.ts guarantees. */
function contract(over: Record<string, unknown> = {}, candidates = [candidate(1)]) {
  return {
    contract_version: "allocation_candidates.v1",
    complete: true,
    max_candidates: ALLOCATION_CANDIDATE_MAX,
    ordering: ["due_date ASC NULLS LAST", "invoice_no ASC", "id ASC"],
    receipt: receipt(),
    customer_id: CUSTOMER_ID,
    currency: "USD",
    total: candidates.length,
    candidates,
    ...over,
  };
}

function apiReturning(body: unknown) {
  return createFakeApi([route("/allocations/candidates", () => ({ data: body }))]);
}

function renderCandidates(receiptId: string | null = RECEIPT_ID) {
  const client = createTestQueryClient();
  return renderHook(() => useAllocationCandidates(receiptId), {
    wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
  });
}

const candidateCalls = () => fakeApi.calls.filter((c) => c.path === "/allocations/candidates");

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── A. Request contract ────────────────────────────────────────────────────

describe("Candidate request contract (Phase B)", () => {
  it("calls /allocations/candidates with ONLY the receipt id", async () => {
    fakeApi = apiReturning(contract());
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(candidateCalls()).toHaveLength(1);
    const params = candidateCalls()[0].params;
    expect(params.receipt_id).toBe(RECEIPT_ID);
    // Candidate authority is the backend's. The frontend must not be able to
    // widen or narrow the set by asking differently.
    expect(params).not.toHaveProperty("customer_id");
    expect(params).not.toHaveProperty("company_id");
    expect(params).not.toHaveProperty("currency");
    expect(params).not.toHaveProperty("status");
    expect(params).not.toHaveProperty("doc_type");
    expect(params).not.toHaveProperty("page");
    expect(params).not.toHaveProperty("page_size");
    expect(Object.keys(params)).toEqual(["receipt_id"]);
  });

  it("never touches /invoices, /allocations/preview or /allocations/auto", async () => {
    fakeApi = apiReturning(contract());
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const paths = fakeApi.calls.map((c) => c.path);
    expect(paths).not.toContain("/invoices");
    expect(paths).not.toContain("/allocations/preview");
    expect(paths).not.toContain("/allocations/auto");
    expect(paths.every((p) => p === "/allocations/candidates")).toBe(true);
  });

  it("issues no request without a selected receipt", async () => {
    fakeApi = apiReturning(contract());
    const { result } = renderCandidates(null);
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(candidateCalls()).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });
});

// ─── B. Successful contracts ────────────────────────────────────────────────

describe("Verified candidate contracts (Phase B)", () => {
  it("accepts a single candidate", async () => {
    fakeApi = apiReturning(contract());
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.total).toBe(1);
    expect(result.current.data?.candidates).toHaveLength(1);
    expect(result.current.data?.complete).toBe(true);
  });

  it("accepts many candidates and preserves the governed order verbatim", async () => {
    // The RPC orders by due_date ASC NULLS LAST, invoice_no ASC, id ASC. The
    // client must NOT reorder: the backend ordering is the contract.
    const rows = [
      candidate(1, { due_date: "2026-07-01", invoice_no: "INV-0001" }),
      candidate(2, { due_date: "2026-07-10", invoice_no: "INV-0002" }),
      candidate(3, { due_date: null, invoice_no: "INV-0003" }),
    ];
    fakeApi = apiReturning(contract({}, rows));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.candidates.map((c) => c.invoice_no)).toEqual([
      "INV-0001",
      "INV-0002",
      "INV-0003",
    ]);
    expect(new Set(result.current.data!.candidates.map((c) => c.id)).size).toBe(3);
  });

  it("accepts a VERIFIED zero-candidate contract as success, not an error", async () => {
    fakeApi = apiReturning(contract({ total: 0, candidates: [] }, []));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.total).toBe(0);
    expect(result.current.data?.candidates).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("accepts Debit Notes and every eligible status", async () => {
    const rows = [
      candidate(1, { doc_type: "Debit Note" }),
      candidate(2, { status: "Overdue" }),
      candidate(3, { status: "Partially Paid" }),
    ];
    fakeApi = apiReturning(contract({}, rows));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.candidates.map((c) => c.doc_type)).toContain("Debit Note");
    expect(result.current.data!.candidates.map((c) => c.status)).toEqual([
      "Open",
      "Overdue",
      "Partially Paid",
    ]);
  });

  it("exposes the governed receipt as the authoritative context", async () => {
    // The list row may be stale; the contract's receipt is the one the backend
    // just validated.
    fakeApi = apiReturning(contract({ receipt: receipt({ unallocated_amount: 42.5, version: 7 }) }));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.receipt.unallocated_amount).toBe(42.5);
    expect(result.current.data!.receipt.version).toBe(7);
    expect(result.current.data!.receipt.id).toBe(RECEIPT_ID);
  });
});

// ─── C. Malformed contracts must all fail closed ────────────────────────────

describe("Malformed candidate contracts fail closed (Phase B)", () => {
  const CASES: Array<[string, unknown]> = [
    ["wrong contract version", contract({ contract_version: "allocation_candidates.v2" })],
    ["complete: false", contract({ complete: false })],
    ["wrong max_candidates", contract({ max_candidates: 1000 })],
    ["wrong ordering array", contract({ ordering: ["invoice_no ASC", "id ASC", "due_date ASC"] })],
    ["short ordering array", contract({ ordering: ["due_date ASC NULLS LAST"] })],
    ["total differs from candidate length", contract({ total: 5 })],
    ["total exceeds max", contract({ total: ALLOCATION_CANDIDATE_MAX + 1 })],
    ["duplicate candidate ids", contract({ total: 2 }, [candidate(1), candidate(1)])],
    ["blank candidate id", contract({}, [candidate(1, { id: "" })])],
    ["non-uuid candidate id", contract({}, [candidate(1, { id: "not-a-uuid" })])],
    ["wrong receipt id", contract({ receipt: receipt({ id: "44444444-4444-4444-4444-444444444444" }) })],
    ["top-level customer mismatch", contract({ customer_id: "55555555-5555-5555-5555-555555555555" })],
    ["top-level currency mismatch", contract({ currency: "SGD" })],
    ["candidate currency mismatch", contract({}, [candidate(1, { currency: "SGD" })])],
    // B9DD-CDR-001: the fixture here used to be `XYZ` and asserted REJECTION,
    // encoding the defect — `XYZ` is a syntactically valid 3-letter code, and
    // this is an existing-document READ contract that the backend gates with
    // ^[A-Z]{3}$. The write-list belongs to new invoice/receipt writes only.
    // What must fail is a code of the wrong SHAPE:
    ["lowercase currency", contract({ currency: "usd", receipt: receipt({ currency: "usd" }) }, [candidate(1, { currency: "usd" })])],
    ["two-letter currency", contract({ currency: "US", receipt: receipt({ currency: "US" }) }, [candidate(1, { currency: "US" })])],
    ["four-letter currency", contract({ currency: "USDX", receipt: receipt({ currency: "USDX" }) }, [candidate(1, { currency: "USDX" })])],
    ["invalid doc_type", contract({}, [candidate(1, { doc_type: "Credit Note" })])],
    ["invalid status", contract({}, [candidate(1, { status: "Paid" })])],
    ["zero outstanding", contract({}, [candidate(1, { outstanding: 0 })])],
    ["negative outstanding", contract({}, [candidate(1, { outstanding: -5 })])],
    ["non-finite outstanding", contract({}, [candidate(1, { outstanding: Number.POSITIVE_INFINITY })])],
    ["zero exchange rate", contract({}, [candidate(1, { exchange_rate: 0 })])],
    ["invalid candidate version", contract({}, [candidate(1, { version: 0 })])],
    ["non-integer candidate version", contract({}, [candidate(1, { version: 1.5 })])],
    ["receipt not Posted", contract({ receipt: receipt({ status: "Draft" }) })],
    ["receipt with no unallocated balance", contract({ receipt: receipt({ unallocated_amount: 0 }) })],
    ["invalid receipt version", contract({ receipt: receipt({ version: 0 }) })],
    ["partial data (candidates missing)", { contract_version: "allocation_candidates.v1", complete: true }],
    ["null response", null],
    ["array response", []],
  ];

  it.each(CASES)("rejects %s", async (_name, body) => {
    fakeApi = apiReturning(body);
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(AllocationContractError);
    // A malformed contract yields NO data — never a partial or empty list.
    expect(result.current.data).toBeUndefined();
  });

  it("exposes no schema internals in the user-facing message", async () => {
    fakeApi = apiReturning(contract({ currency: "SGD" }));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isError).toBe(true));

    const err = result.current.error as AllocationContractError;
    // The message the UI could show is fixed and safe...
    expect(err.message).toBe("The eligible invoice list could not be verified.");
    expect(err.message).not.toMatch(/zod|schema|receipt\.|candidates\[/i);
    // ...while the developer detail is kept off the message itself.
    expect(err.detail).toBeTruthy();
  });

  it("does not retry a malformed contract into looking valid", async () => {
    fakeApi = apiReturning(contract({ complete: false }));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(candidateCalls()).toHaveLength(1);
  });

  it("fails closed when the contract is for a DIFFERENT receipt", async () => {
    // The most dangerous possible response on this screen.
    const otherId = "99999999-9999-9999-9999-999999999999";
    fakeApi = createFakeApi([
      route("/allocations/candidates", () => ({
        data: contract({ receipt: receipt({ id: otherId }) }),
      })),
    ]);
    const { result } = renderCandidates(RECEIPT_ID);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(AllocationContractError);
    expect(result.current.data).toBeUndefined();
  });
});

// ─── Transport failures ─────────────────────────────────────────────────────

describe("Candidate transport failures (Phase B)", () => {
  it("surfaces a transport error with no candidate data", async () => {
    fakeApi = createFakeApi([
      route("/allocations/candidates", () => {
        throw new Error("network down");
      }),
    ]);
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("uses a receipt-scoped query key so a different receipt cannot reuse a cache entry", async () => {
    const other = "66666666-6666-6666-6666-666666666666";
    fakeApi = createFakeApi([
      route("/allocations/candidates", (params) => ({
        data:
          params.receipt_id === RECEIPT_ID
            ? contract()
            : contract({ receipt: receipt({ id: other }), total: 0, candidates: [] }, []),
      })),
    ]);

    const client = createTestQueryClient();
    const { result, rerender } = renderHook(({ id }) => useAllocationCandidates(id), {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
      initialProps: { id: RECEIPT_ID },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.candidates).toHaveLength(1);

    rerender({ id: other });
    await waitFor(() => expect(result.current.data?.receipt.id).toBe(other));
    // Receipt B's verified result is B's — never A's rows.
    expect(result.current.data!.candidates).toHaveLength(0);
    expect(candidateCalls().map((c) => c.params.receipt_id)).toEqual([RECEIPT_ID, other]);
  });
});

// ─── E. Legacy currency read compatibility (B9DD-CDR-001) ───────────────────
//
// The backend keeps TWO deliberate currency boundaries (_shared/validators.ts):
//
//   validateCurrency                    -> ^[A-Z]{3}$     (existing-doc READS)
//   validateOperationalCurrencyForWrite -> the six codes   (new invoice/receipt WRITES)
//
// Its own comment on the read validator says: "Historical reads may still expose
// other valid three-letter legacy codes."
//
// The candidate contract is an existing-document READ, and the backend gates it
// with ^[A-Z]{3}$ (allocations/service.ts ~185). This schema previously applied
// the six-code WRITE list, making the client STRICTER than the server — and
// because the workbench is fail-closed, a legacy JPY receipt would have been
// refused as an unverifiable contract rather than allocated. That is an
// availability defect, not a safety margin.
//
// Shape is still enforced exactly; cross-field agreement is what actually stops
// currencies being mixed.

describe("Legacy three-letter currency reads (B9DD-CDR-001)", () => {
  /** Build a whole contract in one legacy currency: receipt, top level, rows. */
  const legacy = (code: string) =>
    contract(
      { receipt: receipt({ currency: code }), currency: code },
      [candidate(1, { currency: code })],
    );

  it("accepts a legacy JPY receipt and candidate", async () => {
    fakeApi = apiReturning(legacy("JPY"));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Displayed as JPY against a JPY receipt — never reinterpreted or converted.
    expect(result.current.data!.currency).toBe("JPY");
    expect(result.current.data!.receipt.currency).toBe("JPY");
    expect(result.current.data!.candidates[0].currency).toBe("JPY");
  });

  it("accepts another legacy code (AUD)", async () => {
    fakeApi = apiReturning(legacy("AUD"));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.currency).toBe("AUD");
  });

  it("still rejects a JPY receipt with an AUD candidate", async () => {
    // Widening the code set must NOT weaken cross-field agreement: this is what
    // actually prevents allocating across currencies.
    const mixed = contract(
      { receipt: receipt({ currency: "JPY" }), currency: "JPY" },
      [candidate(1, { currency: "AUD" })],
    );
    fakeApi = apiReturning(mixed);
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(AllocationContractError);
  });

  it("still rejects a top-level/receipt currency mismatch", async () => {
    fakeApi = apiReturning(
      contract({ receipt: receipt({ currency: "JPY" }), currency: "AUD" }, [
        candidate(1, { currency: "AUD" }),
      ]),
    );
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  const MALFORMED: Array<[string, string]> = [
    ["lowercase", "jpy"],
    ["mixed case", "Jpy"],
    ["two letters", "JP"],
    ["four letters", "JPYX"],
    ["blank", ""],
    ["digits", "123"],
    ["padded", " JPY"],
  ];

  it.each(MALFORMED)("rejects a %s currency code", async (_name, code) => {
    fakeApi = apiReturning(legacy(code));
    const { result } = renderCandidates();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(AllocationContractError);
  });

  it("leaves the six-code NEW-WRITE restriction untouched", async () => {
    // The read contract must not import the write list at all — that coupling is
    // exactly what caused this defect.
    const contractSrc = readFileSync(
      path.join(process.cwd(), "src", "lib", "allocation-candidate-contract.ts"),
      "utf8",
    );
    expect(contractSrc).not.toContain("SUPPORTED_CURRENCIES");

    // And the operational write list itself is unchanged.
    const { SUPPORTED_CURRENCIES } = await import("@/lib/currency");
    expect([...SUPPORTED_CURRENCIES]).toEqual(["MYR", "SGD", "USD", "EUR", "GBP", "CNY"]);

    // A legacy code is still NOT offered for new writes.
    const { SUPPORTED_CURRENCY_OPTIONS } = await import("@/lib/currency");
    expect(SUPPORTED_CURRENCY_OPTIONS.map((o) => o.value)).not.toContain("JPY");
    expect(SUPPORTED_CURRENCY_OPTIONS).toHaveLength(6);

    // And a legacy code is still not a "supported" write currency.
    const { isSupportedCurrency } = await import("@/lib/currency");
    expect(isSupportedCurrency("JPY")).toBe(false);
    expect(isSupportedCurrency("MYR")).toBe(true);
  });
});

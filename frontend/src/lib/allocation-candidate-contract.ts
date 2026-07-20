// ============================================================================
// TSH Synergy AR — Governed allocation-candidate contract (Batch 9D-D Phase B)
//
// Consumes `GET /allocations/candidates?receipt_id=<uuid>`, which is backed by
// `public.get_allocation_candidates(...)` (migration 030). That RPC is STABLE,
// SECURITY DEFINER, read-only, non-paginated and capped at 5,000 rows, so it
// returns ONE complete candidate set from ONE PostgreSQL statement snapshot.
//
// This replaces the frontend's mutable OFFSET scan over `/invoices`. That scan
// could never prove coverage: an offset window over a collection that changes
// underneath it can SKIP rows that appear on no page at all, and no amount of
// client-side invariant checking can recover a row the server never sent.
//
// Everything here is FAIL-CLOSED. The backend already validates this contract
// (allocations/service.ts::parseAllocationCandidateResult); this schema is a
// second, independent gate on the client, because the allocation workbench must
// never render or act on a candidate set it cannot verify. A malformed response
// is an error state, never an empty list.
//
// The frontend derives NO candidate authority of its own: it sends only the
// receipt id, and customer/currency/eligibility are all governed server-side.
// ============================================================================

import { z } from "zod";

/** Mirrors ALLOCATION_CANDIDATE_CONTRACT_VERSION (allocations/service.ts ~80). */
export const ALLOCATION_CANDIDATE_CONTRACT_VERSION = "allocation_candidates.v1" as const;
/** Mirrors ALLOCATION_CANDIDATE_MAX (allocations/service.ts ~81). */
export const ALLOCATION_CANDIDATE_MAX = 5000;

/**
 * The exact ordering the RPC guarantees. Asserted, not assumed: if the backend
 * ordering ever changes, the FIFO presentation built on it is no longer sound,
 * and we would rather fail than silently reorder money.
 */
export const ALLOCATION_CANDIDATE_ORDERING = [
  "due_date ASC NULLS LAST",
  "invoice_no ASC",
  "id ASC",
] as const;

/**
 * PostgreSQL's `uuid` accepts any canonical 128-bit value, including fixtures
 * that encode no RFC version/variant. Kept identical in breadth to the backend
 * UUID_PATTERN (allocations/service.ts ~130) so the two gates cannot disagree.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "must be a UUID");

const finite = z.number().finite();
const positiveFinite = finite.positive();
const positiveInt = z.number().int().positive();

/**
 * Any syntactically valid 3-letter uppercase ISO 4217 code. Never defaulted,
 * never inferred, never converted.
 *
 * B9DD-CDR-001: this is deliberately NOT the six-code operational write list
 * (MYR/SGD/USD/EUR/GBP/CNY). The backend keeps two distinct currency boundaries
 * on purpose (`_shared/validators.ts`):
 *
 *   - `validateCurrency` — `^[A-Z]{3}$`, for EXISTING-document reads. Its own
 *     comment says "Historical reads may still expose other valid three-letter
 *     legacy codes."
 *   - `validateOperationalCurrencyForWrite` — the six-code list, for NEW invoice
 *     and receipt writes only.
 *
 * The candidate contract is an existing-document READ, and the backend gates it
 * with `^[A-Z]{3}$` (`allocations/service.ts` ~185). Applying the write list
 * here made the client STRICTER than the server it was validating: a legacy JPY
 * receipt would fail this schema, and because the workbench is fail-closed, a
 * legitimate allocation would be refused with an unverifiable-contract error.
 * That is a real availability defect, not a safety margin.
 *
 * Shape is still enforced exactly: no lowercase, no blank, no 2- or 4-letter
 * code. Cross-field agreement (receipt/top-level/candidate) is enforced below,
 * which is what actually prevents mixing currencies.
 */
const readCurrencyCode = z.string().regex(/^[A-Z]{3}$/, "must be a 3-letter uppercase ISO 4217 code");

export const ALLOCATION_CANDIDATE_DOC_TYPES = ["Invoice", "Debit Note"] as const;
export const ALLOCATION_CANDIDATE_STATUSES = ["Open", "Overdue", "Partially Paid"] as const;

const candidateSchema = z.object({
  id: uuid,
  invoice_no: z.string().min(1),
  doc_type: z.enum(ALLOCATION_CANDIDATE_DOC_TYPES),
  invoice_date: z.string().min(1),
  due_date: z.string().min(1).nullable(),
  currency: readCurrencyCode,
  exchange_rate: positiveFinite,
  total_amount: finite,
  // Outstanding must be strictly positive: a zero/negative-outstanding document
  // is not an allocation candidate at all.
  outstanding: positiveFinite,
  status: z.enum(ALLOCATION_CANDIDATE_STATUSES),
  version: positiveInt,
});

const receiptSchema = z.object({
  id: uuid,
  receipt_no: z.string().min(1),
  receipt_date: z.string().min(1),
  customer_id: uuid,
  customer_name: z.string().min(1),
  currency: readCurrencyCode,
  exchange_rate: positiveFinite,
  receipt_amount: positiveFinite,
  allocated_amount: finite.nonnegative(),
  // The backend only returns a receipt that is eligible to allocate; a
  // non-positive unallocated balance is BR-ALLOC-CANDIDATES server-side.
  unallocated_amount: positiveFinite,
  payment_method: z.string().min(1),
  status: z.literal("Posted"),
  version: positiveInt,
});

const baseSchema = z.object({
  contract_version: z.literal(ALLOCATION_CANDIDATE_CONTRACT_VERSION),
  // `complete` is the whole point of this contract. `false` is not a degraded
  // success — it is a refusal, and must never reach the workbench.
  complete: z.literal(true),
  max_candidates: z.literal(ALLOCATION_CANDIDATE_MAX),
  ordering: z.tuple([
    z.literal(ALLOCATION_CANDIDATE_ORDERING[0]),
    z.literal(ALLOCATION_CANDIDATE_ORDERING[1]),
    z.literal(ALLOCATION_CANDIDATE_ORDERING[2]),
  ]),
  receipt: receiptSchema,
  customer_id: uuid,
  currency: readCurrencyCode,
  total: z.number().int().nonnegative().max(ALLOCATION_CANDIDATE_MAX),
  candidates: z.array(candidateSchema),
});

/**
 * Cross-field invariants the shape alone cannot express. Each one is a way the
 * response could be internally inconsistent while every individual field looks
 * fine — which is exactly the class of bug that makes a candidate list wrong.
 */
export const allocationCandidateContractSchema = baseSchema
  .superRefine((value, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    // `total` is the server's own count; it must describe the array it shipped.
    if (value.candidates.length !== value.total) {
      fail(`total ${value.total} does not match ${value.candidates.length} candidates`, ["total"]);
    }
    // The top-level customer/currency are the governed authority; the receipt
    // must agree with them or we cannot tell which one to believe.
    if (value.customer_id !== value.receipt.customer_id) {
      fail("customer_id does not match receipt.customer_id", ["customer_id"]);
    }
    if (value.currency !== value.receipt.currency) {
      fail("currency does not match receipt.currency", ["currency"]);
    }

    const seen = new Set<string>();
    value.candidates.forEach((candidate, i) => {
      if (seen.has(candidate.id)) {
        // A duplicate id would let one document be allocated twice in one pass.
        fail("duplicate candidate id", ["candidates", i, "id"]);
      }
      seen.add(candidate.id);
      // Allocation is same-currency by construction; a foreign-currency
      // candidate means the governed filter did not hold.
      if (candidate.currency !== value.currency) {
        fail("candidate currency does not match the receipt currency", ["candidates", i, "currency"]);
      }
    });
  });

export type AllocationCandidateContract = z.infer<typeof baseSchema>;
export type GovernedAllocationCandidate = z.infer<typeof candidateSchema>;
export type AllocationCandidateReceipt = z.infer<typeof receiptSchema>;

/**
 * Raised when the governed response cannot be verified.
 *
 * Deliberately carries NO schema paths or raw response text into its message:
 * the UI shows a safe fixed string, and leaking internals would disclose
 * structure (and potentially cross-tenant existence) to the user.
 */
export class AllocationContractError extends Error {
  /** Internal detail for developers/tests — never rendered. */
  public readonly detail: string;

  constructor(detail: string) {
    super("The eligible invoice list could not be verified.");
    this.name = "AllocationContractError";
    this.detail = detail;
  }
}

/**
 * Parse and verify a governed candidate response against the receipt we asked
 * about.
 *
 * `expectedReceiptId` is checked here rather than trusted: a response for a
 * DIFFERENT receipt is the most dangerous possible outcome on this screen, so
 * identity is an invariant, not an assumption.
 */
export function parseAllocationCandidateContract(
  raw: unknown,
  expectedReceiptId: string,
): AllocationCandidateContract {
  const result = allocationCandidateContractSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AllocationContractError(
      `${first?.path.join(".") || "response"}: ${first?.message ?? "invalid contract"}`,
    );
  }
  const contract = result.data;

  if (contract.receipt.id !== expectedReceiptId) {
    throw new AllocationContractError(
      `contract is for receipt ${contract.receipt.id}, not the selected ${expectedReceiptId}`,
    );
  }

  return contract;
}

/**
 * A stable fingerprint of everything the workbench's allocation lines depend on.
 *
 * If any of this changes between reads, previously-entered lines may be based on
 * balances or documents that no longer exist, so they are discarded rather than
 * submitted. Includes candidate `version` and `outstanding` because those are
 * exactly what a concurrent allocation elsewhere would move.
 */
export function allocationContractFingerprint(contract: AllocationCandidateContract): string {
  return [
    contract.receipt.id,
    contract.receipt.version,
    contract.receipt.unallocated_amount,
    contract.receipt.currency,
    contract.customer_id,
    contract.total,
    ...contract.candidates.map((c) => `${c.id}:${c.version}:${c.outstanding}:${c.status}`),
  ].join("|");
}

// ── B9DD-CDR-002 / B9DD-CRR-001: bound contract generation identity ─────────

/**
 * The authoritative FETCH generation of the candidate query.
 *
 * B9DD-CRR-001: content identity is NOT sufficient to authorize an action. A
 * byte-identical background refetch produces a genuinely NEW authoritative read
 * whose content compares equal to the old one — reproduced against the previous
 * implementation, which reported:
 *
 *   status: "success", fetchStatus: "idle", dataUpdateCount: 1 -> 2,
 *   sameDataRef: true (structural sharing), boundGeneration: still 1,
 *   STALE_AUTHORIZED: true, STALE_PAYLOAD_NOT_NULL: true
 *
 * i.e. the cache had already settled on a new generation while React had not yet
 * committed the rebind, and a stale callback captured before the refetch was
 * silently RE-AUTHORIZED and could build a payload. Binding the fetch generation
 * closes that window: the token advances on every completed successful fetch,
 * including a structurally shared identical one.
 *
 * Both fields come from TanStack Query 5.95.2's PUBLIC `QueryState` interface:
 *
 *   - `dataUpdateCount` — a monotonic counter incremented on every successful
 *     data update. This is the load-bearing field: it cannot collide.
 *   - `dataUpdatedAt` — the update timestamp. Carried as defence in depth, but
 *     NOT relied on alone: it is millisecond-resolution, so two fetches settling
 *     within the same millisecond would produce the SAME value. On its own it
 *     would reopen exactly the window this closes.
 *
 * `dataUpdateCount` is deliberately read from `QueryState` (via
 * `getQueryClient().getQueryState`) rather than from a `useQuery` result: the
 * observer result exposes `dataUpdatedAt` but NOT `dataUpdateCount`, and it is
 * a RENDER-time value anyway — the cache is the only synchronous authority.
 */
export interface AllocationQueryGenerationToken {
  readonly dataUpdateCount: number;
  readonly dataUpdatedAt: number;
}

/** Exact equality of two fetch generations. Both fields must agree. */
export function queryGenerationsMatch(
  a: AllocationQueryGenerationToken,
  b: AllocationQueryGenerationToken,
): boolean {
  return a.dataUpdateCount === b.dataUpdateCount && a.dataUpdatedAt === b.dataUpdatedAt;
}

/**
 * B9DD-FDR-001: `dataUpdateCount` is monotonic ONLY WITHIN ONE Query INSTANCE.
 *
 * It restarts at zero when a Query is removed, reset, or recreated (or when a new
 * QueryClient is built). Reproduced against the generation-only design:
 *
 *   q1IsQ2_objectIdentity: false        <- genuinely a different Query object
 *   dataUpdateCount: 1 -> 1             <- SAME
 *   dataUpdatedAtEqual: true            <- SAME (frozen clock)
 *   contentEqualByFingerprint: true     <- SAME
 *   OLD_BINDING_AUTHORIZED_AGAINST_Q2: true   <- the collision
 *   OLD_PAYLOAD_NOT_NULL: true
 *
 * Every token field repeated, so an old binding from Q1 authorized against a
 * brand-new Q2. The instance epoch is what makes "the same numbers from a
 * different Query" distinguishable from "the same Query".
 */
export type AllocationQueryEpoch = number;

/**
 * Monotonic lifecycle revision for the exact company/receipt candidate query.
 *
 * Unlike `dataUpdateCount`, this advances when QueryCache publishes a relevant
 * lifecycle event, including a same-object `resetQueries()` transition whose
 * final QueryState fields can repeat. It is captured in the binding so the live
 * invocation-time check denies immediately, before React processes its
 * scheduled external-store notification.
 */
export type AllocationQueryLifecycleEpoch = number;

/**
 * The immutable identity of the exact contract generation the workbench's
 * allocation lines were created against.
 *
 * A render-time boolean cannot express this. TanStack Query mutates its cache
 * SYNCHRONOUSLY, but React commits the resulting render LATER — so between a
 * refetch starting (or failing, or returning changed or identical data) and the
 * component re-rendering, a callback captured during the last verified render is
 * still live and still believes it is authorized. Comparing this identity
 * against the cache AT INVOCATION TIME is what closes that window: the bound
 * generation is a fact about the past, and the live cache is a fact about now.
 */
export interface AllocationContractBinding {
  /**
   * The tenant this authority belongs to (B9DD-FDR-002). The workbench is a
   * per-company surface: a binding made under Company A must never authorize an
   * action taken while Company B is active.
   */
  companyId: string;
  /**
   * The exact Query INSTANCE this contract came from (B9DD-FDR-001). Distinct
   * from the generation, which only counts updates within one instance.
   */
  queryEpoch: AllocationQueryEpoch;
  /**
   * Synchronous QueryCache lifecycle revision for this canonical candidate
   * query. This closes reset/pending/success cycles that return to identical
   * QueryState fields before React receives a batched notification.
   */
  queryLifecycleEpoch: AllocationQueryLifecycleEpoch;
  receiptId: string;
  receiptVersion: number;
  unallocatedAmount: number;
  customerId: string;
  currency: string;
  fingerprint: string;
  /**
   * The authoritative query fetch generation that produced this contract.
   * Compared against the live cache on every action (B9DD-CRR-001).
   */
  queryGeneration: AllocationQueryGenerationToken;
  /**
   * Monotonic LOCAL counter, incremented on each bind. NOT part of
   * `bindingsMatch` — the cache cannot produce it. It exists so the hook and its
   * tests can observe that a rebind actually happened rather than inferring it.
   */
  generation: number;
  candidates: ReadonlyArray<{ id: string; version: number }>;
}

/**
 * Derive the binding identity from a verified contract, the tenant it belongs
 * to, and the exact Query instance + generation that produced it.
 *
 * B9DD-CRR-001 §1.2 / B9DD-FDR-001/002 / B9DD-FNC-001: `companyId`,
 * `queryEpoch`, `queryLifecycleEpoch`, and `queryGeneration` are all REQUIRED
 * parameters with no defaults. A contract can only be bound together with its
 * full authority context, so there is no call shape that produces a
 * content-only, tenant-less, or lifecycle-less binding.
 */
export function contractBindingIdentity(
  contract: AllocationCandidateContract,
  companyId: string,
  queryEpoch: AllocationQueryEpoch,
  queryLifecycleEpoch: AllocationQueryLifecycleEpoch,
  queryGeneration: AllocationQueryGenerationToken,
): AllocationContractBinding {
  return {
    companyId,
    queryEpoch,
    queryLifecycleEpoch,
    receiptId: contract.receipt.id,
    receiptVersion: contract.receipt.version,
    unallocatedAmount: contract.receipt.unallocated_amount,
    customerId: contract.customer_id,
    currency: contract.currency,
    fingerprint: allocationContractFingerprint(contract),
    queryGeneration: {
      dataUpdateCount: queryGeneration.dataUpdateCount,
      dataUpdatedAt: queryGeneration.dataUpdatedAt,
    },
    generation: 0,
    candidates: contract.candidates.map((c) => ({ id: c.id, version: c.version })),
  };
}

/**
 * Is the live cached generation the SAME one the lines were bound against?
 *
 * Tenant, Query instance, lifecycle epoch, and fetch generation are checked
 * before content. A later lifecycle/fetch that has not yet been rebound must be
 * rejected even when its content is byte-identical. Content is then compared as
 * well, so a changed contract is rejected on both counts.
 *
 * The local `generation` counter is excluded deliberately: it is local-only, and
 * the live side has no way to produce it.
 *
 * The fingerprint alone would very likely cover the content rules (it already
 * includes receipt version, unallocated amount, customer, currency and every
 * candidate's version/outstanding/status). The individual comparisons are kept
 * anyway so that each rule is independently visible and testable, rather than
 * implied by a string built somewhere else.
 */
export function bindingsMatch(
  bound: AllocationContractBinding,
  live: AllocationContractBinding,
): boolean {
  // Order matters, and it is deliberate: the widest, cheapest disqualifiers
  // first, so a later Query instance or a different tenant fails BEFORE any
  // repeated generation or content value is even considered.

  // 1. B9DD-FDR-002: tenant. Nothing about a Company A binding may authorize an
  //    action in Company B, however identical the numbers look.
  if (bound.companyId !== live.companyId) return false;
  // 2. B9DD-FDR-001: Query instance. `dataUpdateCount` restarts on a recreated
  //    Query, so the generation is meaningless across instances. Same-object
  //    reset is handled by the lifecycle epoch immediately below.
  if (bound.queryEpoch !== live.queryEpoch) return false;
  // 3. B9DD-FNC-001: the synchronous lifecycle revision. A same-object reset
  //    may return to the exact same generation fields and content, but it cannot
  //    return to an earlier monotonic lifecycle epoch.
  if (bound.queryLifecycleEpoch !== live.queryLifecycleEpoch) return false;
  // 4. B9DD-CRR-001: the authoritative fetch generation within that instance.
  if (!queryGenerationsMatch(bound.queryGeneration, live.queryGeneration)) return false;
  // 5. Content identity.
  if (bound.receiptId !== live.receiptId) return false;
  if (bound.receiptVersion !== live.receiptVersion) return false;
  if (bound.unallocatedAmount !== live.unallocatedAmount) return false;
  if (bound.customerId !== live.customerId) return false;
  if (bound.currency !== live.currency) return false;
  if (bound.fingerprint !== live.fingerprint) return false;
  if (bound.candidates.length !== live.candidates.length) return false;
  return bound.candidates.every(
    (c, i) => c.id === live.candidates[i].id && c.version === live.candidates[i].version,
  );
}

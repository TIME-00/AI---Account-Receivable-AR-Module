// ============================================================================
// TSH Synergy AR — Allocation API Hooks (TanStack Query)
// Handles data fetching and mutations for the Allocation Wizard.
// ============================================================================

"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  notifyManager,
  type QueryClient,
  type QueryCacheNotifyEvent,
} from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type {
  APIResponse,
  Receipt,
  AllocationDetail,
  AllocationDetailFull,
  AllocationMethod,
  AllocationStatus,
} from "@/types";
import { useCompanyStore } from "@/stores/company-store";
import type { AllocationReceipt, AllocationInvoice } from "@/hooks/use-allocation-logic";
import {
  parseAllocationCandidateContract,
  contractBindingIdentity,
  AllocationContractError,
  type AllocationCandidateContract,
  type AllocationContractBinding,
  type AllocationQueryEpoch,
  type AllocationQueryLifecycleEpoch,
} from "@/lib/allocation-candidate-contract";

interface UseAllocationsOptions {
  receiptId?: string;
  invoiceId?: string;
  status?: AllocationStatus | "All";
  method?: AllocationMethod | "All";
  page?: number;
  pageSize?: number;
}

export interface AllocationListResult {
  allocations: AllocationDetailFull[];
  meta: {
    total: number;
    page: number;
    page_size: number;
  };
}

export function useAllocations(options: UseAllocationsOptions = {}) {
  const api = useApi();
  const {
    receiptId,
    invoiceId,
    status = "All",
    method = "All",
    page = 1,
    pageSize = 10,
  } = options;

  return useQuery({
    queryKey: ["allocations", "history", receiptId, invoiceId, status, method, page, pageSize],
    queryFn: async (): Promise<AllocationListResult> => {
      const response = await api.rawFetch("/allocations", {
        method: "GET",
      }, {
        silent: true,
        params: {
          receipt_id: receiptId,
          invoice_id: invoiceId,
          status: status === "All" ? undefined : status,
          method: method === "All" ? undefined : method,
          page,
          page_size: pageSize,
        },
      });

      const json = await response.json() as APIResponse<AllocationDetailFull[]>;
      if (!response.ok || !json.success || json.error) {
        throw new Error(json.error?.message ?? `Failed to fetch allocations: HTTP ${response.status}`);
      }

      return {
        allocations: json.data ?? [],
        meta: {
          total: json.meta?.total ?? (json.data?.length ?? 0),
          page: json.meta?.page ?? page,
          page_size: json.meta?.page_size ?? pageSize,
        },
      };
    },
    staleTime: 30_000,
  });
}

// ─── Query: Fetch Posted Receipts with unallocated balance ──────────────────

export function usePostedReceipts(customerId?: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["receipts", "posted", customerId],
    queryFn: async () => {
      // useApi() returns json.data = Receipt[] (raw array).
      // B9DD-FEIR-001: `ar_receipt_collection` already excludes deleted/hidden
      // customers and applies assignment scoping server-side, so the previous
      // capped `/customers?page_size=500` post-filter was both redundant and
      // weaker than the backend scope it duplicated.
      const receipts = await api.get<Receipt[]>("/receipts", {
        params: {
          page: 1,
          page_size: 50,
          status: "Posted",
          customer_id: customerId,
        },
      });

      // Map to AllocationReceipt and filter those with unallocated balance
      const mapped: AllocationReceipt[] = (receipts ?? [])
        .filter((r) => r.unallocated_amount > 0.005)
        .map((r) => ({
          id: r.id,
          receipt_no: r.receipt_no,
          receipt_date: r.receipt_date,
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          currency: r.currency,
          exchange_rate: r.exchange_rate,
          receipt_amount: r.receipt_amount,
          unallocated_amount: r.unallocated_amount,
          payment_method: r.payment_method,
          status: r.status,
        }));

      return mapped;
    },
    enabled: true,
    staleTime: 30_000,
  });
}

// ─── Query: Governed allocation candidates (Batch 9D-D Phase B) ─────────

/**
 * The ONE canonical candidate query key — COMPANY-SCOPED.
 *
 * B9DD-CDR-002 §2.1: the hook, the live verifier, the revision subscription,
 * invalidation and every test must address the same cache entry. A second
 * hand-written copy of this array would be a verifier that silently reads a key
 * nobody writes — which fails OPEN in the worst possible place, because "no
 * cache entry" is indistinguishable from "nothing to check" unless it is the
 * same key by construction.
 *
 * B9DD-FDR-002: the company id is part of the key because the key IS the cache
 * identity. The previous receipt-only key was a real, production-reachable
 * tenant defect: the header's company switcher updates the Zustand store in
 * place, `useApi` immediately sends the new `X-Company-Id`, but TanStack does
 * not refetch merely because a queryFn closure changed — same key, same enabled
 * state, no refetch. Reproduced via the real `setCompany` path:
 *
 *   currentCompany: COMPANY_B          candidateRequests: 1 (no refetch)
 *   boundCustomerName: "Company A"     <- A's contract shown under B
 *   COMPANY_A_CALLBACK_STILL_AUTHORIZED: true
 *   COMPANY_A_PAYLOAD_NOT_NULL: true   canSubmit: true
 *
 * The backend would reject the eventual Company-B-header mutation, but frontend
 * tenant context had already failed — the user was looking at another company's
 * financial data and could act on it.
 *
 * The company id here is the ACTIVE COMPANY IDENTITY (a UUID), never a display
 * name. It is a tenant-context discriminator used to select the correct governed
 * backend contract — it is never itself an authority over money.
 */
export function allocationCandidateQueryKey(
  companyId: string | null,
  receiptId: string | null,
) {
  return ["allocations", "candidates", companyId, receiptId] as const;
}

/** Normalize an id the same way everywhere: blank/undefined means none. */
function normalizeId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The ACTIVE company id, read synchronously from the authoritative store. */
function currentCompanyId(): string | null {
  return normalizeId(useCompanyStore.getState().companyId);
}

// ── B9DD-FNC-001: synchronous candidate lifecycle observation ───────────────

/** One monotonic lifecycle counter per QueryClient and canonical candidate key. */
const candidateLifecycleEpochs = new WeakMap<QueryClient, Map<string, number>>();

/**
 * One QueryCache event is delivered to every active subscriber. Record it once,
 * not once per mounted consumer. Weak membership does not retain old events.
 */
const recordedCandidateLifecycleEvents = new WeakSet<object>();

function candidateLifecycleKey(companyId: string, receiptId: string): string {
  return `${companyId}\u0000${receiptId}`;
}

function candidateLifecycleEpochMap(queryClient: QueryClient): Map<string, number> {
  let epochs = candidateLifecycleEpochs.get(queryClient);
  if (!epochs) {
    epochs = new Map<string, number>();
    candidateLifecycleEpochs.set(queryClient, epochs);
  }
  return epochs;
}

/**
 * Read-only public diagnostic used by the production revision/binding and by
 * regression tests. A missing subscription history is generation zero.
 */
export function allocationCandidateLifecycleEventEpoch(
  queryClient: QueryClient,
  companyId: string | null | undefined,
  receiptId: string | null | undefined,
): AllocationQueryLifecycleEpoch {
  const normalizedCompanyId = normalizeId(companyId);
  const normalizedReceiptId = normalizeId(receiptId);
  if (!normalizedCompanyId || !normalizedReceiptId) return 0;
  return (
    candidateLifecycleEpochs
      .get(queryClient)
      ?.get(candidateLifecycleKey(normalizedCompanyId, normalizedReceiptId)) ?? 0
  );
}

function candidateIdentityFromEvent(
  event: QueryCacheNotifyEvent,
): { companyId: string; receiptId: string } | null {
  if (event.type !== "added" && event.type !== "removed" && event.type !== "updated") {
    return null;
  }
  const key = event.query.queryKey;
  if (
    key.length !== 4 ||
    key[0] !== "allocations" ||
    key[1] !== "candidates" ||
    typeof key[2] !== "string" ||
    typeof key[3] !== "string"
  ) {
    return null;
  }
  const companyId = normalizeId(key[2]);
  const receiptId = normalizeId(key[3]);
  return companyId && receiptId ? { companyId, receiptId } : null;
}

/**
 * Advance lifecycle authority synchronously while QueryCache is publishing the
 * event. React notification may be batched afterwards without losing a rapid
 * reset/pending/success cycle that finishes at the old QueryState values.
 */
function recordCandidateLifecycleEvent(
  queryClient: QueryClient,
  event: QueryCacheNotifyEvent,
  companyId: string,
  receiptId: string,
): void {
  if (recordedCandidateLifecycleEvents.has(event)) return;
  recordedCandidateLifecycleEvents.add(event);
  const epochs = candidateLifecycleEpochMap(queryClient);
  const key = candidateLifecycleKey(companyId, receiptId);
  epochs.set(key, (epochs.get(key) ?? 0) + 1);
}

// ── B9DD-FDR-001: Query INSTANCE identity ───────────────────────────────────

/**
 * A stable runtime epoch per Query INSTANCE.
 *
 * Keyed by the public `Query` object from `QueryCache.find(...)`, via a WeakMap:
 * one Query object always yields the same epoch, a recreated Query object yields
 * a new one, and repeated snapshot reads allocate nothing. The WeakMap holds no
 * strong reference, so a removed Query is still garbage-collectable.
 *
 * This exists because `dataUpdateCount` is monotonic only WITHIN one uninterrupted
 * instance lifetime. A removed/recreated Query needs an instance identity. A
 * same-object reset is handled separately by the synchronous lifecycle epoch,
 * because `resetQueries()` can restore that object's initial state and later
 * repeat its previous count, timestamp, and content.
 *
 * Honest limitations: the epoch is per JS runtime, so it is not stable across a
 * page reload, SSR/client boundaries, or a Fast Refresh module reset. Fast
 * Refresh may preserve hook state while recreating module trackers; the full
 * binding (company + query object + lifecycle + generation + content + local
 * session) therefore fails closed on any mismatch rather than assuming HMR
 * discarded the workbench.
 */
const queryEpochs = new WeakMap<object, AllocationQueryEpoch>();
let nextQueryEpoch = 1;

function queryInstanceEpoch(query: object): AllocationQueryEpoch {
  const existing = queryEpochs.get(query);
  if (existing !== undefined) return existing;
  const epoch = nextQueryEpoch++;
  queryEpochs.set(query, epoch);
  return epoch;
}

/**
 * The complete, governed allocation-candidate set for ONE receipt.
 *
 * REPLACES the previous `useOutstandingInvoices` OFFSET scan over `/invoices`.
 * That scan paged a collection that could change underneath it, so it could not
 * prove coverage: rows shifted out of an already-read offset window appeared on
 * no page at all. It was hardened with invariants (immutable total, duplicate
 * detection, exact coverage) but those only DETECT instability — they cannot
 * recover a row the server never sent, and an exactly-balanced concurrent
 * delete+insert defeated them entirely.
 *
 * `GET /allocations/candidates` removes the problem at the source rather than
 * mitigating it on the client: migration 030's `get_allocation_candidates` RPC
 * is read-only and non-paginated, so the whole candidate set comes from ONE
 * PostgreSQL statement snapshot. There is no window to shift.
 *
 * The receipt id is the ONLY business identifier sent. Customer, currency,
 * eligibility, visibility, assignment scope and the 5,000-row cap are all
 * derived and governed server-side — the frontend supplies no candidate
 * authority of its own, and cannot widen the set by asking differently.
 *
 * Deliberately NOT `keepPreviousData`: showing a previous receipt's candidates
 * while a new receipt loads is precisely the stale-authority defect this batch
 * exists to remove. An unverified read yields no rows at all.
 */
export function useAllocationCandidates(receiptId: string | null | undefined) {
  const api = useApi();
  const id = normalizeId(receiptId);
  // B9DD-FDR-002: the active company is part of the cache identity, so switching
  // company is a DIFFERENT query — it cannot resolve against the previous
  // tenant's entry, and it refetches under the new `X-Company-Id` by
  // construction rather than by hoping an effect notices.
  const companyId = useCompanyStore((s) => normalizeId(s.companyId));

  return useQuery<AllocationCandidateContract>({
    // Company AND receipt are both in the key.
    queryKey: allocationCandidateQueryKey(companyId, id),
    queryFn: async () => {
      // Non-null by `enabled`, but assert rather than assume: a request without
      // a receipt id or a tenant must never be constructed.
      if (!id) throw new AllocationContractError("no receipt selected");
      if (!companyId) throw new AllocationContractError("no active company");
      const raw = await api.get<unknown>("/allocations/candidates", {
        params: { receipt_id: id },
      });
      // Verified against the id we ASKED for, not the one we were told about.
      return parseAllocationCandidateContract(raw, id);
    },
    // Both identifiers are mandatory: a blank/invalid company or receipt
    // disables the query rather than issuing an ungoverned read.
    enabled: id !== null && companyId !== null,
    // A candidate set that cannot be verified is not retried into looking valid.
    retry: false,
    // Always re-read: allocation acts on balances, so a cached candidate set is
    // never presented as current.
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * A LIVE read of the governed candidate cache, evaluated at ACTION INVOCATION
 * time rather than at render time.
 *
 * B9DD-CDR-002: this exists because a render-time boolean is not an authority.
 * `isContractVerified` is computed during render and then captured by every
 * `useCallback` closure. TanStack Query updates its cache synchronously and
 * notifies observers, but React may not commit the resulting render before a
 * queued event handler runs. In that window the captured callback still holds
 * `isContractVerified === true` while the cache has ALREADY moved on. Three real
 * periods produce exactly that:
 *
 *   - refetch STARTED: data retained, status still `success`, fetchStatus
 *     `fetching`;
 *   - refetch FAILED: stale data retained, status flips to `error`;
 *   - refetch SUCCEEDED with CHANGED data: cache holds the new contract while
 *     the workbench is still bound to the old one.
 *
 * Reading `getQueryState` here makes the check synchronous with the cache, not
 * with the render. Returns the live binding identity, or `null` — and `null`
 * always means DENY.
 */
export interface LiveAllocationContract {
  /** The identity to authorize against, including lifecycle and fetch generation. */
  binding: AllocationContractBinding;
  /** The governed contract that exact generation produced. */
  contract: AllocationCandidateContract;
}

/**
 * The ONE reader of live candidate authority (B9DD-CRR-001 Section 1.1).
 *
 * Production and tests both go through this function, so they cannot disagree
 * about what "the current generation" means. It performs a SINGLE
 * single public Query-object state read, so the returned contract and its generation token are
 * atomically consistent — deriving them from two separate reads (or taking the
 * contract from a render and the generation from the cache) could pair a stale
 * contract with a fresh generation, which is the very defect being fixed.
 */
function readLiveAllocationContract(
  queryClient: QueryClient,
  id: string | null,
): LiveAllocationContract | null {
  // No receipt selected: nothing can be authorized.
  if (!id) return null;

  // B9DD-FDR-002: the CURRENT tenant, read synchronously from the authoritative
  // store at INVOCATION time — never a company id captured by a previous render.
  // A callback created under Company A must deny the instant the store flips to
  // Company B, before the page has any chance to re-render.
  const companyId = currentCompanyId();
  if (!companyId) return null;

  // ONE Query object, addressed by the SAME canonical company-scoped key the
  // hook writes. Everything below — identity, state, contract, generation —
  // comes from this single instance, so no read can pair one Query's content
  // with another Query's token (B9DD-FDR-001 §2).
  const query = queryClient
    .getQueryCache()
    .find<AllocationCandidateContract>({ queryKey: allocationCandidateQueryKey(companyId, id) });
  if (!query) return null;

  const state = query.state;

  // Only a settled success counts. `status === 'error'` covers the failed
  // background refetch that RETAINS old data (TanStack's `isRefetchError`):
  // the data is still there and still stale, and it must not be actionable.
  if (state.status !== "success") return null;
  // A refetch in flight (or paused) means these figures are already being
  // replaced.
  if (state.fetchStatus !== "idle") return null;
  if (state.error !== null) return null;

  const data = state.data;
  if (!data) return null;
  // `complete` and full schema validity were established by the queryFn's
  // parser; re-assert the two identity facts that matter most here rather than
  // trusting that the cache entry under this key is what we think it is.
  if (data.complete !== true) return null;
  if (data.receipt.id !== id) return null;

  return {
    binding: contractBindingIdentity(
      data,
      companyId,
      // The epoch of THIS Query object — the one whose state and data we just read.
      queryInstanceEpoch(query),
      // The synchronous event generation for this exact company/receipt key.
      allocationCandidateLifecycleEventEpoch(queryClient, companyId, id),
      // `dataUpdateCount` / `dataUpdatedAt` from the same public state snapshot.
      { dataUpdateCount: state.dataUpdateCount, dataUpdatedAt: state.dataUpdatedAt },
    ),
    contract: data,
  };
}

export function useLiveAllocationContract(
  receiptId: string | null | undefined,
): () => LiveAllocationContract | null {
  const queryClient = useQueryClient();
  const id = normalizeId(receiptId);
  // Deliberately NOT keyed on a render-time company id: the reader resolves the
  // current tenant itself, at invocation.
  return useCallback(() => readLiveAllocationContract(queryClient, id), [queryClient, id]);
}

// ── B9DD-FRR-001: collision-free query-revision observation ─────────────────

/**
 * A PRIMITIVE revision string for the exact canonical candidate query.
 *
 * B9DD-FRR-001 exists because the rebind effect observed `dataUpdatedAt` only.
 * That is a millisecond timestamp, so two successful byte-identical reads
 * completing in the SAME millisecond are indistinguishable to React. Reproduced
 * against the previous implementation, with `Date.now()` frozen:
 *
 *   dataUpdateCount: 1 -> 2      dataUpdatedAtEqual: true   sameDataRef: true
 *   boundGeneration: 1 -> 1      REBOUND: false             linesStillPresent: 1
 *   ACTIONABLE_NOW: false        canSubmit: true
 *
 * Every render-visible input was unchanged — same `data` reference (structural
 * sharing), same fingerprint, same `dataUpdatedAt` — so the effect never re-ran,
 * the workbench stayed bound to generation 1 while the cache was on generation 2,
 * and invocation-time authorization then denied every action FOREVER. Worse, the
 * stale `canSubmit` memo still read `true`, so the Confirm button rendered
 * enabled and silently did nothing. Safety held; liveness did not.
 *
 * `dataUpdateCount` distinguishes successful generations within an uninterrupted
 * Query lifetime. B9DD-FNC-001 adds the synchronous lifecycle epoch because a
 * same-object reset can restore the count and then immediately reach identical
 * final state before React receives its scheduled notification. `dataUpdatedAt`
 * remains defence in depth and diagnostics; it is never the sole trigger.
 *
 * Returned as a PRIMITIVE deliberately: `useSyncExternalStore` compares
 * snapshots with `Object.is`, so a string compares BY VALUE and an unchanged
 * query yields an equal snapshot. Returning a fresh object here would signal a
 * change on every read and spin the render loop.
 *
 * Derived ONLY from the exact allocation-candidate key. QueryCache is a global
 * event source, but the listener returns before recording or notifying for an
 * unrelated, observer-only, stale-company, or other-receipt event.
 */
export function allocationCandidateQueryRevision(
  queryClient: QueryClient,
  id: string | null,
): string {
  if (!id) return "no-receipt";
  // B9DD-FDR-002: the tenant is part of the revision, so a company switch is
  // itself an observable transition rather than something React must infer.
  const companyId = currentCompanyId();
  if (!companyId) return "no-company";

  const query = queryClient
    .getQueryCache()
    .find<AllocationCandidateContract>({ queryKey: allocationCandidateQueryKey(companyId, id) });
  // A removed query is a distinct, observable state — not "unchanged".
  const lifecycleEpoch = allocationCandidateLifecycleEventEpoch(queryClient, companyId, id);
  if (!query) return `${companyId}|${id}|${lifecycleEpoch}|missing`;

  const state = query.state;
  return [
    companyId,
    id,
    lifecycleEpoch,
    // B9DD-FDR-001: the Query INSTANCE. A removed-and-recreated query reads as a
    // new revision even when every state field below repeats exactly.
    queryInstanceEpoch(query),
    state.status, // pending | error | success
    state.fetchStatus, // fetching | paused | idle
    state.dataUpdateCount, // successful-generation counter within this Query lifetime
    state.dataUpdatedAt, // defence in depth / diagnostics; never alone
    state.errorUpdateCount, // a repeated identical failure is still a transition
  ].join("|");
}

/**
 * Subscribe one React/external-store consumer to the exact active-company
 * candidate lifecycle. Exported so regression probes exercise the same listener
 * as the hook rather than a parallel reconstruction.
 */
export function subscribeToAllocationCandidateQueryLifecycle(
  queryClient: QueryClient,
  receiptId: string | null | undefined,
  onStoreChange: () => void,
): () => void {
  const id = normalizeId(receiptId);
  // B9DD-FCR-002 keeps React notification on TanStack's public scheduler so a
  // Query fetch begun during render cannot synchronously update another React
  // subscriber. B9DD-FNC-001 separates that scheduling concern from semantic
  // observation: the matching lifecycle epoch advances NOW, in QueryCache's
  // synchronous event delivery, before `batchCalls` queues the notification.
  const notifyReact = notifyManager.batchCalls(onStoreChange);
  return queryClient.getQueryCache().subscribe((event) => {
    const identity = candidateIdentityFromEvent(event);
    const activeCompanyId = currentCompanyId();
    if (!identity || !id || !activeCompanyId) return;
    if (identity.companyId !== activeCompanyId || identity.receiptId !== id) return;
    recordCandidateLifecycleEvent(queryClient, event, identity.companyId, identity.receiptId);
    notifyReact();
  });
}

/**
 * Subscribe React to every state transition of the exact candidate query.
 *
 * Uses the PUBLIC `queryClient.getQueryCache().subscribe(...)` API (QueryCache
 * extends the exported `Subscribable`), with `useSyncExternalStore`. No polling,
 * no timers, no forced refetch, no private internals, and structural sharing is
 * left enabled — the revision observes the generation instead of fighting it.
 */
export function useAllocationCandidateQueryRevision(
  receiptId: string | null | undefined,
): string {
  const queryClient = useQueryClient();
  const id = normalizeId(receiptId);

  // Subscribe to the company store as well. A tenant switch is a Zustand change,
  // NOT a QueryCache event, so the cache subscription alone would never see it
  // and the revision would go unrecomputed through a company switch.
  //
  // This selector is here purely as a SUBSCRIPTION: it re-renders the hook on a
  // tenant change, and `useSyncExternalStore` then re-reads `getSnapshot`, which
  // always resolves the CURRENT company itself. So the value is deliberately not
  // captured or used as a dependency — ESLint is right that it would be dead
  // weight there, and depending on a render-captured tenant is the very thing
  // B9DD-FDR-002 forbids.
  useCompanyStore((s) => s.companyId);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeToAllocationCandidateQueryLifecycle(queryClient, id, onStoreChange),
    [queryClient, id],
  );

  const getSnapshot = useCallback(
    () => allocationCandidateQueryRevision(queryClient, id),
    [queryClient, id],
  );

  // Server snapshot is the same pure read: this hook is client-only ("use
  // client"), and the cache is empty during SSR, so it yields `missing`.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Map a governed candidate to the workbench's display/input row.
 *
 * `overdue_days` is presentation only. Nothing here derives an authoritative
 * financial figure: outstanding is the backend's, and the manual-allocation
 * route revalidates every balance at execution time regardless of what the
 * workbench shows.
 */
export function toAllocationInvoice(
  candidate: AllocationCandidateContract["candidates"][number],
  today: Date = new Date(),
): AllocationInvoice {
  const dueDate = candidate.due_date ? new Date(candidate.due_date) : null;
  const overdueDays = dueDate
    ? Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    id: candidate.id,
    invoice_no: candidate.invoice_no,
    doc_type: candidate.doc_type,
    invoice_date: candidate.invoice_date,
    due_date: candidate.due_date,
    currency: candidate.currency,
    exchange_rate: candidate.exchange_rate,
    total_amount: candidate.total_amount,
    outstanding: candidate.outstanding,
    overdue_days: overdueDays,
  };
}

/**
 * Map the governed receipt to the workbench's receipt context.
 *
 * This is the AUTHORITATIVE receipt for the workbench: the row the user clicked
 * in the list may be stale (its unallocated balance in particular), and the
 * governed contract's receipt is the one the backend just validated.
 */
export function toAllocationReceipt(
  receipt: AllocationCandidateContract["receipt"],
): AllocationReceipt {
  return {
    id: receipt.id,
    receipt_no: receipt.receipt_no,
    receipt_date: receipt.receipt_date,
    customer_id: receipt.customer_id,
    customer_name: receipt.customer_name,
    currency: receipt.currency,
    exchange_rate: receipt.exchange_rate,
    receipt_amount: receipt.receipt_amount,
    unallocated_amount: receipt.unallocated_amount,
    payment_method: receipt.payment_method,
    status: receipt.status,
  };
}

// ─── Mutation: Execute Manual Allocation ─────────────────────────────────────

export function useManualAllocate() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      receipt_id: string;
      allocations: Array<{ invoice_id: string; amount: number; discount_amount?: number }>;
    }) => {
      return api.post<AllocationDetail[]>("/allocations/manual", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["allocations"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ─── Mutation: Execute Auto Allocation (DISABLED for Sprint F1) ───────────────
// IMPORTANT: POST /allocations/auto is NOT in the verified Sprint F1 endpoint list.
// This hook is disabled. Use useManualAllocate() instead.

export function useAutoAllocate() {
  return useMutation({
    mutationFn: async (_payload: { receipt_id: string; method: "FIFO" | "AmountMatch" }) => {
      // DISABLED: /allocations/auto is not a verified Sprint F1 endpoint.
      // This will be enabled when the endpoint is added to the verified list.
      throw new Error(
        "Auto-allocation is not available in the current sprint. Use manual allocation instead."
      );
    },
  });
}

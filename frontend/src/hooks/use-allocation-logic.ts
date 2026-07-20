// ============================================================================
// TSH Synergy AR — useAllocationLogic Hook
// Frontend FIFO allocation engine + real-time balance validation.
// Mirrors backend algorithms.ts (allocateFIFO / allocateAmountMatch).
// Uses audited roundTo2 from invoice-calculator.ts.
// ============================================================================

"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { roundTo2 } from "@/lib/invoice-calculator";
import {
  bindingsMatch,
  type AllocationContractBinding,
} from "@/lib/allocation-candidate-contract";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Receipt as displayed in the left panel */
export interface AllocationReceipt {
  id: string;
  receipt_no: string;
  receipt_date: string;
  customer_id: string;
  customer_name: string;
  currency: string;
  exchange_rate: number;
  receipt_amount: number;
  unallocated_amount: number;
  payment_method: string;
  status: string;
}

/** Outstanding invoice as displayed in the right panel */
export interface AllocationInvoice {
  id: string;
  invoice_no: string;
  doc_type: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  exchange_rate: number;
  total_amount: number;
  outstanding: number;
  /** Days overdue (negative = not yet due) */
  overdue_days: number;
}

/** A single allocation line (manual or FIFO-proposed) */
export interface AllocationLine {
  invoice_id: string;
  invoice_no: string;
  doc_type: string;
  /** Amount to allocate from receipt to this invoice */
  amount: number;
  /** Max allowed = invoice.outstanding */
  max_amount: number;
  /** Early payment discount amount (optional, matches backend discount_amount field) */
  discount_amount: number;
  /** Forex gain/loss in base currency */
  forex_gain_loss: number;
  /** Whether this line was auto-proposed by FIFO */
  is_auto: boolean;
  /** Validation errors for this line */
  errors: string[];
}

/** Overall allocation session state */
export interface AllocationState {
  /** Currently selected receipt */
  selectedReceipt: AllocationReceipt | null;
  /** Outstanding invoices for the receipt's customer */
  invoices: AllocationInvoice[];
  /** The working allocation lines */
  lines: AllocationLine[];
  /** Is FIFO preview active (highlight, not committed) */
  isFifoPreview: boolean;
}

/** Computed validation summary */
export interface AllocationValidation {
  /** Sum of all allocation amounts */
  totalAllocating: number;
  /** Receipt unallocated balance */
  availableBalance: number;
  /** Remaining after allocation */
  remainingBalance: number;
  /** Whether total ≤ available */
  isBalanceValid: boolean;
  /** Whether all individual lines are valid */
  allLinesValid: boolean;
  /** Overall can-submit status */
  canSubmit: boolean;
  /** Number of lines with amounts > 0 */
  activeLineCount: number;
}

// ─── Forex Calculation (mirrors backend algorithms.ts) ──────────────────────
//
// IMPORTANT (BUG-A03): This forex calculation is for **UI preview only**.
// The backend AllocationService.manualAllocate() recalculates forex gain/loss
// from the database snapshot of invoice.exchange_rate and receipt.exchange_rate
// at the time of execution. This ensures the authoritative G/L value is based
// on committed data, not stale frontend state. The frontend preview may differ
// if exchange rates are updated between preview and submission.
//

function calculateForexGainLoss(
  allocatedAmount: number,
  invoiceRate: number,
  receiptRate: number,
): number {
  if (Math.abs(invoiceRate - receiptRate) < 0.0001) return 0;
  return roundTo2(allocatedAmount * (receiptRate - invoiceRate));
}

// ─── FIFO Algorithm (mirrors backend allocateFIFO exactly) ──────────────────
//
// BUG-A01 FIX: The loop must NOT round allocAmount before subtracting from
// `remaining`. Premature rounding can cause cumulative drift:
//   e.g., remaining=100, inv1.outstanding=33.33, inv2=33.33, inv3=33.34
//   With premature round: 100 - 33.33 = 66.67, 66.67 - 33.33 = 33.34,
//     33.34 - 33.34 = 0 ✓
//   But edge cases with 4+ invoices can cause the last invoice to be short
//   by 0.01 due to accumulated rounding errors.
//
// Correct approach: keep `remaining` at full precision throughout the loop.
// Only round allocAmount when pushing to the proposals array (output).
//

function computeFIFO(
  invoices: AllocationInvoice[],
  availableAmount: number,
  receiptRate: number,
): AllocationLine[] {
  const proposals: AllocationLine[] = [];
  let remaining = availableAmount; // Full precision — NO rounding in loop

  // Sort by due_date ASC (oldest first), then by invoice_no
  const sorted = [...invoices].sort((a, b) => {
    const dA = a.due_date ?? "9999-12-31";
    const dB = b.due_date ?? "9999-12-31";
    if (dA !== dB) return dA.localeCompare(dB);
    return a.invoice_no.localeCompare(b.invoice_no);
  });

  for (const inv of sorted) {
    if (remaining <= 0.005) break; // Tolerance for float dust

    // Raw allocation amount — DO NOT round yet (BUG-A01 fix)
    const rawAllocAmount = Math.min(inv.outstanding, remaining);

    // Round only for output — the value that will be displayed and submitted
    const roundedAllocAmount = roundTo2(rawAllocAmount);

    const forexGL = calculateForexGainLoss(roundedAllocAmount, inv.exchange_rate, receiptRate);

    proposals.push({
      invoice_id: inv.id,
      invoice_no: inv.invoice_no,
      doc_type: inv.doc_type,
      amount: roundedAllocAmount,
      max_amount: inv.outstanding,
      discount_amount: 0,
      forex_gain_loss: forexGL,
      is_auto: true,
      errors: [],
    });

    // Subtract raw (unrounded) amount to preserve precision for next iteration
    remaining -= rawAllocAmount;
  }

  return proposals;
}

// ─── Receipt selection transition (B9DD-CRR-002) ────────────────────────────

/**
 * Build THE receipt-selection transition handler.
 *
 * Every change to which receipt is authoritative must go through this, so the
 * ordering rule exists in exactly one place and cannot drift between the select,
 * reselect, clear and post-submit paths.
 *
 * The rule: **revoke synchronously, THEN schedule**.
 *
 * B9DD-CRR-002: the previous handler only called `setSelectedReceiptId(id)`,
 * assuming the binding effect would clear the old receipt "before any new data
 * arrives". It does not — an effect runs only after React COMMITS. Until then:
 *
 *   - the verifier closure captured by the last render still addresses receipt A;
 *   - A's cache entry is still success/idle with matching content and generation;
 *   - `boundRef.current` still holds A's binding;
 *
 * so a callback captured from A's last verified render remained authorized
 * INSIDE this very event. `revoke()` is a ref write and takes effect the instant
 * it returns, which is the only thing that actually closes the window.
 *
 * It is deliberately a plain factory rather than a hook: the page's selection
 * state must be declared before the logic hook that produces `revoke`, so a hook
 * owning both would be circular. This keeps one shared implementation that the
 * page and its tests both execute.
 */
export function createReceiptSelectionHandler(
  revoke: () => void,
  setSelectedReceiptId: (id: string | null) => void,
): (id: string | null) => void {
  return (id: string | null) => {
    // 1. Revoke current authority SYNCHRONOUSLY.
    revoke();
    // 2. Only then schedule the new selection.
    setSelectedReceiptId(id);
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Options controlling whether the workbench may be acted on at all.
 *
 * B9DD-CDR-002: hiding a component is NOT enforcement, and neither is a boolean
 * captured during render. Every mutating action below re-verifies against the
 * LIVE query cache at invocation time, so a stale closure surviving into the
 * gap between a cache change and React's commit cannot act on it.
 */
export interface AllocationLogicOptions {
  /**
   * Reads the live candidate-query cache and returns the binding identity of the
   * contract that is authoritative RIGHT NOW, or `null` if nothing is.
   *
   * Omitting it means DENY (see below) — never allow.
   */
  verifyLiveContract?: () => AllocationContractBinding | null;
}

/**
 * The identity of one local binding session.
 *
 * B9DD-FDR old-callback hardening: every `bindVerifiedContract` starts a NEW
 * session. Each action callback captures the session id of the render it was
 * created in, and may only act while that session is still the active one.
 *
 * Without this, a callback captured under generation N read the newest mutable
 * `boundRef.current` — so once N+1 bound, the old callback passed verification
 * against N+1 and acted using N's captured `invoices`/`lines` closures. That is
 * how a stale FIFO helper could repopulate the workbench with the previous
 * generation's rows and produce a duplicate line.
 */
type BindingSessionId = number;

export function useAllocationLogic(options: AllocationLogicOptions = {}) {
  const { verifyLiveContract } = options;

  const [selectedReceipt, setSelectedReceipt] = useState<AllocationReceipt | null>(null);
  const [invoices, setInvoices] = useState<AllocationInvoice[]>([]);
  const [lines, setLines] = useState<AllocationLine[]>([]);
  const [isFifoPreview, setIsFifoPreview] = useState(false);

  /**
   * The contract generation the current lines were built against.
   *
   * A ref, not state, and that is the whole point: a stale callback closes over
   * the RENDER's values, but `boundRef.current` is read at invocation and always
   * returns the latest bind. State here would reintroduce exactly the staleness
   * this is defending against.
   */
  const boundRef = useRef<AllocationContractBinding | null>(null);
  const generationRef = useRef(0);
  const [boundGeneration, setBoundGeneration] = useState(0);

  /**
   * The ACTIVE binding session. Bumped on every bind, cleared on every revoke.
   *
   * `sessionRef` is the authority; `bindingSession` is its render-visible mirror
   * so that callbacks can capture the session they were created in.
   */
  const sessionCounterRef = useRef<BindingSessionId>(0);
  const sessionRef = useRef<BindingSessionId | null>(null);
  const [bindingSession, setBindingSession] = useState<BindingSessionId | null>(null);

  /**
   * The single authorization gate. Called by every mutating action, at the
   * moment it runs.
   *
   * B9DD-CDR-002 §2.4: DEFAULT-DENY. No verifier configured means no authority,
   * not implicit trust. The previous `isContractVerified ?? true` meant a caller
   * who simply forgot to wire verification got a fully actionable financial
   * workbench — the failure mode was silent and maximally permissive.
   *
   * `expectedSession` is the session the CALLING callback was created in. It is
   * what stops an old callback riding the newest `boundRef`: verification alone
   * would pass, because the current binding really is valid — just not the one
   * that callback's captured `invoices`/`lines` belong to.
   */
  const isActionAuthorized = useCallback(
    (expectedSession?: BindingSessionId | null): boolean => {
      // No verifier => no authority. Fail closed.
      if (!verifyLiveContract) return false;
      // Nothing bound => there is no generation to act against.
      const bound = boundRef.current;
      if (!bound) return false;
      // The caller belongs to a superseded session: deny regardless of how valid
      // the CURRENT binding is.
      if (expectedSession !== undefined) {
        if (expectedSession === null) return false;
        if (sessionRef.current === null) return false;
        if (expectedSession !== sessionRef.current) return false;
      }
      // Live read: covers tenant switch, refetch-in-flight,
      // refetch-failed-with-stale-data, wrong receipt, missing/incomplete data,
      // and a recreated Query instance. `null` is always DENY.
      const live = verifyLiveContract();
      if (!live) return false;
      // A changed contract that has arrived but not yet been rebound: the lines
      // still belong to `bound`, so acting on them would submit against figures
      // the server has already moved past.
      return bindingsMatch(bound, live);
    },
    [verifyLiveContract],
  );

  /**
   * Bind the workbench to a freshly verified contract.
   *
   * Lines are ALWAYS cleared, including on a background refetch of the same
   * receipt: a later read may carry different candidate versions, outstanding
   * balances or a different unallocated amount, and a line entered against the
   * previous read would then be submitting against figures that no longer
   * exist. Rebuilding from the verified result only is the fail-closed choice.
   */
  const bindVerifiedContract = useCallback(
    (
      receipt: AllocationReceipt,
      verifiedInvoices: AllocationInvoice[],
      binding: AllocationContractBinding,
    ) => {
      generationRef.current += 1;
      boundRef.current = { ...binding, generation: generationRef.current };
      // A new authoritative generation is a NEW session: every callback created
      // before this moment is now permanently inert.
      sessionCounterRef.current += 1;
      sessionRef.current = sessionCounterRef.current;
      setBindingSession(sessionCounterRef.current);
      setBoundGeneration(generationRef.current);
      setSelectedReceipt(receipt);
      setInvoices(verifiedInvoices);
      setLines([]);
      setIsFifoPreview(false);
    },
    [],
  );

  /**
   * SYNCHRONOUSLY revoke the current contract authority, then drop every
   * candidate and line. The user's receipt choice is kept.
   *
   * B9DD-CRR-002: `boundRef.current = null` takes effect the instant this
   * returns — it is a ref write, not a scheduled state update. That matters
   * because a React state update does NOT revoke anything until React commits,
   * and a callback captured by the previous render keeps running against the
   * previous authority in the meantime. Any caller that is about to change WHICH
   * receipt is authoritative must revoke here FIRST and only then schedule the
   * new selection; relying on the binding effect to clean up afterwards leaves
   * precisely the window this closes.
   *
   * Unbinding before tearing down the dependent state is likewise deliberate:
   * authority is revoked before the state that depended on it, never after.
   *
   * §2.6: this is a SAFE destructive operation. It only ever REMOVES local state
   * and cannot grant authority, so it needs no live verification — a stale
   * caller invoking it can only make the workbench less actionable.
   */
  const revokeContractAuthority = useCallback(() => {
    boundRef.current = null;
    sessionRef.current = null;
    setBindingSession(null);
    setInvoices([]);
    setLines([]);
    setIsFifoPreview(false);
  }, []);

  /** Safe destructive operation — see `revokeContractAuthority`. */
  const clearSelection = useCallback(() => {
    boundRef.current = null;
    sessionRef.current = null;
    setBindingSession(null);
    setSelectedReceipt(null);
    setInvoices([]);
    setLines([]);
    setIsFifoPreview(false);
  }, []);

  /**
   * The session THIS RENDER's callbacks belong to.
   *
   * Every action callback below closes over this value and passes it to
   * `isActionAuthorized`, so a callback can only ever act for the session whose
   * `invoices`/`lines` it also captured. After a rebind the session advances and
   * every previously-created callback is inert — which is precisely what stops a
   * stale FIFO closure from repopulating the workbench with the old generation's
   * rows.
   */
  const session = bindingSession;

  // ── FIFO Preview (compute locally, highlight, don't submit) ─────────

  const runFifoPreview = useCallback(() => {
    if (!isActionAuthorized(session)) return;
    if (!selectedReceipt || invoices.length === 0) return;

    const proposals = computeFIFO(
      invoices,
      selectedReceipt.unallocated_amount,
      selectedReceipt.exchange_rate,
    );

    setLines(proposals);
    setIsFifoPreview(true);
  }, [selectedReceipt, invoices, isActionAuthorized, session]);

  // ── Manual: add an invoice to allocation ────────────────────────────

  const addInvoice = useCallback((invoice: AllocationInvoice) => {
    if (!isActionAuthorized(session)) return;
    // Only a candidate from the CURRENT verified contract may be added.
    if (!invoices.some((i) => i.id === invoice.id)) return;
    // Skip if already in the list
    if (lines.some((l) => l.invoice_id === invoice.id)) return;

    setLines((prev) => [
      ...prev,
      {
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        doc_type: invoice.doc_type,
        amount: 0,
        max_amount: invoice.outstanding,
        discount_amount: 0,
        forex_gain_loss: 0,
        is_auto: false,
        errors: [],
      },
    ]);
    setIsFifoPreview(false);
  }, [lines, invoices, isActionAuthorized, session]);

  // ── Manual: remove an invoice from allocation ───────────────────────

  const removeInvoice = useCallback((invoiceId: string) => {
    if (!isActionAuthorized(session)) return;
    setLines((prev) => prev.filter((l) => l.invoice_id !== invoiceId));
    setIsFifoPreview(false);
  }, [isActionAuthorized, session]);

  // ── Manual: update allocation amount for a specific line ────────────

  const updateAmount = useCallback((invoiceId: string, newAmount: number) => {
    if (!isActionAuthorized(session)) return;
    if (!selectedReceipt) return;

    setLines((prev) =>
      prev.map((line) => {
        if (line.invoice_id !== invoiceId) return line;

        const amount = roundTo2(Math.max(0, newAmount));
        const errors: string[] = [];

        // Validate: amount ≤ invoice outstanding
        if (amount > line.max_amount + 0.005) {
          errors.push(`Allocation amount (${amount}) exceeds invoice outstanding balance (${line.max_amount}).`);
        }

        // Recalculate forex
        const inv = invoices.find((i) => i.id === invoiceId);
        const forexGL = inv
          ? calculateForexGainLoss(amount, inv.exchange_rate, selectedReceipt.exchange_rate)
          : 0;

        return {
          ...line,
          amount,
          forex_gain_loss: forexGL,
          is_auto: false,
          errors,
        };
      })
    );
    setIsFifoPreview(false);
  }, [selectedReceipt, invoices, isActionAuthorized, session]);

  // ── "Fill Max" for a single line ────────────────────────────────────

  const fillMax = useCallback((invoiceId: string) => {
    if (!isActionAuthorized(session)) return;
    if (!selectedReceipt) return;

    setLines((prev) => {
      // Calculate how much is already allocated to other lines
      const otherTotal = prev
        .filter((l) => l.invoice_id !== invoiceId)
        .reduce((sum, l) => sum + l.amount, 0);

      const available = roundTo2(selectedReceipt.unallocated_amount - otherTotal);

      return prev.map((line) => {
        if (line.invoice_id !== invoiceId) return line;

        const amount = roundTo2(Math.min(line.max_amount, Math.max(0, available)));
        const inv = invoices.find((i) => i.id === invoiceId);
        const forexGL = inv
          ? calculateForexGainLoss(amount, inv.exchange_rate, selectedReceipt.exchange_rate)
          : 0;

        return { ...line, amount, discount_amount: line.discount_amount, forex_gain_loss: forexGL, is_auto: false, errors: [] };
      });
    });
    setIsFifoPreview(false);
  }, [selectedReceipt, invoices, isActionAuthorized, session]);

  // ── Clear all lines (reset) ─────────────────────────────────────────
  //
  // §2.6: deliberately NOT live-verified. Authorization exists to stop stale
  // state becoming ACTIONABLE; this only ever removes local lines. It cannot
  // create a mutation, cannot raise an amount, and cannot increase authority, so
  // a stale caller invoking it can only ever make the workbench safer. Gating it
  // would mean a user could get stuck unable to clear lines the app itself has
  // already decided are untrustworthy.

  const clearLines = useCallback(() => {
    setLines([]);
    setIsFifoPreview(false);
  }, []);

  // ── Validation (computed) ───────────────────────────────────────────

  const validation = useMemo<AllocationValidation>(() => {
    const availableBalance = selectedReceipt?.unallocated_amount ?? 0;
    const totalAllocating = roundTo2(lines.reduce((sum, l) => sum + l.amount, 0));
    const remainingBalance = roundTo2(availableBalance - totalAllocating);
    const isBalanceValid = totalAllocating <= availableBalance + 0.005;
    const allLinesValid = lines.every((l) => l.errors.length === 0 && l.amount >= 0);
    const activeLineCount = lines.filter((l) => l.amount > 0).length;
    // Every line must still reference a candidate in the CURRENT verified
    // contract. A line whose candidate vanished from a later read is stale by
    // definition and must not be submittable.
    const allLinesBacked = lines.every((l) => invoices.some((i) => i.id === l.invoice_id));
    // `canSubmit` is PRESENTATION: it decides whether the button looks enabled.
    // It is computed during render, so by the time a click handler runs it may
    // already be wrong — which is precisely B9DD-CDR-002. It is therefore NOT
    // the submission authority; `buildPayload` re-verifies live, and the page
    // re-verifies again immediately before mutating. This live call still
    // belongs here so a default-deny hook never renders a submit-capable state.
    const canSubmit =
      // Scoped to THIS render's session, exactly like every action callback, so
      // a memo left over from a superseded session can never read `true`.
      isActionAuthorized(session) &&
      allLinesBacked &&
      isBalanceValid &&
      allLinesValid &&
      activeLineCount > 0;

    return {
      totalAllocating,
      availableBalance,
      remainingBalance,
      isBalanceValid,
      allLinesValid,
      canSubmit,
      activeLineCount,
    };
    // No `boundGeneration` dependency: every rebind replaces the `lines` and
    // `invoices` arrays by reference, so this already recomputes. ESLint is
    // right that it would be dead weight.
  }, [lines, selectedReceipt, invoices, isActionAuthorized, session]);

  // ── Update discount amount for a specific line ──────────────────────

  const updateDiscount = useCallback((invoiceId: string, discountAmt: number) => {
    if (!isActionAuthorized(session)) return;
    setLines((prev) =>
      prev.map((line) => {
        if (line.invoice_id !== invoiceId) return line;
        const discount = roundTo2(Math.max(0, discountAmt));
        const errors = [...line.errors.filter((e) => !e.includes("discount"))];

        // Validate: amount + discount ≤ outstanding
        if (line.amount + discount > line.max_amount + 0.005) {
          errors.push(`Allocation + discount (${roundTo2(line.amount + discount)}) exceeds invoice outstanding balance (${line.max_amount}).`);
        }

        return { ...line, discount_amount: discount, errors };
      })
    );
  }, [isActionAuthorized, session]);

  // ── Build API payload ───────────────────────────────────────────────

  const buildPayload = useCallback(() => {
    // §2.7: the payload refuses to EXIST unless live verification succeeds at
    // this exact invocation. A caller cannot construct a mutation from stale
    // state even by ignoring `canSubmit` entirely — there is nothing to send.
    if (!isActionAuthorized(session)) return null;
    if (!selectedReceipt) return null;
    // Never submit a line whose candidate is not in the current contract.
    if (!lines.every((l) => invoices.some((i) => i.id === l.invoice_id))) return null;
    const active = lines.filter((l) => l.amount > 0);
    // An empty allocation set is not a mutation, it is a no-op the backend would
    // reject. Constructing it at all would mean a verified-EMPTY contract could
    // still produce a POST-shaped object.
    if (active.length === 0) return null;
    return {
      receipt_id: selectedReceipt.id,
      allocations: active
        .map((l) => ({
          invoice_id: l.invoice_id,
          amount: l.amount,
          // Include discount_amount only if > 0 (matches backend optional field)
          ...(l.discount_amount > 0 ? { discount_amount: l.discount_amount } : {}),
        })),
    };
  }, [selectedReceipt, lines, invoices, isActionAuthorized, session]);

  return {
    // State
    selectedReceipt,
    invoices,
    lines,
    isFifoPreview,
    validation,
    /** Which bind the current lines belong to. Observability, not authority. */
    boundGeneration,
    /** The active binding session. Observability + presentation authority. */
    bindingSession,

    // Live authorization gate — exported so the page can re-verify immediately
    // before mutating, rather than trusting a render-time value (§2.7).
    isActionAuthorized,

    // Actions
    //
    // B9DD-CDR-002 §2.5: `selectReceipt(receipt, invoices)` is GONE. It bound a
    // receipt-list row — user intent, with a balance that may already be stale —
    // straight into authoritative workbench state, with no governed contract
    // involved. That is an ungoverned path to an actionable workbench, so it is
    // removed rather than guarded. The ONLY way in is `bindVerifiedContract`.
    bindVerifiedContract,
    revokeContractAuthority,
    clearSelection,
    runFifoPreview,
    addInvoice,
    removeInvoice,
    updateAmount,
    updateDiscount,
    fillMax,
    clearLines,
    buildPayload,
  };
}

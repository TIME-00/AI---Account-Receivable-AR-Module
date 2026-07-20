// ============================================================================
// TSH Synergy AR — Allocation Wizard (Split-Screen)
// Left:  Selectable Posted Receipts (receipt_no, amount, unallocated)
// Right: Governed allocation candidates for the selected receipt
// Center: FIFO preview + manual allocation table with real-time validation
//
// Batch 9D-D Phase B: candidates come from the governed, snapshot-consistent
// `GET /allocations/candidates` contract. The workbench is actionable ONLY while
// that contract is currently verified for the currently selected receipt.
// ============================================================================

"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatMoneySafe } from "@/lib/currency";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { useCompanyStore } from "@/stores/company-store";
import { useAllocationLogic, createReceiptSelectionHandler } from "@/hooks/use-allocation-logic";
import type { AllocationReceipt } from "@/hooks/use-allocation-logic";
import {
  usePostedReceipts,
  useAllocationCandidates,
  useLiveAllocationContract,
  useAllocationCandidateQueryRevision,
  useManualAllocate,
  toAllocationInvoice,
  toAllocationReceipt,
} from "@/hooks/use-allocations";
import { LoadingButton } from "@/components/ui/loading-button";
import { ReceiptPanel } from "@/components/features/allocations/receipt-panel";
import { InvoicePanel } from "@/components/features/allocations/invoice-panel";
import { AllocationTable } from "@/components/features/allocations/allocation-table";
import { AllocationHistoryTable } from "@/components/allocation-history-table";
import { ArrowLeftRight, RotateCcw, Zap } from "lucide-react";

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AllocationsPage() {
  const allocMutation = useManualAllocate();
  // B9DD-RR-004: forex_gain_loss is a COMPANY-BASE amount — migration 028
  // enforces `forex_gain_loss = ROUND(allocated_amount * (receipt_rate -
  // invoice_rate), 2)`, and those rates convert transaction → base. It is
  // therefore labelled with the authoritative company base currency, which may
  // legitimately be unavailable.
  const { baseCurrency } = useBaseCurrency();
  // B9DD-FDR-002: the active tenant. Its IDENTITY scopes the candidate cache and
  // gates authority; it is never itself an authority over money.
  const activeCompanyId = useCompanyStore((s) => s.companyId);

  // Receipt list
  const { data: receipts = [], isLoading: receiptsLoading } = usePostedReceipts();

  // The receipt the USER picked, TOGETHER with the tenant they picked it in.
  // This is only an intent: its balance may be stale, and it is never the
  // allocation authority.
  //
  // B9DD-FDR-002: the selection is stored company-qualified and then DERIVED, so
  // a tenant switch invalidates it during the very same render — no effect has
  // to run first. Storing a bare receipt id meant the render immediately after
  // `setCompany` still had Company A's receipt selected while the key had already
  // moved to Company B, which issued a pointless Company-B read for a receipt the
  // user had not chosen in that tenant.
  const [selection, setSelection] = useState<{ companyId: string; receiptId: string } | null>(null);
  const selectedReceiptId =
    selection !== null && selection.companyId === activeCompanyId ? selection.receiptId : null;

  const setSelectedReceiptId = useCallback(
    (id: string | null) =>
      setSelection(id === null ? null : { companyId: activeCompanyId, receiptId: id }),
    [activeCompanyId],
  );

  // The governed candidate contract for that receipt. Receipt id is the only
  // business identifier sent; customer, currency and eligibility are governed.
  const candidatesQuery = useAllocationCandidates(selectedReceiptId);
  const contract = candidatesQuery.data;

  // B9DD-FRR-001: the collision-free revision of the exact candidate query,
  // observed through the public QueryCache subscription. This — not
  // `dataUpdatedAt` — is what drives the rebind below.
  const queryRevision = useAllocationCandidateQueryRevision(selectedReceiptId);

  // ── Presentation gate ────────────────────────────────────────────────────
  //
  // Verified means ALL of: a contract resolved, it is not being refetched, and
  // it is for the receipt currently selected.
  //
  // B9DD-CDR-002: this is a RENDER-TIME value and therefore NOT the action
  // authority. It decides what is drawn. What may be DONE is decided by
  // `useLiveAllocationContract` at invocation time, because between a cache
  // change and React's commit this boolean is provably able to be wrong.
  const isContractVerified =
    candidatesQuery.isSuccess &&
    !candidatesQuery.isFetching &&
    contract !== undefined &&
    contract.receipt.id === selectedReceiptId;

  // The live authority: ONE reader of the candidate query cache, under the same
  // canonical key the hook writes. It returns the governed contract and the
  // exact fetch generation that produced it, from a single atomic read.
  const readLiveContract = useLiveAllocationContract(selectedReceiptId);
  // The logic layer only needs the binding; it stays decoupled from the query
  // layer, but resolves through the SAME reader so the two cannot disagree.
  const verifyLiveContract = useCallback(
    () => readLiveContract()?.binding ?? null,
    [readLiveContract],
  );

  const logic = useAllocationLogic({ verifyLiveContract });

  const { bindVerifiedContract, revokeContractAuthority, clearSelection } = logic;

  // ── B9DD-FDR-003: render-visible authority ───────────────────────────────
  //
  // `queryRevision` is a dependency of this memo, so every cache transition —
  // and every company switch — recomputes it. It answers "does the workbench
  // the user is looking at RIGHT NOW still hold authority?", using the same live
  // reader the actions use, so presentation and authorization cannot disagree
  // about the current state.
  //
  // It is NOT the mutation authority: `handleSubmit` still re-verifies at
  // invocation. It exists so the UI stops showing an enabled Confirm button that
  // would silently refuse — which is what the user actually experienced during a
  // same-timestamp refetch or a company switch.
  const presentationAuthorityValid = useMemo(() => {
    void queryRevision; // recompute on every observed query/tenant transition
    return logic.isActionAuthorized(logic.bindingSession);
  }, [queryRevision, logic]);

  // Local validity AND live authority. Either alone is misleading.
  const canSubmitNow = logic.validation.canSubmit && presentationAuthorityValid;

  // ── Bind the workbench to the verified contract, or to nothing ───────────
  //
  // This replaces the original effect, which synced only when the candidate
  // array was NON-EMPTY — so a verified-empty result, a failure or a malformed
  // response silently left the previous receipt's candidates and allocation
  // lines on screen and submittable.
  //
  // B9DD-FRR-001: the trigger is `queryRevision`, NOT `dataUpdatedAt` and not
  // any render-visible value. Those were all provably blind to a byte-identical
  // refetch settling in the SAME millisecond: structural sharing keeps the same
  // `data` reference, the fingerprint is unchanged, and `dataUpdatedAt` is a
  // millisecond timestamp, so nothing React could see had changed — while the
  // cache had moved to a new generation. Authorization then denied every action
  // forever. `queryRevision` includes `dataUpdateCount` for uninterrupted Query
  // generations and a synchronous lifecycle epoch for same-object reset cycles,
  // whose final count/timestamp/content can otherwise repeat. Every relevant
  // cache lifecycle is therefore observable even when React notification is
  // safely scheduled out of the cache callback.
  //
  // The condition is the live reader alone. It already encodes the whole policy
  // — settled success, idle, no error, complete, receipt-id match — so there is
  // no second, render-time notion of "verified" that could disagree with it.
  //
  // B9DD-FDR-003: this is a LAYOUT effect, not a passive one. A passive effect
  // runs AFTER paint, which left a real painted frame in which the cache had
  // already advanced to a new generation while `boundRef` still held the old
  // one — so `validation.canSubmit` (a memo whose dependencies had not changed)
  // still read `true` and the Confirm button painted ENABLED while every action
  // would deny. Measured directly: immediately after a byte-identical cache
  // advance the DOM still showed "Confirm Allocation (1)", enabled.
  // Rebinding in the layout phase closes that frame at the source rather than
  // painting it and correcting it afterwards.
  useLayoutEffect(() => {
    if (!selectedReceiptId) {
      clearSelection();
      return;
    }
    // B9DD-CRR-001: ONE atomic live read, so the contract and the fetch
    // generation authorising it always come from the same snapshot. Pairing a
    // contract from this render with a generation from a later cache read is
    // exactly the defect that design closed.
    const live = readLiveContract();
    if (live) {
      // Rebuild from the governed result only. The contract's receipt — not the
      // list row — is the authoritative context. Lines belonging to the previous
      // generation are cleared by `bindVerifiedContract`.
      bindVerifiedContract(
        toAllocationReceipt(live.contract.receipt),
        live.contract.candidates.map((c) => toAllocationInvoice(c)),
        live.binding,
      );
      return;
    }
    // Missing, pending, fetching, errored, malformed, or identity mismatch:
    // nothing from a previous read may remain actionable.
    revokeContractAuthority();
  }, [
    selectedReceiptId,
    queryRevision,
    readLiveContract,
    bindVerifiedContract,
    revokeContractAuthority,
    clearSelection,
  ]);

  // ── Handlers ────────────────────────────────────────────────────────

  // B9DD-CRR-002: THE single receipt-ID transition. Every path that changes
  // which receipt is authoritative — select, reselect, post-submit clear — goes
  // through this one handler, which revokes synchronously before scheduling.
  // `setSelectedReceiptId` MUST be a dependency: it is company-qualified, so a
  // handler memoized against a previous tenant's setter would record the new
  // selection under the OLD company and the derived selection would silently
  // discard it — the receipt would simply refuse to select after a switch.
  const selectReceiptId = useMemo(
    () => createReceiptSelectionHandler(clearSelection, setSelectedReceiptId),
    [clearSelection, setSelectedReceiptId],
  );

  // The receipt-list row is user INTENT only: only its id is taken, never its
  // balance, and it is never bound into authoritative state.
  const handleSelectReceipt = (receipt: AllocationReceipt) => selectReceiptId(receipt.id);

  const handleReselect = () => selectReceiptId(null);

  // ── B9DD-FDR-002: company transition ─────────────────────────────────────
  //
  // Three independent mechanisms, in the order they take effect:
  //
  //   1. INVOCATION-TIME (the security boundary): the live reader resolves the
  //      current tenant from the store on every action, so a Company-A callback
  //      denies the instant the store flips — before any render or effect.
  //   2. RENDER-TIME: `selectedReceiptId` is derived from a company-qualified
  //      selection, so the new tenant renders unselected in the same render.
  //   3. LAYOUT-PHASE (this effect): revokes the bound ref and drops candidate
  //      rows, lines and FIFO preview before paint, so the previous company's
  //      data never appears under the new company's name.
  //
  // (3) is presentation cleanup, not security — relying on an effect for safety
  // would be exactly the mistake B9DD-CRR-002 corrected. The company-scoped key
  // does the rest: Company B is a different cache entry, so there is nothing of
  // A's to evict and no broad destructive cache clearing to do.
  const previousCompanyIdRef = useRef(activeCompanyId);
  useLayoutEffect(() => {
    if (previousCompanyIdRef.current === activeCompanyId) return;
    previousCompanyIdRef.current = activeCompanyId;
    // Same ordering rule as every receipt transition: revoke, then schedule.
    selectReceiptId(null);
  }, [activeCompanyId, selectReceiptId]);

  const handleSubmit = async () => {
    // §2.7: submission is NEVER driven by the render-time `canSubmit`. Three
    // independent live checks, in order:
    //
    //   1. `buildPayload()` re-verifies against the live cache and returns null
    //      if anything has moved — so there is literally nothing to POST.
    //   2. `canSubmit` is the presentation gate (balance, line validity).
    //   3. One final live re-verification immediately before `mutateAsync`,
    //      because steps 1-2 and the network call are not atomic.
    const payload = logic.buildPayload();
    if (!payload || !canSubmitNow) return;
    // Scoped to this render's binding session, so a handler left over from a
    // superseded session cannot submit even if the CURRENT binding is valid.
    if (!logic.isActionAuthorized(logic.bindingSession)) return;

    try {
      await allocMutation.mutateAsync(payload);
      // B9DD-RR-004: a monetary total in a toast carries its currency. All
      // allocation amounts are in the receipt's currency (the governed contract
      // guarantees every candidate matches receipt.currency).
      toast.success("Allocation Successful", {
        description: `Allocated ${logic.validation.activeLineCount} invoice(s), total ${formatMoneySafe(
          logic.validation.totalAllocating,
          logic.selectedReceipt?.currency ?? null,
        )}`,
      });
      // Same single transition: revoke, then schedule.
      selectReceiptId(null);
    } catch {
      // Error toast handled by useApi
    }
  };

  // Compute the set of invoice IDs already in allocation lines
  const allocatedInvoiceIds = new Set(logic.lines.map((l) => l.invoice_id));

  // The receipt context shown to the user: the governed one once verified,
  // otherwise only the user's selection for panel headings.
  const selectedListReceipt = receipts.find((r) => r.id === selectedReceiptId) ?? null;
  const displayReceipt = logic.selectedReceipt ?? selectedListReceipt;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-brand-400" />
            Allocation Wizard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Select Receipt → Match Invoices → Manual Allocation
          </p>
        </div>
        {selectedReceiptId && (
          <LoadingButton variant="ghost" size="sm" onClick={handleReselect}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reselect
          </LoadingButton>
        )}
      </div>

      {/* Auto-Allocate Disabled Notice */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-medium text-amber-800">Auto-allocation is not available</p>
          <p className="text-xs text-amber-600">
            Automatic FIFO allocation will be available in a future sprint. Use manual allocation below.
          </p>
        </div>
      </div>

      {/* Split Screen: Receipts + Candidates */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ReceiptPanel
          receipts={receipts}
          isLoading={receiptsLoading}
          selectedReceiptId={selectedReceiptId ?? undefined}
          onSelectReceipt={handleSelectReceipt}
          totalAllocating={logic.validation.totalAllocating}
        />
        <InvoicePanel
          invoices={logic.invoices}
          selectedReceipt={displayReceipt}
          isLoading={candidatesQuery.isLoading || candidatesQuery.isFetching}
          error={candidatesQuery.error}
          isVerified={isContractVerified}
          allocatedInvoiceIds={allocatedInvoiceIds}
          onAddInvoice={logic.addInvoice}
        />
      </div>

      {/* Allocation Table — rendered ONLY against a verified contract. The
          action layer enforces this independently; this is presentation. */}
      {/* B9DD-FDR-003: `presentationAuthorityValid` is part of the condition, so
          during ANY authority mismatch — company switch, refetch, removal,
          error, superseded session — the table is replaced by the panel's
          loading/error state rather than left on screen looking usable. */}
      {isContractVerified && presentationAuthorityValid && logic.selectedReceipt && (
        <AllocationTable
          lines={logic.lines}
          invoices={logic.invoices}
          isFifoPreview={logic.isFifoPreview}
          // Defence in depth behind the render gate above: the Confirm button
          // reads `validation.canSubmit`, so it is handed the AUTHORITY-AWARE
          // value. A button that looks enabled but silently refuses is a UX lie.
          validation={{ ...logic.validation, canSubmit: canSubmitNow }}
          // B9DD-RR-004: the two authoritative bases for this workbench.
          receiptCurrency={logic.selectedReceipt.currency}
          baseCurrency={baseCurrency}
          onUpdateAmount={logic.updateAmount}
          onUpdateDiscount={logic.updateDiscount}
          onFillMax={logic.fillMax}
          onRemoveInvoice={logic.removeInvoice}
          onClearLines={logic.clearLines}
          onRunFifo={logic.runFifoPreview}
          onSubmit={handleSubmit}
          isSubmitting={allocMutation.isPending}
        />
      )}

      {/* Allocation History — Placeholder */}
      <AllocationHistoryTable
        showFilters
        showReceiptColumn
        showInvoiceColumn
        title="Allocation History"
        emptyMessage="No allocation history is available yet."
      />
    </div>
  );
}

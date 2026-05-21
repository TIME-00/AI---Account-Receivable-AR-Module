// ============================================================================
// TSH Synergy AR — useAllocationLogic Hook
// Frontend FIFO allocation engine + real-time balance validation.
// Mirrors backend algorithms.ts (allocateFIFO / allocateAmountMatch).
// Uses audited roundTo2 from invoice-calculator.ts.
// ============================================================================

"use client";

import { useState, useMemo, useCallback } from "react";
import { roundTo2 } from "@/lib/invoice-calculator";

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

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAllocationLogic() {
  const [selectedReceipt, setSelectedReceipt] = useState<AllocationReceipt | null>(null);
  const [invoices, setInvoices] = useState<AllocationInvoice[]>([]);
  const [lines, setLines] = useState<AllocationLine[]>([]);
  const [isFifoPreview, setIsFifoPreview] = useState(false);

  // ── Select a receipt ────────────────────────────────────────────────

  const selectReceipt = useCallback((receipt: AllocationReceipt, outstandingInvoices: AllocationInvoice[]) => {
    setSelectedReceipt(receipt);
    setInvoices(outstandingInvoices);
    setLines([]);
    setIsFifoPreview(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedReceipt(null);
    setInvoices([]);
    setLines([]);
    setIsFifoPreview(false);
  }, []);

  // ── FIFO Preview (compute locally, highlight, don't submit) ─────────

  const runFifoPreview = useCallback(() => {
    if (!selectedReceipt || invoices.length === 0) return;

    const proposals = computeFIFO(
      invoices,
      selectedReceipt.unallocated_amount,
      selectedReceipt.exchange_rate,
    );

    setLines(proposals);
    setIsFifoPreview(true);
  }, [selectedReceipt, invoices]);

  // ── Manual: add an invoice to allocation ────────────────────────────

  const addInvoice = useCallback((invoice: AllocationInvoice) => {
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
  }, [lines]);

  // ── Manual: remove an invoice from allocation ───────────────────────

  const removeInvoice = useCallback((invoiceId: string) => {
    setLines((prev) => prev.filter((l) => l.invoice_id !== invoiceId));
    setIsFifoPreview(false);
  }, []);

  // ── Manual: update allocation amount for a specific line ────────────

  const updateAmount = useCallback((invoiceId: string, newAmount: number) => {
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
  }, [selectedReceipt, invoices]);

  // ── "Fill Max" for a single line ────────────────────────────────────

  const fillMax = useCallback((invoiceId: string) => {
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
  }, [selectedReceipt, invoices]);

  // ── Clear all lines (reset) ─────────────────────────────────────────

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
    const canSubmit = isBalanceValid && allLinesValid && activeLineCount > 0;

    return {
      totalAllocating,
      availableBalance,
      remainingBalance,
      isBalanceValid,
      allLinesValid,
      canSubmit,
      activeLineCount,
    };
  }, [lines, selectedReceipt]);

  // ── Build API payload ───────────────────────────────────────────────

  // ── Update discount amount for a specific line ──────────────────────

  const updateDiscount = useCallback((invoiceId: string, discountAmt: number) => {
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
  }, []);

  // ── Build API payload ───────────────────────────────────────────────

  const buildPayload = useCallback(() => {
    if (!selectedReceipt) return null;
    return {
      receipt_id: selectedReceipt.id,
      allocations: lines
        .filter((l) => l.amount > 0)
        .map((l) => ({
          invoice_id: l.invoice_id,
          amount: l.amount,
          // Include discount_amount only if > 0 (matches backend optional field)
          ...(l.discount_amount > 0 ? { discount_amount: l.discount_amount } : {}),
        })),
    };
  }, [selectedReceipt, lines]);

  return {
    // State
    selectedReceipt,
    invoices,
    lines,
    isFifoPreview,
    validation,

    // Actions
    selectReceipt,
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

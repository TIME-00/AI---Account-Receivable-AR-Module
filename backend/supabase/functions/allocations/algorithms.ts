// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Allocation Algorithms
// Implements FIFO and Amount Match auto-allocation strategies
// PRD Part 3 §4.2-4.3
// ============================================================================

import type { Invoice, Receipt } from '../_shared/types.ts';
import { roundTo2 } from '../invoices/calculator.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AllocationCandidate {
  invoice_id: string;
  invoice_no: string;
  doc_type: string;
  due_date: string | null;
  outstanding: number;
  currency: string;
  exchange_rate: number;
}

export interface AllocationProposal {
  invoice_id: string;
  invoice_no: string;
  doc_type: string;
  allocated_amount: number;
  invoice_rate: number;
  receipt_rate: number;
  forex_gain_loss: number;
}

// ─── FIFO Algorithm (Auto_FIFO) ─────────────────────────────────────────────

/**
 * FIFO (First-In-First-Out) allocation algorithm (PRD Part 3 §4.2).
 *
 * Strategy:
 * 1. Sort outstanding invoices by due_date ASC (oldest first)
 * 2. Allocate receipt balance sequentially
 * 3. For each invoice: allocate MIN(invoice.outstanding, remaining_receipt)
 * 4. Stop when receipt is fully allocated or no more invoices
 *
 * Forex:
 * - If invoice currency = receipt currency, no forex G/L
 * - If different base_currency rates, calculate forex gain/loss
 *
 * @param candidates - Outstanding invoices sorted by due_date ASC
 * @param availableAmount - Unallocated receipt amount
 * @param receiptRate - Receipt's exchange rate to base currency
 * @returns Array of allocation proposals
 */
export function allocateFIFO(
  candidates: AllocationCandidate[],
  availableAmount: number,
  receiptRate: number,
): AllocationProposal[] {
  const proposals: AllocationProposal[] = [];
  let remaining = availableAmount;

  // Sort by due_date ASC (oldest first), then by invoice_no
  const sorted = [...candidates].sort((a, b) => {
    const dA = a.due_date ?? '9999-12-31';
    const dB = b.due_date ?? '9999-12-31';
    if (dA !== dB) return dA.localeCompare(dB);
    return a.invoice_no.localeCompare(b.invoice_no);
  });

  for (const candidate of sorted) {
    if (remaining <= 0.005) break; // Tolerance for rounding

    const allocAmount = Math.min(candidate.outstanding, remaining);

    // Calculate forex gain/loss (BR-REC-FOREX)
    const forexGL = calculateForexGainLoss(
      allocAmount,
      candidate.exchange_rate,
      receiptRate,
    );

    proposals.push({
      invoice_id: candidate.invoice_id,
      invoice_no: candidate.invoice_no,
      doc_type: candidate.doc_type,
      allocated_amount: roundTo2(allocAmount),
      invoice_rate: candidate.exchange_rate,
      receipt_rate: receiptRate,
      forex_gain_loss: forexGL,
    });

    remaining = roundTo2(remaining - allocAmount);
  }

  return proposals;
}

// ─── Amount Match Algorithm (Auto_Amount) ───────────────────────────────────

/**
 * Amount Match allocation algorithm (PRD Part 3 §4.3).
 *
 * Strategy:
 * 1. First, look for a SINGLE invoice whose outstanding exactly matches the receipt
 * 2. If no exact match, try combinations of 2 invoices (subset-sum)
 * 3. If no combination match found, fall back to FIFO
 *
 * This is useful when a customer pays for specific invoices by matching amounts.
 */
export function allocateAmountMatch(
  candidates: AllocationCandidate[],
  availableAmount: number,
  receiptRate: number,
): AllocationProposal[] {
  // Step 1: Look for exact single-invoice match
  const exactMatch = candidates.find(
    c => Math.abs(c.outstanding - availableAmount) < 0.01,
  );

  if (exactMatch) {
    const forexGL = calculateForexGainLoss(
      availableAmount,
      exactMatch.exchange_rate,
      receiptRate,
    );

    return [{
      invoice_id: exactMatch.invoice_id,
      invoice_no: exactMatch.invoice_no,
      doc_type: exactMatch.doc_type,
      allocated_amount: roundTo2(availableAmount),
      invoice_rate: exactMatch.exchange_rate,
      receipt_rate: receiptRate,
      forex_gain_loss: forexGL,
    }];
  }

  // Step 2: Look for 2-invoice combination match
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const sum = roundTo2(candidates[i].outstanding + candidates[j].outstanding);
      if (Math.abs(sum - availableAmount) < 0.01) {
        return [candidates[i], candidates[j]].map(c => ({
          invoice_id: c.invoice_id,
          invoice_no: c.invoice_no,
          doc_type: c.doc_type,
          allocated_amount: roundTo2(c.outstanding),
          invoice_rate: c.exchange_rate,
          receipt_rate: receiptRate,
          forex_gain_loss: calculateForexGainLoss(c.outstanding, c.exchange_rate, receiptRate),
        }));
      }
    }
  }

  // Step 3: No match found — fall back to FIFO
  return allocateFIFO(candidates, availableAmount, receiptRate);
}

// ─── Forex Gain/Loss Calculation ────────────────────────────────────────────

/**
 * Calculate realized forex gain/loss on allocation (PRD Part 5 §2.5).
 *
 * Formula:
 *   forex_gl = allocated_amount × (receipt_rate - invoice_rate)
 *
 * If forex_gl > 0 → Forex Gain (positive, recognized in income)
 * If forex_gl < 0 → Forex Loss (negative, recognized in expense)
 * If same currency → forex_gl = 0
 *
 * @returns Forex gain (+) or loss (-) in base currency
 */
export function calculateForexGainLoss(
  allocatedAmount: number,
  invoiceRate: number,
  receiptRate: number,
): number {
  if (Math.abs(invoiceRate - receiptRate) < 0.0001) return 0;
  return roundTo2(allocatedAmount * (receiptRate - invoiceRate));
}

// ─── Discount Calculation ───────────────────────────────────────────────────

/**
 * Calculate early payment discount eligibility (PRD Part 3 §4.6).
 *
 * If the payment is received within the discount period defined by the
 * payment terms, a discount percentage is applied to the invoice total.
 *
 * Note: This is a simplified version. Full implementation would check
 * the payment_terms table for discount tiers.
 */
export function calculateEarlyPaymentDiscount(
  invoiceTotal: number,
  invoiceDueDate: string,
  receiptDate: string,
  discountPct: number = 0,
  discountDays: number = 0,
): { discount_amount: number; eligible: boolean } {
  if (discountPct <= 0 || discountDays <= 0) {
    return { discount_amount: 0, eligible: false };
  }

  const invDate = new Date(invoiceDueDate);
  const earlyDate = new Date(invDate);
  earlyDate.setDate(earlyDate.getDate() - discountDays);

  const rcptDate = new Date(receiptDate);
  const eligible = rcptDate <= earlyDate;

  return {
    discount_amount: eligible ? roundTo2(invoiceTotal * discountPct / 100) : 0,
    eligible,
  };
}

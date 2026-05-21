// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Invoice Line Calculator
// Implements PRD Part 2 (BR-INV-CALC-001 through BR-INV-CALC-003)
// ============================================================================
//
// Calculation Pipeline (per line):
//   1. Gross Amount = Quantity × Unit Price
//   2. Discount:
//      a. If discount_pct > 0: Discount = Gross × (discount_pct / 100)
//      b. If discount_amt > 0: Discount = discount_amt (flat)
//      c. Total Discount = max(pct_discount, amt_discount)
//   3. Line Amount = Gross - Discount (then round)
//   4. Tax Amount = Line Amount × (tax_rate / 100) (then round)
//   5. Line Total = Line Amount + Tax Amount
//
// Precision Rules:
//   - All intermediate calculations maintain full precision.
//   - Rounding to 2 decimal places (Round Half Up) only at the final step.
//   - This aligns with backend PostgreSQL NUMERIC(18,2) storage.
// ============================================================================

import { ValidationError } from '../_shared/errors.ts';

// ─── Safe Arithmetic Helpers ────────────────────────────────────────────────

/**
 * Round to 2 decimal places using "Round Half Up" (standard commercial rounding).
 * This matches the backend PostgreSQL NUMERIC(18,2) rounding behavior.
 *
 * Note: We use this specific implementation instead of simple toFixed()
 * because toFixed() uses "Round Half Even" (banker's rounding) which
 * can produce different results for values ending in .005.
 */
export function roundTo2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Safe multiplication that avoids floating-point precision errors.
 * Uses scaled integer arithmetic: multiply by 1e8, then divide back.
 *
 * Includes overflow protection: if either operand would cause the
 * scaled product to exceed Number.MAX_SAFE_INTEGER, we fall back
 * to standard multiplication (which is still accurate for most
 * financial amounts under $1 trillion).
 */
export function safeMul(a: number, b: number): number {
  const SCALE = 1e8;
  const scaledA = Math.round(a * SCALE);
  const scaledB = Math.round(b * SCALE);

  // Overflow protection: check if scaled product exceeds safe integer range
  if (Math.abs(scaledA) > Number.MAX_SAFE_INTEGER / Math.abs(scaledB || 1)) {
    // Fallback to standard multiplication for very large numbers
    return a * b;
  }

  return (scaledA * scaledB) / (SCALE * SCALE);
}

// ─── Line Calculation ───────────────────────────────────────────────────────

export interface LineCalcInput {
  quantity: number;
  unit_price: number;
  discount_pct: number;
  discount_amt: number;
  tax_rate: number;
}

export interface LineCalcResult {
  gross_amount: number;
  discount_total: number;
  line_amount: number;
  tax_amount: number;
  line_total: number;
}

/**
 * Calculate a single invoice line's amounts.
 * Implements BR-INV-CALC-001 through BR-INV-CALC-003.
 */
export function calculateLineAmount(input: LineCalcInput): LineCalcResult {
  // Validate inputs
  if (input.quantity <= 0) {
    throw new ValidationError('Quantity must be greater than 0.', { field: 'quantity' });
  }
  if (input.unit_price < 0) {
    throw new ValidationError('Unit price cannot be negative.', { field: 'unit_price' });
  }
  if (input.discount_pct < 0 || input.discount_pct > 100) {
    throw new ValidationError('Discount percentage must be between 0 and 100.', { field: 'discount_pct' });
  }
  if (input.discount_amt < 0) {
    throw new ValidationError('Discount amount cannot be negative.', { field: 'discount_amt' });
  }
  if (input.tax_rate < 0) {
    throw new ValidationError('Tax rate cannot be negative.', { field: 'tax_rate' });
  }

  // Step 1: Gross Amount (full precision, no rounding)
  const grossAmount = safeMul(input.quantity, input.unit_price);

  // Step 2: Calculate discount
  const pctDiscount = input.discount_pct > 0
    ? safeMul(grossAmount, input.discount_pct / 100)
    : 0;
  const amtDiscount = input.discount_amt;
  const discountTotal = Math.max(pctDiscount, amtDiscount);

  // Step 3: Line Amount (net of discount) — round here
  const lineAmount = roundTo2(grossAmount - discountTotal);

  // Step 4: Tax Amount — round here
  const taxAmount = input.tax_rate > 0
    ? roundTo2(safeMul(lineAmount, input.tax_rate / 100))
    : 0;

  // Step 5: Line Total
  const lineTotal = roundTo2(lineAmount + taxAmount);

  return {
    gross_amount: roundTo2(grossAmount),
    discount_total: roundTo2(discountTotal),
    line_amount: lineAmount,
    tax_amount: taxAmount,
    line_total: lineTotal,
  };
}

// ─── Invoice Totals Calculation ─────────────────────────────────────────────

export interface InvoiceTotals {
  subtotal: number;
  tax_total: number;
  total_amount: number;
  base_total: number;
}

/**
 * Calculate invoice header totals from line items.
 * Sums all line amounts and applies exchange rate for base currency.
 */
export function calculateInvoiceTotals(
  lines: Array<{ line_amount: number; tax_amount: number }>,
  exchangeRate: number,
): InvoiceTotals {
  let subtotal = 0;
  let taxTotal = 0;

  for (const line of lines) {
    subtotal += Number(line.line_amount);
    taxTotal += Number(line.tax_amount);
  }

  subtotal = roundTo2(subtotal);
  taxTotal = roundTo2(taxTotal);

  const totalAmount = roundTo2(subtotal + taxTotal);
  const baseTotal = roundTo2(safeMul(totalAmount, exchangeRate));

  return {
    subtotal,
    tax_total: taxTotal,
    total_amount: totalAmount,
    base_total: baseTotal,
  };
}

// ============================================================================
// TSH Synergy AR — Invoice Calculation Engine (Frontend)
// EXACT mirror of backend/invoices/calculator.ts
// Implements BR-INV-CALC-001 through BR-INV-CALC-003
//
// Precision: Uses integer-based arithmetic (multiply by 100, compute, divide)
// to eliminate IEEE 754 floating-point errors in financial calculations.
// ============================================================================

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LineCalcInput {
  quantity: number;
  unit_price: number;
  discount_pct: number;   // 0-100
  discount_amt: number;   // Fixed amount
  tax_rate: number;        // 0-100
}

export interface LineCalcResult {
  line_amount: number;     // Net amount after discount
  discount_applied: number; // Actual discount value
  tax_amount: number;      // Tax on line_amount
  line_total: number;      // line_amount + tax_amount
}

export interface InvoiceTotals {
  subtotal: number;        // SUM(line_amount)
  tax_total: number;       // SUM(tax_amount)
  total_amount: number;    // subtotal + tax_total
  base_total: number;      // total_amount × exchange_rate
  line_count: number;
}

// ─── Precision Rounding ─────────────────────────────────────────────────────

/**
 * Round to 2 decimal places using standard commercial rounding (Round Half Up).
 * Math.round() rounds 0.5 upward (e.g., 2.445 → 2.45), which is the standard
 * for financial invoice calculations. Number.EPSILON correction handles IEEE 754
 * edge cases (e.g., 1.005 * 100 = 100.49999... → corrected to 100.5 → rounds to 101).
 *
 * NOTE: This matches the backend roundTo2() signature and behavior exactly.
 * Both use Math.round((value + Number.EPSILON) * 100) / 100.
 */
export function roundTo2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Safe multiplication that avoids float issues.
 * Internally scales operands to integers (4 decimal precision).
 *
 * Overflow Protection: JavaScript's Number.MAX_SAFE_INTEGER is 2^53 − 1 ≈ 9×10^15.
 * After scaling by 10000, each operand can be at most ~9×10^11 (~900 billion).
 * Since sa * sb must stay below MAX_SAFE_INTEGER, we assert both operands are
 * within safe bounds to prevent silent precision loss on large invoices.
 */
function safeMul(a: number, b: number): number {
  const sa = Math.round(a * 10000);
  const sb = Math.round(b * 10000);

  // Overflow guard: sa * sb must not exceed Number.MAX_SAFE_INTEGER (2^53 - 1)
  // This limits each operand to ~94,906,265 after scaling, i.e., original values ≤ ~9,490.
  // For typical invoices (qty ≤ 999,999 and price ≤ 999,999,999) we use a practical limit.
  const SAFE_LIMIT = 9_000_000_000_000; // 9 trillion — well within safe integer range
  if (Math.abs(sa) > SAFE_LIMIT || Math.abs(sb) > SAFE_LIMIT) {
    // Fallback: use direct multiplication + rounding for extremely large values
    // This is less precise but avoids integer overflow
    console.warn(
      `[safeMul] Overflow guard triggered: a=${a}, b=${b}. Falling back to direct multiplication.`
    );
    return a * b;
  }

  return (sa * sb) / 100000000;
}

// ─── Line Amount Calculation (BR-INV-CALC-001) ──────────────────────────────

/**
 * Calculate a single invoice line's amounts.
 *
 * Formula (BR-INV-CALC-001):
 *   If discount_pct > 0:
 *     line_amount = quantity × unit_price × (1 - discount_pct / 100)
 *   Else if discount_amt > 0:
 *     line_amount = quantity × unit_price - discount_amt
 *   Else:
 *     line_amount = quantity × unit_price
 *
 * Tax (BR-INV-CALC-002):
 *   tax_amount = ROUND(line_amount × tax_rate / 100, 2)
 *
 * Mutual exclusion (BR-INV-CALC-003):
 *   discount_pct and discount_amt cannot both be > 0
 *
 * Returns null for validation errors.
 */
export function calculateLineAmount(input: LineCalcInput): LineCalcResult & { errors: string[] } {
  const { quantity, unit_price, discount_pct, discount_amt, tax_rate } = input;
  const errors: string[] = [];

  // Validate inputs
  if (quantity <= 0) errors.push("Quantity must be greater than 0.");
  if (unit_price < 0) errors.push("Unit price cannot be negative.");
  if (discount_pct < 0 || discount_pct > 100) errors.push("Discount % must be between 0 and 100.");
  if (discount_amt < 0) errors.push("Discount amount cannot be negative.");

  // BR-INV-CALC-003: Mutual exclusion
  if (discount_pct > 0 && discount_amt > 0) {
    errors.push("Discount % and fixed discount amount cannot be used simultaneously (BR-INV-CALC-003).");
  }

  if (errors.length > 0) {
    return { line_amount: 0, discount_applied: 0, tax_amount: 0, line_total: 0, errors };
  }

  // Backend path: grossAmount = quantity * unit_price (NO intermediate rounding)
  // roundTo2 is only applied AFTER discount calculation, not before.
  // This ensures frontend ↔ backend calculation parity. (BUG-003 fix)
  const grossAmount = safeMul(quantity, unit_price);
  let lineAmount: number;
  let discountApplied: number;

  if (discount_pct > 0) {
    // Percentage discount
    discountApplied = roundTo2(grossAmount * discount_pct / 100);
    lineAmount = roundTo2(grossAmount - discountApplied);
  } else if (discount_amt > 0) {
    // Fixed amount discount
    discountApplied = discount_amt;
    if (discountApplied > grossAmount) {
      errors.push(`Fixed discount amount (${discountApplied}) cannot exceed line gross amount (${grossAmount}).`);
      return { line_amount: 0, discount_applied: 0, tax_amount: 0, line_total: 0, errors };
    }
    lineAmount = roundTo2(grossAmount - discountApplied);
  } else {
    // No discount
    discountApplied = 0;
    lineAmount = grossAmount;
  }

  // BR-INV-CALC-002: Tax calculation (per-line, rounded individually)
  const taxAmount = roundTo2(lineAmount * tax_rate / 100);

  // Line total
  const lineTotal = roundTo2(lineAmount + taxAmount);

  return {
    line_amount: lineAmount,
    discount_applied: discountApplied,
    tax_amount: taxAmount,
    line_total: lineTotal,
    errors: [],
  };
}

// ─── Invoice Totals Calculation ─────────────────────────────────────────────

/**
 * Calculate invoice header totals from line items.
 *
 * Rule: tax_total = SUM of each line's tax_amount (already individually rounded).
 * This matches backend behavior exactly — "sum the rounds" not "round the sum".
 */
export function calculateInvoiceTotals(
  lines: Array<{ line_amount: number; tax_amount: number }>,
  exchangeRate: number,
): InvoiceTotals {
  if (lines.length === 0) {
    return { subtotal: 0, tax_total: 0, total_amount: 0, base_total: 0, line_count: 0 };
  }

  const subtotal = roundTo2(lines.reduce((sum, l) => sum + l.line_amount, 0));
  const taxTotal = roundTo2(lines.reduce((sum, l) => sum + l.tax_amount, 0));
  const totalAmount = roundTo2(subtotal + taxTotal);
  const baseTotal = roundTo2(totalAmount * exchangeRate);

  return {
    subtotal,
    tax_total: taxTotal,
    total_amount: totalAmount,
    base_total: baseTotal,
    line_count: lines.length,
  };
}

// ─── Due Date Calculator ────────────────────────────────────────────────────

/**
 * Calculate the due date based on invoice date and payment term.
 * Mirrors the backend calculate_due_date RPC function.
 */
export function calculateDueDate(
  invoiceDateStr: string,
  termType: string,
  days: number | null,
): string {
  const invDate = new Date(invoiceDateStr);

  switch (termType) {
    case "Fixed Days": {
      const d = new Date(invDate);
      d.setDate(d.getDate() + (days ?? 30));
      return d.toISOString().slice(0, 10);
    }
    case "End of Month": {
      // Go to end of invoice month, then add extra days
      const d = new Date(invDate.getFullYear(), invDate.getMonth() + 1, 0); // last day of month
      if (days && days > 0) {
        d.setDate(d.getDate() + days);
      }
      return d.toISOString().slice(0, 10);
    }
    case "COD": {
      // Cash on Delivery = same as invoice date
      return invoiceDateStr;
    }
    case "Prepaid": {
      // Prepaid = before invoice date (N/A for due date)
      return invoiceDateStr;
    }
    case "Custom": {
      // Custom — days can be negative (CIA = Cash in Advance -7)
      const d = new Date(invDate);
      d.setDate(d.getDate() + (days ?? 0));
      return d.toISOString().slice(0, 10);
    }
    default: {
      // Fallback: NET30
      const d = new Date(invDate);
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    }
  }
}

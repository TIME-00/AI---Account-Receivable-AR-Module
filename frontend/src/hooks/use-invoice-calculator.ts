// ============================================================================
// TSH Synergy AR — useInvoiceCalculator Hook
// Real-time calculation engine for the Invoice Workbench.
// Watches line items via react-hook-form and recalculates on every change.
// ============================================================================

"use client";

import { useMemo } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import {
  calculateLineAmount,
  calculateInvoiceTotals,
  calculateDueDate,
  type LineCalcResult,
  type InvoiceTotals,
} from "@/lib/invoice-calculator";
import type { InvoiceFormValues } from "@/lib/invoice-schema";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LineCalcOutput extends LineCalcResult {
  errors: string[];
}

export interface InvoiceCalcOutput {
  /** Per-line calculation results */
  lineResults: LineCalcOutput[];
  /** Aggregated invoice totals */
  totals: InvoiceTotals;
  /** Calculated due date (null if no payment term set) */
  calculatedDueDate: string | null;
  /** Whether all lines pass validation */
  isValid: boolean;
  /** Aggregate error messages across all lines */
  allLineErrors: Array<{ lineIndex: number; errors: string[] }>;
}

// ─── Tax Code Lookup ────────────────────────────────────────────────────────

/** Tax code info — fetched from API and stored in component state */
export interface TaxCodeOption {
  id: string;
  tax_code: string;
  tax_name: string;
  rate: number;
  country: string;
}

/** Payment term info */
export interface PaymentTermOption {
  id: string;
  term_code: string;
  term_name: string;
  term_type: string;
  days: number | null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * useInvoiceCalculator — Real-time financial calculation engine.
 *
 * Features:
 * - Watches all line items via react-hook-form useWatch()
 * - Recalculates on every field change (quantity, price, discount, tax)
 * - Returns per-line results, aggregated totals, and validation errors
 * - Calculates due date from invoice_date + payment term
 *
 * @param form - The react-hook-form instance
 * @param taxCodes - Available tax codes for rate lookup
 * @param paymentTerms - Available payment terms for due date calculation
 * @param selectedTermId - Currently selected payment term ID
 */
export function useInvoiceCalculator(
  form: UseFormReturn<InvoiceFormValues>,
  taxCodes: TaxCodeOption[],
  paymentTerms: PaymentTermOption[],
  selectedTermId: string | null,
): InvoiceCalcOutput {
  // Watch all relevant fields
  const lines = useWatch({ control: form.control, name: "lines" });
  const invoiceDate = useWatch({ control: form.control, name: "invoice_date" });
  const exchangeRate = useWatch({ control: form.control, name: "exchange_rate" });

  // Build tax rate lookup map
  const taxRateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const tc of taxCodes) {
      map.set(tc.id, tc.rate);
    }
    return map;
  }, [taxCodes]);

  // Calculate per-line results
  const lineResults = useMemo<LineCalcOutput[]>(() => {
    if (!lines || lines.length === 0) return [];

    return lines.map((line) => {
      const taxRate = line.tax_code_id ? (taxRateMap.get(line.tax_code_id) ?? 0) : 0;

      return calculateLineAmount({
        quantity: Number(line.quantity) || 0,
        unit_price: Number(line.unit_price) || 0,
        discount_pct: Number(line.discount_pct) || 0,
        discount_amt: Number(line.discount_amt) || 0,
        tax_rate: taxRate,
      });
    });
  }, [lines, taxRateMap]);

  // Calculate invoice totals
  const totals = useMemo<InvoiceTotals>(() => {
    const validLines = lineResults.filter((lr) => lr.errors.length === 0);
    return calculateInvoiceTotals(validLines, Number(exchangeRate) || 1);
  }, [lineResults, exchangeRate]);

  // Calculate due date
  const calculatedDueDate = useMemo<string | null>(() => {
    if (!invoiceDate || !selectedTermId) return null;

    const term = paymentTerms.find((t) => t.id === selectedTermId);
    if (!term) return null;

    return calculateDueDate(invoiceDate, term.term_type, term.days);
  }, [invoiceDate, selectedTermId, paymentTerms]);

  // Collect all line errors
  const allLineErrors = useMemo(() => {
    return lineResults
      .map((lr, idx) => ({ lineIndex: idx, errors: lr.errors }))
      .filter((e) => e.errors.length > 0);
  }, [lineResults]);

  const isValid = allLineErrors.length === 0 && lineResults.length > 0;

  return {
    lineResults,
    totals,
    calculatedDueDate,
    isValid,
    allLineErrors,
  };
}

"use client";

import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/utils";
import { formatMoneySafe } from "@/lib/currency";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { defaultLineValues } from "@/lib/invoice-schema";
import type { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import type { InvoiceFormValues } from "@/lib/invoice-schema";
import type { InvoiceCalcOutput } from "@/hooks/use-invoice-calculator";
import type { TaxCodeOption } from "@/hooks/use-invoice-calculator";
import { LoadingButton } from "@/components/ui/loading-button";
import { Plus, Trash2, Calculator, AlertCircle, Info } from "lucide-react";

interface InvoiceLineTableProps {
  form: UseFormReturn<InvoiceFormValues>;
  fields: UseFieldArrayReturn<InvoiceFormValues, "lines">["fields"];
  append: UseFieldArrayReturn<InvoiceFormValues, "lines">["append"];
  remove: UseFieldArrayReturn<InvoiceFormValues, "lines">["remove"];
  calc: InvoiceCalcOutput;
  taxCodes: TaxCodeOption[];
  fieldErrors: Record<string, string>;
}

export function InvoiceLineTable({
  form,
  fields,
  append,
  remove,
  calc,
  taxCodes,
  fieldErrors,
}: InvoiceLineTableProps) {
  // Draft previews show an ESTIMATED company-base amount; the base currency is
  // authoritative (from /auth/me) and renders as unavailable rather than "MYR".
  const { baseCurrency } = useBaseCurrency();
  // B9DD-RR-003: the document's own transaction currency, used to label every
  // running total explicitly. Empty until the user (or the base-currency seed)
  // selects one — in which case the totals say so rather than implying MYR.
  const documentCurrency = form.watch("currency");
  // Column-header currency marker. When no currency is selected yet it states
  // that explicitly rather than implying one.
  const currencySuffix = documentCurrency ? `(${documentCurrency})` : "(currency not selected)";
  return (
    <div className="animate-fade-in space-y-4">
      {/* Line Items Table */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Calculator className="h-4 w-4 text-brand-400" />
            Line Items
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
              {fields.length} lines
            </span>
          </h2>
          <LoadingButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => append(defaultLineValues())}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Line
          </LoadingButton>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5 text-center w-10">#</th>
                <th className="px-3 py-2.5 text-left min-w-[180px]">Description *</th>
                <th className="px-3 py-2.5 text-left w-20">Item Code</th>
                <th className="px-3 py-2.5 text-right w-20">Qty *</th>
                <th className="px-3 py-2.5 text-left w-14">UOM</th>
                {/* B9DD-RR-003: monetary columns name the document's currency in
                    the header, so no per-line amount is rendered codeless. */}
                <th className="px-3 py-2.5 text-right w-24">Unit Price * {currencySuffix}</th>
                <th className="px-3 py-2.5 text-right w-16">Disc %</th>
                <th className="px-3 py-2.5 text-left w-28">Tax Code</th>
                <th className="px-3 py-2.5 text-right w-24">Line Amt {currencySuffix}</th>
                <th className="px-3 py-2.5 text-right w-20">Tax {currencySuffix}</th>
                <th className="px-3 py-2.5 text-right w-24">Line Total {currencySuffix}</th>
                <th className="px-3 py-2.5 text-center w-10"></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, idx) => {
                const lineResult = calc.lineResults[idx];
                const lineError =
                  lineResult?.errors.length > 0
                    ? lineResult.errors
                    : fieldErrors[`line_${idx}`]
                    ? [fieldErrors[`line_${idx}`]]
                    : [];
                const hasError = lineError.length > 0;
                const formErrors = form.formState.errors.lines?.[idx];

                return (
                  <tr
                    key={field.id}
                    className={cn(
                      "border-b border-slate-100 transition-colors hover:bg-slate-50",
                      hasError && "bg-red-500/5"
                    )}
                  >
                    <td className="px-3 py-2 text-center text-xs text-slate-500">{idx + 1}</td>

                    {/* Description */}
                    <td className="px-2 py-1.5">
                      <input
                        {...form.register(`lines.${idx}.description`)}
                        placeholder="Item description..."
                        className={cn(
                          "h-8 w-full rounded border bg-transparent px-2 text-sm text-slate-700 transition-colors",
                          "border-transparent focus:border-brand-500 focus:outline-none",
                          formErrors?.description && "!border-red-500"
                        )}
                      />
                    </td>

                    {/* Item Code */}
                    <td className="px-2 py-1.5">
                      <input
                        {...form.register(`lines.${idx}.item_code`)}
                        placeholder="SKU"
                        className="h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm text-slate-500 focus:border-brand-500 focus:outline-none"
                      />
                    </td>

                    {/* Quantity */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        {...form.register(`lines.${idx}.quantity`, { valueAsNumber: true })}
                        className={cn(
                          "h-8 w-full rounded border bg-transparent px-2 text-right text-sm text-slate-700",
                          "border-transparent focus:border-brand-500 focus:outline-none",
                          formErrors?.quantity && "!border-red-500"
                        )}
                      />
                    </td>

                    {/* UOM */}
                    <td className="px-2 py-1.5">
                      <input
                        {...form.register(`lines.${idx}.uom`)}
                        className="h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm text-slate-500 focus:border-brand-500 focus:outline-none"
                      />
                    </td>

                    {/* Unit Price */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        {...form.register(`lines.${idx}.unit_price`, { valueAsNumber: true })}
                        className={cn(
                          "h-8 w-full rounded border bg-transparent px-2 text-right text-sm text-slate-700",
                          "border-transparent focus:border-brand-500 focus:outline-none",
                          formErrors?.unit_price && "!border-red-500"
                        )}
                      />
                    </td>

                    {/* Discount % */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        {...form.register(`lines.${idx}.discount_pct`, { valueAsNumber: true })}
                        className={cn(
                          "h-8 w-full rounded border bg-transparent px-2 text-right text-sm text-slate-500",
                          "border-transparent focus:border-brand-500 focus:outline-none",
                          formErrors?.discount_pct && "!border-red-500"
                        )}
                      />
                    </td>

                    {/* Tax Code */}
                    <td className="px-2 py-1.5">
                      <select
                        {...form.register(`lines.${idx}.tax_code_id`)}
                        className="h-8 w-full rounded border border-transparent bg-transparent px-1 text-sm text-slate-500 focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">No Tax</option>
                        {taxCodes.map((tc) => (
                          <option key={tc.id} value={tc.id}>
                            {tc.tax_code} ({tc.rate}%)
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Calculated: Line Amount */}
                    <td className="px-3 py-2 text-right font-mono text-sm text-slate-700">
                      {lineResult ? formatAmount(lineResult.line_amount) : "-"}
                    </td>

                    {/* Calculated: Tax Amount */}
                    <td className="px-3 py-2 text-right font-mono text-sm text-amber-500">
                      {lineResult ? formatAmount(lineResult.tax_amount) : "-"}
                    </td>

                    {/* Calculated: Line Total */}
                    <td className="px-3 py-2 text-right font-mono text-sm font-semibold text-slate-900">
                      {lineResult ? formatAmount(lineResult.line_total) : "-"}
                    </td>

                    {/* Delete */}
                    <td className="px-2 py-1.5 text-center">
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(idx)}
                          className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Line-level errors */}
        {calc.allLineErrors.length > 0 && (
          <div className="border-t border-red-200 bg-red-50 px-5 py-3">
            {calc.allLineErrors.map(({ lineIndex, errors }) => (
              <div key={lineIndex} className="flex items-start gap-2 text-xs text-red-500">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Line {lineIndex + 1}: {errors.join("; ")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Running Totals ─────────────────────────────────────── */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Info className="h-3.5 w-3.5" />
            Real-time calculation results (BR-INV-CALC-002: per-line tax then aggregate)
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Subtotal</p>
            <p className="mt-1 text-lg font-bold text-slate-900 font-mono">
              {formatMoneySafe(calc.totals.subtotal, documentCurrency)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">Tax Total</p>
            <p className="mt-1 text-lg font-bold text-amber-500 font-mono">
              {formatMoneySafe(calc.totals.tax_total, documentCurrency)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Grand Total</p>
            <p className="mt-1 text-lg font-bold text-slate-900 font-mono">
              {formatMoneySafe(calc.totals.total_amount, documentCurrency)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            {/* The base label names the REAL company base currency. */}
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {baseCurrency ? `Base Total (${baseCurrency})` : "Base Total"}
            </p>
            <p className="mt-1 text-lg font-bold text-brand-500 font-mono">
              {baseCurrency ? (
                formatMoneySafe(calc.totals.base_total, baseCurrency)
              ) : (
                <span className="text-sm font-medium italic text-amber-700">
                  Base currency unavailable
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { roundTo2 } from "@/lib/invoice-calculator";
import { Controller, type UseFormReturn } from "react-hook-form";
import type { ReceiptFormValues } from "@/lib/receipt-schema";
import { DollarSign } from "lucide-react";

interface ReceiptFormAmountProps {
  form: UseFormReturn<ReceiptFormValues>;
  watchCurrency: string;
  watchAmount: number;
  watchExchangeRate: number;
}

export function ReceiptFormAmount({ form, watchCurrency, watchAmount, watchExchangeRate }: ReceiptFormAmountProps) {
  const baseAmount = roundTo2(watchAmount * watchExchangeRate);

  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          Amount & Currency
        </h2>
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-3">
        {/* Receipt Amount */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Receipt Amount <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">{watchCurrency}</span>
            <Controller
              control={form.control}
              name="receipt_amount"
              render={({ field }) => (
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={field.value || ""}
                  onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                  className={cn(
                    "h-10 w-full rounded-lg border bg-white pl-14 pr-3 text-right font-mono text-sm text-slate-800",
                    "focus:outline-none focus:ring-1 focus:ring-brand-500",
                    form.formState.errors.receipt_amount ? "border-red-500" : "border-slate-300"
                  )}
                />
              )}
            />
          </div>
          {form.formState.errors.receipt_amount && (
            <p className="mt-1 text-xs text-red-400">{form.formState.errors.receipt_amount.message}</p>
          )}
        </div>

        {/* Currency */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Currency <span className="text-red-400">*</span>
          </label>
          <Controller
            control={form.control}
            name="currency"
            render={({ field }) => (
              <select
                {...field}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="MYR">MYR — Malaysian Ringgit</option>
                <option value="SGD">SGD — Singapore Dollar</option>
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="CNY">CNY — Chinese Yuan</option>
              </select>
            )}
          />
        </div>

        {/* Exchange Rate */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Exchange Rate (→ MYR)</label>
          <Controller
            control={form.control}
            name="exchange_rate"
            render={({ field }) => (
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                value={field.value || ""}
                onChange={(e) => field.onChange(parseFloat(e.target.value) || 1)}
                disabled={watchCurrency === "MYR"}
                className={cn(
                  "h-10 w-full rounded-lg border bg-white px-3 text-right font-mono text-sm text-slate-800",
                  "focus:outline-none focus:ring-1 focus:ring-brand-500",
                  watchCurrency === "MYR" ? "border-slate-200 text-slate-400" : "border-slate-300"
                )}
              />
            )}
          />
          {watchCurrency !== "MYR" && watchAmount > 0 && (
            <p className="mt-1 text-[10px] text-slate-500">
              Base amount: <span className="font-mono text-slate-600">{formatCurrency(baseAmount)}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

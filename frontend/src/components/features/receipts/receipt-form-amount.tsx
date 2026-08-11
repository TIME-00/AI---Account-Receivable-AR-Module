"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  SUPPORTED_TRANSACTION_CURRENCY_OPTIONS,
  transactionCurrencyScopeNote,
} from "@/lib/currency";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { FxRateField } from "@/components/features/fx/fx-rate-field";
import { Controller, type UseFormReturn } from "react-hook-form";
import type { ReceiptFormValues } from "@/lib/receipt-schema";
import { DollarSign } from "lucide-react";

interface ReceiptFormAmountProps {
  form: UseFormReturn<ReceiptFormValues>;
  watchCurrency: string;
  watchAmount: number;
  onFxSubmittableChange?: (canSubmit: boolean) => void;
}

export function ReceiptFormAmount({
  form,
  watchCurrency,
  watchAmount,
  onFxSubmittableChange,
}: ReceiptFormAmountProps) {
  // B9DD-FEIR-006: base parity is `transaction currency === company base
  // currency`, resolved from authoritative company context — not a hard-coded
  // comparison against "MYR".
  const { baseCurrency } = useBaseCurrency();

  // ── Governed FX authority (Gate A) ──
  // The normal-mode foreign rate is no longer freely editable and never defaults
  // to 1: the shared FxRateField looks up the governed reference rate and submits
  // fx_reference_rate_id. Manual-override sub-state is held locally and synced
  // into RHF only while the explicit override mode is active.
  const [fxOverrideMode, setFxOverrideMode] = useState(false);
  const [fxManualRate, setFxManualRate] = useState<number | null>(null);
  const [fxOverrideReason, setFxOverrideReason] = useState("");
  const watchDate = form.watch("receipt_date");
  const referenceRateId = form.watch("fx_reference_rate_id") || null;

  useEffect(() => {
    if (fxOverrideMode) {
      if (fxManualRate != null && fxManualRate > 0) {
        form.setValue("exchange_rate", fxManualRate, { shouldValidate: false });
      }
      form.setValue("fx_override_reason", fxOverrideReason, { shouldValidate: false });
    } else {
      form.setValue("exchange_rate", 1, { shouldValidate: false });
      form.setValue("fx_override_reason", "", { shouldValidate: false });
    }
  }, [fxOverrideMode, fxManualRate, fxOverrideReason, form]);

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
                {SUPPORTED_TRANSACTION_CURRENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
          />
          <p className="mt-1 text-[11px] text-slate-400">
            {transactionCurrencyScopeNote("receipts")}
          </p>
        </div>

        {/* Exchange Rate — governed shared FX field (Gate A) */}
        <FxRateField
          currency={watchCurrency}
          baseCurrency={baseCurrency}
          effectiveDate={watchDate}
          amount={watchAmount}
          referenceRateId={referenceRateId}
          onReferenceRateIdChange={(id) =>
            form.setValue("fx_reference_rate_id", id ?? "", { shouldValidate: false })
          }
          manualRate={fxManualRate}
          onManualRateChange={setFxManualRate}
          overrideReason={fxOverrideReason}
          onOverrideReasonChange={setFxOverrideReason}
          overrideMode={fxOverrideMode}
          onOverrideModeChange={setFxOverrideMode}
          onSubmittableChange={onFxSubmittableChange}
        />
      </div>
    </div>
  );
}

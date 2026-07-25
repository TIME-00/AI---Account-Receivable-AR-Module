"use client";

import { formatMoney, formatMoneySafe } from "@/lib/currency";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { roundTo2 } from "@/lib/invoice-calculator";
import { LoadingButton } from "@/components/ui/loading-button";
import { ArrowRight, Save, Send, Info } from "lucide-react";

interface Customer { customer_name: string; }

interface ReceiptSummaryBarProps {
  watchAmount: number;
  watchCurrency: string;
  watchExchangeRate: number;
  selectedCustomer: Customer | undefined;
  isPostMode: boolean;
  setIsPostMode: (v: boolean) => void;
  isCreating: boolean;
  isPosting: boolean;
}

export function ReceiptSummaryBar({
  watchAmount, watchCurrency, watchExchangeRate,
  selectedCustomer, isPostMode, setIsPostMode,
  isCreating, isPosting,
}: ReceiptSummaryBarProps) {
  // Draft previews show an ESTIMATED company-base amount; the base currency is
  // authoritative (from /auth/me) and renders as unavailable rather than "MYR".
  const { baseCurrency } = useBaseCurrency();
  const baseAmount = roundTo2(watchAmount * watchExchangeRate);

  // B9DD-RR-003: parity is transaction currency == the AUTHORITATIVE company
  // base currency. The previous `watchCurrency !== "MYR"` hard-coded the base,
  // so an SGD-base company saw a bogus "conversion" for its own base currency
  // and no preview at all for MYR.
  const isParity = baseCurrency !== null && watchCurrency === baseCurrency;
  // With an unknown base currency there is no defensible conversion to show.
  // Gate A: in reference-selected mode the working exchange_rate is a placeholder
  // 1 (the authoritative rate/base is computed by the backend at booking). We
  // must NOT render a bogus `amount × 1` base for a foreign receipt — the shared
  // FxRateField already shows the governed estimated base. Only preview a base
  // here when a real (non-placeholder) rate is present, matching the Invoice
  // review, which likewise hides the base while exchange_rate === 1.
  const canShowBasePreview =
    baseCurrency !== null && !isParity && watchAmount > 0 && watchExchangeRate !== 1;

  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left: Amount preview */}
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Receipt Amount</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-slate-900">
                {watchAmount > 0 ? formatMoney(watchAmount, watchCurrency) : "—"}
              </p>
            </div>
            {canShowBasePreview && (
              <>
                <ArrowRight className="h-4 w-4 text-slate-400" />
                <div>
                  {/* The base label names the REAL base currency. */}
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Base Currency ({baseCurrency})
                  </p>
                  <p className="mt-0.5 font-mono text-lg font-bold text-emerald-500">
                    {formatMoneySafe(baseAmount, baseCurrency)}
                  </p>
                  <p className="text-[9px] text-slate-400">
                    Estimate — the rate is booked when the receipt is posted
                  </p>
                </div>
              </>
            )}
            {baseCurrency === null && watchAmount > 0 && (
              <>
                <ArrowRight className="h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Company base
                  </p>
                  <p className="mt-0.5 text-sm font-medium italic text-amber-700">
                    Base currency unavailable
                  </p>
                </div>
              </>
            )}
            {selectedCustomer && (
              <div className="ml-4 border-l border-slate-200 pl-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Customer</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">{selectedCustomer.customer_name}</p>
              </div>
            )}
          </div>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-3">
            <LoadingButton
              type="submit"
              variant="secondary"
              onClick={() => setIsPostMode(false)}
              isLoading={isCreating && !isPostMode}
              disabled={isCreating || isPosting}
              loadingText="Saving..."
            >
              <Save className="h-4 w-4" />
              Save Draft
            </LoadingButton>
            <LoadingButton
              type="submit"
              variant="primary"
              onClick={() => setIsPostMode(true)}
              isLoading={(isCreating || isPosting) && isPostMode}
              disabled={isCreating || isPosting}
              loadingText="Posting..."
            >
              <Send className="h-4 w-4" />
              Create & Post
            </LoadingButton>
          </div>
        </div>

        {/* Info line */}
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">
          <Info className="h-3 w-3" />
          Precision: roundTo2 (Round Half Up) · base_amount = receipt_amount × exchange_rate
          · Posted receipts are immutable (can only be cancelled)
        </div>
      </div>
    </div>
  );
}

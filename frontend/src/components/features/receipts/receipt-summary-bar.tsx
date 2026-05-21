"use client";

import { formatCurrency } from "@/lib/utils";
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
  const baseAmount = roundTo2(watchAmount * watchExchangeRate);

  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left: Amount preview */}
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Receipt Amount</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-slate-900">
                {watchAmount > 0 ? formatCurrency(watchAmount, watchCurrency) : "—"}
              </p>
            </div>
            {watchCurrency !== "MYR" && watchAmount > 0 && (
              <>
                <ArrowRight className="h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Base Currency (MYR)</p>
                  <p className="mt-0.5 font-mono text-lg font-bold text-emerald-500">{formatCurrency(baseAmount)}</p>
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

"use client";

import { cn } from "@/lib/utils";
import { formatCurrency, formatAmount, formatDate } from "@/lib/utils";
import type { AllocationReceipt } from "@/hooks/use-allocation-logic";
import { Wallet } from "lucide-react";

interface ReceiptPanelProps {
  receipts: AllocationReceipt[];
  isLoading: boolean;
  selectedReceiptId: string | undefined;
  onSelectReceipt: (receipt: AllocationReceipt) => void;
  totalAllocating: number;
}

export function ReceiptPanel({
  receipts, isLoading, selectedReceiptId,
  onSelectReceipt, totalAllocating,
}: ReceiptPanelProps) {
  return (
    <div className="glass-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-emerald-400" />
          Receipts
          {!selectedReceiptId && <span className="ml-1 text-[10px] text-slate-500">← Click to select</span>}
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">{receipts.length}</span>
      </div>

      <div className="flex-1 overflow-auto" style={{ maxHeight: "420px" }}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : receipts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <Wallet className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm">No receipts available for allocation</p>
            <p className="text-[11px] text-slate-400">Receipt must be Posted with unallocated balance</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {receipts.map((r) => {
              const isSelected = selectedReceiptId === r.id;
              const committed = r.receipt_amount - r.unallocated_amount;
              const projectedAlloc = isSelected ? totalAllocating : 0;
              const projectedPct = r.receipt_amount > 0 ? ((committed + projectedAlloc) / r.receipt_amount) * 100 : 0;

              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectReceipt(r)}
                  className={cn(
                    "w-full px-4 py-3 text-left transition-all",
                    isSelected ? "bg-brand-600/10 border-l-2 border-brand-500" : "hover:bg-slate-50 border-l-2 border-transparent"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={cn("text-sm font-semibold", isSelected ? "text-brand-600" : "text-slate-700")}>{r.receipt_no}</p>
                      <p className="text-[11px] text-slate-500">{r.customer_name} · {formatDate(r.receipt_date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-slate-900">{formatCurrency(r.receipt_amount, r.currency)}</p>
                      <p className="font-mono text-[11px] text-emerald-500">Avail: {formatAmount(r.unallocated_amount)}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200">
                    <div className="relative h-full rounded-full">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-600 to-emerald-500 transition-all" style={{ width: `${Math.min(((r.receipt_amount - r.unallocated_amount) / Math.max(r.receipt_amount, 0.01)) * 100, 100)}%` }} />
                      {isSelected && projectedAlloc > 0 && (
                        <div className="absolute inset-y-0 rounded-r-full bg-brand-400/40 transition-all" style={{
                          left: `${Math.min(((r.receipt_amount - r.unallocated_amount) / Math.max(r.receipt_amount, 0.01)) * 100, 100)}%`,
                          width: `${Math.min((projectedAlloc / Math.max(r.receipt_amount, 0.01)) * 100, 100 - ((r.receipt_amount - r.unallocated_amount) / Math.max(r.receipt_amount, 0.01)) * 100)}%`,
                        }} />
                      )}
                    </div>
                  </div>
                  {isSelected && projectedAlloc > 0 && (
                    <p className="mt-1 text-[9px] text-brand-400/70">Projected utilization: {Math.min(projectedPct, 100).toFixed(1)}%</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { formatDate, pct } from "@/lib/utils";
import { formatMoneySafe } from "@/lib/currency";
import type { AllocationInvoice } from "@/hooks/use-allocation-logic";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  ArrowUpDown, ArrowLeftRight, Zap, RotateCcw, Trash2,
  Maximize2, AlertCircle, CheckCircle2, TrendingUp, TrendingDown, Info,
} from "lucide-react";

interface AllocLine {
  invoice_id: string;
  invoice_no: string;
  doc_type: string;
  max_amount: number;
  amount: number;
  discount_amount: number;
  forex_gain_loss: number;
  is_auto: boolean;
  errors: string[];
}

interface Validation {
  totalAllocating: number;
  availableBalance: number;
  remainingBalance: number;
  isBalanceValid: boolean;
  canSubmit: boolean;
  activeLineCount: number;
}

interface AllocationTableProps {
  lines: AllocLine[];
  invoices: AllocationInvoice[];
  isFifoPreview: boolean;
  validation: Validation;
  /**
   * B9DD-RR-004: the transaction currency of EVERY amount in this table.
   *
   * Allocation is same-currency by construction: the backend lists candidate
   * invoices with `.eq('currency', receipt.currency)`
   * (allocations/service.ts ~445), so invoice totals, outstanding, allocation
   * amounts, discounts and the balance bar all share the receipt's currency.
   */
  receiptCurrency: string;
  /**
   * Company base currency, used ONLY to label forex gain/loss — which migration
   * 028 defines as `allocated_amount * (receipt_rate - invoice_rate)`, a
   * company-base amount. `null` is a real state and is shown as such.
   */
  baseCurrency: string | null;
  onUpdateAmount: (invoiceId: string, amount: number) => void;
  onUpdateDiscount: (invoiceId: string, amount: number) => void;
  onFillMax: (invoiceId: string) => void;
  onRemoveInvoice: (invoiceId: string) => void;
  onClearLines: () => void;
  onRunFifo: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function AllocationTable({
  lines, invoices, isFifoPreview, validation,
  receiptCurrency, baseCurrency,
  onUpdateAmount, onUpdateDiscount, onFillMax,
  onRemoveInvoice, onClearLines, onRunFifo,
  onSubmit, isSubmitting,
}: AllocationTableProps) {
  // Every transaction-currency amount in this table shares one basis.
  const tx = (value: number) => formatMoneySafe(value, receiptCurrency);
  return (
    <div className="glass-card overflow-hidden animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-brand-400" />
          Allocation Details
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">{lines.length} lines</span>
          {isFifoPreview && (
            <span className="ml-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-500">FIFO Preview</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <LoadingButton type="button" variant="secondary" size="sm" onClick={onClearLines} disabled={lines.length === 0}>
            <RotateCcw className="h-3 w-3" />
            Clear
          </LoadingButton>
          <LoadingButton type="button" variant="secondary" size="sm" onClick={onRunFifo} disabled={invoices.length === 0}>
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            Auto FIFO Allocate
          </LoadingButton>
        </div>
      </div>

      {/* Table */}
      {lines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
          <ArrowLeftRight className="h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm">Add invoices from the right panel, or click &quot;Auto FIFO Allocate&quot;</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {/* B9DD-RR-004: every monetary column names its basis.
                      Transaction columns are in the receipt's currency; Forex
                      G/L is a company-base amount (migration 028). */}
                  <th className="px-4 py-2.5 text-left">Invoice No.</th>
                  <th className="px-3 py-2.5 text-left">Type</th>
                  <th className="px-3 py-2.5 text-right">Invoice Total ({receiptCurrency})</th>
                  <th className="px-3 py-2.5 text-right">Outstanding ({receiptCurrency})</th>
                  <th className="px-3 py-2.5 text-right w-36">
                    Allocate ({receiptCurrency}) <span className="text-red-400">*</span>
                  </th>
                  <th className="px-3 py-2.5 text-right w-24">Discount ({receiptCurrency})</th>
                  <th className="px-3 py-2.5 text-right">
                    Forex G/L {baseCurrency ? `(${baseCurrency}, company base)` : "(company base — unavailable)"}
                  </th>
                  <th className="px-3 py-2.5 text-center w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const inv = invoices.find((i) => i.id === line.invoice_id);
                  const hasError = line.errors.length > 0;
                  const exceedsMax = line.amount > line.max_amount + 0.005;

                  return (
                    <tr key={line.invoice_id} className={cn("border-b border-slate-100 transition-colors", line.is_auto && "bg-amber-500/[0.03]", hasError && "bg-red-500/5")}>
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-medium text-slate-700">{line.invoice_no}</p>
                        {inv && <p className="text-[10px] text-slate-500">Due {formatDate(inv.due_date ?? "")}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">{line.doc_type}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-slate-400">{inv ? tx(inv.total_amount) : "-"}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-slate-900">{tx(line.max_amount)}</td>
                      <td className="px-3 py-2">
                        <div className="relative">
                          <input
                            type="number" step="0.01" min="0" max={line.max_amount}
                            value={line.amount || ""}
                            onChange={(e) => onUpdateAmount(line.invoice_id, parseFloat(e.target.value) || 0)}
                            className={cn(
                              "h-8 w-full rounded border bg-transparent px-2 pr-8 text-right font-mono text-sm transition-colors focus:outline-none",
                              exceedsMax || hasError ? "border-red-500 text-red-500 ring-1 ring-red-500/30" : line.amount > 0 ? "border-brand-500/30 text-emerald-600 focus:border-brand-500" : "border-slate-300 text-slate-500 focus:border-slate-400"
                            )}
                          />
                          <button type="button" onClick={() => onFillMax(line.invoice_id)} className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition-colors hover:text-brand-500" title="Fill max allocatable amount">
                            <Maximize2 className="h-3 w-3" />
                          </button>
                        </div>
                        {hasError && (
                          <p className="mt-1 flex items-center gap-1 text-[10px] text-red-500">
                            <AlertCircle className="h-2.5 w-2.5" />{line.errors[0]}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" step="0.01" min="0"
                          value={line.discount_amount || ""}
                          onChange={(e) => onUpdateDiscount(line.invoice_id, parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                          className={cn(
                            "h-8 w-full rounded border bg-transparent px-2 text-right font-mono text-sm transition-colors focus:outline-none",
                            line.discount_amount > 0 ? "border-purple-500/30 text-purple-500 focus:border-purple-500" : "border-slate-300 text-slate-400 focus:border-slate-400"
                          )}
                        />
                      </td>
                      {/* Forex G/L: a COMPANY-BASE amount. Never rendered as a
                          bare number, and never in the transaction currency. */}
                      <td className="px-3 py-2.5 text-right">
                        {Math.abs(line.forex_gain_loss) < 0.01 ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : baseCurrency === null ? (
                          <span className="text-[10px] italic text-amber-700" title="The company base currency is unavailable, so this gain/loss cannot be denominated.">
                            Basis not specified
                          </span>
                        ) : line.forex_gain_loss > 0 ? (
                          <span className="flex items-center justify-end gap-1 font-mono text-xs text-emerald-500">
                            <TrendingUp className="h-3 w-3" />+{formatMoneySafe(line.forex_gain_loss, baseCurrency)}
                          </span>
                        ) : (
                          <span className="flex items-center justify-end gap-1 font-mono text-xs text-red-500">
                            <TrendingDown className="h-3 w-3" />{formatMoneySafe(line.forex_gain_loss, baseCurrency)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button type="button" onClick={() => onRemoveInvoice(line.invoice_id)} className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Balance Summary Bar */}
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Receipt unallocated ({receiptCurrency})
                  </p>
                  <p className="mt-0.5 font-mono text-base font-bold text-slate-900">{tx(validation.availableBalance)}</p>
                </div>
                <span className="text-slate-400">−</span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Allocating ({receiptCurrency})
                  </p>
                  <p className={cn("mt-0.5 font-mono text-base font-bold", validation.isBalanceValid ? "text-brand-500" : "text-red-500")}>{tx(validation.totalAllocating)}</p>
                </div>
                <span className="text-slate-400">=</span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Unapplied receipt balance ({receiptCurrency})
                  </p>
                  <p className={cn("mt-0.5 font-mono text-base font-bold", validation.remainingBalance < -0.005 ? "text-red-500" : validation.remainingBalance < 0.01 ? "text-emerald-500" : "text-slate-500")}>
                    {tx(Math.max(0, validation.remainingBalance))}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {!validation.isBalanceValid && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                    {/* A validation message about money states the amounts. */}
                    <span className="text-xs font-medium text-red-500">
                      Total allocation ({tx(validation.totalAllocating)}) cannot exceed the receipt&apos;s
                      unallocated amount ({tx(validation.availableBalance)})
                    </span>
                  </div>
                )}
                {validation.isBalanceValid && validation.totalAllocating > 0 && validation.remainingBalance > 0.005 && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5">
                    <Info className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-medium text-amber-700">
                      This receipt will retain an unapplied balance of {tx(validation.remainingBalance)}
                    </span>
                  </div>
                )}
                {validation.canSubmit && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-600">Validation Passed</span>
                  </div>
                )}
                <LoadingButton type="button" variant="primary" onClick={onSubmit} disabled={!validation.canSubmit} isLoading={isSubmitting} loadingText="Submitting...">
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Allocation ({validation.activeLineCount})
                </LoadingButton>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={cn("h-full rounded-full transition-all duration-300", validation.isBalanceValid ? "bg-gradient-to-r from-brand-600 to-emerald-500" : "bg-gradient-to-r from-red-600 to-red-400")}
                style={{ width: `${Math.min((validation.totalAllocating / Math.max(validation.availableBalance, 0.01)) * 100, 100)}%` }}
              />
            </div>

            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
              <Info className="h-3 w-3" />
              Receipt balance utilized: {pct(validation.totalAllocating, validation.availableBalance)}
              {" · "}Precision: roundTo2 (Round Half Up)
              {" · "}Allocation is same-currency: only {receiptCurrency} invoices can be allocated to this
              {" "}{receiptCurrency} receipt
              {" · "}Forex G/L is a company-base
              {baseCurrency ? ` (${baseCurrency})` : ""} preview only; final values are recalculated by the
              backend from its own snapshot
            </div>
          </div>
        </>
      )}
    </div>
  );
}

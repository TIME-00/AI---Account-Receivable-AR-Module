"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { useAllocations } from "@/hooks/use-allocations";
import { cn, formatDate } from "@/lib/utils";
import { formatMoney, sumByCurrency } from "@/lib/currency";
import { CurrencySubtotals } from "@/components/ui/currency-subtotals";
import type { AllocationMethod, AllocationStatus } from "@/types";

interface AllocationHistoryTableProps {
  receiptId?: string;
  invoiceId?: string;
  showReceiptColumn?: boolean;
  showInvoiceColumn?: boolean;
  showFilters?: boolean;
  maxRows?: number;
  title?: string;
  emptyMessage?: string;
}

const STATUS_FILTERS: Array<AllocationStatus | "All"> = ["All", "Active", "Reversed"];
const METHOD_FILTERS: Array<AllocationMethod | "All"> = ["All", "Manual", "Auto_FIFO", "Auto_Amount"];

const METHOD_LABELS: Record<AllocationMethod, string> = {
  Manual: "Manual",
  Auto_FIFO: "FIFO",
  Auto_Amount: "Amount Match",
};

export function AllocationHistoryTable({
  receiptId,
  invoiceId,
  showReceiptColumn = true,
  showInvoiceColumn = true,
  showFilters = false,
  maxRows,
  title = "Allocation History",
  emptyMessage = "No allocations found.",
}: AllocationHistoryTableProps) {
  const [status, setStatus] = useState<AllocationStatus | "All">("All");
  const [method, setMethod] = useState<AllocationMethod | "All">("All");
  const [page, setPage] = useState(1);
  const pageSize = maxRows ?? 10;

  const { data, isLoading, isError, error, refetch } = useAllocations({
    receiptId,
    invoiceId,
    status,
    method,
    page,
    pageSize,
  });

  const allocations = data?.allocations ?? [];
  const meta = data?.meta;
  const totalPages = useMemo(() => {
    if (!meta) return 1;
    return Math.max(1, Math.ceil(meta.total / meta.page_size));
  }, [meta]);

  // B9DD-FEIR-004: the `allocate_receipt` SQL invariant (BR-REC-003) guarantees
  // receipt.currency === invoice.currency for EACH allocation PAIR. It does NOT
  // make a page of allocations single-currency: this table is also rendered
  // unscoped (global history), where rows from different receipts can carry
  // different currencies. Summing them into one number and labelling it with
  // `allocations[0].receipt_currency` produced a fabricated total.
  //
  // Totals are therefore grouped by receipt_currency, and each is a genuine
  // same-currency sum. No company-base rollup is invented: the allocations read
  // contract supplies no base allocation amount, so none is shown.
  const activeSubtotals = sumByCurrency(
    allocations.filter((allocation) => allocation.status === "Active"),
    (allocation) => allocation.receipt_currency,
    (allocation) => Number(allocation.allocated_amount),
  );

  const setStatusFilter = (nextStatus: AllocationStatus | "All") => {
    setStatus(nextStatus);
    setPage(1);
  };

  const setMethodFilter = (nextMethod: AllocationMethod | "All") => {
    setMethod(nextMethod);
    setPage(1);
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {meta && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              {meta.total}
            </span>
          )}
        </div>
        {allocations.length > 0 && activeSubtotals.length > 0 && (
          <div className="flex items-start gap-2">
            {/* Scope is explicit: these totals describe THIS PAGE only. */}
            <p className="text-xs font-medium text-slate-500">Active total (this page):</p>
            <CurrencySubtotals
              subtotals={activeSubtotals}
              className="text-xs [&>div]:text-xs"
              color="text-slate-800"
            />
          </div>
        )}
      </div>

      {showFilters && (
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-3 sm:flex-row sm:items-center">
          <FilterGroup
            label="Status"
            options={STATUS_FILTERS}
            value={status}
            getLabel={(value) => value}
            onChange={setStatusFilter}
          />
          <FilterGroup
            label="Method"
            options={METHOD_FILTERS}
            value={method}
            getLabel={(value) => value === "All" ? "All" : METHOD_LABELS[value]}
            onChange={setMethodFilter}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <div>
            <p className="text-sm font-medium text-slate-700">Failed to load allocation history</p>
            <p className="mt-1 text-xs text-slate-400">{error instanceof Error ? error.message : "Please try again."}</p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Retry
          </button>
        </div>
      ) : allocations.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
          <ListChecks className="h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {showReceiptColumn && <th className="px-4 py-2.5 text-left">Receipt No</th>}
                  {showInvoiceColumn && <th className="px-4 py-2.5 text-left">Invoice No</th>}
                  <th className="px-4 py-2.5 text-left">Customer</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-left">Method</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  {!showReceiptColumn && <th className="px-4 py-2.5 text-right">Invoice Outstanding</th>}
                  {!showInvoiceColumn && <th className="px-4 py-2.5 text-right">Receipt Amount</th>}
                </tr>
              </thead>
              <tbody>
                {allocations.map((allocation) => (
                  <tr key={allocation.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    {showReceiptColumn && (
                      <td className="px-4 py-3">
                        <Link href={`/receipts/${allocation.receipt_id}`} className="text-sm font-semibold text-brand-600 hover:text-brand-500">
                          {allocation.receipt_no}
                        </Link>
                      </td>
                    )}
                    {showInvoiceColumn && (
                      <td className="px-4 py-3">
                        <Link href={`/invoices/${allocation.invoice_id}`} className="text-sm font-semibold text-brand-600 hover:text-brand-500">
                          {allocation.invoice_no}
                        </Link>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-800">{allocation.customer_name}</p>
                      <p className="text-[10px] font-mono text-slate-400">{allocation.customer_code}</p>
                    </td>
                    <td className={cn("px-4 py-3 text-right text-sm font-mono font-semibold", allocation.status === "Reversed" && "text-slate-400 line-through")}>
                      {formatMoney(allocation.allocated_amount, allocation.receipt_currency)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{formatDate(allocation.allocation_date)}</td>
                    <td className="px-4 py-3">
                      <MethodBadge method={allocation.allocation_method} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={allocation.status} />
                    </td>
                    {!showReceiptColumn && (
                      <td className="px-4 py-3 text-right text-sm font-mono text-slate-600">
                        {formatMoney(allocation.invoice_outstanding, allocation.receipt_currency)}
                      </td>
                    )}
                    {!showInvoiceColumn && (
                      <td className="px-4 py-3 text-right text-sm font-mono text-slate-600">
                        {formatMoney(allocation.receipt_amount, allocation.receipt_currency)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!maxRows && meta && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
              <p className="text-xs text-slate-500">
                Page {meta.page} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  getLabel,
  onChange,
}: {
  label: string;
  options: T[];
  value: T;
  getLabel: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">{label}:</span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            value === option
              ? "border-brand-200 bg-brand-50 text-brand-700"
              : "border-slate-200 bg-surface text-slate-500 hover:bg-slate-50"
          )}
        >
          {getLabel(option)}
        </button>
      ))}
    </div>
  );
}

function MethodBadge({ method }: { method: AllocationMethod }) {
  const styles: Record<AllocationMethod, string> = {
    Manual: "border-blue-200 bg-blue-50 text-blue-700",
    Auto_FIFO: "border-purple-200 bg-purple-50 text-purple-700",
    Auto_Amount: "border-teal-200 bg-teal-50 text-teal-700",
  };

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", styles[method])}>
      {METHOD_LABELS[method]}
    </span>
  );
}

function StatusPill({ status }: { status: AllocationStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
        status === "Active"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-red-50 text-red-700"
      )}
    >
      {status}
    </span>
  );
}

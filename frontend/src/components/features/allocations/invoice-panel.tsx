"use client";

import { cn } from "@/lib/utils";
import { formatAmount, formatDate } from "@/lib/utils";
import type { AllocationInvoice } from "@/hooks/use-allocation-logic";
import { FileText, ChevronsRight, Plus, CheckCircle2 } from "lucide-react";

interface InvoicePanelProps {
  invoices: AllocationInvoice[];
  selectedReceipt: { customer_name: string } | null;
  isLoading: boolean;
  allocatedInvoiceIds: Set<string>;
  onAddInvoice: (inv: AllocationInvoice) => void;
}

export function InvoicePanel({
  invoices, selectedReceipt, isLoading, allocatedInvoiceIds, onAddInvoice,
}: InvoicePanelProps) {
  return (
    <div className="glass-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <FileText className="h-4 w-4 text-amber-400" />
          Outstanding Invoices
          {selectedReceipt && <span className="ml-1 text-[10px] text-slate-500">{selectedReceipt.customer_name}</span>}
        </h2>
        {invoices.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">{invoices.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-auto" style={{ maxHeight: "420px" }}>
        {!selectedReceipt ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <ChevronsRight className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm">Please select a receipt from the left panel</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <FileText className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm">No outstanding invoices for this customer</p>
            <p className="text-[11px] text-slate-400">Requires invoices with Open/Overdue/Partially Paid status</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {invoices.map((inv) => {
              const isInLines = allocatedInvoiceIds.has(inv.id);
              const isOverdue = inv.overdue_days > 0;

              return (
                <div key={inv.id} className={cn("flex items-center justify-between px-4 py-2.5 transition-colors", isInLines ? "bg-brand-600/5" : "hover:bg-slate-50")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-700">{inv.invoice_no}</p>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">{inv.doc_type}</span>
                      {isOverdue && (
                        <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-500">Overdue {inv.overdue_days}d</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {formatDate(inv.invoice_date)}
                      {inv.due_date && <> · Due {formatDate(inv.due_date)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-mono text-sm text-slate-900">{formatAmount(inv.outstanding)}</p>
                      <p className="font-mono text-[10px] text-slate-500">/ {formatAmount(inv.total_amount)}</p>
                    </div>
                    {!isInLines && (
                      <button type="button" onClick={() => onAddInvoice(inv)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600" title="Add to allocation">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isInLines && <CheckCircle2 className="h-4 w-4 text-brand-500" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

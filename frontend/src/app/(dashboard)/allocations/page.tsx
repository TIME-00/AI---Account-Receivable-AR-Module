// ============================================================================
// TSH Synergy AR — Allocation Wizard (Split-Screen)
// Left:  Selectable Posted Receipts (receipt_no, amount, unallocated)
// Right: Outstanding Invoices for that customer
// Center: FIFO preview + manual allocation table with real-time validation
// ============================================================================

"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { formatAmount } from "@/lib/utils";
import { useAllocationLogic } from "@/hooks/use-allocation-logic";
import type { AllocationReceipt } from "@/hooks/use-allocation-logic";
import {
  usePostedReceipts,
  useOutstandingInvoices,
  useManualAllocate,
} from "@/hooks/use-allocations";
import { LoadingButton } from "@/components/ui/loading-button";
import { ReceiptPanel } from "@/components/features/allocations/receipt-panel";
import { InvoicePanel } from "@/components/features/allocations/invoice-panel";
import { AllocationTable } from "@/components/features/allocations/allocation-table";
import { ArrowLeftRight, RotateCcw } from "lucide-react";

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AllocationsPage() {
  const logic = useAllocationLogic();
  const allocMutation = useManualAllocate();

  // Receipt list
  const { data: receipts = [], isLoading: receiptsLoading } = usePostedReceipts();

  // Outstanding invoices — triggered when receipt is selected
  const { data: outstandingInvoices = [], isLoading: invoicesLoading } =
    useOutstandingInvoices(
      logic.selectedReceipt?.customer_id ?? "",
      logic.selectedReceipt?.currency ?? ""
    );

  // Load invoices into logic when data arrives
  useEffect(() => {
    if (logic.selectedReceipt && outstandingInvoices.length > 0) {
      logic.selectReceipt(logic.selectedReceipt, outstandingInvoices);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outstandingInvoices]);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleSelectReceipt = (receipt: AllocationReceipt) => {
    logic.selectReceipt(receipt, []);
  };

  const handleSubmit = async () => {
    const payload = logic.buildPayload();
    if (!payload || !logic.validation.canSubmit) return;

    try {
      await allocMutation.mutateAsync(payload);
      toast.success("Allocation Successful", {
        description: `Allocated ${logic.validation.activeLineCount} invoice(s), total ${formatAmount(logic.validation.totalAllocating)}`,
      });
      logic.clearSelection();
    } catch {
      // Error toast handled by useApi
    }
  };

  // Compute the set of invoice IDs already in allocation lines
  const allocatedInvoiceIds = new Set(logic.lines.map((l) => l.invoice_id));

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-brand-400" />
            Allocation Wizard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Select Receipt → Match Invoices → Auto FIFO or Manual Allocation
          </p>
        </div>
        {logic.selectedReceipt && (
          <LoadingButton variant="ghost" size="sm" onClick={logic.clearSelection}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reselect
          </LoadingButton>
        )}
      </div>

      {/* Split Screen: Receipts + Invoices */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ReceiptPanel
          receipts={receipts}
          isLoading={receiptsLoading}
          selectedReceiptId={logic.selectedReceipt?.id}
          onSelectReceipt={handleSelectReceipt}
          totalAllocating={logic.validation.totalAllocating}
        />
        <InvoicePanel
          invoices={logic.invoices}
          selectedReceipt={logic.selectedReceipt}
          isLoading={invoicesLoading}
          allocatedInvoiceIds={allocatedInvoiceIds}
          onAddInvoice={logic.addInvoice}
        />
      </div>

      {/* Allocation Table */}
      {logic.selectedReceipt && (
        <AllocationTable
          lines={logic.lines}
          invoices={logic.invoices}
          isFifoPreview={logic.isFifoPreview}
          validation={logic.validation}
          onUpdateAmount={logic.updateAmount}
          onUpdateDiscount={logic.updateDiscount}
          onFillMax={logic.fillMax}
          onRemoveInvoice={logic.removeInvoice}
          onClearLines={logic.clearLines}
          onRunFifo={logic.runFifoPreview}
          onSubmit={handleSubmit}
          isSubmitting={allocMutation.isPending}
        />
      )}
    </div>
  );
}

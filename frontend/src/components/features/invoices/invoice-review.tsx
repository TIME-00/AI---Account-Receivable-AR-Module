"use client";

import { formatAmount, formatCurrency, formatDate } from "@/lib/utils";
import { SummaryRow } from "@/components/ui/summary-row";
import { LoadingButton } from "@/components/ui/loading-button";
import type { UseFormReturn } from "react-hook-form";
import type { InvoiceFormValues } from "@/lib/invoice-schema";
import type { InvoiceCalcOutput } from "@/hooks/use-invoice-calculator";
import { FileText, Send, Info } from "lucide-react";

interface InvoiceReviewProps {
  form: UseFormReturn<InvoiceFormValues>;
  calc: InvoiceCalcOutput;
  selectedCustomerName: string;
  calculatedDueDate: string | null;
  onCreateDraft: () => void;
  onCreateAndPost: () => void;
  isCreating: boolean;
  isPosting: boolean;
  isSubmitting: boolean;
  submittingAction: "draft" | "post" | null;
}

export function InvoiceReview({
  form,
  calc,
  selectedCustomerName,
  calculatedDueDate,
  onCreateDraft,
  onCreateAndPost,
  isCreating,
  isPosting,
  isSubmitting,
  submittingAction,
}: InvoiceReviewProps) {
  return (
    <div className="animate-fade-in space-y-4">
      {/* Summary Card */}
      <div className="glass-card p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900 flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand-400" />
          Invoice Summary
        </h2>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Left: Key fields */}
          <div className="space-y-2">
            <SummaryRow label="Document Type" value={form.watch("doc_type")} />
            <SummaryRow label="Customer" value={selectedCustomerName || "—"} />
            <SummaryRow label="Invoice Date" value={formatDate(form.watch("invoice_date"))} />
            {calculatedDueDate && (
              <SummaryRow label="Due Date" value={formatDate(calculatedDueDate)} highlight />
            )}
            <SummaryRow label="Currency" value={form.watch("currency")} />
            {form.watch("exchange_rate") !== 1 && (
              <SummaryRow label="Exchange Rate" value={String(form.watch("exchange_rate"))} />
            )}
            {form.watch("reference_no") && (
              <SummaryRow label="Reference No." value={form.watch("reference_no")!} />
            )}
          </div>

          {/* Right: Totals */}
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal ({calc.totals.line_count} lines)</span>
                <span className="font-mono text-slate-900">{formatAmount(calc.totals.subtotal)}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-amber-500">Tax</span>
                <span className="font-mono text-amber-500">{formatAmount(calc.totals.tax_total)}</span>
              </div>
              <div className="mt-3 border-t border-slate-200 pt-3 flex justify-between">
                <span className="text-sm font-semibold text-slate-900">Grand Total</span>
                <span className="text-lg font-bold text-slate-900 font-mono">
                  {formatCurrency(calc.totals.total_amount, form.watch("currency"))}
                </span>
              </div>
              {form.watch("exchange_rate") !== 1 && (
                <div className="mt-1 flex justify-between text-xs text-slate-500">
                  <span>Base Currency Total</span>
                  <span className="font-mono">{formatCurrency(calc.totals.base_total)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Remarks */}
      <div className="glass-card p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Remarks</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Internal Remarks (internal use only)
            </label>
            <textarea
              {...form.register("internal_remarks")}
              rows={3}
              placeholder="This will not appear on the invoice..."
              className="input-premium w-full resize-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Invoice Remarks (shown on invoice)
            </label>
            <textarea
              {...form.register("invoice_remarks")}
              rows={3}
              placeholder="Thank you for your business..."
              className="input-premium w-full resize-none"
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Info className="h-3.5 w-3.5" />
          Save as Draft to continue editing. Posting will lock core fields.
        </div>
        <div className="flex gap-3">
          <LoadingButton
            type="button"
            variant="secondary"
            onClick={onCreateDraft}
            isLoading={submittingAction === "draft" || (isCreating && !isPosting)}
            disabled={isSubmitting}
            loadingText="Saving..."
          >
            <FileText className="h-4 w-4" />
            Save Draft
          </LoadingButton>
          <LoadingButton
            type="button"
            variant="primary"
            onClick={onCreateAndPost}
            isLoading={submittingAction === "post" || isPosting}
            disabled={isSubmitting}
            loadingText={isPosting ? "Posting..." : "Processing..."}
          >
            <Send className="h-4 w-4" />
            Create & Post
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TSH Synergy AR — Invoice Creation Workbench
// 3-Step financial document creation with real-time tax calculation engine.
//
// Step 1: Header  — Customer, dates, currency, payment term
// Step 2: Lines   — Editable table with per-line tax, live totals
// Step 3: Review  — Summary, remarks, create (Draft) + optional Post
// ============================================================================

"use client";

import { useRouter } from "next/navigation";
import { useInvoiceForm } from "@/hooks/use-invoice-form";
import { StepIndicator, type StepConfig } from "@/components/ui/step-indicator";
import { LoadingButton } from "@/components/ui/loading-button";
import { InvoiceHeaderForm } from "@/components/features/invoices/invoice-header-form";
import { InvoiceLineTable } from "@/components/features/invoices/invoice-line-table";
import { InvoiceReview } from "@/components/features/invoices/invoice-review";
import { ArrowLeft, ArrowRight, AlertCircle, User, Calculator, Send, Info } from "lucide-react";

// ─── Step Configuration ─────────────────────────────────────────────────────

const STEPS: StepConfig[] = [
  { id: 1, label: "Invoice Header", icon: User, desc: "Customer · Currency · Date" },
  { id: 2, label: "Line Items", icon: Calculator, desc: "Items · Tax Code · Discount" },
  { id: 3, label: "Review & Submit", icon: Send, desc: "Verify · Remarks · Post" },
];

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function NewInvoicePage() {
  const router = useRouter();
  const inv = useInvoiceForm();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/invoices")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              New {inv.docType === "Credit Note" ? "Credit Note" : inv.docType === "Debit Note" ? "Debit Note" : "Invoice"}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Fill in all required fields across each step.
            </p>
          </div>
        </div>
        <StepIndicator steps={STEPS} currentStep={inv.currentStep} />
      </div>

      {/* B9DD-RR-003: an unresolvable company base currency is stated plainly.
          Nothing is defaulted to MYR, and the schema keeps the form
          unsubmittable until a supported currency is chosen. */}
      {inv.baseCurrencyUnavailable && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-amber-800">Company base currency unavailable</p>
            <p className="text-xs text-amber-600">
              The document currency has not been pre-filled. Select a currency before saving; the
              company-base total stays hidden until the base currency is known.
            </p>
          </div>
        </div>
      )}

      {/* ── Form Error Banner ────────────────────────────────────────── */}
      {inv.fieldErrors["_form"] && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-600">Submission Failed</p>
            <p className="mt-0.5 text-xs text-red-500">{inv.fieldErrors["_form"]}</p>
          </div>
        </div>
      )}

      {/* ── Step 1: Header ─────────────────────────────────────────── */}
      {inv.currentStep === 1 && (
        <InvoiceHeaderForm
          form={inv.form}
          customers={inv.customers}
          paymentTerms={inv.paymentTerms}
          setCustomerSearch={inv.setCustomerSearch}
          selectedCustomerName={inv.selectedCustomerName}
          setSelectedCustomerName={inv.setSelectedCustomerName}
          selectedTermId={inv.selectedTermId}
          setSelectedTermId={inv.setSelectedTermId}
          fieldErrors={inv.fieldErrors}
          calculatedDueDate={inv.calc.calculatedDueDate}
          onFxSubmittableChange={inv.setFxSubmittable}
        />
      )}

      {/* ── Step 2: Line Items ─────────────────────────────────────── */}
      {inv.currentStep === 2 && (
        <InvoiceLineTable
          form={inv.form}
          fields={inv.fields}
          append={inv.append}
          remove={inv.remove}
          calc={inv.calc}
          taxCodes={inv.taxCodes}
          fieldErrors={inv.fieldErrors}
        />
      )}

      {/* ── Step 3: Review & Submit ────────────────────────────────── */}
      {inv.currentStep === 3 && (
        <InvoiceReview
          form={inv.form}
          calc={inv.calc}
          selectedCustomerName={inv.selectedCustomerName}
          calculatedDueDate={inv.calc.calculatedDueDate}
          onCreateDraft={inv.handleCreateDraft}
          onCreateAndPost={inv.handleCreateAndPost}
          isCreating={inv.createMutation.isPending}
          isPosting={inv.postMutation.isPending}
          isSubmitting={inv.isSubmitting}
          submittingAction={inv.submittingAction}
        />
      )}

      {/* ── Step Navigation ────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <LoadingButton
          type="button"
          variant="ghost"
          onClick={inv.goPrev}
          disabled={inv.currentStep === 1}
        >
          <ArrowLeft className="h-4 w-4" />
          Previous
        </LoadingButton>

        {inv.currentStep < 3 && (
          <LoadingButton type="button" variant="primary" onClick={inv.goNext}>
            Next
            <ArrowRight className="h-4 w-4" />
          </LoadingButton>
        )}
      </div>
    </div>
  );
}

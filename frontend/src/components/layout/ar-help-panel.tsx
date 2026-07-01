"use client";

import Link from "next/link";
import { BookOpen, LifeBuoy, ArrowRight } from "lucide-react";

// ============================================================================
// AR Help / Workflow Guide
//
// A LOCAL, static help surface for the AR module. It contains hand-written
// workflow guidance only. It does NOT call any external AI/LLM/OCR provider
// and never uploads company data or documents anywhere. There is no live
// "AI assistant" — this is honest in-app help copy.
// ============================================================================

interface WorkflowStep {
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}

const WORKFLOWS: { heading: string; steps: WorkflowStep[] }[] = [
  {
    heading: "Create & post an invoice",
    steps: [
      {
        title: "1. Open the Invoice Workbench",
        body: "Go to Invoices → New. Pick the customer, date, and currency, then add line items.",
        href: "/invoices/new",
        hrefLabel: "New invoice",
      },
      {
        title: "2. Add lines and tax",
        body: "Each line supports quantity, unit price, discount, and a tax code. Totals update live.",
      },
      {
        title: "3. Save draft or create & post",
        body: "Save as a draft to review later, or create-and-post to recognise revenue immediately.",
      },
    ],
  },
  {
    heading: "Record & allocate a receipt",
    steps: [
      {
        title: "1. Create the receipt",
        body: "Go to Receipts → New, choose the customer and bank account, and enter the amount.",
        href: "/receipts/new",
        hrefLabel: "New receipt",
      },
      {
        title: "2. Post the receipt",
        body: "Posting records the cash entry. Any unallocated amount is kept as unapplied cash.",
      },
      {
        title: "3. Allocate to invoices",
        body: "Use the Allocation Wizard to apply one receipt across one or more open invoices.",
        href: "/allocations",
        hrefLabel: "Allocation Wizard",
      },
    ],
  },
  {
    heading: "Import invoices or receipts",
    steps: [
      {
        title: "1. Upload a CSV / Excel file",
        body: "Use Invoices → Import or Receipts → Import. Download the template if you need the column layout.",
        href: "/invoices/import",
        hrefLabel: "Invoice import",
      },
      {
        title: "2. Validate and review",
        body: "Rows are validated. Rows needing review (e.g. fuzzy customer matches) wait for your approval.",
      },
      {
        title: "3. Execute",
        body: "Invoice import creates drafts. Receipt import can post and allocate when you choose to.",
      },
    ],
  },
];

export function ArHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex w-[380px] animate-slide-in-right flex-col border-l border-slate-200 bg-white/95 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-slate-900">AR Help &amp; Workflow Guide</h3>
        </div>
        <button
          onClick={onClose}
          className="text-sm text-slate-500 transition-colors hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-xs text-slate-500">
            Step-by-step guidance for common AR tasks. This is built-in help — it does not use any
            external AI service and never sends your data anywhere.
          </p>
        </div>

        <div className="space-y-6">
          {WORKFLOWS.map((wf) => (
            <section key={wf.heading}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {wf.heading}
              </h4>
              <ol className="space-y-2.5">
                {wf.steps.map((step) => (
                  <li key={step.title} className="rounded-lg border border-slate-100 bg-white p-3">
                    <p className="text-sm font-medium text-slate-700">{step.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{step.body}</p>
                    {step.href && step.hrefLabel && (
                      <Link
                        href={step.href}
                        onClick={onClose}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                      >
                        {step.hrefLabel}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

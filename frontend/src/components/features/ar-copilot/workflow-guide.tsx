"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { COMPOSABLE_FOCUS_RING } from "@/lib/focus-styles";

// ============================================================================
// Workflow Guide
//
// The hand-written, deterministic half of the Copilot drawer. It is static
// product guidance: no provider call, no company data, no generated text. It
// was previously the whole of the "AR Help" panel and is preserved here rather
// than replaced, because a step list is a better answer than a chat turn for
// "how do I do X".
//
// The panel-level disclosure covers privacy for the drawer as a whole; this
// component deliberately makes no claim about AI or data handling of its own.
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
        body: "Save as a draft to review later, or create-and-post to record the authoritative receivable and its journal entry.",
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
        body: "Posting records the cash entry. Any amount not allocated to an eligible invoice stays as unapplied cash.",
      },
      {
        title: "3. Allocate to invoices",
        body: "Use the Allocation Wizard to apply one receipt across one or more open invoices. Customer, currency, and outstanding amount are validated before anything is applied.",
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
        body: "Rows are validated. Rows needing review — an unsupported currency, or a fuzzy customer match — wait for your approval instead of being guessed.",
      },
      {
        title: "3. Execute",
        body: "Invoice import creates drafts. Receipt import can post and allocate when you choose to.",
      },
    ],
  },
  {
    heading: "Work through Automation",
    steps: [
      {
        title: "1. Documents arrive from the mailbox",
        body: "Connected mailboxes ingest source messages. Document understanding proposes a classification; it never becomes financial authority on its own.",
        href: "/automation",
        hrefLabel: "Automation overview",
      },
      {
        title: "2. Straight-Through processing",
        body: "Eligible documents move through deterministic validation, governed creation and posting, and deterministic allocation. A failed gate opens an exception rather than guessing.",
      },
      {
        title: "3. Clear exceptions",
        body: "Review open and retryable exceptions, resolve or dismiss them with a note, or retry once the underlying cause is fixed.",
        href: "/automation/exceptions",
        hrefLabel: "Exceptions",
      },
    ],
  },
  {
    heading: "Report and export",
    steps: [
      {
        title: "1. Pick a report",
        body: "Report Center provides Aging, Invoice Summary, Receipt Summary, and Customer Outstanding.",
        href: "/reports",
        hrefLabel: "Report Center",
      },
      {
        title: "2. Filter and review",
        body: "Company-base totals include only documents with an authoritative booked FX rate; anything else is shown as unavailable rather than re-valued at today's rate.",
      },
      {
        title: "3. Export",
        body: "PDF and Excel exports are available within each report.",
      },
    ],
  },
];

export function WorkflowGuide({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="space-y-6">
      <p className="text-xs leading-relaxed text-content-muted">
        Step-by-step guidance for common AR tasks, written and maintained in
        this application.
      </p>

      {WORKFLOWS.map((workflow) => (
        <section key={workflow.heading}>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-content-muted">
            {workflow.heading}
          </h4>
          <ol className="space-y-2">
            {workflow.steps.map((step) => (
              <li
                key={step.title}
                className="rounded-lg border border-line-muted bg-surface p-3"
              >
                <p className="text-sm font-medium text-content">{step.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                  {step.body}
                </p>
                {step.href && step.hrefLabel && (
                  <Link
                    href={step.href}
                    onClick={onNavigate}
                    className={`mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline ${COMPOSABLE_FOCUS_RING}`}
                  >
                    {step.hrefLabel}
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

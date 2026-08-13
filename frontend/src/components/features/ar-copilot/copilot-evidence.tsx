"use client";

import {
  BookOpen,
  ArrowLeftRight,
  BarChart3,
  Bell,
  CreditCard,
  FileText,
  Receipt,
  Shield,
  Users,
  Workflow,
} from "lucide-react";
import type { CopilotEvidence, CopilotEvidenceKind } from "@/lib/ar-copilot/contract";

// ============================================================================
// Evidence chips.
//
// Evidence is what the answer was built from. It is presented as a source
// list, not as navigation: a chip is deliberately not clickable, because the
// only destinations this feature trusts are the separately validated `links`.
//
// A chip shows the record's own number or name. The internal identifier is
// never the primary label, and where the server sent no number — a curated
// guide entry, the AR summary — the chip shows the kind and label only.
// ============================================================================

const KIND_LABEL: Record<CopilotEvidenceKind, string> = {
  system_guide: "System guide",
  ar_summary: "AR summary",
  customer: "Customer",
  invoice: "Invoice",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
  receipt: "Receipt",
  allocation: "Allocation",
  automation_document: "Automation Document",
  automation_exception: "Automation Exception",
  journal_entry: "Journal Entry",
  audit_event: "Audit Event",
  reminder: "Reminder",
};

const KIND_ICON: Record<CopilotEvidenceKind, typeof FileText> = {
  system_guide: BookOpen,
  ar_summary: BarChart3,
  customer: Users,
  invoice: FileText,
  credit_note: CreditCard,
  debit_note: CreditCard,
  receipt: Receipt,
  allocation: ArrowLeftRight,
  automation_document: Workflow,
  automation_exception: Workflow,
  journal_entry: BookOpen,
  audit_event: Shield,
  reminder: Bell,
};

export function CopilotEvidenceList({
  evidence,
}: {
  evidence: readonly CopilotEvidence[];
}) {
  if (evidence.length === 0) return null;

  return (
    <div className="mt-3">
      {/* `text-content-secondary`, not `-muted`: browser measurement put muted
          at 4.32:1 on the elevated answer surface in Dark, below AA for 10px. */}
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-content-secondary">
        Sources
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {evidence.map((item) => {
          const Icon = KIND_ICON[item.kind];
          // The number is the recognisable handle when the server sent one;
          // otherwise the label already is the human name.
          const primary = item.number ?? item.label;
          return (
            <li
              key={`${item.kind}:${item.id}`}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-chip-border bg-chip-bg px-2 py-1"
            >
              <Icon
                className="h-3 w-3 shrink-0 text-content-muted"
                aria-hidden="true"
              />
              {/* The kind label is real content, not decoration: muted measured
                  4.08:1 on the chip surface in Dark, so it uses the secondary
                  text token like the chip's own value. */}
              <span className="text-[10px] font-medium uppercase tracking-wide text-content-secondary">
                {KIND_LABEL[item.kind]}
              </span>
              <span className="truncate text-[11px] font-medium text-chip-text">
                {primary}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

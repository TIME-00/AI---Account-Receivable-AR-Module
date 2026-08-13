// ============================================================================
// AR Copilot — suggested questions registry.
//
// Every suggested question lives here rather than inside the drawer, so the
// question text, the page it belongs to, and the authority it needs are stated
// in one place and can be tested directly.
//
// Suggestions are UX ONLY. Hiding a question the caller could not use avoids
// walking someone into a predictable permission error; it is not a security
// control. The Edge Function re-derives roles from the bearer token and remains
// the authority for every read.
// ============================================================================

import type { UserRole } from "@/types";
import type { CopilotPage } from "./contract";

/**
 * The authority a question's likely tool needs, mirroring the role gates in
 * `backend/supabase/functions/ar-copilot/tools.ts`.
 *
 * - `guide`      — `search_system_guide`; any authenticated company member.
 * - `operational`— AR reads; AR Clerk, AR Supervisor, Finance Manager, Auditor.
 *                  AR Clerk remains assigned-customer scoped server-side.
 * - `automation` — Automation/Journal reads; AR Supervisor, Finance Manager,
 *                  Auditor. System Admin and AR Clerk are excluded.
 * - `audit`      — Audit Trail reads; Finance Manager and Auditor only.
 */
export type CopilotCapability = "guide" | "operational" | "automation" | "audit";

const CAPABILITY_ROLES: Record<CopilotCapability, readonly UserRole[]> = {
  guide: ["AR Clerk", "AR Supervisor", "Finance Manager", "Auditor", "System Admin"],
  operational: ["AR Clerk", "AR Supervisor", "Finance Manager", "Auditor"],
  automation: ["AR Supervisor", "Finance Manager", "Auditor"],
  audit: ["Finance Manager", "Auditor"],
};

export interface CopilotSuggestion {
  id: string;
  question: string;
  capability: CopilotCapability;
}

/** Whether these roles may use a capability. Membership-based, like the server. */
export function hasCopilotCapability(
  roles: readonly string[],
  capability: CopilotCapability,
): boolean {
  const allowed = CAPABILITY_ROLES[capability] as readonly string[];
  return roles.some((role) => allowed.includes(role));
}

/** Questions offered when the current page suggests nothing more specific. */
const GENERAL: readonly CopilotSuggestion[] = [
  { id: "unapplied-cash", question: "What is unapplied cash?", capability: "guide" },
  {
    id: "straight-through",
    question: "How does Straight-Through mode work?",
    capability: "guide",
  },
  {
    id: "reminder-vs-delivery",
    question:
      "What is the difference between Reminder Evaluation and Delivery?",
    capability: "guide",
  },
  {
    id: "auto-allocation",
    question: "How does automatic allocation work?",
    capability: "guide",
  },
];

const BY_PAGE: Partial<Record<CopilotPage, readonly CopilotSuggestion[]>> = {
  dashboard: [
    {
      id: "dashboard-overdue",
      question: "Which invoices are overdue?",
      capability: "operational",
    },
    {
      id: "dashboard-overdue-meaning",
      question: "What does the overdue outstanding amount mean?",
      capability: "guide",
    },
    {
      id: "dashboard-attention",
      question: "Which customers need attention?",
      capability: "operational",
    },
  ],
  customers: [
    {
      id: "customers-rating",
      question: "What do the customer credit ratings mean?",
      capability: "guide",
    },
    {
      id: "customers-overdue",
      question: "Which customers need attention?",
      capability: "operational",
    },
  ],
  customer_detail: [
    {
      id: "customer-outstanding",
      question: "What is this customer's outstanding balance?",
      capability: "operational",
    },
    {
      id: "customer-open-documents",
      question: "Which documents are still open for this customer?",
      capability: "operational",
    },
    {
      id: "customer-credit",
      question: "How is available credit calculated?",
      capability: "guide",
    },
  ],
  invoices: [
    {
      id: "invoices-overdue",
      question: "Which invoices are overdue?",
      capability: "operational",
    },
    {
      id: "invoices-lifecycle",
      question: "What happens when an invoice is posted?",
      capability: "guide",
    },
  ],
  invoice_detail: [
    {
      id: "invoice-open",
      question: "Why is this invoice still open?",
      capability: "operational",
    },
    {
      id: "invoice-allocation",
      question: "Has this invoice received any allocation?",
      capability: "operational",
    },
    {
      id: "invoice-reminders",
      question: "What is the reminder history for this invoice?",
      capability: "operational",
    },
  ],
  credit_notes: [
    {
      id: "credit-note-effect",
      question: "How does a Credit Note reduce a receivable?",
      capability: "guide",
    },
  ],
  receipts: [
    {
      id: "receipts-unapplied",
      question: "What is unapplied cash?",
      capability: "guide",
    },
  ],
  receipt_detail: [
    {
      id: "receipt-unapplied",
      question: "Why is this receipt still unapplied?",
      capability: "operational",
    },
    {
      id: "receipt-allocation",
      question: "How was this receipt allocated?",
      capability: "operational",
    },
  ],
  allocations: [
    {
      id: "allocation-rules",
      question: "How does automatic allocation work?",
      capability: "guide",
    },
    {
      id: "allocation-mismatch",
      question: "Why can a receipt not be allocated to an invoice?",
      capability: "guide",
    },
  ],
  automation_overview: [
    {
      id: "automation-mode",
      question: "How does Straight-Through mode work?",
      capability: "guide",
    },
    {
      id: "automation-open-exceptions",
      question: "Which automation exceptions are still open?",
      capability: "automation",
    },
  ],
  automation_documents: [
    {
      id: "automation-document-status",
      question: "What do the document classification statuses mean?",
      capability: "guide",
    },
  ],
  automation_exceptions: [
    {
      id: "exception-cause",
      question: "Why did this exception occur?",
      capability: "automation",
    },
    {
      id: "exception-next",
      question: "What should I review next?",
      capability: "automation",
    },
  ],
  automation_mailboxes: [
    {
      id: "mailbox-sync",
      question: "What does Sync Now actually do?",
      capability: "guide",
    },
  ],
  journal_entries: [
    {
      id: "journal-source",
      question: "How are Journal Entries generated?",
      capability: "guide",
    },
  ],
  journal_entry_detail: [
    {
      id: "journal-explain",
      question: "Explain this Journal Entry.",
      capability: "automation",
    },
    {
      id: "journal-balance",
      question: "Why is this entry balanced the way it is?",
      capability: "automation",
    },
  ],
  audit_trail: [
    {
      id: "audit-scope",
      question: "What does the Audit Trail record?",
      capability: "guide",
    },
    {
      id: "audit-entity",
      question: "What audit activity exists for this record?",
      capability: "audit",
    },
  ],
  reports: [
    {
      id: "reports-base",
      question: "Why is a Base amount sometimes unavailable?",
      capability: "guide",
    },
    {
      id: "reports-aging",
      question: "How are the aging buckets calculated?",
      capability: "guide",
    },
  ],
  settings: [
    {
      id: "settings-roles",
      question: "What can each AR role do?",
      capability: "guide",
    },
  ],
};

/** How many suggestions the empty state offers before it feels like a menu. */
const MAX_SUGGESTIONS = 4;

/**
 * Suggestions for the current page and roles.
 *
 * Page-specific questions come first; general system questions fill the
 * remainder so a caller whose role blocks the live reads on this screen — a
 * System Admin, for instance — still sees useful system help rather than an
 * empty list.
 */
export function copilotSuggestions(
  page: CopilotPage,
  roles: readonly string[],
): CopilotSuggestion[] {
  const permitted = (list: readonly CopilotSuggestion[]) =>
    list.filter((item) => hasCopilotCapability(roles, item.capability));

  const specific = permitted(BY_PAGE[page] ?? []);
  const general = permitted(GENERAL).filter(
    (item) => !specific.some((existing) => existing.question === item.question),
  );
  return [...specific, ...general].slice(0, MAX_SUGGESTIONS);
}

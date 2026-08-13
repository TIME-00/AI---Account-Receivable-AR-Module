// ============================================================================
// AR Copilot — page/entity context.
//
// One centralized mapper from the real Next.js route structure to the backend's
// `CopilotContextHint` vocabulary. Two rules govern it:
//
//   1. Only mappings that correspond to a route that actually exists in this
//      application AND an entity type the backend actually supports are
//      produced. There is no `/credit-notes/[id]`, `/debit-notes/[id]`,
//      `/automation/documents/[id]`, `/automation/exceptions/[id]`, or audit
//      event detail route here, so none is invented.
//   2. A route value is a HINT, never authorization. A malformed identifier is
//      dropped rather than sent, and the backend re-proves company scope, role,
//      and customer assignment for whatever does get sent.
// ============================================================================

import {
  isValidContextEntityId,
  type CopilotContextHint,
  type CopilotEntityType,
  type CopilotPage,
} from "./contract";

/** Human label for the context chip. Never shows a raw identifier. */
export const COPILOT_PAGE_LABEL: Record<CopilotPage, string> = {
  dashboard: "Dashboard",
  customers: "Customers",
  customer_detail: "Customer Detail",
  invoices: "Invoices",
  invoice_detail: "Invoice Detail",
  credit_notes: "Credit Notes",
  debit_notes: "Debit Notes",
  receipts: "Receipts",
  receipt_detail: "Receipt Detail",
  allocations: "Allocation Wizard",
  automation_overview: "Automation",
  automation_documents: "Automation Documents",
  automation_exceptions: "Automation Exceptions",
  automation_mailboxes: "Mailboxes",
  journal_entries: "Journal Entries",
  journal_entry_detail: "Journal Entry Detail",
  audit_trail: "Audit Trail",
  reports: "Report Center",
  settings: "Settings",
};

/**
 * Static routes, longest-prefix first. `/automation/documents` must be tested
 * before `/automation`, otherwise every automation sub-screen would collapse to
 * the overview.
 */
const STATIC_ROUTES: ReadonlyArray<readonly [string, CopilotPage]> = [
  ["/automation/documents", "automation_documents"],
  ["/automation/exceptions", "automation_exceptions"],
  ["/automation/mailboxes", "automation_mailboxes"],
  ["/automation", "automation_overview"],
  ["/settings/audit-log", "audit_trail"],
  ["/settings", "settings"],
  ["/credit-notes", "credit_notes"],
  ["/journal-entries", "journal_entries"],
  ["/customers", "customers"],
  ["/invoices", "invoices"],
  ["/receipts", "receipts"],
  ["/allocations", "allocations"],
  ["/reports", "reports"],
];

/**
 * Detail routes that carry a supported entity.
 *
 * `/invoices/[id]` maps to `invoice` as its default hint. Credit and Debit
 * Notes are Invoice-family records that share this route, so the Invoice detail
 * page refines the type once it knows the real `doc_type` (see
 * `useRegisterCopilotEntity`). The backend distinguishes the three and would
 * report a mismatched hint as unavailable context, so the refinement matters.
 */
const DETAIL_ROUTES: ReadonlyArray<
  readonly [RegExp, CopilotPage, CopilotEntityType]
> = [
  [/^\/customers\/([^/]+)$/, "customer_detail", "customer"],
  [/^\/invoices\/([^/]+)$/, "invoice_detail", "invoice"],
  [/^\/receipts\/([^/]+)$/, "receipt_detail", "receipt"],
  [/^\/journal-entries\/([^/]+)$/, "journal_entry_detail", "journal_entry"],
];

/**
 * Sub-routes of a detail path that are their own screen rather than the entity
 * detail — `/invoices/new`, `/receipts/import`, `/customers/[id]/statement`.
 * These are matched by the static table or fall through to the list page, and
 * must never be read as an entity identifier.
 */
const RESERVED_SEGMENTS = new Set(["new", "import", "statement"]);

function normalizePath(pathname: string): string {
  const trimmed = pathname.split("?")[0].split("#")[0];
  if (trimmed.length > 1 && trimmed.endsWith("/")) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

/**
 * Map the current route to a page/entity hint.
 *
 * An unsupported route yields the dashboard page with no entity rather than a
 * guessed mapping, and a route segment that is not a valid identifier for its
 * entity type is dropped — the page context is still sent, the unsafe entity is
 * not.
 */
export function copilotContextForPath(pathname: string): CopilotContextHint {
  const path = normalizePath(pathname || "/");
  if (path === "/" || path === "") {
    return { page: "dashboard", entity_type: null, entity_id: null };
  }

  for (const [pattern, page, entityType] of DETAIL_ROUTES) {
    const match = pattern.exec(path);
    if (!match) continue;
    const raw = decodeSegment(match[1]);
    if (raw === null || RESERVED_SEGMENTS.has(raw)) break;
    if (!isValidContextEntityId(entityType, raw)) {
      // A malformed id is never forwarded as an entity. The list page is the
      // honest description of where the user is.
      return { page: listPageFor(page), entity_type: null, entity_id: null };
    }
    return { page, entity_type: entityType, entity_id: raw };
  }

  for (const [prefix, page] of STATIC_ROUTES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return { page, entity_type: null, entity_id: null };
    }
  }

  return { page: "dashboard", entity_type: null, entity_id: null };
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The list screen a detail page belongs to, used when its id is unusable. */
function listPageFor(page: CopilotPage): CopilotPage {
  switch (page) {
    case "customer_detail":
      return "customers";
    case "invoice_detail":
      return "invoices";
    case "receipt_detail":
      return "receipts";
    case "journal_entry_detail":
      return "journal_entries";
    default:
      return page;
  }
}

/**
 * A refinement published by a detail page: the entity type it actually shows,
 * plus the display number already on screen.
 *
 * The number exists so the context chip can name the record without a second
 * fetch and without exposing a raw UUID.
 */
export interface CopilotEntityRegistration {
  entityType: CopilotEntityType;
  entityId: string;
  displayNumber: string | null;
}

/**
 * Apply a page's registration to the route-derived hint.
 *
 * The registration is honoured only when it concerns the same record the route
 * already identifies, so a stale registration left behind by a previous screen
 * can never relabel the current one.
 */
export function applyEntityRegistration(
  hint: CopilotContextHint,
  registration: CopilotEntityRegistration | null,
): CopilotContextHint {
  if (
    !registration || hint.entity_id === null ||
    registration.entityId !== hint.entity_id ||
    !isValidContextEntityId(registration.entityType, registration.entityId)
  ) {
    return hint;
  }
  return { ...hint, entity_type: registration.entityType };
}

/**
 * The chip text for the current context.
 *
 * Prefers a known display number ("INV-202608-00012"); otherwise names the
 * screen. A raw identifier is never shown.
 */
export function copilotContextLabel(
  hint: CopilotContextHint,
  displayNumber: string | null,
): string {
  if (hint.entity_id && displayNumber) return displayNumber;
  return COPILOT_PAGE_LABEL[hint.page];
}

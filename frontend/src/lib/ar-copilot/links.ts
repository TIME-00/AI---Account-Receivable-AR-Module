// ============================================================================
// AR Copilot — safe internal navigation.
//
// The backend already constructs every `href` from a fixed server-owned table
// and the model cannot supply one. This module re-derives the same result on
// the client anyway: a navigation target is the one part of a Copilot answer
// that acts on the user's behalf, so it is validated on both sides.
//
// The check is destination-aware rather than a flat path allow-list. A link is
// accepted only when its `href` is exactly what the server would build for that
// `entity_type` and `entity_id`, so a well-formed path attached to the wrong
// entity is still rejected.
// ============================================================================

import {
  isAuditEventId,
  isUuid,
  type CopilotLink,
  type CopilotLinkEntityType,
} from "./contract";

/**
 * Entity detail routes, mirroring `LINK_PATHS` in
 * `backend/supabase/functions/ar-copilot/read-service.ts`.
 *
 * Credit Notes and Debit Notes are Invoice-family records and share the
 * Invoice detail route — that is the real page in this application, matching
 * the same decision already made for Journal source links.
 */
const ENTITY_DETAIL_PREFIX: Partial<Record<CopilotLinkEntityType, string>> = {
  customer: "/customers/",
  invoice: "/invoices/",
  credit_note: "/invoices/",
  debit_note: "/invoices/",
  receipt: "/receipts/",
  journal_entry: "/journal-entries/",
};

/**
 * Entity types that resolve to a fixed screen because this application has no
 * per-record detail route for them.
 */
const ENTITY_FIXED_PATH: Partial<Record<CopilotLinkEntityType, string>> = {
  automation_document: "/automation/documents",
  automation_exception: "/automation/exceptions",
  audit_event: "/settings/audit-log",
};

/**
 * Screens the curated system guide may point at, mirroring the `suggested_path`
 * values in `backend/supabase/functions/ar-copilot/knowledge.ts`. Every entry
 * is a real route in this application.
 */
const GUIDE_PATHS: ReadonlySet<string> = new Set([
  "/invoices",
  "/invoices/import",
  "/receipts",
  "/credit-notes",
  "/allocations",
  "/automation",
  "/automation/exceptions",
  "/automation/mailboxes",
  "/journal-entries",
  "/reports",
  "/settings/audit-log",
  "/settings/roles",
]);

/**
 * Anything outside this set makes the href unusable as an internal route.
 * Restricting to a positive character class is stronger than blocking known-bad
 * characters: whitespace, control bytes, and non-ASCII lookalikes never reach
 * the structural comparison at all.
 */
const SAFE_HREF_CHARACTERS = /^[A-Za-z0-9/_-]+$/;

/**
 * Shapes that must never be treated as an internal route, checked before any
 * structural parsing. `//host` is protocol-relative and leaves the application;
 * a colon would admit `javascript:`, `data:`, `mailto:`, and `http:`.
 */
function hasUnsafeShape(href: string): boolean {
  return (
    href.length === 0 ||
    href.length > 300 ||
    !href.startsWith("/") ||
    href.startsWith("//") ||
    href.includes("..") ||
    !SAFE_HREF_CHARACTERS.test(href)
  );
}

/**
 * Whether a Copilot link may be rendered as a navigation control.
 *
 * Rejects external (`http://`, `https://`, `//host`), `javascript:`, `data:`,
 * and `mailto:` destinations, unknown routes, malformed identifiers, and any
 * path that does not match the destination the server would build for that
 * entity. A link that fails is not rendered as clickable anywhere.
 */
export function isSafeCopilotLink(link: CopilotLink): boolean {
  const { href, entity_type: type, entity_id: id } = link;
  if (hasUnsafeShape(href)) return false;

  const prefix = ENTITY_DETAIL_PREFIX[type];
  if (prefix) {
    return isUuid(id) && href === `${prefix}${id}`;
  }

  const fixed = ENTITY_FIXED_PATH[type];
  if (fixed) {
    // A fixed-screen link still proves its identifier: an `audit_event` uses
    // the composite `source:uuid` form, the automation entities use a UUID.
    // The colon in an audit event id lives in `entity_id`, never in the href.
    const idValid = type === "audit_event" ? isAuditEventId(id) : isUuid(id);
    return idValid && href === fixed;
  }

  if (type === "system_guide") {
    return GUIDE_PATHS.has(href);
  }

  return false;
}

/** Keep only the links that are safe to navigate to. */
export function safeCopilotLinks(links: readonly CopilotLink[]): CopilotLink[] {
  return links.filter(isSafeCopilotLink);
}

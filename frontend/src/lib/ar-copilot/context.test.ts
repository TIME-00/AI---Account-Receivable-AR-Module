// ============================================================================
// AR Copilot — route to page/entity context.
//
// The mapper is the only place that turns a URL into something the backend
// treats as a record reference, so these tests pin two behaviours: the mapping
// covers the routes this application really has, and a route it cannot map
// safely degrades to page context rather than sending a guessed entity.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  applyEntityRegistration,
  copilotContextForPath,
  copilotContextLabel,
  COPILOT_PAGE_LABEL,
} from "./context";
import { COPILOT_PAGES } from "./contract";

const ID = "11111111-2222-4333-8444-555555555555";

describe("page mapping", () => {
  it("maps the dashboard root", () => {
    expect(copilotContextForPath("/")).toEqual({
      page: "dashboard",
      entity_type: null,
      entity_id: null,
    });
  });

  it("maps customer detail", () => {
    expect(copilotContextForPath(`/customers/${ID}`)).toEqual({
      page: "customer_detail",
      entity_type: "customer",
      entity_id: ID,
    });
  });

  it("maps invoice detail", () => {
    expect(copilotContextForPath(`/invoices/${ID}`)).toEqual({
      page: "invoice_detail",
      entity_type: "invoice",
      entity_id: ID,
    });
  });

  it("maps receipt detail", () => {
    expect(copilotContextForPath(`/receipts/${ID}`)).toEqual({
      page: "receipt_detail",
      entity_type: "receipt",
      entity_id: ID,
    });
  });

  it("maps journal entry detail", () => {
    expect(copilotContextForPath(`/journal-entries/${ID}`)).toEqual({
      page: "journal_entry_detail",
      entity_type: "journal_entry",
      entity_id: ID,
    });
  });

  it("maps the automation document and exception screens without an entity", () => {
    // These are list screens: this application has no per-record detail route
    // for either, so no entity is invented for them.
    expect(copilotContextForPath("/automation/documents")).toEqual({
      page: "automation_documents",
      entity_type: null,
      entity_id: null,
    });
    expect(copilotContextForPath("/automation/exceptions")).toEqual({
      page: "automation_exceptions",
      entity_type: null,
      entity_id: null,
    });
  });

  it("maps the remaining list and settings screens", () => {
    const cases: Array<[string, string]> = [
      ["/customers", "customers"],
      ["/invoices", "invoices"],
      ["/credit-notes", "credit_notes"],
      ["/receipts", "receipts"],
      ["/allocations", "allocations"],
      ["/automation", "automation_overview"],
      ["/automation/mailboxes", "automation_mailboxes"],
      ["/journal-entries", "journal_entries"],
      ["/reports", "reports"],
      ["/reports/aging", "reports"],
      ["/settings", "settings"],
      ["/settings/roles", "settings"],
      ["/settings/audit-log", "audit_trail"],
    ];
    for (const [path, page] of cases) {
      expect(copilotContextForPath(path).page).toBe(page);
    }
  });

  it("only ever emits a page from the backend vocabulary", () => {
    for (
      const path of [
        "/",
        "/profile",
        "/notifications",
        "/invoices/new",
        `/customers/${ID}/statement`,
        "/automation/runs",
      ]
    ) {
      expect(COPILOT_PAGES).toContain(copilotContextForPath(path).page);
    }
  });
});

describe("unsafe and unsupported routes", () => {
  it("sends page context without an entity when the identifier is malformed", () => {
    expect(copilotContextForPath("/invoices/not-a-uuid")).toEqual({
      page: "invoices",
      entity_type: null,
      entity_id: null,
    });
    expect(copilotContextForPath("/customers/1%20OR%201=1")).toEqual({
      page: "customers",
      entity_type: null,
      entity_id: null,
    });
  });

  it("never reads a sub-route as an entity identifier", () => {
    for (
      const [path, page] of [
        ["/invoices/new", "invoices"],
        ["/invoices/import", "invoices"],
        ["/receipts/new", "receipts"],
        ["/receipts/import", "receipts"],
      ] as const
    ) {
      const hint = copilotContextForPath(path);
      expect(hint.page).toBe(page);
      expect(hint.entity_id).toBeNull();
    }
  });

  it("falls back to page context for a route the vocabulary cannot express", () => {
    const hint = copilotContextForPath("/profile");
    expect(hint.entity_type).toBeNull();
    expect(hint.entity_id).toBeNull();
  });

  it("ignores a trailing slash, query string, and fragment", () => {
    expect(copilotContextForPath(`/invoices/${ID}/`).entity_id).toBe(ID);
    expect(copilotContextForPath("/receipts/?page=2").page).toBe("receipts");
    expect(copilotContextForPath("/reports#top").page).toBe("reports");
  });

  it("does not throw on a malformed percent-encoded segment", () => {
    expect(() => copilotContextForPath("/invoices/%E0%A4%A")).not.toThrow();
    expect(copilotContextForPath("/invoices/%E0%A4%A").entity_id).toBeNull();
  });
});

describe("detail-page entity refinement", () => {
  const hint = copilotContextForPath(`/invoices/${ID}`);

  it("lets the Invoice route resolve to a Credit Note", () => {
    // One route renders all three Invoice-family documents; the backend treats
    // them as distinct context types and would report a mismatched hint as
    // unavailable context.
    const refined = applyEntityRegistration(hint, {
      entityType: "credit_note",
      entityId: ID,
      displayNumber: "CN-202608-00003",
    });
    expect(refined.entity_type).toBe("credit_note");
    expect(refined.entity_id).toBe(ID);
    expect(refined.page).toBe("invoice_detail");
  });

  it("ignores a registration for a different record", () => {
    const stale = applyEntityRegistration(hint, {
      entityType: "credit_note",
      entityId: "99999999-8888-4777-8666-555555555555",
      displayNumber: "CN-1",
    });
    expect(stale.entity_type).toBe("invoice");
  });

  it("ignores a registration with a malformed identifier", () => {
    expect(
      applyEntityRegistration(hint, {
        entityType: "credit_note",
        entityId: "nonsense",
        displayNumber: null,
      }).entity_type,
    ).toBe("invoice");
  });

  it("ignores a registration when the route carries no entity", () => {
    const listHint = copilotContextForPath("/invoices");
    expect(
      applyEntityRegistration(listHint, {
        entityType: "invoice",
        entityId: ID,
        displayNumber: "INV-1",
      }),
    ).toEqual(listHint);
  });
});

describe("context label", () => {
  it("prefers the display number the page already has", () => {
    expect(
      copilotContextLabel(copilotContextForPath(`/invoices/${ID}`), "INV-202608-00012"),
    ).toBe("INV-202608-00012");
  });

  it("names the screen rather than exposing a raw identifier", () => {
    const label = copilotContextLabel(
      copilotContextForPath(`/invoices/${ID}`),
      null,
    );
    expect(label).toBe("Invoice Detail");
    expect(label).not.toContain(ID);
  });

  it("has a human label for every page in the vocabulary", () => {
    for (const page of COPILOT_PAGES) {
      expect(COPILOT_PAGE_LABEL[page]).toBeTruthy();
    }
  });
});

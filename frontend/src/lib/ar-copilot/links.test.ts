// ============================================================================
// AR Copilot — safe internal navigation.
//
// A link is the one part of an answer that acts on the user's behalf, so this
// suite is written adversarially: it asserts what CANNOT be rendered, not just
// what can.
// ============================================================================

import { describe, expect, it } from "vitest";
import { isSafeCopilotLink, safeCopilotLinks } from "./links";
import type { CopilotLink, CopilotLinkEntityType } from "./contract";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "99999999-8888-4777-8666-555555555555";

const link = (overrides: Partial<CopilotLink> = {}): CopilotLink => ({
  label: "View document",
  entity_type: "invoice",
  entity_id: ID,
  href: `/invoices/${ID}`,
  ...overrides,
});

describe("supported internal destinations", () => {
  const cases: Array<[CopilotLinkEntityType, string]> = [
    ["customer", `/customers/${ID}`],
    ["invoice", `/invoices/${ID}`],
    ["credit_note", `/invoices/${ID}`],
    ["debit_note", `/invoices/${ID}`],
    ["receipt", `/receipts/${ID}`],
    ["journal_entry", `/journal-entries/${ID}`],
  ];

  it.each(cases)("accepts the %s detail route", (entity_type, href) => {
    expect(isSafeCopilotLink(link({ entity_type, href }))).toBe(true);
  });

  it("accepts the fixed screens used where no detail route exists", () => {
    expect(
      isSafeCopilotLink(
        link({
          entity_type: "automation_exception",
          href: "/automation/exceptions",
        }),
      ),
    ).toBe(true);
    expect(
      isSafeCopilotLink(
        link({
          entity_type: "automation_document",
          href: "/automation/documents",
        }),
      ),
    ).toBe(true);
    expect(
      isSafeCopilotLink(
        link({
          entity_type: "audit_event",
          entity_id: `invoice:${ID}`,
          href: "/settings/audit-log",
        }),
      ),
    ).toBe(true);
  });

  it("accepts curated system-guide screens", () => {
    for (
      const href of [
        "/invoices",
        "/invoices/import",
        "/receipts",
        "/credit-notes",
        "/allocations",
        "/automation",
        "/automation/mailboxes",
        "/journal-entries",
        "/reports",
        "/settings/roles",
      ]
    ) {
      expect(
        isSafeCopilotLink(
          link({ entity_type: "system_guide", entity_id: "invoice-lifecycle", href }),
        ),
      ).toBe(true);
    }
  });
});

describe("external and scheme-bearing destinations are refused", () => {
  it.each([
    ["http", "http://evil.example.com/invoices"],
    ["https", "https://evil.example.com/invoices"],
    ["protocol-relative", "//evil.example.com/invoices"],
    ["javascript", "javascript:alert(1)"],
    ["javascript with whitespace", " javascript:alert(1)"],
    ["data", "data:text/html;base64,PHNjcmlwdD4="],
    ["mailto", "mailto:finance@example.com"],
    ["vbscript", "vbscript:msgbox(1)"],
  ])("refuses a %s destination", (_name, href) => {
    expect(isSafeCopilotLink(link({ href }))).toBe(false);
  });

  it("refuses an absolute URL even when it points at this application", () => {
    expect(
      isSafeCopilotLink(link({ href: `https://ar.example.com/invoices/${ID}` })),
    ).toBe(false);
  });
});

describe("malformed and mismatched destinations are refused", () => {
  it("refuses a relative path that does not start at the application root", () => {
    expect(isSafeCopilotLink(link({ href: `invoices/${ID}` }))).toBe(false);
  });

  it("refuses path traversal", () => {
    expect(isSafeCopilotLink(link({ href: `/invoices/../../etc/passwd` }))).toBe(
      false,
    );
  });

  it("refuses a backslash, which some browsers normalise to a slash", () => {
    expect(isSafeCopilotLink(link({ href: `\\\\evil.example.com` }))).toBe(false);
  });

  it("refuses a query string or fragment", () => {
    expect(isSafeCopilotLink(link({ href: `/invoices/${ID}?next=/admin` }))).toBe(
      false,
    );
    expect(isSafeCopilotLink(link({ href: `/invoices/${ID}#x` }))).toBe(false);
  });

  it("refuses an unknown route", () => {
    expect(
      isSafeCopilotLink(
        link({ entity_type: "system_guide", entity_id: "x", href: "/admin/keys" }),
      ),
    ).toBe(false);
  });

  it("refuses a well-formed path attached to a different record", () => {
    expect(isSafeCopilotLink(link({ href: `/invoices/${OTHER_ID}` }))).toBe(
      false,
    );
  });

  it("refuses a well-formed path attached to the wrong entity type", () => {
    expect(
      isSafeCopilotLink(link({ entity_type: "receipt", href: `/invoices/${ID}` })),
    ).toBe(false);
  });

  it("refuses a detail route whose identifier is not a UUID", () => {
    expect(
      isSafeCopilotLink(
        link({ entity_id: "1 OR 1=1", href: "/invoices/1 OR 1=1" }),
      ),
    ).toBe(false);
  });

  it("refuses an audit link whose identifier is not the composite source form", () => {
    expect(
      isSafeCopilotLink(
        link({
          entity_type: "audit_event",
          entity_id: ID,
          href: "/settings/audit-log",
        }),
      ),
    ).toBe(false);
  });
});

describe("filtering a list", () => {
  it("keeps the safe links and silently discards the rest", () => {
    const result = safeCopilotLinks([
      link(),
      link({ href: "https://evil.example.com" }),
      link({ entity_type: "receipt", href: `/receipts/${OTHER_ID}`, entity_id: OTHER_ID }),
      link({ href: "javascript:alert(1)" }),
    ]);
    expect(result.map((item) => item.href)).toEqual([
      `/invoices/${ID}`,
      `/receipts/${OTHER_ID}`,
    ]);
  });
});

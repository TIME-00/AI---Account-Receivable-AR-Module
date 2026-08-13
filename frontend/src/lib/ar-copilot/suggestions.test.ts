// ============================================================================
// AR Copilot — suggested questions and role capability.
//
// Suggestions are UX, not security. What these tests protect is the honesty of
// the offer: a question the caller's role cannot have answered should not be
// dangled in front of them, and every role should still be offered something
// useful rather than an empty panel.
//
// The capability sets mirror the role gates in
// `backend/supabase/functions/ar-copilot/tools.ts`.
// ============================================================================

import { describe, expect, it } from "vitest";
import { copilotSuggestions, hasCopilotCapability } from "./suggestions";
import { COPILOT_PAGES } from "./contract";

const CLERK = ["AR Clerk"];
const SUPERVISOR = ["AR Supervisor"];
const FINANCE = ["Finance Manager"];
const AUDITOR = ["Auditor"];
const ADMIN = ["System Admin"];

describe("capability sets mirror the backend tool gates", () => {
  it("gives every role the curated system guide", () => {
    for (const roles of [CLERK, SUPERVISOR, FINANCE, AUDITOR, ADMIN]) {
      expect(hasCopilotCapability(roles, "guide")).toBe(true);
    }
  });

  it("excludes System Admin from operational AR data", () => {
    expect(hasCopilotCapability(ADMIN, "operational")).toBe(false);
    expect(hasCopilotCapability(ADMIN, "automation")).toBe(false);
    expect(hasCopilotCapability(ADMIN, "audit")).toBe(false);
  });

  it("gives AR Clerk operational AR but not Automation, Journal, or Audit", () => {
    expect(hasCopilotCapability(CLERK, "operational")).toBe(true);
    expect(hasCopilotCapability(CLERK, "automation")).toBe(false);
    expect(hasCopilotCapability(CLERK, "audit")).toBe(false);
  });

  it("gives AR Supervisor Automation and Journal but not Audit", () => {
    expect(hasCopilotCapability(SUPERVISOR, "automation")).toBe(true);
    expect(hasCopilotCapability(SUPERVISOR, "audit")).toBe(false);
  });

  it("gives Finance Manager and Auditor the full read set", () => {
    for (const roles of [FINANCE, AUDITOR]) {
      expect(hasCopilotCapability(roles, "operational")).toBe(true);
      expect(hasCopilotCapability(roles, "automation")).toBe(true);
      expect(hasCopilotCapability(roles, "audit")).toBe(true);
    }
  });

  it("evaluates multi-role membership rather than a single highest role", () => {
    // Matching the backend: System Admin + Finance Manager is authorized
    // through the Finance Manager membership, not blocked by the admin one.
    expect(hasCopilotCapability(["System Admin", "Finance Manager"], "audit"))
      .toBe(true);
  });

  it("treats an unresolved role list as having only nothing", () => {
    expect(hasCopilotCapability([], "guide")).toBe(false);
    expect(hasCopilotCapability([], "operational")).toBe(false);
  });
});

describe("page suggestions", () => {
  it("offers page-specific questions on the dashboard", () => {
    const questions = copilotSuggestions("dashboard", FINANCE).map(
      (item) => item.question,
    );
    expect(questions).toContain("Which invoices are overdue?");
    expect(questions).toContain("Which customers need attention?");
  });

  it("offers record questions on an invoice", () => {
    const questions = copilotSuggestions("invoice_detail", CLERK).map(
      (item) => item.question,
    );
    expect(questions).toContain("Why is this invoice still open?");
    expect(questions).toContain("Has this invoice received any allocation?");
  });

  it("offers record questions on a receipt", () => {
    const questions = copilotSuggestions("receipt_detail", CLERK).map(
      (item) => item.question,
    );
    expect(questions).toContain("Why is this receipt still unapplied?");
    expect(questions).toContain("How was this receipt allocated?");
  });

  it("offers exception triage questions to a supervisor", () => {
    const questions = copilotSuggestions("automation_exceptions", SUPERVISOR)
      .map((item) => item.question);
    expect(questions).toContain("Why did this exception occur?");
    expect(questions).toContain("What should I review next?");
  });

  it("offers the journal explanation to a journal reader", () => {
    expect(
      copilotSuggestions("journal_entry_detail", FINANCE).map((i) => i.question),
    ).toContain("Explain this Journal Entry.");
  });

  it("never offers more than a short list", () => {
    for (const page of COPILOT_PAGES) {
      expect(copilotSuggestions(page, FINANCE).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("role gating of suggestions", () => {
  it("does not offer an Audit question to an AR Clerk", () => {
    const clerk = copilotSuggestions("audit_trail", CLERK);
    expect(clerk.some((item) => item.capability === "audit")).toBe(false);
    // The screen still offers the system-guide explanation of what the Audit
    // Trail is, which the Clerk can genuinely have answered.
    expect(clerk.length).toBeGreaterThan(0);
  });

  it("does not offer an Automation or Journal question to an AR Clerk", () => {
    for (const page of ["automation_exceptions", "journal_entry_detail"] as const) {
      expect(
        copilotSuggestions(page, CLERK).some(
          (item) => item.capability === "automation",
        ),
      ).toBe(false);
    }
  });

  it("does not offer an Audit question to an AR Supervisor", () => {
    expect(
      copilotSuggestions("audit_trail", SUPERVISOR).some(
        (item) => item.capability === "audit",
      ),
    ).toBe(false);
  });

  it("never offers a financial-data question to a System Admin", () => {
    for (const page of COPILOT_PAGES) {
      const offered = copilotSuggestions(page, ADMIN);
      expect(offered.every((item) => item.capability === "guide")).toBe(true);
    }
  });

  it("still offers a System Admin useful system help on every screen", () => {
    // The Copilot entry has to remain worthwhile for a configuration-only role:
    // it can answer how the system works, just not what it currently holds.
    for (const page of COPILOT_PAGES) {
      expect(copilotSuggestions(page, ADMIN).length).toBeGreaterThan(0);
    }
  });

  it("offers authorized operational questions to a Finance Manager", () => {
    expect(
      copilotSuggestions("dashboard", FINANCE).some(
        (item) => item.capability === "operational",
      ),
    ).toBe(true);
  });

  it("offers read-only evidence questions to an Auditor", () => {
    expect(
      copilotSuggestions("dashboard", AUDITOR).some(
        (item) => item.capability === "operational",
      ),
    ).toBe(true);
    expect(
      copilotSuggestions("audit_trail", AUDITOR).some(
        (item) => item.capability === "audit",
      ),
    ).toBe(true);
  });

  it("offers nothing before the role context resolves", () => {
    // `useUserRole` returns an empty role list while loading and on error. An
    // empty suggestion list is the conservative direction; the composer still
    // works, so nothing is blocked.
    expect(copilotSuggestions("dashboard", [])).toHaveLength(0);
  });

  it("has a unique id for every suggestion it can produce", () => {
    const seen = new Map<string, string>();
    for (const page of COPILOT_PAGES) {
      for (const item of copilotSuggestions(page, FINANCE)) {
        const existing = seen.get(item.id);
        if (existing) expect(existing).toBe(item.question);
        seen.set(item.id, item.question);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});

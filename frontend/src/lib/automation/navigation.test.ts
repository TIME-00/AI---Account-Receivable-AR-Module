// ============================================================================
// Gate E — role-aware navigation policy tests. Proves System Admin is
// configuration-only and each role sees/opens exactly the frozen tab set.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  canAccessAutomationArea,
  canAccessAutomationPath,
  hasAutomationReadCapability,
  matchAutomationTab,
  visibleAutomationTabs,
} from "./navigation";

function labels(roles: string[]) {
  return visibleAutomationTabs(roles).map((t) => t.label);
}

describe("System Admin is configuration-only", () => {
  it("sees only Settings, Mailboxes, and Sales Representatives", () => {
    const seen = labels(["System Admin"]);
    expect(seen).toEqual(
      expect.arrayContaining(["Settings", "Mailboxes", "Sales Representatives"]),
    );
    expect(seen).not.toContain("Overview");
    expect(seen).not.toContain("Runs");
    expect(seen).not.toContain("Documents");
    expect(seen).not.toContain("Commands");
    expect(seen).not.toContain("Exceptions");
  });

  it("cannot open operational pages by direct URL", () => {
    expect(canAccessAutomationPath(["System Admin"], "/automation")).toBe(false);
    expect(canAccessAutomationPath(["System Admin"], "/automation/runs")).toBe(false);
    expect(canAccessAutomationPath(["System Admin"], "/automation/exceptions")).toBe(false);
    expect(canAccessAutomationPath(["System Admin"], "/automation/settings")).toBe(true);
    expect(canAccessAutomationPath(["System Admin"], "/automation/mailboxes")).toBe(true);
  });
});

describe("operational roles", () => {
  it("Finance Manager sees every tab", () => {
    const seen = labels(["Finance Manager"]);
    expect(seen).toEqual(
      expect.arrayContaining([
        "Overview",
        "Runs",
        "Documents",
        "Commands",
        "Exceptions",
        "Mailboxes",
        "Sales Representatives",
        "Settings",
      ]),
    );
  });

  it("AR Supervisor sees operational tabs but not Mailboxes", () => {
    const seen = labels(["AR Supervisor"]);
    expect(seen).toContain("Overview");
    expect(seen).toContain("Exceptions");
    expect(seen).not.toContain("Mailboxes");
  });

  it("Auditor can read every listed tab (read-only elsewhere)", () => {
    const seen = labels(["Auditor"]);
    expect(seen).toContain("Overview");
    expect(seen).toContain("Mailboxes");
    expect(seen).toContain("Settings");
  });

  it("AR Clerk sees only Settings and Sales Representatives", () => {
    const seen = labels(["AR Clerk"]);
    expect(seen).toEqual(
      expect.arrayContaining(["Settings", "Sales Representatives"]),
    );
    expect(seen).not.toContain("Overview");
    expect(seen).not.toContain("Mailboxes");
  });
});

describe("read-capability matrix (detail-page request gating)", () => {
  it("operational reads exclude BOTH System Admin and AR Clerk", () => {
    for (const cap of ["overview", "reminders", "reminderAttempts", "audit"] as const) {
      expect(hasAutomationReadCapability(["AR Supervisor"], cap)).toBe(true);
      expect(hasAutomationReadCapability(["Finance Manager"], cap)).toBe(true);
      expect(hasAutomationReadCapability(["Auditor"], cap)).toBe(true);
      expect(hasAutomationReadCapability(["System Admin"], cap)).toBe(false);
      expect(hasAutomationReadCapability(["AR Clerk"], cap)).toBe(false);
    }
  });

  it("customer assignment read includes AR Clerk but excludes System Admin", () => {
    expect(hasAutomationReadCapability(["AR Clerk"], "customerAssignment")).toBe(true);
    expect(hasAutomationReadCapability(["Auditor"], "customerAssignment")).toBe(true);
    expect(hasAutomationReadCapability(["System Admin"], "customerAssignment")).toBe(false);
  });

  it("settings read includes System Admin and AR Clerk", () => {
    expect(hasAutomationReadCapability(["System Admin"], "settings")).toBe(true);
    expect(hasAutomationReadCapability(["AR Clerk"], "settings")).toBe(true);
  });

  it("an unresolved/empty role set has no read capability", () => {
    expect(hasAutomationReadCapability([], "overview")).toBe(false);
    expect(hasAutomationReadCapability([], "customerAssignment")).toBe(false);
  });
});

describe("area access + tab matching", () => {
  it("an unknown/empty role has no automation area", () => {
    expect(canAccessAutomationArea([])).toBe(false);
  });

  it("matches the most specific tab for a nested path", () => {
    expect(matchAutomationTab("/automation/runs")?.label).toBe("Runs");
    expect(matchAutomationTab("/automation")?.label).toBe("Overview");
  });
});

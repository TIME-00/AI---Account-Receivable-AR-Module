// ============================================================================
// Sidebar — role gating must survive the theme/motion refactor.
//
// The Journal and Audit destinations are role-gated UX. Restyling the
// navigation is exactly the kind of change that can quietly drop a filter, so
// the gate is asserted directly against the shipped component, alongside the
// motion and token contracts the modernization introduced.
// ============================================================================

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@/types";

let currentRoles: UserRole[] = [];
vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({ roles: currentRoles }),
}));

let currentPath = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
}));

const { Sidebar } = await import("@/components/layout/sidebar");

function renderSidebar(roles: UserRole[], pathname = "/") {
  currentRoles = roles;
  currentPath = pathname;
  return render(<Sidebar />);
}

const linkNames = () =>
  screen.getAllByRole("link").map((a) => a.textContent?.trim());

beforeEach(() => {
  currentRoles = [];
  currentPath = "/";
});

// ── Role gating ─────────────────────────────────────────────────────────────

describe("Journal role gating", () => {
  it.each<UserRole>(["AR Supervisor", "Finance Manager", "Auditor"])(
    "shows Journal Entries to %s",
    (role) => {
      renderSidebar([role]);
      expect(screen.getByRole("link", { name: /Journal Entries/ })).toBeInTheDocument();
    },
  );

  it("hides Journal Entries from AR Clerk", () => {
    renderSidebar(["AR Clerk"]);
    expect(screen.queryByRole("link", { name: /Journal Entries/ })).toBeNull();
  });

  it("hides Journal Entries from System Admin", () => {
    renderSidebar(["System Admin"]);
    expect(screen.queryByRole("link", { name: /Journal Entries/ })).toBeNull();
  });
});

describe("Audit role gating", () => {
  it.each<UserRole>(["Finance Manager", "Auditor"])(
    "shows Audit Trail to %s",
    (role) => {
      renderSidebar([role]);
      expect(screen.getByRole("link", { name: /Audit Trail/ })).toBeInTheDocument();
    },
  );

  it("hides Audit Trail from AR Supervisor, who may see Journal but not Audit", () => {
    renderSidebar(["AR Supervisor"]);
    expect(screen.getByRole("link", { name: /Journal Entries/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Audit Trail/ })).toBeNull();
  });

  it("hides Audit Trail from AR Clerk", () => {
    renderSidebar(["AR Clerk"]);
    expect(screen.queryByRole("link", { name: /Audit Trail/ })).toBeNull();
  });
});

describe("multi-role and unresolved users", () => {
  it("shows the union of gated destinations for a multi-role user", () => {
    renderSidebar(["AR Clerk", "Auditor"]);
    expect(screen.getByRole("link", { name: /Journal Entries/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Audit Trail/ })).toBeInTheDocument();
  });

  it("hides both gated destinations while the authenticated context is unresolved", () => {
    renderSidebar([]);
    expect(screen.queryByRole("link", { name: /Journal Entries/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Audit Trail/ })).toBeNull();
  });
});

describe("ungated navigation is preserved", () => {
  const ALWAYS_VISIBLE = [
    "Dashboard", "Customers", "Invoices", "Credit Notes", "Receipts",
    "Allocation Wizard", "Automation", "Report Center", "Settings", "Roles",
  ];

  it.each(ALWAYS_VISIBLE)("keeps %s available to an AR Clerk", (label) => {
    renderSidebar(["AR Clerk"]);
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  });

  it("keeps every ungated route present even with no resolved role", () => {
    renderSidebar([]);
    for (const label of ALWAYS_VISIBLE) {
      expect(linkNames()).toContain(label);
    }
  });
});

// ── Theme + motion contract ─────────────────────────────────────────────────

describe("navigation theming and motion", () => {
  it("paints from navigation tokens rather than fixed dark hexes", () => {
    const { container } = renderSidebar(["Finance Manager"]);
    const aside = container.querySelector("aside")!;
    expect(aside.className).toContain("bg-nav-bg");
    expect(aside.className).toContain("border-nav-border");
  });

  it("marks the active destination for both styling and assistive tech", () => {
    renderSidebar(["AR Clerk"], "/invoices");
    const active = screen.getByRole("link", { name: "Invoices" });
    expect(active).toHaveAttribute("data-active", "true");
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.className).toContain("bg-nav-active");
  });

  it("leaves inactive destinations unmarked and hover-styled", () => {
    renderSidebar(["AR Clerk"], "/invoices");
    const inactive = screen.getByRole("link", { name: "Customers" });
    expect(inactive).toHaveAttribute("data-active", "false");
    expect(inactive).not.toHaveAttribute("aria-current");
    expect(inactive.className).toContain("hover:bg-nav-hover");
  });

  it("gives every destination the shared press and active-edge primitives", () => {
    renderSidebar(["Finance Manager"]);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("ds-brand-edge");
      expect(link.className).toContain("ds-press");
    }
  });

  it("labels the collapse control and reports its state", () => {
    renderSidebar(["AR Clerk"]);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("does not resurrect a hard-coded slate sidebar palette", () => {
    const { container } = renderSidebar(["Finance Manager"]);
    const markup = container.innerHTML;
    expect(markup).not.toContain("bg-sidebar-bg");
    expect(markup).not.toContain("text-sidebar-text");
  });
});

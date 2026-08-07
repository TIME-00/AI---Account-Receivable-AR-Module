// Gate E — permission-denied + status surfaces (Blocker 2 role copy).
//
// The permission-denied surface must state the truth for the specific section
// rather than one inaccurate universal role list, and must never leak a raw 403
// body. Error/loading surfaces must be announced to assistive technology.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AutomationPermissionDenied,
  AutomationError,
  AutomationLoading,
} from "./states";

describe("AutomationPermissionDenied role copy", () => {
  it("renders neutral default copy (no single false universal role list)", () => {
    render(<AutomationPermissionDenied />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/do not have permission to access this Automation section/i),
    ).toBeInTheDocument();
    // The old inaccurate claim (monitoring available to a single flat list that
    // includes System Admin) must not appear by default.
    expect(
      screen.queryByText(
        /available to AR Supervisor,\s*Finance Manager,\s*Auditor,\s*and System Admin/i,
      ),
    ).toBeNull();
  });

  it("renders caller-supplied, section-specific copy", () => {
    render(
      <AutomationPermissionDenied
        title="No access"
        message="System Admin access is configuration-only; operational monitoring is for AR Supervisor, Finance Manager, and Auditor."
      />,
    );
    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(
      screen.getByText(/System Admin access is configuration-only/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/operational monitoring is for AR Supervisor, Finance Manager, and Auditor/i),
    ).toBeInTheDocument();
  });

  it("does not render any raw HTTP status text", () => {
    render(<AutomationPermissionDenied message="This section is not available for your role." />);
    expect(screen.queryByText(/\b40[13]\b/)).toBeNull();
  });
});

describe("Automation status surfaces are announced", () => {
  it("AutomationError uses role=alert and shows a safe message", () => {
    render(<AutomationError message="This information could not be loaded." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This information could not be loaded.");
  });

  it("AutomationLoading is a polite live status", () => {
    render(<AutomationLoading label="Checking access" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});

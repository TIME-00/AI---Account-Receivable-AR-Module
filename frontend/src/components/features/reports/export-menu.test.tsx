import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportOversizeError, ExportValidationError } from "@/lib/export";
import type { UseReportExportResult } from "@/hooks/use-report-export";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let hookState: UseReportExportResult;
const run = vi.fn();
const reset = vi.fn();

vi.mock("@/hooks/use-report-export", () => ({
  useReportExport: () => hookState,
}));

import { ExportMenu } from "./export-menu";

function baseState(overrides: Partial<UseReportExportResult> = {}): UseReportExportResult {
  return {
    status: "idle",
    isReady: true,
    isPending: false,
    activeFormat: null,
    error: null,
    run,
    reset,
    ...overrides,
  };
}

beforeEach(() => {
  run.mockReset();
  reset.mockReset();
  hookState = baseState();
});

afterEach(() => vi.clearAllMocks());

describe("ExportMenu", () => {
  it("opens the format menu and exports as PDF with the page filters", async () => {
    const user = userEvent.setup();
    render(<ExportMenu reportType="aging" filters={{ as_of_date: "2026-07-27" }} />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    const menu = screen.getByRole("menu", { name: /choose export format/i });
    await user.click(within(menu).getByRole("menuitem", { name: /export as pdf/i }));

    expect(run).toHaveBeenCalledWith("pdf", { as_of_date: "2026-07-27" });
    expect(screen.queryByRole("menu")).toBeNull(); // closes after choosing
    expect(screen.getByRole("button", { name: /export/i })).toHaveFocus();
  });

  it("exports as Excel", async () => {
    const user = userEvent.setup();
    render(<ExportMenu reportType="invoices" filters={{ date_from: "2026-07-01" }} />);
    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByRole("menuitem", { name: /export as excel/i }));
    expect(run).toHaveBeenCalledWith("xlsx", { date_from: "2026-07-01" });
  });

  it("supports keyboard navigation and closes on Escape restoring focus", async () => {
    const user = userEvent.setup();
    render(<ExportMenu reportType="aging" filters={{}} />);
    const trigger = screen.getByRole("button", { name: /export/i });
    await user.click(trigger);

    const items = screen.getAllByRole("menuitem");
    await waitFor(() => expect(items[0]).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("disables the trigger while pending (no double submission)", () => {
    hookState = baseState({ status: "generating", isPending: true, activeFormat: "pdf" });
    render(<ExportMenu reportType="aging" filters={{}} />);
    const trigger = screen.getByRole("button", { name: /generating pdf/i });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows a success confirmation", () => {
    hookState = baseState({ status: "success", activeFormat: "xlsx" });
    render(<ExportMenu reportType="aging" filters={{}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/excel downloaded/i);
  });

  it("shows the oversize error with a retry that re-runs the export", async () => {
    const user = userEvent.setup();
    hookState = baseState({
      status: "error",
      activeFormat: "pdf",
      error: new ExportOversizeError("This report is too large to export. Narrow the filters."),
    });
    render(<ExportMenu reportType="aging" filters={{ as_of_date: "2026-07-27" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/too large/i);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(reset).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith("pdf", { as_of_date: "2026-07-27" });
  });

  it("shows a validation error message", () => {
    hookState = baseState({ status: "error", activeFormat: "pdf", error: new ExportValidationError() });
    render(<ExportMenu reportType="aging" filters={{}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/rejected|adjust the report filters/i);
  });

  it("can be disabled by the page", () => {
    render(<ExportMenu reportType="aging" filters={{}} disabled />);
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });

  it("remains disabled until authenticated export authority is ready", () => {
    hookState = baseState({ isReady: false });
    render(<ExportMenu reportType="aging" filters={{}} />);
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
  });
});

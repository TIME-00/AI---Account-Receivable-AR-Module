import { describe, expect, it } from "vitest";
import { FEATURE_STATUS_ROWS } from "./feature-status";

function row(feature: string) {
  return FEATURE_STATUS_ROWS.find((r) => r.feature === feature);
}

describe("Feature Status — Gate C report export", () => {
  it("marks Report Export as Implemented — Pending Deployment (not Live, not Planned)", () => {
    const exportRow = FEATURE_STATUS_ROWS.find((r) => r.feature.includes("Report Export"));
    expect(exportRow?.status).toBe("Implemented — Pending Deployment");
    expect(exportRow?.status).not.toBe("Live");
    expect(exportRow?.status).not.toBe("Planned");
  });

  it("keeps Gate A and Gate B capabilities Live", () => {
    expect(row("AR Reports (Aging, Invoice, Receipt, Outstanding)")?.status).toBe("Live");
    expect(
      row("Import Notifications (Page, Dropdown & Unread Badge) — Import Alerts Only")?.status,
    ).toBe("Live");
    expect(row("Credit Rating Drill-Down (Dashboard → Aging by Customer)")?.status).toBe("Live");
    expect(row("Credit/Debit Note Visibility & Empty States")?.status).toBe("Live");
  });

  it("preserves unrelated capability statuses", () => {
    expect(row("Auto-Allocation")?.status).toBe("Disabled");
    expect(row("Daily FX Sync")?.status).toBe("Live (Automated)");
  });

  it("has no duplicate feature rows", () => {
    const names = FEATURE_STATUS_ROWS.map((r) => r.feature);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ============================================================================
// Gate B — Feature Status truthfulness.
// ============================================================================

import { describe, it, expect } from "vitest";
import { FEATURE_STATUS_ROWS } from "@/lib/feature-status";

const find = (predicate: (feature: string) => boolean) =>
  FEATURE_STATUS_ROWS.find((row) => predicate(row.feature));

describe("Gate B feature status", () => {
  it("marks the three Gate B capabilities Implemented — Pending Deployment (never Live)", () => {
    const gateB = [
      "Import Notifications",
      "Credit Rating Drill-Down",
      "Credit/Debit Note Visibility",
    ];
    for (const prefix of gateB) {
      const row = find((f) => f.startsWith(prefix));
      expect(row, `missing Gate B row: ${prefix}`).toBeDefined();
      expect(row!.status).toBe("Implemented — Pending Deployment");
      expect(row!.status).not.toBe("Live");
    }
  });

  it("keeps notifications import-alert-only and never implies overdue alerts", () => {
    const notif = find((f) => f.startsWith("Import Notifications"));
    expect(notif!.feature).toMatch(/import alerts only/i);
    for (const row of FEATURE_STATUS_ROWS) {
      expect(row.feature.toLowerCase()).not.toContain("overdue");
    }
  });

  it("preserves Gate A rows as Live and Report Export as Planned", () => {
    expect(find((f) => f === "Dashboard")!.status).toBe("Live");
    expect(find((f) => f.startsWith("Governed FX"))!.status).toBe("Live");
    expect(find((f) => f.startsWith("Booked-Rate"))!.status).toBe("Live");
    expect(find((f) => f === "Daily FX Sync")!.status).toBe("Live (Automated)");
    expect(find((f) => f.startsWith("Report Export"))!.status).toBe("Planned");
    expect(find((f) => f === "Auto-Allocation")!.status).toBe("Disabled");
  });

  it("has no duplicate or contradictory rows", () => {
    const names = FEATURE_STATUS_ROWS.map((r) => r.feature);
    expect(new Set(names).size).toBe(names.length);
    // Report Export appears exactly once.
    expect(names.filter((n) => n.startsWith("Report Export"))).toHaveLength(1);
  });
});

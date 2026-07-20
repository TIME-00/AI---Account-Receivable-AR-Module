import { describe, it, expect } from "vitest";
import {
  fxSourcePresentation,
  fxDecisionStatePresentation,
  FX_TONE_CLASSES,
} from "@/lib/fx-presentation";
import type { FxPostingEligibilityReason, FxSourceCategory } from "@/types/monetary";

describe("fxSourcePresentation", () => {
  const categories: FxSourceCategory[] = [
    "BASE_PARITY",
    "CATALOG",
    "REFERENCE_SELECTED",
    "MANUAL_OVERRIDE",
    "LEGACY_UNVERIFIED",
  ];

  it("maps every source category to a labelled, icon-bearing presentation", () => {
    for (const c of categories) {
      const p = fxSourcePresentation(c);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0); // icon + text, never colour alone
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("falls back safely for unknown / missing sources (no crash, no invention)", () => {
    expect(fxSourcePresentation(null).label).toBe("Unknown source");
    expect(fxSourcePresentation("SOMETHING_NEW").label).toBe("SOMETHING_NEW");
  });
});

describe("fxDecisionStatePresentation", () => {
  const reasons: FxPostingEligibilityReason[] = [
    "approved",
    "not_required",
    "pending_approval",
    "rejected",
    "stale_decision",
    "non_current_decision",
    "blocked",
    "inconsistent_state",
    "missing_decision",
  ];

  it("maps every eligibility reason to an icon + text (colour never the sole signal)", () => {
    for (const r of reasons) {
      const p = fxDecisionStatePresentation(r);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
      expect(FX_TONE_CLASSES[p.tone]).toBeDefined();
    }
  });

  it("treats approved/not_required as success and rejected/blocked as danger", () => {
    expect(fxDecisionStatePresentation("approved").tone).toBe("success");
    expect(fxDecisionStatePresentation("not_required").tone).toBe("success");
    expect(fxDecisionStatePresentation("rejected").tone).toBe("danger");
    expect(fxDecisionStatePresentation("blocked").tone).toBe("danger");
  });

  it("defaults null reason to the missing-decision state", () => {
    expect(fxDecisionStatePresentation(null).label).toBe("No booking decision");
  });
});

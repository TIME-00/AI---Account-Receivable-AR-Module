// ============================================================================
// Gate A — Booked / Legacy / rejection presentation mapping (§H).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  resolveFxRateDisplay,
  fxDecisionStatePresentation,
  fxDecisionStatePresentationForDocument,
  fxSourcePresentation,
} from "@/lib/fx-presentation";
import { fxDecision } from "@/test/harness";

describe("Gate A §H presentation mapping", () => {
  it("Posted + booked → 'Booked rate', informational/neutral tone, never danger", () => {
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ source_category: "CATALOG", booked_rate: 4.45 }),
    });
    expect(r.kind).toBe("booked_snapshot");
    expect(r.caption).toBe("Booked rate");
    // Not a danger "Blocked" state merely because editing is no longer eligible.
    expect(r.tone).not.toBe("danger");
    expect(["info", "neutral"]).toContain(r.tone);
    expect(r.description.toLowerCase()).toContain("locked");
    expect(r.icon).toBe("Lock"); // colour is never the sole signal
  });

  it("LEGACY_UNVERIFIED → 'Legacy rate unverified', warning (not danger), truthful copy", () => {
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ source_category: "LEGACY_UNVERIFIED", booked_rate: 1 }),
    });
    expect(r.kind).toBe("legacy_unverified");
    expect(r.caption).toBe("Legacy rate unverified");
    expect(r.tone).toBe("warning");
    // Truthful: historical booked snapshot, NOT a present MAS valuation.
    expect(r.description).toMatch(/historical booked snapshot/i);
    expect(r.description).toMatch(/not a present market\/MAS valuation/i);
  });

  it("genuine rejection / blocked decision stays danger with a precise reason", () => {
    expect(fxDecisionStatePresentation("rejected").tone).toBe("danger");
    expect(fxDecisionStatePresentation("blocked").tone).toBe("danger");
    expect(fxDecisionStatePresentation("inconsistent_state").tone).toBe("warning");
    expect(fxDecisionStatePresentationForDocument("blocked", false)?.tone).toBe("danger");
    expect(fxDecisionStatePresentationForDocument("blocked", true)).toBeNull();
  });

  it("the legacy source chip reads 'Legacy rate unverified' and is not danger", () => {
    const p = fxSourcePresentation("LEGACY_UNVERIFIED");
    expect(p.label).toBe("Legacy rate unverified");
    expect(p.tone).not.toBe("danger");
    expect(p.icon.length).toBeGreaterThan(0);
    expect(p.description.length).toBeGreaterThan(0);
  });

  it("every rate-display state carries an icon + non-empty description (colour not sole signal)", () => {
    const states = [
      resolveFxRateDisplay({ currency: "MYR", baseCurrency: "MYR", documentPosted: true }),
      resolveFxRateDisplay({ currency: "USD", baseCurrency: "MYR", documentPosted: false, draftExchangeRate: 4.4 }),
      resolveFxRateDisplay({ currency: "USD", baseCurrency: "MYR", documentPosted: true, decision: null }),
      resolveFxRateDisplay({ currency: "USD", baseCurrency: "MYR", documentPosted: true, decision: fxDecision({ source_category: "MANUAL_OVERRIDE", booked_rate: 4.5 }) }),
    ];
    for (const s of states) {
      expect(s.icon.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.caption.length).toBeGreaterThan(0);
    }
  });
});

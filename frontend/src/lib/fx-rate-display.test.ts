// ============================================================================
// B9DD-FEIR-007 — governed, directional, lifecycle-aware FX rate presentation.
// ============================================================================

import { describe, it, expect } from "vitest";
import { resolveFxRateDisplay, isPostedDocumentStatus } from "@/lib/fx-presentation";
import { fxDecision } from "@/test/harness";

describe("resolveFxRateDisplay — direction", () => {
  it("states the direction explicitly as 1 <transaction> = <rate> <base>", () => {
    // Verified against migration 027: base = ROUND(amount * exchange_rate, 2),
    // so the rate converts transaction -> base.
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ booked_rate: 4.45 }),
    });
    expect(r.directionLabel).toBe("1 USD = 4.4500 MYR");
    expect(r.kind).toBe("booked_snapshot");
    expect(r.caption).toBe("Booked rate");
  });

  it("omits a direction when a currency code is unknown (never guesses)", () => {
    const r = resolveFxRateDisplay({
      currency: null,
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision(),
    });
    expect(r.directionLabel).toBeNull();
  });
});

describe("resolveFxRateDisplay — lifecycle", () => {
  it("treats a draft's exchange_rate as an ESTIMATE, not a booked rate", () => {
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: false,
      decision: null,
      draftExchangeRate: 4.5,
    });
    expect(r.kind).toBe("draft_estimate");
    expect(r.caption).toBe("Estimated rate");
    expect(r.rate).toBe(4.5);
    expect(r.directionLabel).toBe("1 USD = 4.5000 MYR");
  });

  it("marks a POSTED document with NO decision as unavailable — never falls back to exchange_rate", () => {
    // This is the specific unsafe pattern the review flagged:
    //   fx_decision?.booked_rate ?? exchange_rate
    // A posted document without governance has no verified booked rate.
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: null,
      draftExchangeRate: 4.45,
    });
    expect(r.kind).toBe("unavailable");
    expect(r.rate).toBeNull();
    expect(r.directionLabel).toBeNull();
    expect(r.caption).toBe("Booked rate not available");
  });

  it("recognises same-currency base parity without inventing a rate line", () => {
    const r = resolveFxRateDisplay({
      currency: "MYR",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: null,
    });
    expect(r.kind).toBe("base_parity");
    expect(r.directionLabel).toBeNull();
  });

  it("flags a legacy/unverified booking rate", () => {
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ source_category: "LEGACY_UNVERIFIED" }),
    });
    expect(r.kind).toBe("legacy_unverified");
    expect(r.caption).toContain("Legacy");
    expect(r.tone).toBe("warning");
  });

  it("flags a manual override distinctly from a catalog booking", () => {
    const override = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ source_category: "MANUAL_OVERRIDE" }),
    });
    expect(override.kind).toBe("manual_override");
    expect(override.caption).toContain("manual override");

    const catalog = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ source_category: "CATALOG" }),
    });
    expect(catalog.kind).toBe("booked_snapshot");
  });

  it("flags a stale reference rate", () => {
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ source_category: "REFERENCE_SELECTED", stale_reference: true }),
    });
    expect(r.kind).toBe("stale_reference");
    expect(r.caption).toContain("stale");
  });

  it("reports a draft with no rate at all as unavailable", () => {
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: false,
      decision: null,
      draftExchangeRate: null,
    });
    expect(r.kind).toBe("unavailable");
    expect(r.rate).toBeNull();
  });

  it("never renders a fabricated 1.0000 for a non-parity pair", () => {
    const r = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: null,
    });
    expect(r.rate).not.toBe(1);
    expect(r.directionLabel).toBeNull();
  });

  it("carries an icon and description on every state (colour is never the sole signal)", () => {
    const states = [
      resolveFxRateDisplay({ currency: "MYR", baseCurrency: "MYR", documentPosted: true }),
      resolveFxRateDisplay({ currency: "USD", baseCurrency: "MYR", documentPosted: false, draftExchangeRate: 4.4 }),
      resolveFxRateDisplay({ currency: "USD", baseCurrency: "MYR", documentPosted: true, decision: fxDecision() }),
      resolveFxRateDisplay({ currency: "USD", baseCurrency: "MYR", documentPosted: true, decision: null }),
    ];
    for (const s of states) {
      expect(s.icon.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.caption.length).toBeGreaterThan(0);
    }
  });
});

describe("isPostedDocumentStatus", () => {
  it("treats only Draft as not-posted; terminal states keep their snapshot", () => {
    expect(isPostedDocumentStatus("Draft")).toBe(false);
    expect(isPostedDocumentStatus(null)).toBe(false);
    for (const s of ["Open", "Overdue", "Partially Paid", "Paid", "Cancelled", "Posted", "Bounced"]) {
      expect(isPostedDocumentStatus(s)).toBe(true);
    }
  });
});

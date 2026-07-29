import { describe, expect, it } from "vitest";
import {
  MonetarySummaryParseError,
  parseCollectionSummary,
  type ParsedSummaryV2,
} from "./monetary-summary";

// ─── Fixture builders (raw API shapes) ──────────────────────────────────────

function v1Summary(amountBasis: string, normalizationBasis: string) {
  return {
    row_count: 2,
    amount_basis: amountBasis,
    base_total: 1234.5,
    base_currency: "MYR",
    by_currency: [
      { currency: "MYR", amount: 1000, base_amount: 1000, count: 1 },
      { currency: "SGD", amount: 100, base_amount: 234.5, count: 1 },
    ],
    meta: { base_currency: "MYR", multi_currency: true, normalization_basis: normalizationBasis },
  };
}

function v1Collection() {
  return {
    current_balance_summary: v1Summary("current_outstanding", "current_balance_x_booked_rate"),
    document_total_summary: v1Summary("original_document_total", "original_booked_base_snapshot"),
  };
}

function v2Group(overrides: Record<string, unknown> = {}) {
  return {
    currency: "MYR",
    amount: "1000.00",
    base_amount: "1000.00",
    count: 1,
    authoritative_document_count: 1,
    unavailable_count: 0,
    base_available: true,
    ...overrides,
  };
}

function v2Summary(amountBasis: string, normalizationBasis: string, overrides: Record<string, unknown> = {}) {
  return {
    row_count: 2,
    matching_document_count: 2,
    authoritative_document_count: 2,
    unavailable_count: 0,
    base_available: true,
    amount_basis: amountBasis,
    base_currency: "MYR",
    base_total: "1500.00",
    by_currency: [
      v2Group(),
      v2Group({ currency: "SGD", amount: "150.00", base_amount: "500.00" }),
    ],
    unavailable_by_currency: [],
    meta: {
      contract_version: 2,
      base_currency: "MYR",
      multi_currency: true,
      normalization_basis: normalizationBasis,
      authority_basis: "current_consistent_booked_fx_decision",
    },
    ...overrides,
  };
}

function v2Collection(currentOverrides = {}, documentOverrides = {}) {
  return {
    current_balance_summary: v2Summary("current_outstanding", "current_balance_x_booked_rate", currentOverrides),
    document_total_summary: v2Summary("original_document_total", "original_booked_base_snapshot", documentOverrides),
  };
}

const INV = { currentAmountBasis: "current_outstanding" } as const;
const RCP = { currentAmountBasis: "current_unallocated" } as const;

function expectReject(raw: unknown, opts = INV) {
  expect(() => parseCollectionSummary(raw, opts)).toThrow(MonetarySummaryParseError);
}

// ─── Valid paths ─────────────────────────────────────────────────────────────

describe("parseCollectionSummary — valid v1", () => {
  it("accepts a valid v1 invoice collection as explicit v1", () => {
    const parsed = parseCollectionSummary(v1Collection(), INV);
    expect(parsed.contractVersion).toBe(1);
    expect(parsed.currentBalance.contractVersion).toBe(1);
    expect(parsed.documentTotal.amountBasis).toBe("original_document_total");
  });

  it("accepts a valid v1 receipt collection (current_unallocated)", () => {
    const raw = {
      current_balance_summary: v1Summary("current_unallocated", "current_balance_x_booked_rate"),
      document_total_summary: v1Summary("original_document_total", "original_booked_base_snapshot"),
    };
    expect(parseCollectionSummary(raw, RCP).contractVersion).toBe(1);
  });

  it("never exposes a v1 base total as authoritative (no v2 fields fabricated)", () => {
    const parsed = parseCollectionSummary(v1Collection(), INV);
    expect(parsed.currentBalance).not.toHaveProperty("authoritativeDocumentCount");
    expect(parsed.currentBalance).not.toHaveProperty("baseAvailable");
  });
});

describe("parseCollectionSummary — valid v2", () => {
  it("accepts a valid v2 invoice collection as strict v2 (complete)", () => {
    const parsed = parseCollectionSummary(v2Collection(), INV);
    expect(parsed.contractVersion).toBe(2);
    const cur = parsed.currentBalance as ParsedSummaryV2;
    expect(cur.baseAvailable).toBe(true);
    expect(cur.baseTotal).toBe("1500.00");
    expect(cur.authorityBasis).toBe("current_consistent_booked_fx_decision");
  });

  it("accepts a valid v2 receipt collection", () => {
    const raw = v2Collection();
    raw.current_balance_summary.amount_basis = "current_unallocated";
    expect(parseCollectionSummary(raw, RCP).contractVersion).toBe(2);
  });

  it("accepts partial (some unavailable) with authoritative subtotal", () => {
    const raw = v2Collection({
      authoritative_document_count: 1,
      unavailable_count: 1,
      base_available: false,
      base_total: "1000.00",
      by_currency: [
        v2Group(),
        v2Group({ currency: "SGD", amount: "150.00", base_amount: null, authoritative_document_count: 0, unavailable_count: 1, base_available: false }),
      ],
      unavailable_by_currency: [{ currency: "SGD", document_count: 1 }],
    });
    const cur = parseCollectionSummary(raw, INV).currentBalance as ParsedSummaryV2;
    expect(cur.baseAvailable).toBe(false);
    expect(cur.baseTotal).toBe("1000.00");
    expect(cur.unavailableByCurrency).toEqual([{ currency: "SGD", documentCount: 1 }]);
  });

  it("accepts all-unavailable with null base_total", () => {
    const raw = v2Collection({
      authoritative_document_count: 0,
      unavailable_count: 2,
      base_available: false,
      base_total: null,
      by_currency: [
        v2Group({ base_amount: null, authoritative_document_count: 0, unavailable_count: 1, base_available: false }),
        v2Group({ currency: "SGD", amount: "150.00", base_amount: null, authoritative_document_count: 0, unavailable_count: 1, base_available: false }),
      ],
      unavailable_by_currency: [{ currency: "MYR", document_count: 1 }, { currency: "SGD", document_count: 1 }],
    });
    const cur = parseCollectionSummary(raw, INV).currentBalance as ParsedSummaryV2;
    expect(cur.baseTotal).toBeNull();
    expect(cur.authoritativeDocumentCount).toBe(0);
  });

  it("accepts empty collection (base_total '0.00', base_available true)", () => {
    const raw = v2Collection({
      row_count: 0,
      matching_document_count: 0,
      authoritative_document_count: 0,
      unavailable_count: 0,
      base_available: true,
      base_total: "0.00",
      by_currency: [],
      unavailable_by_currency: [],
      meta: {
        contract_version: 2,
        base_currency: "MYR",
        multi_currency: false,
        normalization_basis: "current_balance_x_booked_rate",
        authority_basis: "current_consistent_booked_fx_decision",
      },
    });
    const cur = parseCollectionSummary(raw, INV).currentBalance as ParsedSummaryV2;
    expect(cur.baseTotal).toBe("0.00");
    expect(cur.byCurrency).toEqual([]);
  });
});

// ─── Rejections ──────────────────────────────────────────────────────────────

describe("parseCollectionSummary — fails closed", () => {
  it("rejects the non-legacy explicit contract_version 1 wire form", () => {
    const raw = v1Collection();
    (raw.current_balance_summary.meta as Record<string, unknown>).contract_version = 1;
    (raw.document_total_summary.meta as Record<string, unknown>).contract_version = 1;
    expectReject(raw);
  });

  it("rejects one-v1 / one-v2 mixed collection", () => {
    expectReject({
      current_balance_summary: v2Summary("current_outstanding", "current_balance_x_booked_rate"),
      document_total_summary: v1Summary("original_document_total", "original_booked_base_snapshot"),
    });
  });

  it("rejects partial v2 fields inside a v1 object", () => {
    const raw = v1Collection();
    (raw.current_balance_summary as Record<string, unknown>).unavailable_count = 0;
    expectReject(raw);
  });

  it("rejects malformed decimal string in v2", () => {
    expectReject(v2Collection({ base_total: "1500.5" }));
    expectReject(v2Collection({ base_total: "1,500.00" }));
    expectReject(v2Collection({ base_total: "NaN" }));
    expectReject(v2Collection({ base_total: "1.5e3" }));
  });

  it("rejects numeric money where a v2 decimal string is required", () => {
    expectReject(v2Collection({ base_total: 1500 }));
    const raw = v2Collection();
    (raw.current_balance_summary.by_currency[0] as Record<string, unknown>).amount = 1000;
    expectReject(raw);
  });

  it("rejects nullable violations (non-null base for all-unavailable / null for authoritative)", () => {
    expectReject(v2Collection({ authoritative_document_count: 0, unavailable_count: 2, base_available: false, base_total: "10.00",
      by_currency: [v2Group({ base_amount: null, authoritative_document_count: 0, unavailable_count: 1, base_available: false }), v2Group({ currency: "SGD", amount: "1.00", base_amount: null, authoritative_document_count: 0, unavailable_count: 1, base_available: false })],
      unavailable_by_currency: [{ currency: "MYR", document_count: 1 }, { currency: "SGD", document_count: 1 }] }));
  });

  it("rejects count-invariant violations", () => {
    expectReject(v2Collection({ authoritative_document_count: 1, unavailable_count: 0 })); // 1+0 != 2
    expectReject(v2Collection({ row_count: 3 })); // row_count != matching
  });

  it("rejects base_available inconsistent with unavailable_count", () => {
    expectReject(v2Collection({ base_available: false })); // unavailable 0 but flag false
  });

  it("rejects unordered / duplicate currency groups", () => {
    expectReject(v2Collection({
      by_currency: [v2Group({ currency: "SGD", amount: "1.00", base_amount: "1.00" }), v2Group({ currency: "MYR" })],
    })); // SGD before MYR
    expectReject(v2Collection({
      row_count: 2, matching_document_count: 2, authoritative_document_count: 2,
      by_currency: [v2Group(), v2Group()], // duplicate MYR
    }));
  });

  it("rejects zero-count by_currency group", () => {
    expectReject(v2Collection({
      by_currency: [v2Group(), v2Group({ currency: "SGD", amount: "0.00", base_amount: "0.00", count: 0, authoritative_document_count: 0, unavailable_count: 0 })],
    }));
  });

  it("rejects invalid amount basis / normalization basis / authority basis", () => {
    expectReject(v2Collection({ amount_basis: "current_unallocated" }), INV); // invoice expects current_outstanding
    const badNorm = v2Collection();
    badNorm.current_balance_summary.meta.normalization_basis = "original_booked_base_snapshot";
    expectReject(badNorm);
    const badAuth = v2Collection();
    (badAuth.current_balance_summary.meta as Record<string, unknown>).authority_basis = "something_else";
    expectReject(badAuth);
  });

  it("rejects extra or missing keys (exact contract)", () => {
    const extra = v2Collection();
    (extra.current_balance_summary as Record<string, unknown>).extra_field = 1;
    expectReject(extra);
    const missing = v2Collection();
    delete (missing.current_balance_summary as Record<string, unknown>).unavailable_by_currency;
    expectReject(missing);
  });

  it("rejects group / overall count mismatch", () => {
    expectReject(v2Collection({
      authoritative_document_count: 2, unavailable_count: 0, base_available: true, base_total: "1500.00",
      by_currency: [v2Group({ authoritative_document_count: 1, unavailable_count: 0 }), v2Group({ currency: "SGD", amount: "150.00", base_amount: "500.00", authoritative_document_count: 0, unavailable_count: 1, base_available: false })],
      unavailable_by_currency: [{ currency: "SGD", document_count: 1 }],
    })); // overall unavailable 0 but a group has unavailable 1
  });

  it("rejects unavailable_by_currency that does not reconcile with groups", () => {
    expectReject(v2Collection({
      authoritative_document_count: 1, unavailable_count: 1, base_available: false, base_total: "1000.00",
      by_currency: [v2Group(), v2Group({ currency: "SGD", amount: "150.00", base_amount: null, authoritative_document_count: 0, unavailable_count: 1, base_available: false })],
      unavailable_by_currency: [{ currency: "USD", document_count: 1 }], // wrong currency
    }));
  });

  it("rejects invalid currency codes and mismatched base currency", () => {
    expectReject(v2Collection({ base_currency: "myr" }));
    const mismatch = v2Collection();
    mismatch.current_balance_summary.meta.base_currency = "SGD";
    expectReject(mismatch);
  });

  it("rejects non-object / null / array envelopes", () => {
    expectReject(null);
    expectReject([]);
    expectReject("nope");
    expectReject({ current_balance_summary: {}, document_total_summary: {} });
  });
});

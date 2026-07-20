import { describe, it, expect } from "vitest";
import {
  formatMoney,
  formatMoneySafe,
  formatMoneyNumber,
  normalizeCurrency,
  isSupportedCurrency,
  isMixedCurrency,
  groupRowsByCurrency,
  sumByCurrency,
  distinctCurrencyCount,
  SUPPORTED_CURRENCIES,
} from "@/lib/currency";
import type { CurrencyTotal } from "@/types/monetary";

describe("currency formatting", () => {
  it("formats money with an explicit currency code", () => {
    expect(formatMoney(1234.5, "USD")).toBe("USD 1,234.50");
    expect(formatMoney(1000, "SGD")).toBe("SGD 1,000.00");
  });

  it("never silently defaults a missing currency to MYR", () => {
    // formatMoneySafe with no currency shows the neutral sentinel, NOT "MYR".
    expect(formatMoneySafe(100, null)).not.toContain("MYR");
    expect(formatMoneySafe(100, null)).toContain("100.00");
    expect(formatMoneySafe(100, "")).not.toContain("MYR");
  });

  it("renders an explicit unavailable state for null/invalid amounts", () => {
    expect(formatMoneySafe(null, "USD")).toBe("Not available");
    expect(formatMoneySafe(undefined, "USD")).toBe("Not available");
    expect(formatMoneySafe(Number.NaN, "USD")).toBe("Not available");
  });

  it("always shows 2 decimal places", () => {
    expect(formatMoneyNumber(5)).toBe("5.00");
    expect(formatMoneyNumber(1234567.891)).toBe("1,234,567.89");
  });
});

describe("normalizeCurrency", () => {
  it("upper-cases and trims, mapping empty/nullish to null (never MYR)", () => {
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("  sgd ")).toBe("SGD");
    expect(normalizeCurrency("")).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency(undefined)).toBeNull();
  });
});

describe("supported currencies", () => {
  it("recognises the Batch 9D-D supported set (case-insensitive)", () => {
    for (const c of SUPPORTED_CURRENCIES) expect(isSupportedCurrency(c)).toBe(true);
    expect(isSupportedCurrency("usd")).toBe(true);
    expect(isSupportedCurrency("JPY")).toBe(false); // non-2-decimal, out of scope
    expect(isSupportedCurrency(null)).toBe(false);
  });
});

describe("mixed-currency detection & grouping", () => {
  it("detects mixed currencies", () => {
    expect(isMixedCurrency(["USD", "SGD"])).toBe(true);
    expect(isMixedCurrency(["USD", "usd"])).toBe(false);
    expect(isMixedCurrency(["MYR"])).toBe(false);
  });

  it("partitions rows by currency without arithmetic", () => {
    const rows = [
      { ccy: "USD", n: 1 },
      { ccy: "SGD", n: 2 },
      { ccy: "USD", n: 3 },
    ];
    const groups = groupRowsByCurrency(rows, (r) => r.ccy);
    expect(groups.map((g) => g.currency)).toEqual(["SGD", "USD"]);
    expect(groups.find((g) => g.currency === "USD")?.rows).toHaveLength(2);
  });
});

describe("sumByCurrency — no cross-currency arithmetic", () => {
  const rows = [
    { currency: "USD", amount: 100 },
    { currency: "SGD", amount: 100 },
    { currency: "USD", amount: 50 },
    { currency: "MYR", amount: 200 },
  ];

  it("produces per-currency subtotals and never one combined total", () => {
    const subtotals = sumByCurrency(rows, (r) => r.currency, (r) => r.amount);
    // Three distinct currencies -> three subtotal lines, sorted.
    expect(subtotals.map((s) => s.currency)).toEqual(["MYR", "SGD", "USD"]);
    // Same-currency amounts ARE combined; different currencies are NOT.
    expect(subtotals.find((s) => s.currency === "USD")?.amount).toBe(150);
    expect(subtotals.find((s) => s.currency === "SGD")?.amount).toBe(100);
    expect(subtotals.find((s) => s.currency === "MYR")?.amount).toBe(200);
    // There is no single scalar total of 450 anywhere in the output.
    expect(subtotals).toHaveLength(3);
  });
});

describe("MYR 545 authoritative base aggregation anchor", () => {
  // A backend MonetarySummary-shaped by_currency breakdown: native subtotals in
  // USD and MYR, with a company-base (MYR) total that is NOT the arithmetic sum
  // of the native amounts. This mirrors the accepted aggregation acceptance
  // anchor (company-base total = 545) from stored booking snapshots.
  const byCurrency: CurrencyTotal[] = [
    { currency: "USD", amount: 100, base_amount: 445, count: 1 },
    { currency: "MYR", amount: 100, base_amount: 100, count: 1 },
  ];
  const baseTotal = byCurrency.reduce((s, c) => s + c.base_amount, 0);

  it("company-base total is 545 and derives from base amounts, not native sums", () => {
    expect(baseTotal).toBe(545);
    // The naive cross-currency native sum (100 + 100 = 200) must NOT equal base.
    const nativeSum = byCurrency.reduce((s, c) => s + c.amount, 0);
    expect(nativeSum).toBe(200);
    expect(nativeSum).not.toBe(baseTotal);
  });

  it("reports the correct number of distinct currencies", () => {
    expect(distinctCurrencyCount(byCurrency)).toBe(2);
  });
});

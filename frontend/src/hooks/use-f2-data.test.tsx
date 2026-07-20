// ============================================================================
// B9DD-FEIR-002 — report completeness / >1,000-row correctness.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  Providers,
  createFakeApi,
  route,
  invoiceFixture,
  receiptFixture,
  collectionSummary,
  monetarySummary,
  currencyTotal,
  ANCHOR_BY_CURRENCY,
  ANCHOR_BASE_TOTAL,
  type FakeApi,
} from "@/test/harness";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

import { useInvoiceReport, useReceiptReport } from "@/hooks/use-f2-data";

/** A 1,001-row filtered collection, summarised entirely by the backend. */
const bigSummary = collectionSummary(
  monetarySummary(
    [currencyTotal("MYR", 500_000, 500_000, 500), currencyTotal("USD", 100_000, 445_000, 501)],
    945_000,
    "MYR",
    "current_outstanding",
  ),
  monetarySummary(
    [currencyTotal("MYR", 500_000, 500_000, 500), currencyTotal("USD", 100_000, 445_000, 501)],
    945_000,
    "MYR",
    "original_document_total",
    "original_booked_base_snapshot",
  ),
);

const anchorSummary = collectionSummary(
  monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL),
  monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL, "MYR", "original_document_total"),
);

describe("useInvoiceReport — authoritative totals, no client summation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the complete backend summary for a 1,001-row collection without downloading the rows", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => ({
        // The row payload is intentionally tiny: exactly what the hook asks for.
        data: Number(params.page_size) === 1 ? [invoiceFixture()] : [invoiceFixture(), invoiceFixture({ id: "inv-2" })],
        meta: { total: 1001, page: 1, page_size: Number(params.page_size), summary: bigSummary },
      })),
    ]);

    const { result } = renderHook(() => useInvoiceReport({ date_from: "2026-01-01", date_to: "2026-12-31" }), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const overall = result.current.data!.overall;
    // 1,001 rows summarised, but no request ever asked for more than 10 rows.
    expect(overall.total).toBe(1001);
    expect(overall.summary.current_balance_summary.base_total).toBe(945_000);

    const maxPageSize = Math.max(...fakeApi.calls.map((c) => Number(c.params.page_size)));
    expect(maxPageSize).toBeLessThanOrEqual(10);
    // And nothing ever requests the impossible page_size=500 the backend clamps.
    expect(fakeApi.calls.every((c) => Number(c.params.page_size) <= 100)).toBe(true);
  });

  it("pushes the date range to the SERVER rather than filtering rows locally", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => {
        expect(params.date_from).toBe("2026-03-01");
        expect(params.date_to).toBe("2026-03-31");
        return { data: [invoiceFixture()], meta: { total: 1, page: 1, page_size: Number(params.page_size), summary: anchorSummary } };
      }),
    ]);

    const { result } = renderHook(() => useInvoiceReport({ date_from: "2026-03-01", date_to: "2026-03-31" }), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fakeApi.calls.every((c) => c.params.date_from === "2026-03-01")).toBe(true);
  });

  it("requests one authoritative summary per status and keeps native currencies separated", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => ({
        data: [invoiceFixture()],
        meta: {
          total: params.status ? 2 : 10,
          page: 1,
          page_size: Number(params.page_size),
          summary: anchorSummary,
        },
      })),
    ]);

    const { result } = renderHook(() => useInvoiceReport({}), { wrapper: Providers });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const statuses = result.current.data!.byStatus.map((s) => s.status);
    expect(statuses).toContain("Open");
    expect(statuses).toContain("Paid");

    for (const entry of result.current.data!.byStatus) {
      const by = entry.summary.document_total_summary.by_currency;
      // Both native currencies survive; they are never collapsed into one.
      expect(by.map((c) => c.currency).sort()).toEqual(["MYR", "USD"]);
      // MYR 545 anchor: the base total is NOT the sum of native amounts (200).
      const nativeSum = by.reduce((s, c) => s + c.amount, 0);
      expect(nativeSum).toBe(200);
      expect(entry.summary.document_total_summary.base_total).toBe(545);
      expect(entry.summary.document_total_summary.base_total).not.toBe(nativeSum);
    }
  });

  it("fails loudly when the authoritative summary is missing rather than approximating", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => ({ data: [invoiceFixture()], meta: { total: 1, page: 1, page_size: 1 } })),
    ]);

    const { result } = renderHook(() => useInvoiceReport({}), { wrapper: Providers });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("useReceiptReport — authoritative totals by status and payment method", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests server-filtered summaries per payment method", async () => {
    fakeApi = createFakeApi([
      route("/receipts", (params) => ({
        data: [receiptFixture()],
        meta: { total: 3, page: 1, page_size: Number(params.page_size), summary: anchorSummary },
      })),
    ]);

    const { result } = renderHook(() => useReceiptReport({}), { wrapper: Providers });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const methods = fakeApi.calls.map((c) => c.params.payment_method).filter(Boolean);
    expect(methods).toContain("CHQ");
    expect(methods).toContain("TT");
    expect(result.current.data!.byMethod.length).toBeGreaterThan(0);
    // Per-method figures come straight from the backend summary.
    expect(result.current.data!.byMethod[0].summary.document_total_summary.base_total).toBe(545);
  });
});

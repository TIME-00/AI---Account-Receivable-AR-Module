// ============================================================================
// B9DD-FEIR-005 — receipt-entry customer exposure.
// B9DD-FEIR-002 — aging lookup respects server pagination.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  Providers,
  createFakeApi,
  route,
  agingRowFixture,
  currencyTotal,
  receiptFixture,
  collectionSummary,
  collectionSummaryV2,
  monetarySummary,
  ANCHOR_BY_CURRENCY,
  ANCHOR_BASE_TOTAL,
  type FakeApi,
} from "@/test/harness";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

import { useCustomerExposure, useReceipts } from "@/hooks/use-receipts";

const receiptV1 = collectionSummary(
  monetarySummary(
    ANCHOR_BY_CURRENCY,
    ANCHOR_BASE_TOTAL,
    "MYR",
    "current_unallocated",
  ),
  monetarySummary(
    ANCHOR_BY_CURRENCY,
    ANCHOR_BASE_TOTAL,
    "MYR",
    "original_document_total",
  ),
);

describe("useReceipts — strict summary boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts legacy v1 explicitly without fabricating authority", async () => {
    fakeApi = createFakeApi([
      route("/receipts", () => ({
        data: [receiptFixture()],
        meta: { total: 1, page: 1, page_size: 20, summary: receiptV1 },
      })),
    ]);
    const { result } = renderHook(() => useReceipts({}), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.summary?.contractVersion).toBe(1);
    expect(result.current.data?.summaryUnavailable).toBeNull();
  });

  it("strictly normalizes v2 partial authority", async () => {
    fakeApi = createFakeApi([
      route("/receipts", () => ({
        data: [receiptFixture()],
        meta: {
          total: 3,
          page: 1,
          page_size: 20,
          summary: collectionSummaryV2("current_unallocated", "partial"),
        },
      })),
    ]);
    const { result } = renderHook(() => useReceipts({}), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.summary?.currentBalance).toMatchObject({
      contractVersion: 2,
      baseTotal: "125.50",
      unavailableCount: 2,
    });
  });

  it("keeps valid rows and exposes only a sanitized unavailable state for a mixed contract", async () => {
    const v2 = collectionSummaryV2("current_unallocated", "complete");
    fakeApi = createFakeApi([
      route("/receipts", () => ({
        data: [receiptFixture()],
        meta: {
          total: 1,
          page: 1,
          page_size: 20,
          summary: {
            current_balance_summary: v2.current_balance_summary,
            document_total_summary: receiptV1.document_total_summary,
          },
        },
      })),
    ]);
    const { result } = renderHook(() => useReceipts({}), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows).toHaveLength(1);
    expect(result.current.data?.summary).toBeNull();
    expect(result.current.data?.summaryUnavailable).toBe(
      "Summary data is unavailable.",
    );
  });
});

describe("useCustomerExposure — authoritative multi-currency exposure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns per-currency native exposure plus a separate company-base total", async () => {
    fakeApi = createFakeApi([
      route("/reports/aging/by-customer", () => ({
        data: [
          agingRowFixture({
            customer_id: "cust-1",
            by_currency: [currencyTotal("SGD", 200, 640, 2), currencyTotal("USD", 100, 445, 1)],
            base_total: 1085,
            base_currency: "MYR",
          }),
        ],
        meta: { total: 1, page: 1, page_size: 100 },
      })),
    ]);

    const { result } = renderHook(() => useCustomerExposure("cust-1"), { wrapper: Providers });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const exposure = result.current.data!;
    // Native currencies stay separate — no cross-currency total is produced.
    expect(exposure.byCurrency.map((c) => c.currency)).toEqual(["SGD", "USD"]);
    expect(exposure.byCurrency.map((c) => c.amount)).toEqual([200, 100]);
    // The company-base total is the backend's, not a sum of the natives (300).
    expect(exposure.baseTotal).toBe(1085);
    expect(exposure.baseCurrency).toBe("MYR");
    expect(exposure.baseTotal).not.toBe(300);
    expect(exposure.documentCount).toBe(3);
  });

  it("does not read exposure from a capped /invoices collection", async () => {
    fakeApi = createFakeApi([
      route("/reports/aging/by-customer", () => ({
        data: [agingRowFixture()],
        meta: { total: 1, page: 1, page_size: 100 },
      })),
    ]);

    const { result } = renderHook(() => useCustomerExposure("cust-1"), { wrapper: Providers });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const paths = fakeApi.calls.map((c) => c.path);
    expect(paths).not.toContain("/invoices");
    expect(paths).toContain("/reports/aging/by-customer");
    // Never requests a page size the backend would silently clamp.
    expect(fakeApi.calls.every((c) => Number(c.params.page_size) <= 100)).toBe(true);
  });

  it("reports zero exposure (null) when the customer has no outstanding documents", async () => {
    // ar_aging_by_customer filters WHERE base_total > 0, so such customers are
    // absent by design — that is zero exposure, not a lookup failure.
    fakeApi = createFakeApi([
      route("/reports/aging/by-customer", () => ({ data: [], meta: { total: 0, page: 1, page_size: 100 } })),
    ]);

    const { result } = renderHook(() => useCustomerExposure("cust-nobody"), { wrapper: Providers });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("pages through the server-paginated aging report to find a customer beyond page 1", async () => {
    fakeApi = createFakeApi([
      route("/reports/aging/by-customer", (params) => {
        const page = Number(params.page);
        // 150 customers with exposure; the target sits on page 2.
        const rows =
          page === 1
            ? Array.from({ length: 100 }, (_, i) => agingRowFixture({ customer_id: `other-${i}` }))
            : [agingRowFixture({ customer_id: "cust-target", base_total: 999 })];
        return { data: rows, meta: { total: 101, page, page_size: 100 } };
      }),
    ]);

    const { result } = renderHook(() => useCustomerExposure("cust-target"), { wrapper: Providers });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.baseTotal).toBe(999);
    // It genuinely paged rather than giving up after the first 100 rows.
    expect(fakeApi.calls.map((c) => Number(c.params.page))).toEqual([1, 2]);
  });

  it("fails safely (error, not a wrong number) when exposure cannot be resolved", async () => {
    fakeApi = createFakeApi([
      route("/reports/aging/by-customer", () => {
        throw new Error("aging report unavailable");
      }),
    ]);

    const { result } = renderHook(() => useCustomerExposure("cust-1"), { wrapper: Providers });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

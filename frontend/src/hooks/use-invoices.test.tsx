// ============================================================================
// B9DD-FEIR-001 — list row/summary scope + pagination integration tests.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  Providers,
  createFakeApi,
  route,
  invoiceFixture,
  collectionSummary,
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

import { useInvoiceList, totalPagesFrom } from "@/hooks/use-invoices";

const summary = collectionSummary(
  monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL, "MYR", "current_outstanding"),
  monetarySummary(ANCHOR_BY_CURRENCY, ANCHOR_BASE_TOTAL, "MYR", "original_document_total", "original_booked_base_snapshot"),
);

describe("useInvoiceList — scope, summary and pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the backend rows verbatim and does NOT post-filter them through a customer request", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => ({
        data: [invoiceFixture({ id: "inv-1" }), invoiceFixture({ id: "inv-2", customer_id: "cust-2" })],
        meta: { total: 2, page: 1, page_size: 20, summary },
      })),
    ]);

    const { result } = renderHook(() => useInvoiceList({ page: 1, page_size: 20 }), { wrapper: Providers });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.rows).toHaveLength(2);

    // The hook must not fetch /customers to re-filter financial rows: that
    // capped request is exactly what made rows and summary describe different
    // sets (B9DD-FEIR-001).
    const paths = fakeApi.calls.map((c) => c.path);
    expect(paths).toEqual(["/invoices"]);
    expect(paths).not.toContain("/customers");
  });

  it("keeps rows and summary on the SAME backend filter scope", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => {
        // The backend applies the filter to both rows and summary; assert the
        // hook forwards the filter rather than filtering locally.
        expect(params.status).toBe("Open");
        expect(params.customer_id).toBe("cust-1");
        return {
          data: [invoiceFixture()],
          meta: { total: 1, page: 1, page_size: 20, summary },
        };
      }),
    ]);

    const { result } = renderHook(
      () => useInvoiceList({ status: "Open", customer_id: "cust-1", page: 1, page_size: 20 }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.summary).toBe(summary);
    expect(fakeApi.calls[0].params).toMatchObject({ status: "Open", customer_id: "cust-1" });
  });

  it("preserves backend pagination metadata instead of forcing a single page", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => ({
        data: [invoiceFixture()],
        // 1,001 rows in the filtered collection; only 1 returned on this page.
        meta: { total: 1001, page: 3, page_size: 20, summary },
      })),
    ]);

    const { result } = renderHook(() => useInvoiceList({ page: 3, page_size: 20 }), { wrapper: Providers });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const pagination = result.current.data!.pagination;
    expect(pagination.total).toBe(1001);
    expect(pagination.page).toBe(3);
    expect(pagination.page_size).toBe(20);
    // The old code hard-coded totalPages = 1 and used rows.length as the total.
    expect(pagination.total).not.toBe(result.current.data!.rows.length);
    expect(totalPagesFrom(pagination)).toBe(51);
  });

  it("keeps the collection summary unchanged as pages are navigated", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => ({
        data: [invoiceFixture({ id: `inv-p${params.page}` })],
        meta: { total: 40, page: Number(params.page), page_size: 20, summary },
      })),
    ]);

    const p1 = renderHook(() => useInvoiceList({ page: 1, page_size: 20 }), { wrapper: Providers });
    await waitFor(() => expect(p1.result.current.isSuccess).toBe(true));
    const p2 = renderHook(() => useInvoiceList({ page: 2, page_size: 20 }), { wrapper: Providers });
    await waitFor(() => expect(p2.result.current.isSuccess).toBe(true));

    // Rows differ per page; the collection-wide summary does not.
    expect(p1.result.current.data!.rows[0].id).not.toBe(p2.result.current.data!.rows[0].id);
    expect(p1.result.current.data!.summary!.current_balance_summary.base_total).toBe(
      p2.result.current.data!.summary!.current_balance_summary.base_total,
    );
    expect(p2.result.current.data!.pagination.total).toBe(40);
  });

  it("cannot leave a hidden row inside the summary while dropping it from the table", async () => {
    // The backend excludes hidden customers from BOTH rows and summary via one
    // scoped_customers CTE. The hook must therefore trust the response as-is:
    // a row it displays is a row the summary counted.
    const scopedSummary = collectionSummary(
      monetarySummary([{ currency: "USD", amount: 100, base_amount: 445, count: 1 }], 445),
      monetarySummary([{ currency: "USD", amount: 100, base_amount: 445, count: 1 }], 445, "MYR", "original_document_total"),
    );
    fakeApi = createFakeApi([
      route("/invoices", () => ({
        data: [invoiceFixture()],
        meta: { total: 1, page: 1, page_size: 20, summary: scopedSummary },
      })),
    ]);

    const { result } = renderHook(() => useInvoiceList({ page: 1, page_size: 20 }), { wrapper: Providers });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rows = result.current.data!.rows;
    const summaryCount = result.current.data!.summary!.current_balance_summary.row_count;
    expect(rows).toHaveLength(summaryCount);
    expect(result.current.data!.pagination.total).toBe(summaryCount);
  });

  it("forwards doc_type as a server filter for credit/debit notes", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => {
        expect(params.doc_type).toBe("Credit Note");
        return { data: [invoiceFixture({ doc_type: "Credit Note" })], meta: { total: 1, page: 1, page_size: 20, summary } };
      }),
    ]);

    const { result } = renderHook(() => useInvoiceList({ doc_type: "Credit Note", page: 1, page_size: 20 }), {
      wrapper: Providers,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fakeApi.calls[0].params.doc_type).toBe("Credit Note");
  });
});

describe("totalPagesFrom", () => {
  it("derives page count from backend metadata and never returns 0", () => {
    expect(totalPagesFrom({ total: 1001, page: 1, page_size: 20 })).toBe(51);
    expect(totalPagesFrom({ total: 0, page: 1, page_size: 20 })).toBe(1);
    expect(totalPagesFrom(undefined)).toBe(1);
  });
});

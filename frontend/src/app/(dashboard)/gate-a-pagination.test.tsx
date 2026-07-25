// ============================================================================
// Gate A — bounded Invoice list pagination + "All statuses" polish.
// Renders the real invoice list page against a >15-row contract response.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  Providers,
  renderWithProviders,
  createFakeApi,
  route,
  invoiceFixture,
  receiptFixture,
  type FakeApi,
} from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});
vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({ baseCurrency: "MYR", isLoading: false, isUnavailable: false }),
}));
vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({ role: "AR Clerk", isLoading: false, email: "t@test", canPostInvoice: true, canCreateInvoice: true, canPostReceipt: true }),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import InvoiceListPage from "@/app/(dashboard)/invoices/page";
import ReceiptsListPage from "@/app/(dashboard)/receipts/page";
import { useInvoiceList } from "@/hooks/use-invoices";
import { useReceipts } from "@/hooks/use-receipts";

const TOTAL = 31;

function pageRows(page: number) {
  const count = page === 1 ? 15 : page === 2 ? 15 : 1;
  return Array.from({ length: count }, (_, i) =>
    invoiceFixture({ id: `inv-${page}-${i}`, invoice_no: `INV-P${page}-${String(i).padStart(2, "0")}`, currency: "MYR", base_currency: "MYR" }),
  );
}

function receiptPageRows(page: number) {
  const count = page === 1 ? 15 : page === 2 ? 15 : 1;
  return Array.from({ length: count }, (_, i) =>
    receiptFixture({
      id: `rcp-${page}-${i}`,
      receipt_no: `RCP-P${page}-${String(i).padStart(2, "0")}`,
      currency: "MYR",
      base_currency: "MYR",
    }),
  );
}

describe("Gate A — bounded invoice pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompanyStore.getState().setCompany("company-a", "Company A", "MYR");
  });

  it("renders 'All statuses', reaches page two of 31 rows, truthful totals, no all-rows query", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => ({
        data: pageRows(Number(params.page ?? 1)),
        meta: { total: TOTAL, page: Number(params.page ?? 1), page_size: 15 },
      })),
    ]);

    renderWithProviders(<InvoiceListPage />);

    // Page one of >15 rows.
    await waitFor(() => expect(screen.getByText("INV-P1-00")).toBeInTheDocument());
    // Status filter renamed.
    expect(screen.getByText("All statuses")).toBeInTheDocument();
    // Truthful footer count over the full result set.
    expect(screen.getByText(/of 31 records/i)).toBeInTheDocument();

    // Navigate to page two (second-page discoverability).
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(screen.getByText("INV-P2-00")).toBeInTheDocument());

    // Never an unbounded / "all rows" request — every page_size stays ≤ 100.
    const sizes = fakeApi.calls.filter((c) => c.path === "/invoices").map((c) => Number(c.params.page_size));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((s) => s > 0 && s <= 100)).toBe(true);
    expect(sizes).toContain(15);
  });

  it("changing the status filter resets pagination to page one", async () => {
    const seen: Array<{ page: unknown; status: unknown }> = [];
    fakeApi = createFakeApi([
      route("/invoices", (params) => {
        seen.push({ page: params.page, status: params.status });
        return { data: pageRows(Number(params.page ?? 1)), meta: { total: TOTAL, page: Number(params.page ?? 1), page_size: 15 } };
      }),
    ]);

    renderWithProviders(<InvoiceListPage />);
    await waitFor(() => expect(screen.getByText("INV-P1-00")).toBeInTheDocument());

    // Go to page two, then apply a status filter.
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(screen.getByText("INV-P2-00")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Draft$/ }));

    // The filtered request must be for page 1 (pagination reset).
    await waitFor(() => {
      const draftCall = seen.find((c) => c.status === "Draft");
      expect(draftCall).toBeTruthy();
      expect(Number(draftCall!.page)).toBe(1);
    });
  });

  it("does not reuse a fresh Invoice collection cache after a company switch", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => ({
        data: [],
        meta: { total: 0, page: 1, page_size: 15 },
      })),
    ]);
    const { result } = renderHook(
      () => useInvoiceList({ page: 1, page_size: 15 }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => useCompanyStore.getState().setCompany("company-b", "Company B", "SGD"));
    await waitFor(() => expect(fakeApi.getWithMeta).toHaveBeenCalledTimes(2));
  });
});

describe("Gate A — bounded receipt pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompanyStore.getState().setCompany("company-a", "Company A", "MYR");
  });

  it("renders 'All statuses', reaches page two, and keeps every request bounded to 15 rows", async () => {
    fakeApi = createFakeApi([
      route("/customers", () => ({ data: [] })),
      route("/receipts", (params) => ({
        data: receiptPageRows(Number(params.page ?? 1)),
        meta: { total: TOTAL, page: Number(params.page ?? 1), page_size: 15 },
      })),
    ]);

    renderWithProviders(<ReceiptsListPage />);

    await waitFor(() => expect(screen.getByText("RCP-P1-00")).toBeInTheDocument());
    expect(screen.getByText("All statuses")).toBeInTheDocument();
    expect(screen.getByText(/of 31 records/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(screen.getByText("RCP-P2-00")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /previous page/i })).toBeEnabled();

    const sizes = fakeApi.calls
      .filter((call) => call.path === "/receipts")
      .map((call) => Number(call.params.page_size));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((size) => size === 15 && size <= 100)).toBe(true);
  });

  it("changing a receipt status resets page two back to page one", async () => {
    const seen: Array<{ page: unknown; status: unknown }> = [];
    fakeApi = createFakeApi([
      route("/customers", () => ({ data: [] })),
      route("/receipts", (params) => {
        seen.push({ page: params.page, status: params.status });
        return {
          data: receiptPageRows(Number(params.page ?? 1)),
          meta: { total: TOTAL, page: Number(params.page ?? 1), page_size: 15 },
        };
      }),
    ]);

    renderWithProviders(<ReceiptsListPage />);
    await waitFor(() => expect(screen.getByText("RCP-P1-00")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(screen.getByText("RCP-P2-00")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Draft$/ }));

    await waitFor(() => {
      const draftCall = seen.find((call) => call.status === "Draft");
      expect(draftCall).toBeTruthy();
      expect(Number(draftCall!.page)).toBe(1);
    });
  });

  it("does not reuse a fresh Receipt collection cache after a company switch", async () => {
    fakeApi = createFakeApi([
      route("/receipts", () => ({
        data: [],
        meta: { total: 0, page: 1, page_size: 15 },
      })),
    ]);
    const { result } = renderHook(
      () => useReceipts({ page: 1, page_size: 15 }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => useCompanyStore.getState().setCompany("company-b", "Company B", "SGD"));
    await waitFor(() => expect(fakeApi.getWithMeta).toHaveBeenCalledTimes(2));
  });
});

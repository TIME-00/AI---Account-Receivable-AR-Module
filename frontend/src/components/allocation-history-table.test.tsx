// ============================================================================
// B9DD-FEIR-004 — allocation history must not cross-sum currencies.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";

const useAllocations = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-allocations", () => ({ useAllocations }));

import { AllocationHistoryTable } from "@/components/allocation-history-table";

/**
 * The "Active total (this page)" block. Row cells can legitimately show the same
 * formatted amount, so totals are asserted within this region specifically.
 */
function totalsRegion(): HTMLElement {
  return screen.getByText(/Active total \(this page\)/i).parentElement as HTMLElement;
}

interface AllocRow {
  id: string;
  receipt_id: string;
  receipt_no: string;
  invoice_id: string;
  invoice_no: string;
  customer_name: string;
  customer_code: string;
  allocated_amount: number;
  receipt_currency: string;
  receipt_amount: number;
  invoice_outstanding: number;
  allocation_date: string;
  allocation_method: "Manual";
  status: "Active" | "Reversed";
}

function alloc(overrides: Partial<AllocRow> = {}): AllocRow {
  return {
    id: "a1",
    receipt_id: "r1",
    receipt_no: "RCP-1",
    invoice_id: "i1",
    invoice_no: "INV-1",
    customer_name: "Acme",
    customer_code: "C1",
    allocated_amount: 100,
    receipt_currency: "USD",
    receipt_amount: 100,
    invoice_outstanding: 0,
    allocation_date: "2026-07-01",
    allocation_method: "Manual",
    status: "Active",
    ...overrides,
  };
}

function mockAllocations(allocations: AllocRow[]) {
  useAllocations.mockReturnValue({
    data: { allocations, meta: { total: allocations.length, page: 1, page_size: 10 } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe("AllocationHistoryTable — multi-currency totals", () => {
  it("groups active totals by receipt_currency instead of summing across them", () => {
    // The allocate_receipt invariant is per PAIR, not per page: an unscoped
    // (global) history legitimately mixes currencies.
    mockAllocations([
      alloc({ id: "a1", receipt_currency: "USD", allocated_amount: 100 }),
      alloc({ id: "a2", receipt_currency: "SGD", allocated_amount: 50 }),
      alloc({ id: "a3", receipt_currency: "MYR", allocated_amount: 200 }),
      alloc({ id: "a4", receipt_currency: "USD", allocated_amount: 25 }),
    ]);

    renderWithProviders(<AllocationHistoryTable />);
    const totals = totalsRegion();

    // One subtotal per currency…
    expect(within(totals).getByText("USD 125.00")).toBeInTheDocument();
    expect(within(totals).getByText("SGD 50.00")).toBeInTheDocument();
    expect(within(totals).getByText("MYR 200.00")).toBeInTheDocument();

    // …and never a combined 375 total under the first row's currency.
    expect(screen.queryByText("USD 375.00")).toBeNull();
    expect(screen.queryByText(/375\.00/)).toBeNull();
  });

  it("does not relabel other currencies with the first row's currency", () => {
    mockAllocations([
      alloc({ id: "a1", receipt_currency: "USD", allocated_amount: 100 }),
      alloc({ id: "a2", receipt_currency: "SGD", allocated_amount: 50 }),
    ]);

    renderWithProviders(<AllocationHistoryTable />);
    const totals = totalsRegion();
    // The old code rendered "USD 150.00" (sum, labelled with allocations[0]).
    expect(screen.queryByText("USD 150.00")).toBeNull();
    expect(within(totals).getByText("USD 100.00")).toBeInTheDocument();
    expect(within(totals).getByText("SGD 50.00")).toBeInTheDocument();
  });

  it("labels the total's scope explicitly as the current page", () => {
    mockAllocations([alloc()]);
    renderWithProviders(<AllocationHistoryTable />);
    expect(screen.getByText(/Active total \(this page\)/i)).toBeInTheDocument();
  });

  it("renders a single subtotal for a single-currency history", () => {
    mockAllocations([
      alloc({ id: "a1", receipt_currency: "MYR", allocated_amount: 300 }),
      alloc({ id: "a2", receipt_currency: "MYR", allocated_amount: 245 }),
    ]);
    renderWithProviders(<AllocationHistoryTable />);
    // 300 + 245 within ONE currency is a legitimate same-currency sum.
    expect(within(totalsRegion()).getByText("MYR 545.00")).toBeInTheDocument();
  });

  it("excludes reversed allocations from the active totals", () => {
    mockAllocations([
      alloc({ id: "a1", receipt_currency: "USD", allocated_amount: 100, status: "Active" }),
      alloc({ id: "a2", receipt_currency: "USD", allocated_amount: 900, status: "Reversed" }),
    ]);
    renderWithProviders(<AllocationHistoryTable />);
    expect(within(totalsRegion()).getByText("USD 100.00")).toBeInTheDocument();
    expect(screen.queryByText("USD 1,000.00")).toBeNull();
  });

  it("does not invent a company-base rollup (the contract supplies none)", () => {
    mockAllocations([
      alloc({ id: "a1", receipt_currency: "USD", allocated_amount: 100 }),
      alloc({ id: "a2", receipt_currency: "SGD", allocated_amount: 50 }),
    ]);
    renderWithProviders(<AllocationHistoryTable />);
    expect(screen.queryByText(/company-base/i)).toBeNull();
  });

  it("renders each row amount in its own currency", () => {
    mockAllocations([alloc({ receipt_currency: "EUR", allocated_amount: 42 })]);
    renderWithProviders(<AllocationHistoryTable />);
    expect(screen.getAllByText("EUR 42.00").length).toBeGreaterThan(0);
  });
});

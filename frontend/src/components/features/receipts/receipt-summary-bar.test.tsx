// ============================================================================
// B9DD-RR-003 — base preview labels and parity use the AUTHORITATIVE company
// base currency, not a hard-coded "MYR".
//
// Pre-remediation source:
//   {watchCurrency !== "MYR" && watchAmount > 0 && (
//     <p>Base Currency (MYR)</p> …
//
// which showed a bogus conversion of an SGD-base company's own base currency,
// and no preview at all for MYR.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";

const baseCurrencyState = vi.hoisted(() => ({
  baseCurrency: null as string | null,
  isLoading: false,
  isUnavailable: false,
}));

vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => baseCurrencyState,
}));

import { ReceiptSummaryBar } from "@/components/features/receipts/receipt-summary-bar";

const baseProps = {
  watchAmount: 100,
  watchExchangeRate: 3.2,
  selectedCustomer: { customer_name: "Acme" },
  isPostMode: false,
  setIsPostMode: vi.fn(),
  isCreating: false,
  isPosting: false,
};

beforeEach(() => {
  baseCurrencyState.baseCurrency = "SGD";
  baseCurrencyState.isLoading = false;
  baseCurrencyState.isUnavailable = false;
});

describe("ReceiptSummaryBar — base preview (B9DD-RR-003)", () => {
  it("labels the base preview with the real base currency", () => {
    renderWithProviders(<ReceiptSummaryBar {...baseProps} watchCurrency="USD" />);
    expect(screen.getByText("Base Currency (SGD)")).toBeInTheDocument();
    // The old hard-coded label must be gone.
    expect(screen.queryByText("Base Currency (MYR)")).toBeNull();
    // 100 USD × 3.2 = SGD 320.00
    expect(screen.getByText("SGD 320.00")).toBeInTheDocument();
  });

  it("shows no conversion for an SGD-base company entering SGD (parity)", () => {
    renderWithProviders(<ReceiptSummaryBar {...baseProps} watchCurrency="SGD" />);
    // Parity: the transaction currency IS the base currency.
    expect(screen.queryByText(/Base Currency \(/)).toBeNull();
    expect(screen.getByText("SGD 100.00")).toBeInTheDocument();
  });

  it("shows a conversion for an MYR receipt when the base is SGD", () => {
    // The pre-remediation `watchCurrency !== "MYR"` suppressed this entirely.
    renderWithProviders(<ReceiptSummaryBar {...baseProps} watchCurrency="MYR" />);
    expect(screen.getByText("Base Currency (SGD)")).toBeInTheDocument();
    expect(screen.getByText("MYR 100.00")).toBeInTheDocument();
  });

  it("states the base currency is unavailable rather than assuming one", () => {
    baseCurrencyState.baseCurrency = null;
    baseCurrencyState.isUnavailable = true;
    renderWithProviders(<ReceiptSummaryBar {...baseProps} watchCurrency="USD" />);
    expect(screen.getByText(/Base currency unavailable/i)).toBeInTheDocument();
    // No conversion is presented under an unknown base.
    expect(screen.queryByText(/Base Currency \(/)).toBeNull();
    expect(screen.queryByText("MYR 320.00")).toBeNull();
  });

  it("marks the base figure as an estimate until posting", () => {
    renderWithProviders(<ReceiptSummaryBar {...baseProps} watchCurrency="USD" />);
    expect(screen.getByText(/Estimate — the rate is booked when the receipt is posted/i)).toBeInTheDocument();
  });

  it("renders the receipt amount with its explicit transaction currency", () => {
    renderWithProviders(<ReceiptSummaryBar {...baseProps} watchCurrency="USD" />);
    expect(screen.getByText("USD 100.00")).toBeInTheDocument();
  });
});

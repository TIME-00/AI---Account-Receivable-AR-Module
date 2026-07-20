import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneySummary } from "@/components/ui/money-summary";
import { CurrencySubtotals } from "@/components/ui/currency-subtotals";
import { sumByCurrency } from "@/lib/currency";
import type { MonetarySummary } from "@/types/monetary";

const mixedSummary: MonetarySummary = {
  row_count: 3,
  amount_basis: "current_outstanding",
  base_total: 545,
  base_currency: "MYR",
  by_currency: [
    { currency: "MYR", amount: 100, base_amount: 100, count: 1 },
    { currency: "USD", amount: 100, base_amount: 445, count: 2 },
  ],
  meta: {
    base_currency: "MYR",
    multi_currency: true,
    normalization_basis: "current_balance_x_booked_rate",
  },
};

describe("MoneySummary", () => {
  it("shows per-currency native subtotals", () => {
    render(<MoneySummary summary={mixedSummary} title="Outstanding" />);
    expect(screen.getByText(/MYR 100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/USD 100\.00/)).toBeInTheDocument();
  });

  it("shows a separate company-base total labelled as converted for mixed currency", () => {
    render(<MoneySummary summary={mixedSummary} />);
    expect(screen.getByText("MYR 545.00")).toBeInTheDocument();
    expect(screen.getByText(/not the sum of native subtotals/i)).toBeInTheDocument();
  });
});

describe("CurrencySubtotals", () => {
  it("renders one line per currency and no combined cross-currency total", () => {
    const rows = [
      { currency: "USD", amount: 100 },
      { currency: "SGD", amount: 50 },
      { currency: "USD", amount: 25 },
    ];
    const subtotals = sumByCurrency(rows, (r) => r.currency, (r) => r.amount);
    render(<CurrencySubtotals subtotals={subtotals} />);
    expect(screen.getByText("USD 125.00")).toBeInTheDocument();
    expect(screen.getByText("SGD 50.00")).toBeInTheDocument();
    // No "175" combined total is ever produced.
    expect(screen.queryByText(/175/)).toBeNull();
  });
});

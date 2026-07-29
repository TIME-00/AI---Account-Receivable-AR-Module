import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import { parseCollectionSummary } from "@/lib/monetary-summary";
import { collectionSummaryV2 } from "@/test/harness";

describe("CurrencyTotals authority states", () => {
  it("keeps native values visible and labels partial/all-unavailable base contributions", () => {
    const parsed = parseCollectionSummary(
      collectionSummaryV2("current_outstanding", "partial"),
      { currentAmountBasis: "current_outstanding" },
    );
    render(
      <CurrencyTotals
        byCurrency={parsed.currentBalance.byCurrency}
        baseCurrency="MYR"
        showBaseContribution
      />,
    );

    expect(screen.getAllByText("MYR 125.50").length).toBeGreaterThan(0);
    expect(screen.getByText("USD 100.00")).toBeInTheDocument();
    expect(screen.getByText("Base not available")).toBeInTheDocument();
  });

  it("does not expose a legacy base contribution", () => {
    const raw = {
      current_balance_summary: {
        row_count: 1,
        amount_basis: "current_outstanding",
        base_total: 445,
        base_currency: "MYR",
        by_currency: [
          { currency: "USD", amount: 100, base_amount: 445, count: 1 },
        ],
        meta: {
          base_currency: "MYR",
          multi_currency: false,
          normalization_basis: "current_balance_x_booked_rate",
        },
      },
      document_total_summary: {
        row_count: 1,
        amount_basis: "original_document_total",
        base_total: 445,
        base_currency: "MYR",
        by_currency: [
          { currency: "USD", amount: 100, base_amount: 445, count: 1 },
        ],
        meta: {
          base_currency: "MYR",
          multi_currency: false,
          normalization_basis: "original_booked_base_snapshot",
        },
      },
    };
    const parsed = parseCollectionSummary(raw, {
      currentAmountBasis: "current_outstanding",
    });
    render(
      <CurrencyTotals
        byCurrency={parsed.currentBalance.byCurrency}
        baseCurrency="MYR"
        showBaseContribution
      />,
    );
    expect(screen.getByText("USD 100.00")).toBeInTheDocument();
    expect(screen.queryByText(/base contribution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/445/)).not.toBeInTheDocument();
  });
});

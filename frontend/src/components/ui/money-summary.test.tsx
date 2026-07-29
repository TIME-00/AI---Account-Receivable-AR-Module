import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneySummary } from "@/components/ui/money-summary";
import { CurrencySubtotals } from "@/components/ui/currency-subtotals";
import { sumByCurrency } from "@/lib/currency";
import { parseCollectionSummary } from "@/lib/monetary-summary";
import { collectionSummaryV2 } from "@/test/harness";

const rawMixedSummary = {
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
const rawDocumentSummary = {
  ...rawMixedSummary,
  amount_basis: "original_document_total",
  meta: {
    ...rawMixedSummary.meta,
    normalization_basis: "original_booked_base_snapshot",
  },
};
const mixedSummary = parseCollectionSummary(
  {
    current_balance_summary: rawMixedSummary,
    document_total_summary: rawDocumentSummary,
  },
  { currentAmountBasis: "current_outstanding" },
).currentBalance;

describe("MoneySummary", () => {
  it("shows per-currency native subtotals", () => {
    render(<MoneySummary summary={mixedSummary} title="Outstanding" />);
    expect(screen.getByText(/MYR 100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/USD 100\.00/)).toBeInTheDocument();
  });

  it("keeps the legacy company-base total unverified", () => {
    render(<MoneySummary summary={mixedSummary} />);
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.queryByText("MYR 545.00")).not.toBeInTheDocument();
  });

  it("renders a complete v2 company-base total without a warning", () => {
    const parsed = parseCollectionSummary(
      collectionSummaryV2("current_outstanding", "complete"),
      { currentAmountBasis: "current_outstanding" },
    );
    render(<MoneySummary summary={parsed.currentBalance} />);
    expect(screen.getByText("MYR 575.50")).toBeInTheDocument();
    expect(screen.queryByText(/excludes/i)).not.toBeInTheDocument();
  });

  it("renders only the authoritative partial subtotal and plural exclusion warning", () => {
    const parsed = parseCollectionSummary(
      collectionSummaryV2("current_outstanding", "partial"),
      { currentAmountBasis: "current_outstanding" },
    );
    render(<MoneySummary summary={parsed.currentBalance} />);
    expect(
      screen.getByText("Authoritative company-base subtotal"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("MYR 125.50").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Company-base total excludes 2 documents without verified booked FX.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Base not available")).toBeInTheDocument();
  });

  it("renders all-unavailable and empty v2 summaries with distinct semantics", () => {
    const unavailable = parseCollectionSummary(
      collectionSummaryV2("current_outstanding", "all-unavailable"),
      { currentAmountBasis: "current_outstanding" },
    );
    const empty = parseCollectionSummary(
      collectionSummaryV2("current_outstanding", "empty"),
      { currentAmountBasis: "current_outstanding" },
    );
    const { rerender } = render(
      <MoneySummary summary={unavailable.currentBalance} />,
    );
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.queryByText("MYR 0.00")).not.toBeInTheDocument();

    rerender(<MoneySummary summary={empty.currentBalance} />);
    expect(screen.getByText("MYR 0.00")).toBeInTheDocument();
    expect(screen.queryByText(/excludes/i)).not.toBeInTheDocument();
  });

  it("uses the singular exclusion warning for exactly one unavailable document", () => {
    const raw = collectionSummaryV2("current_outstanding", "partial");
    for (const summary of [
      raw.current_balance_summary,
      raw.document_total_summary,
    ]) {
      summary.row_count = 2;
      summary.matching_document_count = 2;
      summary.unavailable_count = 1;
      summary.by_currency[1].count = 1;
      summary.by_currency[1].unavailable_count = 1;
      summary.unavailable_by_currency[0].document_count = 1;
    }
    const parsed = parseCollectionSummary(raw, {
      currentAmountBasis: "current_outstanding",
    });
    render(<MoneySummary summary={parsed.currentBalance} />);
    expect(
      screen.getByText(
        "Company-base total excludes 1 document without verified booked FX.",
      ),
    ).toBeInTheDocument();
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

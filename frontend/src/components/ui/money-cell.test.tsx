import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyCell } from "@/components/ui/money-cell";
import { resolveFxRateDisplay } from "@/lib/fx-presentation";
import { fxDecision } from "@/test/harness";

describe("MoneyCell", () => {
  it("shows the transaction amount with an explicit currency code", () => {
    render(<MoneyCell amount={1234.5} currency="USD" baseCurrency="MYR" />);
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText(/1,234\.50/)).toBeInTheDocument();
  });

  it("renders a booked base amount without an approximation prefix for posted docs", () => {
    render(
      <MoneyCell amount={100} currency="USD" baseAmount={445} baseCurrency="MYR" baseAvailable baseBasis="booked" />,
    );
    const line = screen.getByText(/Booked base/i).parentElement;
    expect(line?.textContent).toContain("445.00");
    expect(line?.textContent).not.toContain("≈");
  });

  it("renders an estimated base with an approximation prefix for drafts", () => {
    render(
      <MoneyCell amount={100} currency="USD" baseAmount={450} baseCurrency="MYR" baseAvailable baseBasis="estimated" />,
    );
    const line = screen.getByText(/Estimated base/i).parentElement;
    expect(line?.textContent).toContain("≈");
    expect(line?.textContent).toContain("450.00");
  });

  it("does not render a redundant base line when currency equals base currency", () => {
    render(<MoneyCell amount={100} currency="MYR" baseAmount={100} baseCurrency="MYR" baseAvailable />);
    expect(screen.queryByText(/Booked base/i)).toBeNull();
    expect(screen.queryByText(/Estimated base/i)).toBeNull();
  });

  it("shows an explicit unavailable state instead of a fabricated rate", () => {
    render(
      <MoneyCell amount={100} currency="USD" baseAmount={null} baseCurrency="MYR" baseAvailable={false} />,
    );
    expect(screen.getByText(/Base not available/i)).toBeInTheDocument();
  });

  it("surfaces an exception decision chip in compact mode", () => {
    render(
      <MoneyCell amount={100} currency="USD" baseCurrency="MYR" decisionReason="stale_decision" />,
    );
    expect(screen.getByText(/Stale reference/i)).toBeInTheDocument();
  });

  it("does not clutter compact rows with a nominal (approved) decision chip", () => {
    render(
      <MoneyCell amount={100} currency="USD" baseCurrency="MYR" decisionReason="approved" mode="compact" />,
    );
    // "Approved" is nominal; compact mode should not render it as a chip.
    expect(screen.queryByText(/Approved/i)).toBeNull();
  });

  it("does not mislabel an already-posted booked document as Blocked", () => {
    const fxRate = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ source_category: "CATALOG", booked_rate: 4.45 }),
    });
    render(
      <MoneyCell
        amount={100}
        currency="USD"
        baseCurrency="MYR"
        fxRate={fxRate}
        decisionReason="blocked"
        documentPosted
        mode="compact"
      />,
    );
    expect(screen.getByText(/^Booked rate$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Blocked$/i)).toBeNull();
  });

  it("keeps a genuine draft blocked decision as a danger state", () => {
    const fxRate = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: false,
      draftExchangeRate: 4.45,
    });
    render(
      <MoneyCell
        amount={100}
        currency="USD"
        baseCurrency="MYR"
        fxRate={fxRate}
        decisionReason="blocked"
        mode="detailed"
      />,
    );
    expect(screen.getByText(/^Blocked$/i)).toBeInTheDocument();
  });

  it("shows the truthful legacy warning in compact rows without implying current valuation", () => {
    const fxRate = resolveFxRateDisplay({
      currency: "USD",
      baseCurrency: "MYR",
      documentPosted: true,
      decision: fxDecision({ source_category: "LEGACY_UNVERIFIED", booked_rate: 1 }),
    });
    render(
      <MoneyCell
        amount={100}
        currency="USD"
        baseCurrency="MYR"
        fxRate={fxRate}
        documentPosted
        decisionReason="blocked"
      />,
    );
    const chip = screen.getByText("Legacy rate unverified").closest("[title]");
    expect(chip).toHaveAttribute("title", expect.stringMatching(/historical booked snapshot/i));
    expect(chip).toHaveAttribute("title", expect.stringMatching(/not a present market\/MAS valuation/i));
    expect(screen.queryByText(/^Blocked$/i)).toBeNull();
  });
});

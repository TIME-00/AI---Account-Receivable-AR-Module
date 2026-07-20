import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyCell } from "@/components/ui/money-cell";

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
});

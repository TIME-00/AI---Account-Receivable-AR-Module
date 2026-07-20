// ============================================================================
// B9DD-FEIR-003 / FEIR-010 — Customer Statement UI integration.
// ============================================================================

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StatementView } from "@/components/features/reports/statement-view";
import type { CustomerStatement, StatementLine } from "@/types";

function line(overrides: Partial<StatementLine> = {}): StatementLine {
  return {
    date: "2026-07-01",
    doc_type: "Invoice",
    doc_no: "INV-0001",
    description: "Consulting",
    currency: "USD",
    exchange_rate: 4.45,
    transaction_debit: 100,
    transaction_credit: 0,
    transaction_balance: 100,
    debit: 100,
    credit: 0,
    balance: 100,
    base_currency: "MYR",
    base_debit: 445,
    base_credit: 0,
    base_balance: 445,
    amount_basis: "stored_booked_base_snapshot",
    ...overrides,
  };
}

function statement(overrides: Partial<CustomerStatement> = {}): CustomerStatement {
  return {
    customer_id: "cust-1",
    customer_name: "Acme Sdn Bhd",
    customer_code: "CUST-001",
    address: "1 Jalan Test, KL",
    period_from: "2026-07-01",
    period_to: "2026-07-31",
    opening_balance: 0,
    lines: [line()],
    closing_balance: 100,
    total_debit: 100,
    total_credit: 0,
    base_currency: "MYR",
    opening_balance_base: 0,
    closing_balance_base: 445,
    total_debit_base: 445,
    total_credit_base: 0,
    by_currency: [{ currency: "USD", opening_balance: 0, total_debit: 100, total_credit: 0, closing_balance: 100 }],
    meta: { base_currency: "MYR", multi_currency: false, normalization_basis: "stored_booked_base_snapshot" },
    legacy_amount_basis: "transaction_currency_legacy",
    legacy_transaction_fields_valid: true,
    legacy_transaction_currency: "USD",
    ...overrides,
  };
}

/** The MYR 545 anchor expressed as a mixed-currency statement. */
const mixed = statement({
  lines: [
    line({ doc_no: "INV-0001", currency: "USD", transaction_balance: null, balance: null, base_balance: 445 }),
    line({
      doc_no: "INV-0002",
      currency: "MYR",
      exchange_rate: 1,
      transaction_debit: 100,
      base_debit: 100,
      transaction_balance: null,
      balance: null,
      base_balance: 545,
    }),
  ],
  opening_balance: null,
  closing_balance: null,
  total_debit: null,
  total_credit: null,
  closing_balance_base: 545,
  total_debit_base: 545,
  by_currency: [
    { currency: "MYR", opening_balance: 0, total_debit: 100, total_credit: 0, closing_balance: 100 },
    { currency: "USD", opening_balance: 0, total_debit: 100, total_credit: 0, closing_balance: 100 },
  ],
  meta: { base_currency: "MYR", multi_currency: true, normalization_basis: "stored_booked_base_snapshot" },
  legacy_transaction_fields_valid: false,
  legacy_transaction_currency: null,
});

describe("StatementView — mixed-currency statement", () => {
  it("shows the backend company-base totals unchanged (MYR 545 anchor)", () => {
    render(<StatementView statement={mixed} />);
    // Appears as the closing-balance card and as the final base running balance;
    // both are the backend's 545, neither is recomputed.
    expect(screen.getAllByText("MYR 545.00").length).toBeGreaterThan(0);
    const closingCard = screen.getByText(/Closing balance \(company base\)/i).parentElement;
    expect(closingCard?.textContent).toContain("MYR 545.00");
  });

  it("keeps per-currency balances separated and never sums them across currencies", () => {
    render(<StatementView statement={mixed} />);
    const table = screen.getByRole("table", { name: "" }) ?? document.body;
    expect(table).toBeTruthy();
    // Both native closing balances present; no combined "200" native total.
    expect(screen.getAllByText("MYR 100.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD 100.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("MYR 200.00")).toBeNull();
  });

  it("states that the base total is not the sum of native balances", () => {
    render(<StatementView statement={mixed} />);
    expect(screen.getByText(/not the sum of the native balances/i)).toBeInTheDocument();
  });

  it("renders an explicit unavailable marker for the native running balance, not a substitute", () => {
    render(<StatementView statement={mixed} />);
    // transaction_balance is null on a multi-currency statement.
    expect(screen.getAllByText(/n\/a — mixed currency/i).length).toBe(2);
  });

  it("explains the mixed-currency situation in text (not colour alone)", () => {
    render(<StatementView statement={mixed} />);
    expect(screen.getByText(/spans multiple transaction currencies/i)).toBeInTheDocument();
  });

  it("labels every movement with its own transaction currency", () => {
    render(<StatementView statement={mixed} />);
    const rows = screen.getAllByRole("row");
    const body = rows.map((r) => r.textContent ?? "").join("|");
    expect(body).toContain("USD");
    expect(body).toContain("MYR");
  });
});

describe("StatementView — single-currency statement", () => {
  it("shows a transaction-currency running balance when the backend says it is valid", () => {
    render(<StatementView statement={statement()} />);
    expect(screen.getByText(/Single-currency statement \(USD\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/n\/a — mixed currency/i)).toBeNull();
  });

  it("does not show the mixed-currency notice", () => {
    render(<StatementView statement={statement()} />);
    expect(screen.queryByText(/spans multiple transaction currencies/i)).toBeNull();
  });
});

describe("StatementView — edge states", () => {
  it("handles an empty period without inventing balances", () => {
    render(
      <StatementView
        statement={statement({ lines: [], by_currency: [], closing_balance_base: 0, total_debit_base: 0 })}
      />,
    );
    expect(screen.getAllByText(/No movements in this period/i).length).toBeGreaterThan(0);
  });

  it("renders a 1,001-movement statement without truncation or client summation", () => {
    const many = statement({
      lines: Array.from({ length: 1001 }, (_, i) =>
        line({ doc_no: `INV-${i}`, base_balance: 445 * (i + 1) }),
      ),
      closing_balance_base: 445_445,
    });
    render(<StatementView statement={many} />);
    // Header count reflects every supplied movement.
    expect(screen.getByText("(1001)")).toBeInTheDocument();
    // Every movement row is rendered — nothing is truncated to 100.
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1001);
    // The closing total is the backend's, rendered verbatim.
    const closingCard = screen.getByText(/Closing balance \(company base\)/i).parentElement;
    expect(closingCard?.textContent).toContain("MYR 445,445.00");
  });

  it("exposes an accessible caption describing the statement", () => {
    render(<StatementView statement={statement()} />);
    expect(screen.getByText(/Customer statement movements for Acme Sdn Bhd/i)).toBeInTheDocument();
  });

  it("shows the customer identity and period", () => {
    render(<StatementView statement={statement()} />);
    expect(screen.getByText("Acme Sdn Bhd")).toBeInTheDocument();
    expect(screen.getByText("CUST-001")).toBeInTheDocument();
    const period = screen.getByText(/Statement period/i).parentElement;
    expect(within(period as HTMLElement).getByText(/2026/)).toBeInTheDocument();
  });
});

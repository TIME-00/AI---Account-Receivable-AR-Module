// ============================================================================
// B9DD-RR-004 — every allocation-workflow amount carries an explicit basis.
//
// Pre-remediation source rendered `formatAmount(...)` for invoice totals,
// outstanding, allocation input maxima, the balance bar and forex G/L — all
// codeless — and the validation message named no amounts at all.
//
// Backend contracts relied on (read, not assumed):
//   • allocations/service.ts ~445: candidate invoices are filtered
//     `.eq('currency', receipt.currency)` — allocation is SAME-CURRENCY.
//   • migration 028: forex_gain_loss = ROUND(allocated_amount *
//     (receipt_rate - invoice_rate), 2) — a COMPANY-BASE amount.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";
import { AllocationTable } from "@/components/features/allocations/allocation-table";
import type { AllocationInvoice } from "@/hooks/use-allocation-logic";

const invoices: AllocationInvoice[] = [
  {
    id: "inv-1",
    invoice_no: "INV-0001",
    doc_type: "Invoice",
    invoice_date: "2026-06-01",
    due_date: "2026-07-01",
    currency: "USD",
    exchange_rate: 4.4,
    total_amount: 1000,
    outstanding: 400,
    overdue_days: 3,
  },
];

const lines = [
  {
    invoice_id: "inv-1",
    invoice_no: "INV-0001",
    doc_type: "Invoice",
    max_amount: 400,
    amount: 250,
    discount_amount: 10,
    forex_gain_loss: 25,
    is_auto: false,
    errors: [] as string[],
  },
];

const validation = {
  totalAllocating: 250,
  availableBalance: 300,
  remainingBalance: 50,
  isBalanceValid: true,
  canSubmit: true,
  activeLineCount: 1,
};

const baseProps = {
  lines,
  invoices,
  isFifoPreview: false,
  receiptCurrency: "USD",
  baseCurrency: "MYR" as string | null,
  validation,
  onUpdateAmount: vi.fn(),
  onUpdateDiscount: vi.fn(),
  onFillMax: vi.fn(),
  onRemoveInvoice: vi.fn(),
  onClearLines: vi.fn(),
  onRunFifo: vi.fn(),
  onSubmit: vi.fn(),
  isSubmitting: false,
};

describe("AllocationTable — explicit currency basis (B9DD-RR-004)", () => {
  it("names the receipt currency on every transaction-money column", () => {
    renderWithProviders(<AllocationTable {...baseProps} />);
    expect(screen.getByText(/Invoice Total \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText(/Outstanding \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText(/Allocate \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText(/Discount \(USD\)/)).toBeInTheDocument();
  });

  it("renders invoice total and outstanding with the transaction currency", () => {
    renderWithProviders(<AllocationTable {...baseProps} />);
    expect(screen.getByText("USD 1,000.00")).toBeInTheDocument();
    expect(screen.getByText("USD 400.00")).toBeInTheDocument();
  });

  it("labels forex gain/loss as COMPANY BASE, not the transaction currency", () => {
    renderWithProviders(<AllocationTable {...baseProps} />);
    expect(screen.getByText(/Forex G\/L \(MYR, company base\)/)).toBeInTheDocument();
    // The gain is denominated in the base currency…
    expect(screen.getByText(/MYR 25\.00/)).toBeInTheDocument();
    // …and never in the receipt's currency.
    expect(screen.queryByText(/USD 25\.00/)).toBeNull();
  });

  it("shows an explicit basis-not-specified state when the base currency is unavailable", () => {
    renderWithProviders(<AllocationTable {...baseProps} baseCurrency={null} />);
    expect(screen.getByText(/Basis not specified/i)).toBeInTheDocument();
    // No bare number is shown, and no currency is guessed.
    expect(screen.queryByText(/MYR 25\.00/)).toBeNull();
    expect(screen.queryByText(/USD 25\.00/)).toBeNull();
    expect(screen.getByText(/company base — unavailable/i)).toBeInTheDocument();
  });

  it("renders the balance bar with the receipt currency throughout", () => {
    renderWithProviders(<AllocationTable {...baseProps} />);
    expect(screen.getByText(/Receipt unallocated \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText(/Allocating \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText(/Unapplied receipt balance \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText("USD 300.00")).toBeInTheDocument();
    expect(screen.getByText("USD 250.00")).toBeInTheDocument();
  });

  it("states amounts with currency in the over-allocation validation message", () => {
    renderWithProviders(
      <AllocationTable
        {...baseProps}
        validation={{ ...validation, totalAllocating: 500, remainingBalance: -200, isBalanceValid: false, canSubmit: false }}
      />,
    );
    const msg = screen.getByText(/cannot exceed/i);
    expect(msg.textContent).toContain("USD 500.00");
    expect(msg.textContent).toContain("USD 300.00");
  });

  it("states the retained unapplied balance with its currency", () => {
    renderWithProviders(<AllocationTable {...baseProps} />);
    expect(screen.getByText(/retain an unapplied balance of USD 50\.00/i)).toBeInTheDocument();
  });

  it("declares the same-currency invariant rather than implying cross-currency allocation", () => {
    renderWithProviders(<AllocationTable {...baseProps} />);
    const footer = screen.getByText(/Allocation is same-currency/i);
    expect(footer.textContent).toMatch(/only USD invoices can be allocated to this USD receipt/i);
  });

  it("describes forex as a company-base preview recalculated by the backend", () => {
    renderWithProviders(<AllocationTable {...baseProps} />);
    expect(screen.getByText(/Forex G\/L is a company-base \(MYR\) preview only/i)).toBeInTheDocument();
  });

  it("renders a per-line error with the allocation row", () => {
    renderWithProviders(
      <AllocationTable
        {...baseProps}
        lines={[{ ...lines[0], errors: ["Allocation exceeds invoice outstanding"] }]}
      />,
    );
    expect(screen.getByText(/Allocation exceeds invoice outstanding/i)).toBeInTheDocument();
  });

  it("renders no monetary value without a currency in the whole table", () => {
    const { container } = renderWithProviders(<AllocationTable {...baseProps} />);
    // Every rendered money-looking cell should be prefixed by a code. Scan the
    // mono-font cells (which hold amounts) for a bare "1,000.00"-style value.
    const monoCells = Array.from(container.querySelectorAll(".font-mono"));
    for (const cell of monoCells) {
      const text = (cell.textContent ?? "").trim();
      if (!/\d/.test(text)) continue;
      // Inputs hold raw numbers by design; skip them.
      if (cell.querySelector("input")) continue;
      if (/^\d[\d,]*\.\d{2}$/.test(text) || /^[+-]\d[\d,]*\.\d{2}$/.test(text)) {
        throw new Error(`Codeless monetary value rendered: "${text}"`);
      }
    }
  });

  it("exposes no auto-allocation trigger", () => {
    const { container } = renderWithProviders(<AllocationTable {...baseProps} />);
    // The FIFO button is a local preview; it must not be an /allocations/auto call.
    expect(container.textContent).not.toMatch(/allocations\/auto/);
  });
});

describe("AllocationTable — empty state", () => {
  it("renders safely with no lines", () => {
    renderWithProviders(<AllocationTable {...baseProps} lines={[]} />);
    expect(screen.getByText(/Add invoices from the right panel/i)).toBeInTheDocument();
  });
});

describe("AllocationTable — SGD receipt", () => {
  it("uses the receipt's own currency, not a hard-coded one", () => {
    renderWithProviders(
      <AllocationTable
        {...baseProps}
        receiptCurrency="SGD"
        baseCurrency="MYR"
        invoices={[{ ...invoices[0], currency: "SGD" }]}
      />,
    );
    expect(screen.getByText(/Allocate \(SGD\)/)).toBeInTheDocument();
    const bar = screen.getByText(/Receipt unallocated \(SGD\)/).parentElement as HTMLElement;
    expect(within(bar).getByText("SGD 300.00")).toBeInTheDocument();
    expect(screen.queryByText(/\(MYR\)$/)).toBeNull();
  });
});

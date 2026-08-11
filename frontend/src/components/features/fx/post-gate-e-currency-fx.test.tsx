// ============================================================================
// Post-Gate-E — FX reference freshness + currency scope + base availability
//
// Two authorities are deliberately DIFFERENT and this suite pins both:
//
//   * NEW AR transactions (Invoice / Credit Note / Debit Note / Receipt) may
//     only be created in MYR or SGD. The selectors offer exactly those, and a
//     retained legacy customer default (USD/EUR/…) is clamped rather than
//     pre-selected into a document the backend would reject with
//     UNSUPPORTED_TRANSACTION_CURRENCY.
//   * HISTORICAL records keep the broad read/report vocabulary. USD/EUR/GBP/CNY
//     documents still render, still parse, and are never re-valued client-side.
//
// FX behaviour: MYR→MYR is exact parity (no provider lookup at all); SGD uses
// the authoritative reference for the DOCUMENT TRANSACTION DATE, requeried when
// that date changes; stale/missing/forward-dated references fail closed and are
// never presented as bookable. Staleness age is in BUSINESS days.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Providers,
  createFakeApi,
  customerFixture,
  collectionSummaryV2,
  route,
  type FakeApi,
} from "@/test/harness";
import type { FxLookupResponse } from "@/types/fx-lookup";
import {
  invoiceFormSchema,
  defaultInvoiceValues,
  type InvoiceFormValues,
} from "@/lib/invoice-schema";
import {
  receiptFormSchema,
  defaultReceiptValues,
  type ReceiptFormValues,
} from "@/lib/receipt-schema";
import { InvoiceHeaderForm } from "@/components/features/invoices/invoice-header-form";
import { ReceiptFormAmount } from "@/components/features/receipts/receipt-form-amount";
import { ReceiptFormCustomer } from "@/components/features/receipts/receipt-form-customer";
import { FxRateField } from "@/components/features/fx/fx-rate-field";
import { MoneyCell } from "@/components/ui/money-cell";
import { MoneySummary } from "@/components/ui/money-summary";
import { parseCollectionSummary } from "@/lib/monetary-summary";
import { getErrorMessage } from "@/lib/error-messages";
import {
  SUPPORTED_CURRENCIES,
  SUPPORTED_TRANSACTION_CURRENCIES,
  clampToSupportedTransactionCurrency,
  formatMoneySafe,
  isSupportedTransactionCurrency,
  normalizeCurrency,
} from "@/lib/currency";

const SGD_REFERENCE_ID = "55555555-5555-4555-8555-555555555555";
const TXN_DATE = "2026-07-24";
const LATER_DATE = "2026-07-31";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

let baseCurrency: string | null = "MYR";
vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({
    baseCurrency,
    isLoading: false,
    isUnavailable: baseCurrency === null,
  }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

function sgdLookup(overrides: {
  effectiveDate?: string;
  requestedDate?: string;
  isStale?: boolean;
  ageDays?: number | null;
} = {}): FxLookupResponse {
  const effective = overrides.effectiveDate ?? TXN_DATE;
  return {
    found: true,
    requested_date: overrides.requestedDate ?? TXN_DATE,
    actual_effective_date: effective,
    reference_only: true,
    stale: {
      is_stale: overrides.isStale ?? false,
      stale_reason: overrides.isStale ? "exceeds_max_age" : null,
      age_days: overrides.ageDays ?? 0,
    },
    rate: {
      id: SGD_REFERENCE_ID,
      company_id: "co-1",
      from_currency: "SGD",
      to_currency: "MYR",
      rate: 3.31,
      effective_date: effective,
      provider: "Frankfurter (ECB/MAS-backed)",
      provider_rate_type: "reference",
      provider_timestamp: null,
      fetched_at: null,
      sync_run_id: null,
      status: "Active",
      supersedes_rate_id: null,
      created_at: `${effective}T00:00:00Z`,
    },
  };
}

const notFoundLookup: FxLookupResponse = {
  found: false,
  requested_date: TXN_DATE,
  reason: "no_rate_on_or_before_requested_date",
} as unknown as FxLookupResponse;

function lookupRoute(respond: (params: Record<string, unknown>) => FxLookupResponse) {
  return route("/fx-rates/lookup", (params) => ({ data: respond(params) }));
}

// ─── Harnesses that render the REAL form sections ───────────────────────────

function InvoiceHarness({
  currency = "",
  docType = "Invoice",
  customers = [],
}: {
  currency?: string;
  docType?: InvoiceFormValues["doc_type"];
  customers?: ReturnType<typeof customerFixture>[];
}) {
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      ...defaultInvoiceValues(),
      doc_type: docType,
      currency,
      invoice_date: TXN_DATE,
    },
    mode: "onChange",
  });
  return (
    <>
      <div data-testid="form-currency">{form.watch("currency") || "none"}</div>
      <div data-testid="form-ref-id">{form.watch("fx_reference_rate_id") || "none"}</div>
      <InvoiceHeaderForm
        form={form}
        customers={customers}
        paymentTerms={[]}
        setCustomerSearch={() => {}}
        selectedCustomerName=""
        setSelectedCustomerName={() => {}}
        selectedTermId={null}
        setSelectedTermId={() => {}}
        fieldErrors={{}}
        calculatedDueDate={null}
      />
    </>
  );
}

function ReceiptAmountHarness({ currency }: { currency: string }) {
  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: {
      ...defaultReceiptValues(),
      currency,
      receipt_date: TXN_DATE,
      receipt_amount: 100,
    },
    mode: "onChange",
  });
  const watched = form.watch("currency");
  return (
    <>
      <div data-testid="form-currency">{watched || "none"}</div>
      <div data-testid="form-ref-id">{form.watch("fx_reference_rate_id") || "none"}</div>
      {/* The receipt DATE lives in the customer section; both are rendered so a
          date change can be observed driving the FX lookup in the amount card. */}
      <ReceiptFormCustomer
        form={form}
        customers={[]}
        exposure={undefined}
        exposureLoading={false}
        exposureError={false}
        selectedCustomer={undefined}
        watchCustomerId=""
      />
      <ReceiptFormAmount form={form} watchCurrency={watched} watchAmount={100} />
    </>
  );
}

function ReceiptCustomerHarness({
  customers,
}: {
  customers: ReturnType<typeof customerFixture>[];
}) {
  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: { ...defaultReceiptValues(), receipt_date: TXN_DATE },
    mode: "onChange",
  });
  return (
    <>
      <div data-testid="form-currency">{form.watch("currency") || "none"}</div>
      <ReceiptFormCustomer
        form={form}
        customers={customers}
        exposure={undefined}
        exposureLoading={false}
        exposureError={false}
        selectedCustomer={undefined}
        watchCustomerId=""
      />
    </>
  );
}

/** Read the option codes of the currency <select> only (not doc_type/terms). */
function currencyOptionCodes(): string[] {
  const select = document.querySelector<HTMLSelectElement>('select[name="currency"]');
  if (!select) throw new Error("currency select not rendered");
  return [...select.options].map((option) => option.value);
}

function selectCustomerNamed(name: string) {
  fireEvent.focus(screen.getByPlaceholderText(/Search or enter a new customer name/i));
  fireEvent.click(screen.getByText(name));
}

beforeEach(() => {
  baseCurrency = "MYR";
  fakeApi = createFakeApi([lookupRoute(() => sgdLookup())]);
  vi.clearAllMocks();
});

// ─── 1-4: NEW-document currency selectors offer exactly MYR + SGD ───────────

describe("new-document currency selectors", () => {
  it("New Invoice offers exactly MYR and SGD", () => {
    render(<InvoiceHarness />, { wrapper: Providers });
    expect(currencyOptionCodes()).toEqual(["MYR", "SGD"]);
    for (const legacy of ["USD", "EUR", "GBP", "CNY"]) {
      expect(currencyOptionCodes()).not.toContain(legacy);
    }
    expect(screen.getByText(/MYR — Malaysian Ringgit/)).toBeInTheDocument();
    expect(screen.getByText(/SGD — Singapore Dollar/)).toBeInTheDocument();
  });

  it("New Credit Note follows the same MYR/SGD authority", () => {
    render(<InvoiceHarness docType="Credit Note" />, { wrapper: Providers });
    expect(
      (document.querySelector('select[name="doc_type"]') as HTMLSelectElement).value,
    ).toBe("Credit Note");
    expect(currencyOptionCodes()).toEqual(["MYR", "SGD"]);
  });

  it("New Debit Note follows the same MYR/SGD authority", () => {
    render(<InvoiceHarness docType="Debit Note" />, { wrapper: Providers });
    expect(
      (document.querySelector('select[name="doc_type"]') as HTMLSelectElement).value,
    ).toBe("Debit Note");
    expect(currencyOptionCodes()).toEqual(["MYR", "SGD"]);
  });

  it("switching doc type at runtime never widens the currency vocabulary", () => {
    render(<InvoiceHarness />, { wrapper: Providers });
    const docType = document.querySelector('select[name="doc_type"]') as HTMLSelectElement;
    for (const value of ["Credit Note", "Debit Note", "Invoice"]) {
      fireEvent.change(docType, { target: { value } });
      expect(currencyOptionCodes()).toEqual(["MYR", "SGD"]);
    }
  });

  it("New Receipt offers exactly MYR and SGD", () => {
    render(<ReceiptAmountHarness currency="MYR" />, { wrapper: Providers });
    expect(currencyOptionCodes()).toEqual(["MYR", "SGD"]);
    for (const legacy of ["USD", "EUR", "GBP", "CNY"]) {
      expect(currencyOptionCodes()).not.toContain(legacy);
    }
  });

  it("the allow-list itself is exactly MYR + SGD and narrower than the read vocabulary", () => {
    expect([...SUPPORTED_TRANSACTION_CURRENCIES]).toEqual(["MYR", "SGD"]);
    expect(SUPPORTED_TRANSACTION_CURRENCIES.length).toBeLessThan(
      SUPPORTED_CURRENCIES.length,
    );
  });
});

// ─── 8-9: legacy customer defaults are clamped, never adopted ───────────────

describe("legacy customer default currency is clamped for NEW documents", () => {
  it("a USD-default customer cannot start a NEW Invoice in USD", async () => {
    const legacy = customerFixture({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      customer_name: "Legacy USD Holdings",
      default_currency: "USD",
    });
    render(<InvoiceHarness customers={[legacy]} />, { wrapper: Providers });

    selectCustomerNamed("Legacy USD Holdings");

    await waitFor(() =>
      expect(screen.getByTestId("form-currency").textContent).toBe("MYR"),
    );
    expect(screen.getByTestId("form-currency").textContent).not.toBe("USD");
    // The form value must be one the selector can actually represent.
    expect(currencyOptionCodes()).toContain(
      screen.getByTestId("form-currency").textContent,
    );
  });

  it("a EUR-default customer cannot start a NEW Receipt in EUR", async () => {
    const legacy = customerFixture({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      customer_name: "Legacy EUR Trading",
      default_currency: "EUR",
    });
    render(<ReceiptCustomerHarness customers={[legacy]} />, { wrapper: Providers });

    selectCustomerNamed("Legacy EUR Trading");

    await waitFor(() =>
      expect(screen.getByTestId("form-currency").textContent).toBe("MYR"),
    );
    expect(screen.getByTestId("form-currency").textContent).not.toBe("EUR");
  });

  it("clamps to the company base when the base is itself supported", async () => {
    baseCurrency = "SGD";
    const legacy = customerFixture({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      customer_name: "Legacy GBP Ltd",
      default_currency: "GBP",
    });
    render(<InvoiceHarness customers={[legacy]} />, { wrapper: Providers });

    selectCustomerNamed("Legacy GBP Ltd");

    await waitFor(() =>
      expect(screen.getByTestId("form-currency").textContent).toBe("SGD"),
    );
  });

  it("keeps an already-supported customer default untouched", async () => {
    const supported = customerFixture({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      customer_name: "Singapore Ops Pte",
      default_currency: "SGD",
    });
    render(<InvoiceHarness customers={[supported]} />, { wrapper: Providers });

    selectCustomerNamed("Singapore Ops Pte");

    await waitFor(() =>
      expect(screen.getByTestId("form-currency").textContent).toBe("SGD"),
    );
  });

  it("clamping never mutates the customer's stored historical default", () => {
    const legacy = customerFixture({ default_currency: "USD" });
    const clamped = clampToSupportedTransactionCurrency(legacy.default_currency, "MYR");
    expect(clamped).toBe("MYR");
    // The customer master record is untouched — only the draft document moved.
    expect(legacy.default_currency).toBe("USD");
  });

  it("falls back to MYR when neither the default nor the base is supported", () => {
    expect(clampToSupportedTransactionCurrency("USD", "EUR")).toBe("MYR");
    expect(clampToSupportedTransactionCurrency(null, null)).toBe("MYR");
    expect(clampToSupportedTransactionCurrency(undefined, "JPY")).toBe("MYR");
    expect(isSupportedTransactionCurrency("USD")).toBe(false);
    expect(isSupportedTransactionCurrency("sgd")).toBe(true);
  });
});

// ─── 10-11: MYR base parity ─────────────────────────────────────────────────

describe("MYR base parity UX", () => {
  it("shows exact parity of 1 and performs NO provider lookup", async () => {
    render(<InvoiceHarness currency="MYR" />, { wrapper: Providers });

    expect(screen.getByTestId("fx-state-parity")).toBeInTheDocument();
    expect(screen.getByTestId("fx-state-parity").textContent).toContain("1.0000");
    expect(screen.getByTestId("fx-direction-label").textContent).toBe("(1 MYR = 1 MYR)");
    // No external reference is required, so no request may be issued at all.
    expect(fakeApi.calls.filter((c) => c.path === "/fx-rates/lookup")).toHaveLength(0);
    expect(screen.getByTestId("form-ref-id").textContent).toBe("none");
  });

  it("shows no stale/missing external-FX warning under parity", () => {
    render(<InvoiceHarness currency="MYR" />, { wrapper: Providers });
    expect(screen.queryByTestId("fx-state-stale")).toBeNull();
    expect(screen.queryByTestId("fx-state-missing")).toBeNull();
    expect(screen.queryByTestId("fx-state-error")).toBeNull();
    expect(screen.queryByText(/business day/i)).toBeNull();
    expect(screen.queryByText(/stale/i)).toBeNull();
  });

  it("does not emphasise Manual override when parity applies", () => {
    render(<ReceiptAmountHarness currency="MYR" />, { wrapper: Providers });
    expect(screen.getByTestId("fx-state-parity")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manual override/i })).toBeNull();
  });
});

// ─── 12-14: SGD uses the TRANSACTION-DATE reference, requeried on date change ─

describe("SGD authoritative transaction-date reference", () => {
  it("queries the reference for the document transaction date and attributes it", async () => {
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-reference")).toBeInTheDocument());

    const lookups = fakeApi.calls.filter((c) => c.path === "/fx-rates/lookup");
    expect(lookups.at(-1)!.params).toMatchObject({
      from_currency: "SGD",
      to_currency: "MYR",
      requested_date: TXN_DATE,
    });

    const box = screen.getByTestId("fx-state-reference");
    expect(screen.getByTestId("fx-reference-rate").textContent).toContain(
      "1 SGD = 3.3100 MYR",
    );
    expect(box.textContent).toContain("Authoritative reference exchange rate");
    expect(box.textContent).toContain("for this transaction date");
    expect(box.textContent).toContain(`effective ${TXN_DATE}`);
    expect(box.textContent).toContain("Frankfurter");
    // Accounting-accurate wording — never a tick-by-tick "real-time" claim, and
    // no unqualified direct-MAS-publication claim.
    expect(box.textContent).not.toMatch(/real[- ]time/i);
    expect(box.textContent).not.toMatch(/live market/i);
    await waitFor(() =>
      expect(screen.getByTestId("form-ref-id").textContent).toBe(SGD_REFERENCE_ID),
    );
  });

  it("changing the Invoice Date requeries FX for the NEW transaction date", async () => {
    fakeApi = createFakeApi([
      lookupRoute((params) =>
        sgdLookup({
          requestedDate: String(params.requested_date),
          effectiveDate: String(params.requested_date),
        }),
      ),
    ]);
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    await waitFor(() =>
      expect(screen.getByTestId("fx-state-reference").textContent).toContain(
        `effective ${TXN_DATE}`,
      ),
    );

    fireEvent.change(document.querySelector('input[name="invoice_date"]') as HTMLInputElement, {
      target: { value: LATER_DATE },
    });

    await waitFor(() =>
      expect(screen.getByTestId("fx-state-reference").textContent).toContain(
        `effective ${LATER_DATE}`,
      ),
    );
    const dates = fakeApi.calls
      .filter((c) => c.path === "/fx-rates/lookup")
      .map((c) => c.params.requested_date);
    expect(dates).toContain(TXN_DATE);
    expect(dates).toContain(LATER_DATE);
    // The displayed rate must not remain the prior date's selection.
    expect(screen.getByTestId("fx-state-reference").textContent).not.toContain(
      `effective ${TXN_DATE}`,
    );
  });

  it("changing the Receipt Date requeries FX for the NEW transaction date", async () => {
    fakeApi = createFakeApi([
      lookupRoute((params) =>
        sgdLookup({
          requestedDate: String(params.requested_date),
          effectiveDate: String(params.requested_date),
        }),
      ),
    ]);
    render(<ReceiptAmountHarness currency="SGD" />, { wrapper: Providers });

    await waitFor(() =>
      expect(screen.getByTestId("fx-state-reference").textContent).toContain(
        `effective ${TXN_DATE}`,
      ),
    );

    fireEvent.change(document.querySelector('input[name="receipt_date"]') as HTMLInputElement, {
      target: { value: LATER_DATE },
    });

    await waitFor(() =>
      expect(screen.getByTestId("fx-state-reference").textContent).toContain(
        `effective ${LATER_DATE}`,
      ),
    );
    expect(
      fakeApi.calls
        .filter((c) => c.path === "/fx-rates/lookup")
        .map((c) => c.params.requested_date),
    ).toContain(LATER_DATE);
  });
});

// ─── 15-19: fail-closed reference governance ───────────────────────────────

describe("reference governance fails closed", () => {
  it("never presents a FORWARD-DATED reference as bookable", async () => {
    fakeApi = createFakeApi([
      // effective_date AFTER the transaction date — not authority for that date.
      lookupRoute(() => sgdLookup({ effectiveDate: LATER_DATE, requestedDate: TXN_DATE })),
    ]);
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-missing")).toBeInTheDocument());
    expect(screen.queryByTestId("fx-state-reference")).toBeNull();
    expect(screen.getByTestId("form-ref-id").textContent).toBe("none");
  });

  it("a genuinely STALE reference is blocked and no rate is fabricated", async () => {
    fakeApi = createFakeApi([lookupRoute(() => sgdLookup({ isStale: true, ageDays: 4 }))]);
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-stale")).toBeInTheDocument());
    expect(screen.getByTestId("form-ref-id").textContent).toBe("none");
    expect(screen.queryByTestId("fx-state-reference")).toBeNull();
  });

  it("an UNAVAILABLE reference is blocked with an explicit, retryable state", async () => {
    fakeApi = createFakeApi([lookupRoute(() => notFoundLookup)]);
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-missing")).toBeInTheDocument());
    expect(screen.getByTestId("fx-state-missing").textContent).toContain(
      "Submission is blocked",
    );
    expect(screen.getByTestId("form-ref-id").textContent).toBe("none");
    expect(
      within(screen.getByTestId("fx-state-missing")).getByRole("button", { name: /Retry/i }),
    ).toBeInTheDocument();
  });

  it("staleness is worded in BUSINESS days, never calendar days", async () => {
    fakeApi = createFakeApi([lookupRoute(() => sgdLookup({ isStale: true, ageDays: 4 }))]);
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-stale")).toBeInTheDocument());
    const text = screen.getByTestId("fx-state-stale").textContent ?? "";
    expect(text).toContain("4 business days old");
    // The superseded calendar-day phrasing must be gone.
    expect(text).not.toMatch(/\d+ days old/);
  });

  it("uses the singular form for a one-business-day-old reference", async () => {
    fakeApi = createFakeApi([lookupRoute(() => sgdLookup({ isStale: true, ageDays: 1 }))]);
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-stale")).toBeInTheDocument());
    expect(screen.getByTestId("fx-state-stale").textContent).toContain(
      "1 business day old",
    );
  });

  it("Manual override stays governed by permission, not by the FX state", async () => {
    const noop = () => {};
    const { rerender } = render(
      <FxRateField
        currency="SGD"
        baseCurrency="MYR"
        effectiveDate={TXN_DATE}
        referenceRateId={null}
        onReferenceRateIdChange={noop}
        manualRate={null}
        onManualRateChange={noop}
        overrideReason=""
        onOverrideReasonChange={noop}
        overrideMode={false}
        onOverrideModeChange={noop}
        allowManualOverride={false}
      />,
      { wrapper: Providers },
    );
    await waitFor(() => expect(screen.getByTestId("fx-state-reference")).toBeInTheDocument());
    // Not permitted → the affordance is absent even though FX is resolved.
    expect(screen.queryByRole("button", { name: /Manual override/i })).toBeNull();

    rerender(
      <FxRateField
        currency="SGD"
        baseCurrency="MYR"
        effectiveDate={TXN_DATE}
        referenceRateId={null}
        onReferenceRateIdChange={noop}
        manualRate={null}
        onManualRateChange={noop}
        overrideReason=""
        onOverrideReasonChange={noop}
        overrideMode={false}
        onOverrideModeChange={noop}
        allowManualOverride
      />,
    );
    expect(
      screen.getByRole("button", { name: /Manual override/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

// ─── 20-21: bounded, non-leaking error UX ──────────────────────────────────

describe("currency & FX error mapping", () => {
  const internals = [
    /select\s/i, /pg_/i, /supabase/i, /postgres/i, /trigger/i, /constraint/i,
    /frankfurter\.app/i, /stack/i, /\bhttps?:\/\//i, /function\s+\w+\(/i,
  ];

  it("UNSUPPORTED_TRANSACTION_CURRENCY maps to a bounded, actionable message", () => {
    const message = getErrorMessage("UNSUPPORTED_TRANSACTION_CURRENCY");
    expect(message).toContain("MYR");
    expect(message).toContain("SGD");
    expect(message).toMatch(/remain viewable and reportable/i);
    expect(message).not.toBe("Operation failed (UNSUPPORTED_TRANSACTION_CURRENCY)");
    for (const pattern of internals) expect(message).not.toMatch(pattern);
  });

  it("FX_REFERENCE_UNAVAILABLE maps to a bounded, actionable message", () => {
    const message = getErrorMessage("FX_REFERENCE_UNAVAILABLE");
    expect(message).toMatch(/reference exchange rate is not available/i);
    expect(message).toMatch(/transaction date/i);
    expect(message).not.toBe("Operation failed (FX_REFERENCE_UNAVAILABLE)");
    for (const pattern of internals) expect(message).not.toMatch(pattern);
  });

  it("does not leak a raw backend message when a mapping exists", () => {
    const raw = 'new row violates trigger "ar_require_supported_transaction_currency"';
    expect(getErrorMessage("UNSUPPORTED_TRANSACTION_CURRENCY", raw)).not.toContain(
      "trigger",
    );
  });
});

// ─── 5-7, 25: historical records keep the broad vocabulary ─────────────────

describe("historical foreign-currency records still render", () => {
  it("renders a historical USD Invoice amount with its real currency", () => {
    render(
      <MoneyCell
        amount={1234.5}
        currency="USD"
        baseAmount={5493.5}
        baseCurrency="MYR"
        baseAvailable
        label="Document total"
      />,
    );
    expect(screen.getByText(/1,234.50/)).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText(/5,493.50/)).toBeInTheDocument();
  });

  it("renders a historical EUR Invoice amount with its real currency", () => {
    render(
      <MoneyCell amount={900} currency="EUR" baseAmount={4230} baseCurrency="MYR" baseAvailable />,
    );
    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByText(/900.00/)).toBeInTheDocument();
  });

  it("renders a historical SGD Receipt amount with its real currency", () => {
    render(
      <MoneyCell amount={500} currency="SGD" baseAmount={1655} baseCurrency="MYR" baseAvailable />,
    );
    expect(screen.getByText("SGD")).toBeInTheDocument();
    expect(screen.getByText(/500.00/)).toBeInTheDocument();
  });

  it("keeps the read/report parsing vocabulary broad", () => {
    expect([...SUPPORTED_CURRENCIES]).toEqual(["MYR", "SGD", "USD", "EUR", "GBP", "CNY"]);
    for (const code of ["USD", "EUR", "GBP", "CNY", "JPY"]) {
      expect(normalizeCurrency(code)).toBe(code);
      expect(formatMoneySafe(10, code)).toBe(`${code} 10.00`);
    }
    // Display never consults the NEW-transaction allow-list.
    expect(formatMoneySafe(10, "usd")).toBe("USD 10.00");
  });
});

// ─── 22-24: historical base-not-available stays fail closed ────────────────

describe("historical Base amount unavailable", () => {
  function partialSummary() {
    return parseCollectionSummary(collectionSummaryV2("current_outstanding", "partial"), {
      currentAmountBasis: "current_outstanding",
    }).currentBalance;
  }

  it("excludes unverified documents from the company-base total", () => {
    render(<MoneySummary summary={partialSummary()} />);
    // Native USD 100.00 is still shown; the base total is the MYR-only 125.50.
    expect(screen.getByText("USD 100.00")).toBeInTheDocument();
    expect(screen.getAllByText("MYR 125.50").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Company-base total excludes 2 documents without verified booked FX.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Base amount unavailable")).toBeInTheDocument();
  });

  it("never recomputes the excluded amount client-side at a current rate", () => {
    render(<MoneySummary summary={partialSummary()} />);
    const text = document.body.textContent ?? "";
    // USD 100 at any plausible current MYR rate would surface ~4xx; the base
    // total must stay exactly the authoritative booked 125.50.
    expect(text).not.toMatch(/5[0-9]{2}\.\d{2}/);
    expect(text).not.toContain("445.00");
    expect(text).not.toContain("450.00");
    expect(screen.queryByText(/current rate/i)).toBeNull();
  });

  it("labels an all-unavailable receipt/invoice group without inventing a total", () => {
    const summary = parseCollectionSummary(
      collectionSummaryV2("current_unallocated", "all-unavailable"),
      { currentAmountBasis: "current_unallocated" },
    ).currentBalance;
    render(<MoneySummary summary={summary} />);

    expect(screen.getByText("USD 100.00")).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.getByText("Base amount unavailable")).toBeInTheDocument();
  });

  it("explains the exclusion without promising a repair or a re-valuation", () => {
    render(
      <MoneyCell amount={100} currency="USD" baseAmount={null} baseCurrency="MYR" baseAvailable={false} />,
    );
    const help = screen.getByTitle(/verified booked FX rate/i);
    expect(help.textContent).toBe("Base amount unavailable");
    expect(help.getAttribute("title")).toMatch(/never re-valued at current rates/i);
    expect(help.getAttribute("title")).toContain("(MYR)");
    expect(help.getAttribute("title")).not.toMatch(/will be (fixed|repaired|backfilled)/i);
  });
});

// ─── 26: accessibility, loading and error states remain valid ──────────────

describe("accessibility, loading and error states", () => {
  it("announces the FX lookup and result states politely", async () => {
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByTestId("fx-state-reference")).toBeInTheDocument());
    expect(screen.getByTestId("fx-state-reference")).toHaveAttribute("role", "status");
  });

  it("marks the blocked missing state as a polite live region with a retry", async () => {
    fakeApi = createFakeApi([lookupRoute(() => notFoundLookup)]);
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    const box = await screen.findByTestId("fx-state-missing");
    expect(box).toHaveAttribute("role", "status");
    expect(box).toHaveAttribute("aria-live", "polite");
  });

  it("surfaces a request failure as an explicit, retryable error state", async () => {
    fakeApi = createFakeApi([
      route("/fx-rates/lookup", () => {
        throw new Error("network unreachable");
      }),
    ]);
    render(<InvoiceHarness currency="SGD" />, { wrapper: Providers });

    const box = await screen.findByTestId("fx-state-error");
    expect(box).toHaveAttribute("aria-live", "polite");
    expect(within(box).getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByTestId("form-ref-id").textContent).toBe("none");
  });

  it("keeps the currency selector labelled and keyboard reachable", () => {
    render(<InvoiceHarness />, { wrapper: Providers });
    const select = document.querySelector('select[name="currency"]') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.disabled).toBe(false);
    // The scope note is text, not colour-only signalling.
    expect(screen.getByText(/New documents use MYR or SGD/i)).toBeInTheDocument();
  });
});

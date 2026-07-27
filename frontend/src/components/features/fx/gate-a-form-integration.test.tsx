// ============================================================================
// Gate A — Invoice header + Receipt amount form integration of the shared
// governed FxRateField. Renders the REAL form sections.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { Providers, createFakeApi, route, type FakeApi } from "@/test/harness";
import type { FxLookupResponse } from "@/types/fx-lookup";
import { invoiceFormSchema, defaultInvoiceValues, type InvoiceFormValues } from "@/lib/invoice-schema";
import { receiptFormSchema, defaultReceiptValues, type ReceiptFormValues } from "@/lib/receipt-schema";
import { InvoiceHeaderForm } from "@/components/features/invoices/invoice-header-form";
import { ReceiptFormAmount } from "@/components/features/receipts/receipt-form-amount";
import { useCreateInvoice } from "@/hooks/use-invoices";
import { useCreateReceipt } from "@/hooks/use-receipts";
import { FEATURE_STATUS_ROWS } from "@/lib/feature-status";

let fakeApi: FakeApi;
const FRESH_REFERENCE_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_REFERENCE_ID = "22222222-2222-4222-8222-222222222222";
const RECEIPT_REFERENCE_ID = "33333333-3333-4333-8333-333333333333";
const FOREIGN_REFERENCE_ID = "44444444-4444-4444-8444-444444444444";

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

let baseCurrency: string | null = "MYR";
vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => ({ baseCurrency, isLoading: false, isUnavailable: baseCurrency === null }),
}));

function freshLookup(): FxLookupResponse {
  return {
    found: true, requested_date: "2026-07-24", actual_effective_date: "2026-07-24", reference_only: true,
    stale: { is_stale: false, stale_reason: null, age_days: 0 },
    rate: {
      id: FRESH_REFERENCE_ID, company_id: "co-1", from_currency: "USD", to_currency: "MYR", rate: 4.25,
      effective_date: "2026-07-24", provider: "MAS", provider_rate_type: "spot", provider_timestamp: null,
      fetched_at: null, sync_run_id: null, status: "Active", supersedes_rate_id: null, created_at: "2026-07-24T00:00:00Z",
    },
  };
}

function InvoiceHarness({ currency }: { currency: string }) {
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: { ...defaultInvoiceValues(), currency, invoice_date: "2026-07-24" },
    mode: "onChange",
  });
  const refId = form.watch("fx_reference_rate_id");
  return (
    <>
      <div data-testid="form-ref-id">{refId || "none"}</div>
      <InvoiceHeaderForm
        form={form}
        customers={[]}
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

function ReceiptHarness({ currency }: { currency: string }) {
  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: { ...defaultReceiptValues(), currency, receipt_date: "2026-07-24", receipt_amount: 100 },
    mode: "onChange",
  });
  const refId = form.watch("fx_reference_rate_id");
  return (
    <>
      <div data-testid="form-ref-id">{refId || "none"}</div>
      <ReceiptFormAmount form={form} watchCurrency={currency} watchAmount={100} />
    </>
  );
}

describe("Gate A — Invoice header FX integration", () => {
  beforeEach(() => { baseCurrency = "MYR"; vi.clearAllMocks(); });

  it("foreign currency: no literal '?', explicit direction, reference id set into the form", async () => {
    fakeApi = createFakeApi([route("/fx-rates/lookup", () => ({ data: freshLookup() }))]);
    render(<InvoiceHarness currency="USD" />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-reference")).toBeTruthy());
    expect(screen.getByTestId("fx-direction-label").textContent).not.toContain("?");
    expect(screen.getByTestId("fx-reference-rate").textContent).toContain("1 USD = 4.2500 MYR");
    await waitFor(() => expect(screen.getByTestId("form-ref-id").textContent).toBe(FRESH_REFERENCE_ID));
  });

  it("base parity: shows parity, no reference id required", async () => {
    fakeApi = createFakeApi([route("/fx-rates/lookup", () => ({ data: freshLookup() }))]);
    render(<InvoiceHarness currency="MYR" />, { wrapper: Providers });
    expect(screen.getByTestId("fx-state-parity")).toBeTruthy();
    expect(screen.getByTestId("form-ref-id").textContent).toBe("none");
  });
});

describe("Gate A — Receipt amount FX integration", () => {
  beforeEach(() => { baseCurrency = "MYR"; vi.clearAllMocks(); });

  it("foreign currency: no freely-editable rate-1 input; governed read-only reference is used", async () => {
    fakeApi = createFakeApi([route("/fx-rates/lookup", () => ({ data: freshLookup() }))]);
    render(<ReceiptHarness currency="USD" />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-reference")).toBeTruthy());
    // There is NO editable normal-mode exchange-rate number input defaulting to 1.
    expect(screen.queryByLabelText("Manual exchange rate")).toBeNull();
    expect(screen.getByTestId("fx-reference-rate").textContent).toContain("1 USD = 4.2500 MYR");
    await waitFor(() => expect(screen.getByTestId("form-ref-id").textContent).toBe(FRESH_REFERENCE_ID));
  });

  it("base parity: exact 1, no reference id", async () => {
    fakeApi = createFakeApi([route("/fx-rates/lookup", () => ({ data: freshLookup() }))]);
    render(<ReceiptHarness currency="MYR" />, { wrapper: Providers });
    expect(screen.getByTestId("fx-state-parity")).toBeTruthy();
    expect(screen.getByTestId("form-ref-id").textContent).toBe("none");
  });
});

describe("Gate A — final mutation payload authority", () => {
  beforeEach(() => {
    baseCurrency = "MYR";
    fakeApi = createFakeApi([]);
    vi.clearAllMocks();
  });

  it("Invoice reference mode sends only reference authority and never client base totals", async () => {
    const { result } = renderHook(() => useCreateInvoice(), { wrapper: Providers });
    await act(async () => {
      await result.current.mutateAsync({
        doc_type: "Invoice",
        invoice_date: "2026-07-24",
        customer_id: "customer-1",
        currency: "USD",
        exchange_rate: 4.25,
        fx_reference_rate_id: INVOICE_REFERENCE_ID,
        fx_override_reason: "must be stripped",
        lines: [{ description: "Consulting", quantity: 1, unit_price: 100 }],
      });
    });

    expect(fakeApi.post).toHaveBeenCalledTimes(1);
    const [path, body] = fakeApi.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/invoices");
    expect(body.fx_reference_rate_id).toBe(INVOICE_REFERENCE_ID);
    expect(body.exchange_rate).toBeUndefined();
    expect(body.fx_override_reason).toBeUndefined();
    expect(body).not.toHaveProperty("base_total");
    expect(body).not.toHaveProperty("company_id");
  });

  it("Invoice manual mode sends numeric authority and reason without a reference id", async () => {
    const { result } = renderHook(() => useCreateInvoice(), { wrapper: Providers });
    await act(async () => {
      await result.current.mutateAsync({
        doc_type: "Invoice",
        invoice_date: "2026-07-24",
        customer_id: "customer-1",
        currency: "USD",
        exchange_rate: 4.31,
        fx_override_reason: "bank advice",
        lines: [{ description: "Consulting", quantity: 1, unit_price: 100 }],
      });
    });

    const body = fakeApi.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.exchange_rate).toBe(4.31);
    expect(body.fx_override_reason).toBe("bank advice");
    expect(body.fx_reference_rate_id).toBeUndefined();
    expect(body).not.toHaveProperty("base_total");
  });

  it("Invoice base parity forces exact rate 1 and strips stale foreign authority", async () => {
    const { result } = renderHook(() => useCreateInvoice(), { wrapper: Providers });
    await act(async () => {
      await result.current.mutateAsync({
        doc_type: "Invoice",
        invoice_date: "2026-07-24",
        customer_id: "customer-1",
        currency: "MYR",
        exchange_rate: 99,
        fx_reference_rate_id: FOREIGN_REFERENCE_ID,
        fx_override_reason: "must not survive",
        lines: [{ description: "Consulting", quantity: 1, unit_price: 100 }],
      });
    });

    const body = fakeApi.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.exchange_rate).toBe(1);
    expect(body.fx_reference_rate_id).toBeUndefined();
    expect(body.fx_override_reason).toBeUndefined();
    expect(body).not.toHaveProperty("base_total");
  });

  it("Receipt reference mode sends only reference authority and never client base amounts", async () => {
    const { result } = renderHook(() => useCreateReceipt(), { wrapper: Providers });
    await act(async () => {
      await result.current.mutateAsync({
        baseCurrency: "MYR",
        values: {
          ...defaultReceiptValues(),
          receipt_date: "2026-07-24",
          customer_id: "customer-1",
          payment_method: "TT",
          currency: "USD",
          receipt_amount: 100,
          bank_account_id: "bank-1",
          exchange_rate: 4.25,
          fx_reference_rate_id: RECEIPT_REFERENCE_ID,
          fx_override_reason: "must be stripped",
        },
      });
    });

    expect(fakeApi.post).toHaveBeenCalledTimes(1);
    const [path, body] = fakeApi.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/receipts");
    expect(body.fx_reference_rate_id).toBe(RECEIPT_REFERENCE_ID);
    expect(body.exchange_rate).toBeUndefined();
    expect(body.fx_override_reason).toBeUndefined();
    expect(body).not.toHaveProperty("base_amount");
    expect(body).not.toHaveProperty("company_id");
  });

  it("Receipt manual mode preserves an intentional foreign rate of 1 and parity stays exact", async () => {
    const { result } = renderHook(() => useCreateReceipt(), { wrapper: Providers });
    await act(async () => {
      await result.current.mutateAsync({
        baseCurrency: "MYR",
        values: {
          ...defaultReceiptValues(),
          receipt_date: "2026-07-24",
          customer_id: "customer-1",
          payment_method: "TT",
          currency: "USD",
          receipt_amount: 100,
          bank_account_id: "bank-1",
          exchange_rate: 1,
          fx_override_reason: "approved legacy parity",
        },
      });
      await result.current.mutateAsync({
        baseCurrency: "MYR",
        values: {
          ...defaultReceiptValues(),
          receipt_date: "2026-07-24",
          customer_id: "customer-1",
          payment_method: "TT",
          currency: "MYR",
          receipt_amount: 100,
          bank_account_id: "bank-1",
          exchange_rate: 99,
          fx_reference_rate_id: FOREIGN_REFERENCE_ID,
          fx_override_reason: "must not survive",
        },
      });
    });

    const manual = fakeApi.post.mock.calls[0][1] as Record<string, unknown>;
    expect(manual.exchange_rate).toBe(1);
    expect(manual.fx_override_reason).toBe("approved legacy parity");
    expect(manual.fx_reference_rate_id).toBeUndefined();

    const parity = fakeApi.post.mock.calls[1][1] as Record<string, unknown>;
    expect(parity.exchange_rate).toBe(1);
    expect(parity.fx_reference_rate_id).toBeUndefined();
    expect(parity.fx_override_reason).toBeUndefined();
    expect(parity).not.toHaveProperty("base_amount");
  });

  it("fails closed before an API request when foreign FX authority is unresolved", async () => {
    const invoice = renderHook(() => useCreateInvoice(), { wrapper: Providers });
    await act(async () => {
      await expect(invoice.result.current.mutateAsync({
        doc_type: "Invoice",
        invoice_date: "2026-07-24",
        customer_id: "customer-1",
        currency: "USD",
        exchange_rate: 1,
        lines: [{ description: "Consulting", quantity: 1, unit_price: 100 }],
      })).rejects.toThrow(/fresh reference rate or governed manual override/i);
    });

    const receipt = renderHook(() => useCreateReceipt(), { wrapper: Providers });
    await act(async () => {
      await expect(receipt.result.current.mutateAsync({
        baseCurrency: "MYR",
        values: {
          ...defaultReceiptValues(),
          receipt_date: "2026-07-24",
          customer_id: "customer-1",
          payment_method: "TT",
          currency: "USD",
          receipt_amount: 100,
          bank_account_id: "bank-1",
          exchange_rate: 1,
        },
      })).rejects.toThrow(/fresh reference rate or governed manual override/i);
    });

    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("fails closed before an API request when authoritative base currency is unavailable", async () => {
    baseCurrency = null;
    const invoice = renderHook(() => useCreateInvoice(), { wrapper: Providers });
    await act(async () => {
      await expect(invoice.result.current.mutateAsync({
        doc_type: "Invoice",
        invoice_date: "2026-07-24",
        customer_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        currency: "USD",
        exchange_rate: 4.25,
        fx_reference_rate_id: INVOICE_REFERENCE_ID,
        lines: [{ description: "Consulting", quantity: 1, unit_price: 100 }],
      })).rejects.toThrow(/authoritative company and transaction currencies/i);
    });

    const receipt = renderHook(() => useCreateReceipt(), { wrapper: Providers });
    await act(async () => {
      await expect(receipt.result.current.mutateAsync({
        baseCurrency: "",
        values: {
          ...defaultReceiptValues(),
          receipt_date: "2026-07-24",
          customer_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          payment_method: "TT",
          currency: "USD",
          receipt_amount: 100,
          bank_account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          fx_reference_rate_id: RECEIPT_REFERENCE_ID,
        },
      })).rejects.toThrow(/authoritative company and transaction currencies/i);
    });

    expect(fakeApi.post).not.toHaveBeenCalled();
  });
});

describe("Gate A — Feature Status truthfulness", () => {
  it("marks only deployed Gate A work Live without duplicating Notifications/Report Export", () => {
    const names = FEATURE_STATUS_ROWS.map((row) => row.feature);
    expect(new Set(names).size).toBe(names.length);
    expect(
      FEATURE_STATUS_ROWS
        .filter((row) =>
          row.feature.startsWith("Governed FX")
          || row.feature.startsWith("Booked-Rate")
          || row.feature.startsWith("Bounded Invoice/Receipt Pagination")
        )
        .map((row) => row.status),
    ).toEqual(["Live", "Live", "Live"]);
    // Gate B implemented (local) the notification surface; it is import-alert-only
    // and Pending Deployment — never "Live" and never implying overdue alerts.
    expect(FEATURE_STATUS_ROWS.find((row) => row.feature.startsWith("Import Notifications"))?.status)
      .toBe("Implemented — Pending Deployment");
    expect(FEATURE_STATUS_ROWS.find((row) => row.feature.startsWith("Report Export"))?.status)
      .toBe("Planned");
    expect(FEATURE_STATUS_ROWS.find((row) => row.feature === "Daily FX Sync")?.status)
      .toBe("Live (Automated)");
  });
});

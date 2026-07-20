// ============================================================================
// B9DD-RR-003 — form currency must come from the authenticated company base,
// never from a hard-coded "MYR".
//
// Pre-remediation: `defaultInvoiceValues()` / `defaultReceiptValues()` returned
// `currency: "MYR"` outright, so an SGD-base company started every document in
// the wrong currency.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Providers } from "@/test/harness";
import { defaultInvoiceValues } from "@/lib/invoice-schema";
import { defaultReceiptValues } from "@/lib/receipt-schema";

const baseCurrencyState = vi.hoisted(() => ({
  baseCurrency: null as string | null,
  isLoading: false,
  isUnavailable: false,
}));

vi.mock("@/hooks/use-base-currency", () => ({
  useBaseCurrency: () => baseCurrencyState,
}));

import { useSeedBaseCurrency } from "@/hooks/use-seed-base-currency";

/** Minimal stand-in for the react-hook-form field the hook drives. */
function makeField(initial = "") {
  let value = initial;
  return {
    getCurrency: () => value,
    setCurrency: (c: string) => {
      value = c;
    },
    read: () => value,
  };
}

beforeEach(() => {
  baseCurrencyState.baseCurrency = null;
  baseCurrencyState.isLoading = false;
  baseCurrencyState.isUnavailable = false;
});

// ─── The defaults themselves ────────────────────────────────────────────────

describe("form defaults (B9DD-RR-003)", () => {
  it("does not default a new Invoice to MYR", () => {
    expect(defaultInvoiceValues().currency).toBe("");
  });

  it("does not default a new Receipt to MYR", () => {
    expect(defaultReceiptValues().currency).toBe("");
  });
});

// ─── Seeding from the authoritative base ────────────────────────────────────

describe("useSeedBaseCurrency", () => {
  it("seeds an SGD-base company's form with SGD", async () => {
    baseCurrencyState.baseCurrency = "SGD";
    const field = makeField();
    renderHook(() => useSeedBaseCurrency(field), { wrapper: Providers });
    await waitFor(() => expect(field.read()).toBe("SGD"));
    expect(field.read()).not.toBe("MYR");
  });

  it("leaves the field empty while the company context is still loading", async () => {
    baseCurrencyState.isLoading = true;
    const field = makeField();
    renderHook(() => useSeedBaseCurrency(field), { wrapper: Providers });
    await waitFor(() => expect(field.read()).toBe(""));
  });

  it("seeds after a DELAYED company context resolves", async () => {
    baseCurrencyState.isLoading = true;
    const field = makeField();
    const { rerender } = renderHook(() => useSeedBaseCurrency(field), { wrapper: Providers });
    expect(field.read()).toBe("");

    act(() => {
      baseCurrencyState.isLoading = false;
      baseCurrencyState.baseCurrency = "SGD";
    });
    rerender();
    await waitFor(() => expect(field.read()).toBe("SGD"));
  });

  it("fabricates nothing when the base currency is unavailable", async () => {
    baseCurrencyState.baseCurrency = null;
    baseCurrencyState.isUnavailable = true;
    const field = makeField();
    const { result } = renderHook(() => useSeedBaseCurrency(field), { wrapper: Providers });
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    // The critical property: still empty, NOT "MYR".
    expect(field.read()).toBe("");
  });

  it("does not seed a base currency outside the creation allow-list", async () => {
    // A historical/unsupported base must not be pushed into a NEW document.
    baseCurrencyState.baseCurrency = "JPY";
    const field = makeField();
    renderHook(() => useSeedBaseCurrency(field), { wrapper: Providers });
    await waitFor(() => expect(field.read()).toBe(""));
  });

  it("never overwrites a currency the user already chose", async () => {
    baseCurrencyState.baseCurrency = "SGD";
    // The user picked USD before /auth/me resolved.
    const field = makeField("USD");
    renderHook(() => useSeedBaseCurrency(field), { wrapper: Providers });
    await waitFor(() => expect(field.read()).toBe("USD"));
  });

  it("does not reset the user's choice when company context refreshes", async () => {
    baseCurrencyState.baseCurrency = "SGD";
    const field = makeField();
    const { rerender } = renderHook(() => useSeedBaseCurrency(field), { wrapper: Providers });
    await waitFor(() => expect(field.read()).toBe("SGD"));

    // User deliberately switches to USD…
    act(() => field.setCurrency("USD"));
    // …and the company context refetches (same value, new render).
    rerender();
    act(() => {
      baseCurrencyState.baseCurrency = "SGD";
    });
    rerender();

    await waitFor(() => expect(field.read()).toBe("USD"));
  });
});

// ============================================================================
// Gate A — shared governed FX reference-rate hook.
// Exercises the real hook against contract-shaped /fx-rates/lookup responses.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  Providers,
  createDeferred,
  createFakeApi,
  route,
  type FakeApi,
  type FakeResponse,
} from "@/test/harness";
import type { FxLookupResponse } from "@/types/fx-lookup";
import { useCompanyStore } from "@/stores/company-store";

let fakeApi: FakeApi;
const DEFAULT_REFERENCE_ID = "11111111-1111-4111-8111-111111111111";
const FRESH_REFERENCE_ID = "22222222-2222-4222-8222-222222222222";
const USD_REFERENCE_ID = "33333333-3333-4333-8333-333333333333";
const EUR_REFERENCE_ID = "44444444-4444-4444-8444-444444444444";
const COMPANY_ONE_REFERENCE_ID = "55555555-5555-4555-8555-555555555555";
const COMPANY_TWO_REFERENCE_ID = "66666666-6666-4666-8666-666666666666";
const BEFORE_OVERRIDE_REFERENCE_ID = "77777777-7777-4777-8777-777777777777";
const AFTER_OVERRIDE_REFERENCE_ID = "88888888-8888-4888-8888-888888888888";

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

import { useFxReferenceRate } from "@/hooks/use-fx-reference-rate";

function foundRate(
  overrides: Partial<{ id: string; rate: number; effective_date: string; provider: string; is_stale: boolean; age_days: number }> = {},
): Extract<FxLookupResponse, { found: true }> {
  const o = { id: DEFAULT_REFERENCE_ID, rate: 4.25, effective_date: "2026-07-24", provider: "MAS", is_stale: false, age_days: 0, ...overrides };
  return {
    found: true,
    requested_date: "2026-07-24",
    actual_effective_date: o.effective_date,
    reference_only: true,
    stale: { is_stale: o.is_stale, stale_reason: o.is_stale ? "effective_date_older_than_threshold" : null, age_days: o.age_days },
    rate: {
      id: o.id, company_id: "co-1", from_currency: "USD", to_currency: "MYR", rate: o.rate,
      effective_date: o.effective_date, provider: o.provider, provider_rate_type: "spot",
      provider_timestamp: null, fetched_at: null, sync_run_id: null, status: "Active",
      supersedes_rate_id: null, created_at: "2026-07-24T00:00:00Z",
    },
  };
}

const lookupRoute = (respond: () => FxLookupResponse) => route("/fx-rates/lookup", () => ({ data: respond() }));

describe("useFxReferenceRate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompanyStore.getState().setCompany("co-1", "Company One", "MYR");
  });

  it("returns base parity WITHOUT calling the lookup, rate exactly 1", async () => {
    fakeApi = createFakeApi([lookupRoute(() => foundRate())]);
    const { result } = renderHook(
      () => useFxReferenceRate({ currency: "MYR", baseCurrency: "MYR", effectiveDate: "2026-07-24" }),
      { wrapper: Providers },
    );
    expect(result.current.mode).toBe("base_parity");
    expect(result.current.rate).toBe(1);
    expect(result.current.canSubmitReference).toBe(false);
    expect(result.current.referenceRateId).toBeNull();
    // No network lookup for base parity.
    expect(fakeApi.calls.map((c) => c.path)).not.toContain("/fx-rates/lookup");
  });

  it("resolves a fresh reference: submittable, id present, explicit direction", async () => {
    fakeApi = createFakeApi([lookupRoute(() => foundRate({ id: FRESH_REFERENCE_ID, rate: 4.25 }))]);
    const { result } = renderHook(
      () => useFxReferenceRate({ currency: "USD", baseCurrency: "MYR", effectiveDate: "2026-07-24" }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.mode).toBe("reference"));
    expect(result.current.referenceRateId).toBe(FRESH_REFERENCE_ID);
    expect(result.current.canSubmitReference).toBe(true);
    expect(result.current.rate).toBe(4.25);
    expect(result.current.directionLabel).toBe("1 USD = 4.2500 MYR");
    // The lookup was called with the governed identity params.
    const call = fakeApi.calls.find((c) => c.path === "/fx-rates/lookup");
    expect(call?.params).toMatchObject({ from_currency: "USD", to_currency: "MYR", requested_date: "2026-07-24" });
  });

  it("missing reference is NOT submittable and NEVER falls back to rate 1", async () => {
    fakeApi = createFakeApi([
      route("/fx-rates/lookup", () => ({
        data: { found: false, requested_date: "2026-07-24", from_currency: "USD", to_currency: "MYR", reference_only: true } as FxLookupResponse,
      })),
    ]);
    const { result } = renderHook(
      () => useFxReferenceRate({ currency: "USD", baseCurrency: "MYR", effectiveDate: "2026-07-24" }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.mode).toBe("missing"));
    expect(result.current.referenceRateId).toBeNull();
    expect(result.current.canSubmitReference).toBe(false);
    expect(result.current.rate).not.toBe(1);
    expect(result.current.rate).toBeNull();
  });

  it("stale reference blocks REFERENCE_SELECTED and uses the backend stale verdict", async () => {
    fakeApi = createFakeApi([lookupRoute(() => foundRate({ is_stale: true, age_days: 9, rate: 4.4 }))]);
    const { result } = renderHook(
      () => useFxReferenceRate({ currency: "USD", baseCurrency: "MYR", effectiveDate: "2026-07-24" }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.mode).toBe("stale"));
    expect(result.current.isStale).toBe(true);
    expect(result.current.ageDays).toBe(9);
    expect(result.current.canSubmitReference).toBe(false);
    expect(result.current.referenceRateId).toBeNull();
    // The looked-up rate is shown for context — but not as a submittable selection.
    expect(result.current.rate).toBe(4.4);
  });

  it("is idle (no lookup) until currency, base and date are all known", async () => {
    fakeApi = createFakeApi([lookupRoute(() => foundRate())]);
    const { result } = renderHook(
      () => useFxReferenceRate({ currency: "USD", baseCurrency: null, effectiveDate: "2026-07-24" }),
      { wrapper: Providers },
    );
    expect(result.current.mode).toBe("idle");
    expect(fakeApi.calls.map((c) => c.path)).not.toContain("/fx-rates/lookup");
  });

  it("a changed effective date issues a fresh lookup (identity invalidation)", async () => {
    fakeApi = createFakeApi([lookupRoute(() => foundRate())]);
    const { result, rerender } = renderHook(
      ({ date }: { date: string }) => useFxReferenceRate({ currency: "USD", baseCurrency: "MYR", effectiveDate: date }),
      { wrapper: Providers, initialProps: { date: "2026-07-24" } },
    );
    await waitFor(() => expect(result.current.mode).toBe("reference"));
    rerender({ date: "2026-07-10" });
    await waitFor(() => {
      const dates = fakeApi.calls.filter((c) => c.path === "/fx-rates/lookup").map((c) => c.params.requested_date);
      expect(dates).toContain("2026-07-10");
    });
  });

  it("preserves a sanitized lookup error and exposes retry without a reference id", async () => {
    fakeApi = createFakeApi([
      route("/fx-rates/lookup", () => {
        throw new Error("Reference service unavailable");
      }),
    ]);
    const { result } = renderHook(
      () => useFxReferenceRate({ currency: "USD", baseCurrency: "MYR", effectiveDate: "2026-07-24" }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.mode).toBe("error"));
    expect(result.current.errorMessage).toBe("Reference service unavailable");
    expect(result.current.referenceRateId).toBeNull();
    expect(result.current.canSubmitReference).toBe(false);
  });

  it("does not allow a late response for an older currency to become booking authority", async () => {
    const usd = createDeferred<FakeResponse>();
    const eur = createDeferred<FakeResponse>();
    fakeApi = createFakeApi([
      route("/fx-rates/lookup", (params) =>
        params.from_currency === "USD" ? usd.promise : eur.promise,
      ),
    ]);
    const { result, rerender } = renderHook(
      ({ currency }: { currency: string }) =>
        useFxReferenceRate({ currency, baseCurrency: "MYR", effectiveDate: "2026-07-24" }),
      { wrapper: Providers, initialProps: { currency: "USD" } },
    );
    await waitFor(() => expect(fakeApi.calls.some((call) => call.params.from_currency === "USD")).toBe(true));

    rerender({ currency: "EUR" });
    await waitFor(() => expect(fakeApi.calls.some((call) => call.params.from_currency === "EUR")).toBe(true));
    await act(async () => {
      usd.resolve({ data: foundRate({ id: USD_REFERENCE_ID }) });
      await usd.promise;
    });
    expect(result.current.referenceRateId).not.toBe(USD_REFERENCE_ID);

    await act(async () => {
      eur.resolve({
        data: {
          ...foundRate({ id: EUR_REFERENCE_ID }),
          rate: { ...foundRate().rate, id: EUR_REFERENCE_ID, from_currency: "EUR" },
        },
      });
      await eur.promise;
    });
    await waitFor(() => expect(result.current.referenceRateId).toBe(EUR_REFERENCE_ID));
  });

  it("clears the selection and re-resolves authority when company context changes", async () => {
    let call = 0;
    fakeApi = createFakeApi([
      lookupRoute(() => foundRate({
        id: ++call === 1 ? COMPANY_ONE_REFERENCE_ID : COMPANY_TWO_REFERENCE_ID,
      })),
    ]);
    const { result } = renderHook(
      () => useFxReferenceRate({ currency: "USD", baseCurrency: "MYR", effectiveDate: "2026-07-24" }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.referenceRateId).toBe(COMPANY_ONE_REFERENCE_ID));

    act(() => useCompanyStore.getState().setCompany("co-2", "Company Two", "MYR"));
    await waitFor(() => expect(result.current.referenceRateId).toBe(COMPANY_TWO_REFERENCE_ID));
    expect(call).toBe(2);
  });

  it("re-enabling reference mode performs a fresh lookup instead of restoring the cached id", async () => {
    let call = 0;
    fakeApi = createFakeApi([
      lookupRoute(() => foundRate({
        id: ++call === 1 ? BEFORE_OVERRIDE_REFERENCE_ID : AFTER_OVERRIDE_REFERENCE_ID,
      })),
    ]);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useFxReferenceRate({
          currency: "USD",
          baseCurrency: "MYR",
          effectiveDate: "2026-07-24",
          enabled,
        }),
      { wrapper: Providers, initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.referenceRateId).toBe(BEFORE_OVERRIDE_REFERENCE_ID));

    rerender({ enabled: false });
    expect(result.current.referenceRateId).toBeNull();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.referenceRateId).toBe(AFTER_OVERRIDE_REFERENCE_ID));
    expect(call).toBe(2);
  });
});

// ============================================================================
// Gate A — shared governed FxRateField component.
// Renders the real component + real useFxReferenceRate against a fake lookup.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { Providers, createFakeApi, route, type FakeApi } from "@/test/harness";
import type { FxLookupResponse } from "@/types/fx-lookup";
import { useCompanyStore } from "@/stores/company-store";

let fakeApi: FakeApi;
const FRESH_REFERENCE_ID = "11111111-1111-4111-8111-111111111111";
const RETRIED_REFERENCE_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

import { FxRateField } from "@/components/features/fx/fx-rate-field";

function found(overrides: Partial<{ id: string; rate: number; is_stale: boolean; age_days: number }> = {}): FxLookupResponse {
  const o = { id: FRESH_REFERENCE_ID, rate: 4.25, is_stale: false, age_days: 0, ...overrides };
  return {
    found: true, requested_date: "2026-07-24", actual_effective_date: "2026-07-24", reference_only: true,
    stale: { is_stale: o.is_stale, stale_reason: o.is_stale ? "effective_date_older_than_threshold" : null, age_days: o.age_days },
    rate: {
      id: o.id, company_id: "co-1", from_currency: "USD", to_currency: "MYR", rate: o.rate,
      effective_date: "2026-07-24", provider: "MAS", provider_rate_type: "spot", provider_timestamp: null,
      fetched_at: null, sync_run_id: null, status: "Active", supersedes_rate_id: null, created_at: "2026-07-24T00:00:00Z",
    },
  };
}

function Harness(props: {
  currency: string;
  baseCurrency: string | null;
  date?: string;
  amount?: number;
  onSubmittable?: (v: boolean) => void;
}) {
  const [refId, setRefId] = useState<string | null>(null);
  const [manualRate, setManualRate] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  return (
    <>
      <div data-testid="ref-id">{refId ?? "none"}</div>
      <FxRateField
        currency={props.currency}
        baseCurrency={props.baseCurrency}
        effectiveDate={props.date ?? "2026-07-24"}
        amount={props.amount ?? 0}
        referenceRateId={refId}
        onReferenceRateIdChange={setRefId}
        manualRate={manualRate}
        onManualRateChange={setManualRate}
        overrideReason={reason}
        onOverrideReasonChange={setReason}
        overrideMode={override}
        onOverrideModeChange={setOverride}
        onSubmittableChange={props.onSubmittable}
      />
    </>
  );
}

describe("FxRateField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompanyStore.getState().setCompany("co-1", "Company One", "MYR");
  });

  it("fresh reference: read-only rate, explicit direction, no literal '?', selects the id", async () => {
    fakeApi = createFakeApi([route("/fx-rates/lookup", () => ({ data: found({ id: FRESH_REFERENCE_ID }) }))]);
    const onSubmittable = vi.fn();
    render(<Harness currency="USD" baseCurrency="MYR" amount={100} onSubmittable={onSubmittable} />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("fx-state-reference")).toBeTruthy());
    expect(screen.getByTestId("fx-reference-rate").textContent).toContain("1 USD = 4.2500 MYR");
    // The hard-coded "?" rate label is gone.
    expect(screen.getByTestId("fx-direction-label").textContent).not.toContain("?");
    // Governed id was pushed to the parent, and the field is submittable.
    await waitFor(() => expect(screen.getByTestId("ref-id").textContent).toBe(FRESH_REFERENCE_ID));
    expect(onSubmittable).toHaveBeenLastCalledWith(true);
    // Estimated base is present but explicitly non-authoritative.
    expect(screen.getByTestId("fx-estimated-base").textContent).toContain("not authoritative");
  });

  it("base parity: shows exact 1, no reference id, submittable", async () => {
    fakeApi = createFakeApi([route("/fx-rates/lookup", () => ({ data: found() }))]);
    const onSubmittable = vi.fn();
    render(<Harness currency="MYR" baseCurrency="MYR" onSubmittable={onSubmittable} />, { wrapper: Providers });
    expect(screen.getByTestId("fx-state-parity")).toBeTruthy();
    expect(screen.getByTestId("ref-id").textContent).toBe("none");
    expect(onSubmittable).toHaveBeenLastCalledWith(true);
  });

  it("missing reference: blocked, not submittable, retry available, no rate-1 fallback", async () => {
    fakeApi = createFakeApi([
      route("/fx-rates/lookup", () => ({
        data: { found: false, requested_date: "2026-07-24", from_currency: "USD", to_currency: "MYR", reference_only: true } as FxLookupResponse,
      })),
    ]);
    const onSubmittable = vi.fn();
    render(<Harness currency="USD" baseCurrency="MYR" onSubmittable={onSubmittable} />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByTestId("fx-state-missing")).toBeTruthy());
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.getByTestId("ref-id").textContent).toBe("none");
    expect(onSubmittable).toHaveBeenLastCalledWith(false);
  });

  it("stale reference: warning state, points to manual override, not submittable", async () => {
    fakeApi = createFakeApi([route("/fx-rates/lookup", () => ({ data: found({ is_stale: true, age_days: 9 }) }))]);
    const onSubmittable = vi.fn();
    render(<Harness currency="USD" baseCurrency="MYR" onSubmittable={onSubmittable} />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByTestId("fx-state-stale")).toBeTruthy());
    expect(screen.getByTestId("fx-state-stale").textContent).toMatch(/stale/i);
    expect(screen.getByTestId("fx-state-stale").textContent).toMatch(/Manual override/i);
    expect(screen.getByTestId("ref-id").textContent).toBe("none");
    expect(onSubmittable).toHaveBeenLastCalledWith(false);
  });

  it("manual override is a SEPARATE mode: clears the reference id, requires a reason ≥5", async () => {
    fakeApi = createFakeApi([route("/fx-rates/lookup", () => ({ data: found({ id: FRESH_REFERENCE_ID }) }))]);
    const onSubmittable = vi.fn();
    render(<Harness currency="USD" baseCurrency="MYR" amount={100} onSubmittable={onSubmittable} />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId("ref-id").textContent).toBe(FRESH_REFERENCE_ID));

    // Enter override mode → reference id is dropped (never combined).
    act(() => { fireEvent.click(screen.getByRole("button", { name: /Manual override/i })); });
    await waitFor(() => expect(screen.getByTestId("ref-id").textContent).toBe("none"));

    const rateInput = screen.getByLabelText("Manual exchange rate");
    const reason = screen.getByLabelText("Override reason");
    act(() => { fireEvent.change(rateInput, { target: { value: "4.3" } }); });
    act(() => { fireEvent.change(reason, { target: { value: "abc" } }); }); // <5 chars
    await waitFor(() => expect(onSubmittable).toHaveBeenLastCalledWith(false));
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAccessibleDescription(/at least 5 characters/i);

    act(() => { fireEvent.change(reason, { target: { value: "rate corrected per bank advice" } }); });
    await waitFor(() => expect(onSubmittable).toHaveBeenLastCalledWith(true));
  });

  it("preserves a sanitized backend error and retries without exposing a stale selection", async () => {
    let call = 0;
    fakeApi = createFakeApi([
      route("/fx-rates/lookup", () => {
        call += 1;
        if (call === 1) throw new Error("Reference service unavailable");
        return { data: found({ id: RETRIED_REFERENCE_ID }) };
      }),
    ]);
    render(<Harness currency="USD" baseCurrency="MYR" />, { wrapper: Providers });

    await waitFor(() =>
      expect(screen.getByTestId("fx-state-error")).toHaveTextContent("Reference service unavailable"),
    );
    expect(screen.getByTestId("ref-id")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("ref-id")).toHaveTextContent(RETRIED_REFERENCE_ID));
    expect(call).toBe(2);
  });
});

// ============================================================================
// TSH Synergy AR — Shared governed FX reference-rate hook (Gate A)
//
// One architecture for BOTH Invoice and Receipt foreign-currency entry. Calls
// GET /fx-rates/lookup with (transaction currency, company base currency,
// effective date) and derives a single governed state machine the shared
// FxRateField renders. Key invariants:
//   * Base parity (currency === base) NEVER calls the lookup.
//   * The query identity includes company context, both currencies and the
//     effective date, so any change invalidates the previous selection.
//   * Staleness is the backend's authoritative verdict — never recomputed here.
//   * A stale or missing reference is NOT submittable as REFERENCE_SELECTED and
//     never silently falls back to rate 1.
// ============================================================================

"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import { useCompanyStore } from "@/stores/company-store";
import { normalizeCurrency } from "@/lib/currency";
import { isFxLookupFound, type FxLookupResponse } from "@/types/fx-lookup";

export type FxReferenceMode =
  | "idle" // insufficient inputs (no currency/base/date yet)
  | "base_parity" // transaction currency === company base currency
  | "loading" // lookup in flight
  | "reference" // fresh, valid reference available and submittable
  | "stale" // reference found but stale — blocked for REFERENCE_SELECTED
  | "missing" // no reference rate on/before the effective date
  | "error"; // lookup request failed

export interface FxReferenceState {
  mode: FxReferenceMode;
  /** Submittable reference id — ONLY set in "reference" mode, else null. */
  referenceRateId: string | null;
  /** Display rate: 1 for parity; the looked-up rate for reference/stale. */
  rate: number | null;
  provider: string | null;
  providerRateType: string | null;
  effectiveDate: string | null;
  ageDays: number | null;
  isStale: boolean;
  /** "1 USD = 4.2500 MYR" — explicit transaction→base direction, or null. */
  directionLabel: string | null;
  /** True only when a governed REFERENCE_SELECTED submission is valid. */
  canSubmitReference: boolean;
  isFetching: boolean;
  /** Sanitized backend/client error text for the request-error state. */
  errorMessage: string | null;
  refetch: () => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function directionLabel(rate: number | null, from: string | null, base: string | null): string | null {
  if (rate === null || !from || !base) return null;
  return `1 ${from} = ${rate.toFixed(4)} ${base}`;
}

export interface UseFxReferenceRateArgs {
  /** Transaction currency (raw form value). */
  currency: string | null | undefined;
  /** Authoritative company base currency (from useBaseCurrency), or null. */
  baseCurrency: string | null | undefined;
  /** Invoice/Receipt effective date (YYYY-MM-DD). */
  effectiveDate: string | null | undefined;
  /** Allow the caller to suspend lookups (e.g. while a manual override is active). */
  enabled?: boolean;
}

/**
 * Governed reference-rate resolution shared by Invoice and Receipt FX entry.
 */
export function useFxReferenceRate({
  currency,
  baseCurrency,
  effectiveDate,
  enabled = true,
}: UseFxReferenceRateArgs): FxReferenceState {
  const companyId = useCompanyStore((s) => s.companyId);
  const api = useApi();

  const from = normalizeCurrency(currency);
  const base = normalizeCurrency(baseCurrency);
  const date = effectiveDate && DATE_RE.test(effectiveDate) ? effectiveDate : null;

  const isBaseParity = from !== null && base !== null && from === base;
  const hasInputs = from !== null && base !== null && date !== null;
  const hasCompany = companyId.trim().length > 0;
  const shouldLookup = enabled && hasCompany && hasInputs && !isBaseParity;

  const query = useQuery<FxLookupResponse>({
    // Company context + both currencies + the effective date form the identity.
    // Changing ANY of them invalidates the prior lookup and its selection.
    queryKey: ["fx-rates", "lookup", companyId, from, base, date],
    queryFn: () =>
      api.get<FxLookupResponse>("/fx-rates/lookup", {
        params: { from_currency: from!, to_currency: base!, requested_date: date! },
        silent: true,
      }),
    enabled: shouldLookup,
    // A reference is booking authority, not display-only cache data. Treat a
    // cached lookup as immediately stale so re-enabling after manual override
    // performs a fresh request instead of silently restoring an old id.
    staleTime: 0,
    retry: false,
  });

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  // ── Base parity: never look up; rate is exactly 1, no reference required. ──
  if (isBaseParity) {
    return {
      mode: "base_parity",
      referenceRateId: null,
      rate: 1,
      provider: null,
      providerRateType: null,
      effectiveDate: null,
      ageDays: null,
      isStale: false,
      directionLabel: null,
      canSubmitReference: false,
      isFetching: false,
      errorMessage: null,
      refetch,
    };
  }

  if (!shouldLookup) {
    return {
      mode: "idle",
      referenceRateId: null,
      rate: null,
      provider: null,
      providerRateType: null,
      effectiveDate: null,
      ageDays: null,
      isStale: false,
      directionLabel: null,
      canSubmitReference: false,
      isFetching: false,
      errorMessage: null,
      refetch,
    };
  }

  if (query.isLoading || query.isFetching) {
    return {
      mode: "loading",
      referenceRateId: null,
      rate: null,
      provider: null,
      providerRateType: null,
      effectiveDate: null,
      ageDays: null,
      isStale: false,
      directionLabel: null,
      canSubmitReference: false,
      isFetching: true,
      errorMessage: null,
      refetch,
    };
  }

  if (query.isError) {
    return {
      mode: "error",
      referenceRateId: null,
      rate: null,
      provider: null,
      providerRateType: null,
      effectiveDate: null,
      ageDays: null,
      isStale: false,
      directionLabel: null,
      canSubmitReference: false,
      isFetching: false,
      errorMessage: query.error instanceof Error
        ? query.error.message
        : "Could not load the reference rate.",
      refetch,
    };
  }

  const data = query.data;
  if (!isFxLookupFound(data)) {
    return {
      mode: "missing",
      referenceRateId: null,
      rate: null,
      provider: null,
      providerRateType: null,
      effectiveDate: null,
      ageDays: null,
      isStale: false,
      directionLabel: null,
      canSubmitReference: false,
      isFetching: false,
      errorMessage: null,
      refetch,
    };
  }

  const rate = toNumber(data.rate.rate);
  const isStale = data.stale.is_stale === true;
  const common = {
    rate,
    provider: data.rate.provider ?? null,
    providerRateType: data.rate.provider_rate_type ?? null,
    effectiveDate: data.actual_effective_date,
    ageDays: data.stale.age_days,
    isStale,
    directionLabel: directionLabel(rate, from, base),
    isFetching: false,
    errorMessage: null,
    refetch,
  };

  if (isStale) {
    // Stale: show the rate for context but block REFERENCE_SELECTED submission.
    return { mode: "stale", referenceRateId: null, canSubmitReference: false, ...common };
  }

  // Fresh, valid reference — the ONLY submittable REFERENCE_SELECTED state.
  return { mode: "reference", referenceRateId: data.rate.id, canSubmitReference: true, ...common };
}

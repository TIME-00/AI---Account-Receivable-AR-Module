// ============================================================================
// TSH Synergy AR — Governed FX reference-rate lookup contract (Gate A)
//
// Mirrors the backend `GET /fx-rates/lookup` response shape exactly
// (backend/supabase/functions/fx-rates/service.ts → FxRatesReadService.lookup).
// The frontend NEVER recomputes staleness or provenance: the authoritative
// `stale` state and reference `id` come straight from this contract.
// ============================================================================

/** One row from `fx_reference_rates` as returned by the lookup endpoint. */
export interface FxReferenceRateRow {
  id: string;
  company_id: string;
  from_currency: string;
  to_currency: string;
  /** Numeric rate; the backend may serialise it as a string. */
  rate: number | string;
  effective_date: string;
  provider: string | null;
  provider_rate_type: string | null;
  provider_timestamp: string | null;
  fetched_at: string | null;
  sync_run_id: string | null;
  status: string;
  supersedes_rate_id: string | null;
  created_at: string;
}

/** Authoritative staleness verdict computed by the backend (3-day basis). */
export interface FxStaleState {
  is_stale: boolean;
  stale_reason: string | null;
  age_days: number | null;
}

export interface FxLookupFound {
  found: true;
  requested_date: string;
  actual_effective_date: string;
  reference_only: true;
  stale: FxStaleState;
  rate: FxReferenceRateRow;
}

export interface FxLookupNotFound {
  found: false;
  requested_date: string;
  from_currency: string;
  to_currency: string;
  reference_only: true;
}

export type FxLookupResponse = FxLookupFound | FxLookupNotFound;

export function isFxLookupFound(r: FxLookupResponse | undefined | null): r is FxLookupFound {
  return !!r && r.found === true;
}

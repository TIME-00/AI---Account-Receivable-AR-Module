// ============================================================================
// TSH Synergy AR — Authoritative company base currency (Batch 9D-D)
//
// B9DD-FEIR-006: the company base currency must be derived from authoritative
// company context (GET /auth/me → company.base_currency), never fabricated as
// "MYR". While the context is loading, or if the backend reports no base
// currency, this hook yields `null` and callers must render an explicit
// unavailable/loading state instead of assuming a currency.
// ============================================================================

"use client";

import { useAuthContext } from "@/hooks/use-auth-context";
import { normalizeCurrency } from "@/lib/currency";

export interface BaseCurrencyState {
  /** Authoritative company base currency, or null when unknown/unavailable. */
  baseCurrency: string | null;
  /** True while company context is still being resolved. */
  isLoading: boolean;
  /**
   * True when context resolved but the backend supplied no base currency.
   * Callers should surface an explicit "Base currency unavailable" state.
   */
  isUnavailable: boolean;
}

/**
 * Resolve the authoritative company base currency.
 *
 * The backend contract (`GET /auth/me`) types `company.base_currency` as
 * `string | null` — null is a real, expected state (e.g. company row missing
 * or inactive), and it must never be silently replaced with a default.
 */
export function useBaseCurrency(): BaseCurrencyState {
  const { data, isLoading } = useAuthContext();
  const baseCurrency = normalizeCurrency(data?.company?.base_currency);

  return {
    baseCurrency,
    isLoading,
    isUnavailable: !isLoading && baseCurrency === null,
  };
}

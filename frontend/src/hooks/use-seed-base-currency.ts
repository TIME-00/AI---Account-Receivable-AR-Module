// ============================================================================
// TSH Synergy AR — Seed a form's currency from the company base (B9DD-RR-003)
//
// Invoice/Receipt forms start with `currency: ""` (never a fabricated "MYR").
// Once `/auth/me` resolves, the field is seeded ONCE with the authenticated
// company's base currency — the most useful, and truthful, starting point.
//
// Two properties this must guarantee:
//
//   1. A user's intentional selection is never overwritten. Seeding happens at
//      most once, and only while the field is still empty. A later company
//      context refresh (refetch, window focus) cannot clobber the choice.
//   2. When the base currency is unavailable or unsupported for creation, the
//      field stays EMPTY. The schema then blocks submission until the user
//      picks a supported currency — no silent default is ever introduced.
// ============================================================================

"use client";

import { useEffect, useRef } from "react";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { isSupportedTransactionCurrency, normalizeCurrency } from "@/lib/currency";

export interface SeedBaseCurrencyForm {
  getCurrency: () => string;
  setCurrency: (currency: string) => void;
}

/**
 * Seed `currency` from the company base currency exactly once.
 *
 * Returns the base-currency state so callers can render an explicit
 * "unavailable" affordance rather than guessing.
 */
export function useSeedBaseCurrency(form: SeedBaseCurrencyForm) {
  const { baseCurrency, isLoading, isUnavailable } = useBaseCurrency();
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    if (isLoading || !baseCurrency) return;

    const normalized = normalizeCurrency(baseCurrency);
    // A historical/unsupported base currency must not be seeded into a NEW
    // document: creation is restricted to the NEW-transaction allow-list
    // (MYR/SGD), which is narrower than the read/report vocabulary. Seeding a
    // retained legacy base (e.g. USD) would both fail the backend
    // UNSUPPORTED_TRANSACTION_CURRENCY check and desynchronise the form value
    // from a selector that no longer offers that option.
    if (!normalized || !isSupportedTransactionCurrency(normalized)) return;

    // Never overwrite a selection the user already made while we were loading.
    if (form.getCurrency()) {
      seededRef.current = true;
      return;
    }

    form.setCurrency(normalized);
    seededRef.current = true;
  }, [baseCurrency, isLoading, form]);

  return { baseCurrency, isLoading, isUnavailable };
}

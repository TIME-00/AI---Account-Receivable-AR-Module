"use client";

// ============================================================================
// TSH Synergy AR — Customer exposure cell (B9DD-RR-002)
//
// Renders authoritative aging exposure for ONE customer with five DISTINCT
// states. The critical rule: an unresolved lookup must never render as zero,
// and a figure belonging to a SUPERSEDED filter must never render as settled.
//
//   • loading     — the exposure lookup has not finished.
//   • stale       — the customer row itself belongs to a previous filter that
//                   the user has already replaced (B9DD-FR-001). The old number
//                   is withheld rather than shown under the new filter.
//   • unavailable — the lookup failed, or the aging result set was not fully
//                   exhausted, so absence proves nothing.
//   • zero        — the aging set WAS exhausted and the customer is absent.
//                   `ar_aging_by_customer` filters `WHERE cg.base_total > 0`
//                   (database/027_*.sql ~380), so this is genuinely zero.
//   • loaded      — an authoritative row exists.
// ============================================================================

import { AlertTriangle } from "lucide-react";
import { formatMoneySafe } from "@/lib/currency";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import type { CustomerAgingRow } from "@/types";

export type CustomerExposureState =
  | { kind: "loading" }
  | { kind: "stale" }
  | { kind: "unavailable"; reason: string }
  | { kind: "zero" }
  | { kind: "loaded"; row: CustomerAgingRow };

/**
 * Derive the exposure state for one customer.
 *
 * `exhausted` is load-bearing: when the aging scan did not complete, a missing
 * row is UNKNOWN, not zero.
 *
 * `isStale` (B9DD-FR-001) is checked FIRST and overrides everything: while the
 * list is showing placeholder rows from a superseded filter, no exposure figure
 * on screen can be attributed to the filter the user has now selected — so none
 * is shown as settled, regardless of how resolvable the old lookup was.
 */
export function customerExposureState(
  customerId: string,
  lookup: { rows: Map<string, CustomerAgingRow>; exhausted: boolean } | undefined,
  isLoading: boolean,
  error: unknown,
  options: { isStale?: boolean } = {},
): CustomerExposureState {
  if (options.isStale) return { kind: "stale" };
  if (error) {
    return { kind: "unavailable", reason: (error as Error)?.message ?? "Exposure lookup failed" };
  }
  if (isLoading || !lookup) return { kind: "loading" };

  const row = lookup.rows.get(customerId);
  if (row) return { kind: "loaded", row };
  if (!lookup.exhausted) {
    return {
      kind: "unavailable",
      reason: "The aging report was not fully scanned, so this customer's exposure is unknown.",
    };
  }
  return { kind: "zero" };
}

export function CustomerExposureCell({ state }: { state: CustomerExposureState }) {
  if (state.kind === "loading") {
    return <span className="text-xs italic text-slate-400">Loading…</span>;
  }

  // B9DD-FR-001: the row under this cell belongs to a filter the user has
  // already replaced. Withhold the figure rather than let it read as the new
  // filter's exposure.
  if (state.kind === "stale") {
    return (
      <span
        className="text-xs italic text-slate-400"
        title="This customer belongs to the previous filter. Exposure will be shown once the new results load."
      >
        Updating…
      </span>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs italic text-amber-700"
        title={state.reason}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
        Exposure unavailable
      </span>
    );
  }

  if (state.kind === "zero") {
    return (
      <span className="text-xs text-slate-500" title="No outstanding documents in the aging report.">
        No outstanding exposure
      </span>
    );
  }

  const { row } = state;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="font-mono text-xs font-semibold text-slate-700">
        {formatMoneySafe(row.base_total, row.base_currency)}
      </span>
      {row.by_currency.length > 0 && (
        <CurrencyTotals byCurrency={row.by_currency} className="text-[10px] text-slate-500" />
      )}
    </span>
  );
}

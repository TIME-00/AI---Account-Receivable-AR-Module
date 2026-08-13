// ============================================================================
// TSH Synergy AR — Customer list filter choices
//
// The Status and Rating filter vocabularies live here rather than inline in the
// page for two reasons: an App Router `page.tsx` may only export a default, and
// the exact values are a backend contract (`customers/index.ts` reads `status`
// and `credit_rating`), so they deserve a named, testable home.
//
// "All" is the sentinel meaning "do not filter". Every other value mirrors the
// domain constant verbatim.
// ============================================================================

import { CREDIT_RATINGS, CUSTOMER_STATUSES } from "@/types";

/** Sentinel meaning "no filter applied". */
export const ALL_FILTER = "All";

export const STATUS_FILTER_OPTIONS: readonly string[] = [
  ALL_FILTER,
  ...CUSTOMER_STATUSES,
];

export const RATING_FILTER_OPTIONS: readonly string[] = [
  ALL_FILTER,
  ...CREDIT_RATINGS,
];

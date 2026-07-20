// ============================================================================
// TSH Synergy AR — Authoritative aging-report access helpers (Batch 9D-D)
//
// B9DD-FEIR-002 / B9DD-FEIR-005: `GET /reports/aging/by-customer` is a paginated
// server contract (edge `parsePagination` clamps page_size to MAX_PAGE_SIZE=100).
// These helpers respect that contract instead of pretending a single
// `page_size=500` request returns "all" rows.
//
// IMPORTANT: no company-base rollup is ever computed here. Per-customer figures
// come from the backend row; company-wide totals come from `GET /reports/aging`
// (ARSummary.base_total / by_currency).
// ============================================================================

import type { ApiClient } from "@/hooks/use-api";
import type { CustomerAgingRow } from "@/types";

/** Server-side maximum accepted page size (backend `_shared/constants.ts`). */
export const AGING_MAX_PAGE_SIZE = 100;

/**
 * Hard bound on paging, so a pathological dataset cannot spin forever.
 * 100 pages × 100 rows = 10,000 customers with outstanding exposure.
 */
export const AGING_MAX_PAGES = 100;

/** Raised when the customer row could not be located within the page bound. */
export class AgingLookupIncompleteError extends Error {
  constructor(customerId: string) {
    super(
      `Customer exposure could not be resolved within ${AGING_MAX_PAGES} pages of the aging report (customer ${customerId}).`,
    );
    this.name = "AgingLookupIncompleteError";
  }
}

interface AgingPage {
  rows: CustomerAgingRow[];
  total: number;
}

async function fetchAgingPage(api: ApiClient, page: number): Promise<AgingPage> {
  const res = await api.getWithMeta<CustomerAgingRow[] | { rows: CustomerAgingRow[] }>(
    "/reports/aging/by-customer",
    { params: { page, page_size: AGING_MAX_PAGE_SIZE } },
  );
  // The edge route responds `successResponse(result.rows, { total, page, page_size })`,
  // so `data` is the row array. Tolerate a `{ rows }` object defensively without
  // an `any` cast.
  const data = res.data;
  const rows = Array.isArray(data) ? data : data.rows;
  return { rows, total: res.meta?.total ?? rows.length };
}

/**
 * Locate one customer's authoritative aging row.
 *
 * Rows are ordered by `base_total DESC`, so a specific customer may fall on any
 * page; we page in server-sized chunks until the backend-reported `total` is
 * covered. Returns `null` when the customer genuinely has no outstanding
 * exposure (`ar_aging_by_customer` filters `WHERE base_total > 0`, so such
 * customers are absent by design). Throws {@link AgingLookupIncompleteError}
 * rather than returning a partial/ambiguous answer if the bound is exceeded.
 */
export async function fetchCustomerAgingRow(
  api: ApiClient,
  customerId: string,
): Promise<CustomerAgingRow | null> {
  let page = 1;
  let seen = 0;

  for (;;) {
    const { rows, total } = await fetchAgingPage(api, page);
    const match = rows.find((row) => row.customer_id === customerId);
    if (match) return match;

    seen += rows.length;
    if (rows.length === 0 || seen >= total) return null;

    page += 1;
    if (page > AGING_MAX_PAGES) throw new AgingLookupIncompleteError(customerId);
  }
}

/**
 * Resolve authoritative aging exposure for a BOUNDED set of customer IDs —
 * normally the customers visible on the current Customer-list page.
 *
 * B9DD-RR-002. The aging report is ordered by exposure, not by customer, so a
 * customer on Customer-list page 1 may have their aging row on any aging page.
 * We therefore scan aging pages until either:
 *
 *   • every requested ID has been found (early exit); or
 *   • the authoritative result set is EXHAUSTED (`seen >= total`).
 *
 * Only after full exhaustion may absence be read as zero exposure — and that is
 * sound because `ar_aging_by_customer` filters `WHERE cg.base_total > 0`
 * (database/027_*.sql line ~380), so zero-exposure customers are omitted by
 * design rather than missing.
 *
 * If the page bound is exceeded the scan is INCOMPLETE, and this throws rather
 * than returning a partial map that a caller could misread as "these are zero".
 */
export interface CustomerExposureLookup {
  /** Authoritative aging rows, keyed by customer id. */
  rows: Map<string, CustomerAgingRow>;
  /**
   * True only when the aging result set was fully exhausted (or every requested
   * ID was found). A caller may report "zero exposure" for a missing ID ONLY
   * when this is true.
   */
  exhausted: boolean;
}

export async function fetchAgingRowsForCustomerIds(
  api: ApiClient,
  customerIds: string[],
): Promise<CustomerExposureLookup> {
  const wanted = new Set(customerIds);
  const rows = new Map<string, CustomerAgingRow>();
  if (wanted.size === 0) return { rows, exhausted: true };

  let page = 1;
  let seen = 0;

  for (;;) {
    const { rows: pageRows, total } = await fetchAgingPage(api, page);
    for (const row of pageRows) {
      if (wanted.has(row.customer_id)) rows.set(row.customer_id, row);
    }
    // Early exit: every requested customer has an authoritative row.
    if (rows.size === wanted.size) return { rows, exhausted: true };

    seen += pageRows.length;
    // Exhausted the authoritative result set: the remainder are genuinely zero.
    if (pageRows.length === 0 || seen >= total) return { rows, exhausted: true };

    page += 1;
    if (page > AGING_MAX_PAGES) {
      throw new AgingLookupIncompleteError(
        [...wanted].filter((id) => !rows.has(id)).join(", ") || "unknown",
      );
    }
  }
}

/**
 * Fetch one page of the aging-by-customer report, preserving backend pagination.
 * Company-wide totals must come from `GET /reports/aging`, NOT from summing
 * these rows.
 */
export async function fetchAgingByCustomerPage(
  api: ApiClient,
  page: number,
  pageSize: number = AGING_MAX_PAGE_SIZE,
): Promise<{ rows: CustomerAgingRow[]; total: number; page: number; page_size: number }> {
  const size = Math.min(Math.max(1, pageSize), AGING_MAX_PAGE_SIZE);
  const res = await api.getWithMeta<CustomerAgingRow[] | { rows: CustomerAgingRow[] }>(
    "/reports/aging/by-customer",
    { params: { page, page_size: size } },
  );
  const data = res.data;
  const rows = Array.isArray(data) ? data : data.rows;
  return {
    rows,
    total: res.meta?.total ?? rows.length,
    page: res.meta?.page ?? page,
    page_size: res.meta?.page_size ?? size,
  };
}

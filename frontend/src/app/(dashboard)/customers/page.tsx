"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Users, Search, ArrowUpDown, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCustomerList, useCustomerExposureMap, CUSTOMER_PAGE_SIZE } from "@/hooks/use-customers";
import {
  CustomerExposureCell,
  customerExposureState,
} from "@/components/features/customers/customer-exposure-cell";
import { formatMoneySafe } from "@/lib/currency";
import { totalPagesFrom } from "@/hooks/use-invoices";
import { CUSTOMER_STATUSES, CREDIT_RATINGS } from "@/types";

// ─── Status / Rating badge helpers ──────────────────────────────────────────

const statusColor: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  Inactive: "bg-slate-50 text-slate-600 ring-slate-500/20",
  Blocked: "bg-red-50 text-red-700 ring-red-600/20",
  "On Hold": "bg-amber-50 text-amber-700 ring-amber-600/20",
};

const ratingColor: Record<string, string> = {
  AAA: "bg-emerald-50 text-emerald-700",
  AA: "bg-emerald-50 text-emerald-700",
  A: "bg-blue-50 text-blue-700",
  B: "bg-amber-50 text-amber-700",
  C: "bg-orange-50 text-orange-700",
  D: "bg-red-50 text-red-700",
};

// Only fields present on the current server page may be sorted client-side.
// Exposure is NOT sortable: it lives in a separate authoritative dataset, and
// sorting a page by it would imply a whole-collection ordering we do not have.
type SortKey = "customer_name" | "credit_limit";

export default function CustomersPage() {
  // B9DD-RR-002: a genuinely server-paginated list. `search`, `status` and
  // `credit_rating` are pushed to the backend (customers/index.ts ~101), so the
  // filter applies to the WHOLE collection — not to a capped first page.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [ratingFilter, setRatingFilter] = useState<string>("All");
  const [sortKey, setSortKey] = useState<SortKey>("customer_name");
  const [sortAsc, setSortAsc] = useState(true);

  // Changing a server filter invalidates the current page number.
  //
  // B9DD-FR-005: this MUST be atomic with the filter change. Doing it in a
  // `useEffect` reset the page only AFTER the commit, so React first rendered
  // the new filter alongside the OLD page number and fired a real request for
  // an incoherent combination (e.g. `credit_rating=B&page=2` — page 2 of a
  // result set that never existed). Both updates now happen in the same event
  // handler, which React batches into a single render, so that request is never
  // constructed at all.
  const applyFilter = (change: () => void) => {
    change();
    setPage(1);
  };

  const {
    data,
    isLoading,
    error,
    isFetching,
    isPlaceholderData,
  } = useCustomerList(page, CUSTOMER_PAGE_SIZE, {
    search,
    status: statusFilter,
    creditRating: ratingFilter,
  });

  // B9DD-FR-001: `isPlaceholderData` is TRUE exactly while the rows on screen
  // were fetched under a DIFFERENT query key (a previous filter or page) than
  // the one now selected. That is the precise definition of "these rows do not
  // describe the current filter", so it — not `isFetching` — drives every
  // authority-withholding affordance below. A background refetch of the SAME
  // filter leaves the data authoritative and is deliberately not marked stale.
  const isStale = isPlaceholderData;

  const pageRows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.pagination.total ?? 0;
  const pageSize = data?.pagination.page_size ?? CUSTOMER_PAGE_SIZE;
  const currentPage = data?.pagination.page ?? page;
  const totalPages = totalPagesFrom({ total, page: currentPage, page_size: pageSize });
  const firstRowIndex = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRowIndex = Math.min(currentPage * pageSize, total);

  // Authoritative exposure for EXACTLY the visible customers. Never joined by
  // index, never taken from a single aging page, never defaulted to zero.
  const visibleIds = useMemo(() => pageRows.map((c) => c.id), [pageRows]);
  const {
    data: exposureLookup,
    isLoading: exposureLoading,
    error: exposureError,
  } = useCustomerExposureMap(visibleIds);

  // Sort only within the current page, and only on page-local fields.
  const rows = useMemo(() => {
    const list = [...pageRows];
    list.sort((a, b) => {
      const cmp =
        sortKey === "customer_name"
          ? a.customer_name.localeCompare(b.customer_name)
          : a.credit_limit - b.credit_limit;
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [pageRows, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Management</h1></div>
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading customers…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Management</h1></div>
        <div className="glass-card flex flex-col items-center justify-center gap-3 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load customers</p>
          <p className="text-xs text-slate-400">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Management</h1>
          {/* The count is the BACKEND total for the current filters — not rows.length.
              B9DD-FR-001: while the response on screen belongs to a superseded
              filter, the old total is NOT restated under the new one. */}
          <p className="mt-1 text-sm text-slate-500">
            {isStale ? (
              "Counting customers for the new filter…"
            ) : (
              <>
                {total} customer{total !== 1 ? "s" : ""} found
                {total > 0 && ` — showing ${firstRowIndex}–${lastRowIndex}`}
              </>
            )}
          </p>
        </div>
      </div>

      {/* B9DD-FR-001: an explicit, announced updating state. Text + icon — never
          opacity or colour alone — so it is conveyed non-visually too. */}
      <div role="status" aria-live="polite" className="min-h-[1.25rem]">
        {isStale && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Updating results… the customers below are from your previous filter and are not final.
          </span>
        )}
      </div>

      {/* Search + Filters */}
      <div className="space-y-3">
        {/* Search bar */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, code, or email…"
            value={search}
            onChange={(e) => applyFilter(() => setSearch(e.target.value))}
            className="h-10 w-full rounded-lg border border-slate-300 bg-surface pl-10 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 mr-1">Status:</span>
          {["All", ...CUSTOMER_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => applyFilter(() => setStatusFilter(s))}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Rating chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 mr-1">Rating:</span>
          {["All", ...CREDIT_RATINGS].map((r) => (
            <button
              key={r}
              onClick={() => applyFilter(() => setRatingFilter(r))}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                ratingFilter === r
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Table. `aria-busy` + the dimming are paired with the announced status
          region above, so the stale state is never conveyed by opacity alone. */}
      <div className="glass-card overflow-hidden" aria-busy={isStale}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Users className="h-10 w-10 text-slate-300" />
            {/* B9DD-FR-001: "no matches" is a CLAIM about the current filter. It
                may only be made once the current filter's response has settled. */}
            <p className="mt-3 text-sm text-slate-500">
              {isStale ? "Updating results…" : "No customers match your filters"}
            </p>
          </div>
        ) : (
          <div className={cn("overflow-x-auto transition-opacity", isStale && "opacity-50")}>
            <table className="w-full text-sm">
              {/* B9DD-FR-001: a semantic (not merely visual) statement of what
                  these rows are, readable by assistive tech via the caption. */}
              {isStale && (
                <caption className="px-4 py-2 text-left text-xs font-medium text-amber-700">
                  Updating results — these rows are from the previous filter and are not confirmed
                  results for your current selection.
                </caption>
              )}
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <button onClick={() => toggleSort("customer_name")} className="inline-flex items-center gap-1 hover:text-slate-700">
                      Customer Name <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Rating</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <button onClick={() => toggleSort("credit_limit")} className="inline-flex items-center gap-1 hover:text-slate-700">
                      Credit Limit <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  {/* Exposure comes from the aging report, a separate dataset —
                      so it is not a sortable column of this page. */}
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Outstanding exposure
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.id} className="group transition-colors hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <Link href={`/customers/${c.id}`} className="font-mono text-xs text-slate-500 group-hover:text-blue-600">
                        {c.customer_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/customers/${c.id}`} className="font-medium text-slate-800 group-hover:text-blue-600">
                        {c.customer_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", statusColor[c.status] ?? "bg-slate-50 text-slate-600")}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", ratingColor[c.credit_rating] ?? "bg-slate-50 text-slate-600")}>
                        {c.credit_rating}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {formatMoneySafe(c.credit_limit, c.default_currency)}
                    </td>
                    {/* B9DD-RR-002: authoritative exposure with an explicit
                        unavailable state. The previous `?? 0` rendered a false
                        ZERO for any customer absent from aging page 1.
                        B9DD-FR-001: `isStale` withholds the figure entirely while
                        the row belongs to a superseded filter. */}
                    <td className="px-4 py-3 text-right">
                      <CustomerExposureCell
                        state={customerExposureState(c.id, exposureLookup, exposureLoading, exposureError, {
                          isStale,
                        })}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-[200px]">
                      {c.contact_email}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* B9DD-RR-002: real server pagination from backend metadata. */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500">
              {isStale ? "Updating…" : `${firstRowIndex}–${lastRowIndex} of ${total} customers`}
            </p>
            {/* B9DD-FR-001: paging is disabled while the page/total on screen is
                superseded, so a click can never combine a new filter with a page
                number derived from the old result set. */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || isFetching || isStale}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs tabular-nums text-slate-600" aria-live="polite">
                Page {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || isFetching || isStale}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="inline-flex items-start gap-1 text-[11px] text-slate-500">
        <Info className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
        Search, status and rating filters are applied by the server across all customers. Outstanding
        exposure is resolved from the authoritative aging report for the customers shown on this page.
      </p>
    </div>
  );
}

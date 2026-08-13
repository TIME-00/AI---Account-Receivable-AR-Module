"use client";

// ============================================================================
// Post-Gate-E — Journal Entries READ-ONLY viewer.
//
// This page lists system-generated accounting entries produced by AR activity.
// It is strictly read-only: there is no create, edit, delete, post or reverse
// affordance, and no manual journal input, because the AR module generates
// every journal entry from a posted document. It is NOT a general ledger.
//
// Amounts are rendered from the backend's exact decimal strings and are never
// parsed into JavaScript numbers.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Info, Search } from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import { useJournalEntries, type JournalFilters } from "@/hooks/use-journal-audit";
import {
  canViewJournalEntries,
  journalSourceHref,
  journalSourceLabel,
  JOURNAL_SOURCE_TYPES,
  JOURNAL_VIEWER_ROLES,
} from "@/lib/journal-audit/contract";
import {
  CursorPagination,
  FILTER_CONTROL_CLASS,
  FilterField,
  ViewerEmpty,
  ViewerError,
  ViewerLoading,
  ViewerPermissionDenied,
  ViewerTableSkeleton,
} from "@/components/features/journal-audit/states";
import { formatDateTime } from "@/lib/automation/format";
import { formatDate } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";

// Historical journals may carry any retained currency, so the filter uses the
// broad read/report vocabulary from the currency-policy module — NOT the
// narrower new-transaction allow-list, and never a hard-coded list here.
const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES;

const DENIED_MESSAGE =
  `The Journal Entries viewer is available to ${JOURNAL_VIEWER_ROLES.join(", ")}. ` +
  "AR Clerk does not have company-wide journal access, and System Admin access is configuration-only.";

export default function JournalEntriesPage() {
  const { roles, isResolved, isLoading: roleLoading } = useUserRole();
  const allowed = canViewJournalEntries(roles);

  // Raw search input, debounced into the query so typing does not fire a
  // request per keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [currency, setCurrency] = useState("");
  const [accountCode, setAccountCode] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters: JournalFilters = useMemo(
    () => ({
      q: q || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sourceType: sourceType || undefined,
      currency: currency || undefined,
      accountCode: accountCode.trim() || undefined,
    }),
    [q, dateFrom, dateTo, sourceType, currency, accountCode],
  );

  // Keyset pagination: a stack of the cursors used to reach each page. The
  // current page is the top of the stack; Previous pops it. There is no page
  // number in the contract, so none is fabricated.
  //
  // The stack is KEYED by the filter set it was built under and the mismatch is
  // resolved during render, not in an effect. An effect would leave one render
  // in which the new filters are paired with the previous page's cursor, and
  // that request — a cursor issued under different filters — would actually go
  // out before the reset landed.
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  const [cursorState, setCursorState] = useState<{ key: string; stack: (string | null)[] }>(
    () => ({ key: filtersKey, stack: [null] }),
  );
  const cursorStack = cursorState.key === filtersKey ? cursorState.stack : [null];
  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  const { data, isLoading, isError, isFetching, error, refetch } = useJournalEntries(
    filters,
    cursor,
    allowed && isResolved,
  );

  const filtersActive =
    Boolean(q || dateFrom || dateTo || sourceType || currency || accountCode.trim());

  function clearFilters() {
    setSearchInput("");
    setQ("");
    setDateFrom("");
    setDateTo("");
    setSourceType("");
    setCurrency("");
    setAccountCode("");
  }

  // A backend refusal on direct navigation renders the same safe surface as a
  // known-unauthorized role — never a raw 403 body.
  const forbidden =
    isError && typeof error === "object" && error !== null && "status" in error &&
    (error as { status?: number }).status === 403;

  const rows = data?.rows ?? [];
  const balancedOnPage = rows.filter((row) => row.is_balanced).length;

  if (roleLoading && !isResolved) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ViewerLoading label="Checking access" />
      </div>
    );
  }

  if (!allowed || forbidden) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ViewerPermissionDenied message={DENIED_MESSAGE} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" aria-hidden="true" />
        <p className="text-xs text-blue-700">
          Journal entries are generated by the backend when a document is posted,
          cancelled or reversed. They cannot be created or edited here — this
          viewer is read-only, and it covers Accounts Receivable activity rather
          than a complete general ledger.
        </p>
      </div>

      {/* ── Filters ── */}
      <section
        aria-label="Journal entry filters"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-surface p-3"
      >
        <FilterField label="Search" htmlFor="je-search">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="je-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="JE number or source document"
              className={`${FILTER_CONTROL_CLASS} pl-7`}
            />
          </div>
        </FilterField>

        <FilterField label="Date from" htmlFor="je-date-from">
          <input
            id="je-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          />
        </FilterField>

        <FilterField label="Date to" htmlFor="je-date-to">
          <input
            id="je-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          />
        </FilterField>

        <FilterField label="Source" htmlFor="je-source">
          <select
            id="je-source"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          >
            <option value="">All sources</option>
            {JOURNAL_SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {journalSourceLabel(type)}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Currency" htmlFor="je-currency">
          <select
            id="je-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          >
            <option value="">All currencies</option>
            {CURRENCY_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="GL account code" htmlFor="je-account">
          <input
            id="je-account"
            type="text"
            value={accountCode}
            maxLength={30}
            onChange={(event) => setAccountCode(event.target.value)}
            placeholder="e.g. 1200"
            className={FILTER_CONTROL_CLASS}
          />
        </FilterField>

        <button
          type="button"
          onClick={clearFilters}
          disabled={!filtersActive}
          className="h-8 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-300"
        >
          Clear filters
        </button>
      </section>

      {/* ── Results ── */}
      {isLoading ? (
        <ViewerTableSkeleton rows={6} columns={7} />
      ) : isError ? (
        <ViewerError
          message="Journal entries could not be loaded."
          onRetry={() => void refetch()}
        />
      ) : rows.length === 0 ? (
        <ViewerEmpty
          title="No journal entries match the current filters."
          description={
            filtersActive
              ? "Adjust or clear the filters to see more entries."
              : "Journal entries appear here once invoices or receipts are posted."
          }
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Showing {rows.length} {rows.length === 1 ? "entry" : "entries"} on this page
            {" · "}
            {balancedOnPage === rows.length
              ? "all balanced"
              : `${balancedOnPage} of ${rows.length} balanced`}
            . Totals below are per entry; this viewer does not produce a
            company-wide total.
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface">
            <table className="w-full min-w-[980px] text-sm">
              <caption className="sr-only">
                Journal entries, newest first. Select a JE number to open its detail.
              </caption>
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-3 py-2 font-medium">JE Number</th>
                  <th scope="col" className="px-3 py-2 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Source</th>
                  <th scope="col" className="px-3 py-2 font-medium">Source Document</th>
                  <th scope="col" className="px-3 py-2 font-medium">Currency</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Debit</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Credit</th>
                  <th scope="col" className="px-3 py-2 font-medium">Balance</th>
                  <th scope="col" className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const href = journalSourceHref(row.source);
                  return (
                    <tr key={row.id} className="border-b border-slate-50 last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        <Link
                          href={`/journal-entries/${encodeURIComponent(row.id)}`}
                          className="font-semibold text-brand-600 hover:underline"
                        >
                          {row.je_no}
                        </Link>
                        <span className="block text-[10px] font-normal text-slate-400">
                          {row.posting_period}
                        </span>
                      </th>
                      <td className="px-3 py-2 text-slate-600">{formatDate(row.je_date)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {journalSourceLabel(row.source_type)}
                        {row.is_reversal && (
                          <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                            Reversal
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {/* A link is rendered ONLY from the backend's allow-listed
                            source object. REV/ADJ/WO and unresolved sources show
                            plain text rather than a fabricated destination. */}
                        {href ? (
                          <Link href={href} className="font-medium text-brand-600 hover:underline">
                            {row.source?.entity_number ?? row.source_doc_no}
                          </Link>
                        ) : (
                          <span>{row.source_doc_no ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.currency}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                        {row.total_debit}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                        {row.total_credit}
                      </td>
                      <td className="px-3 py-2">
                        <BalanceBadge balanced={row.is_balanced} />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {formatDateTime(row.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <CursorPagination
            label="Journal entries pagination"
            pageIndex={cursorStack.length - 1}
            hasPrevious={cursorStack.length > 1}
            hasNext={Boolean(data?.meta.has_more && data.meta.next_cursor)}
            onPrevious={() =>
              setCursorState({ key: filtersKey, stack: cursorStack.slice(0, -1) })
            }
            onNext={() =>
              setCursorState({
                key: filtersKey,
                stack: data?.meta.next_cursor
                  ? [...cursorStack, data.meta.next_cursor]
                  : cursorStack,
              })
            }
            isFetching={isFetching}
          />
        </div>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-brand-500" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Journal Entries</h1>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-600">
          Read-only
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        View system-generated accounting entries from Accounts Receivable activity.
      </p>
    </div>
  );
}

/** Balance state carries an icon-free but explicit text label, never colour alone. */
function BalanceBadge({ balanced }: { balanced: boolean }) {
  return balanced ? (
    <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
      Balanced
    </span>
  ) : (
    <span className="inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
      Not balanced
    </span>
  );
}

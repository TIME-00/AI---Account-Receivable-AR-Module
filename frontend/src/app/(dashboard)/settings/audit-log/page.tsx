"use client";

// ============================================================================
// Post-Gate-E — Audit Trail READ-ONLY viewer.
//
// This is a read model over authoritative stored evidence — the lifecycle
// columns, change logs and event tables the AR module already writes. It is NOT
// a universal historical ledger, and the copy on this page deliberately does
// not claim that every action is audited or that any certification applies.
//
// Privacy: the API returns allow-listed scalar metadata only, and this page
// renders only the keys it can name. Redacted customer values surface as an
// explicit notice — never as a value, and never inside a tooltip or title
// attribute where they would still be readable.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Shield } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import { useAuditTrail, type AuditFilters } from "@/hooks/use-journal-audit";
import {
  auditActionLabel,
  auditEntityLabel,
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_FILTER_ACTIONS,
  AUDIT_VIEWER_ROLES,
  canViewAuditTrail,
  presentAuditActor,
  presentAuditMetadata,
  REDACTED_VALUE_NOTICE,
  type AuditEvent,
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

const DENIED_MESSAGE =
  `The Audit Trail is available to ${AUDIT_VIEWER_ROLES.join(" and ")}. ` +
  "AR Supervisor and AR Clerk do not have company-wide audit access, and System Admin " +
  "access is configuration-only — this page living under Settings does not grant it.";

export default function AuditTrailPage() {
  const { roles, isResolved, isLoading: roleLoading } = useUserRole();
  const allowed = canViewAuditTrail(roles);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actorType, setActorType] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters: AuditFilters = useMemo(
    () => ({
      q: q || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      action: action || undefined,
      entityType: entityType || undefined,
      actorType: actorType || undefined,
    }),
    [q, dateFrom, dateTo, action, entityType, actorType],
  );

  // Cursor chain keyed by its filter set and reconciled during render, so a
  // cursor issued under one filter set can never be sent with another. See the
  // Journal viewer for the full rationale.
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  const [cursorState, setCursorState] = useState<{ key: string; stack: (string | null)[] }>(
    () => ({ key: filtersKey, stack: [null] }),
  );
  const cursorStack = cursorState.key === filtersKey ? cursorState.stack : [null];
  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  const { data, isLoading, isError, isFetching, error, refetch } = useAuditTrail(
    filters,
    cursor,
    allowed && isResolved,
  );

  const filtersActive = Boolean(q || dateFrom || dateTo || action || entityType || actorType);

  function clearFilters() {
    setSearchInput("");
    setQ("");
    setDateFrom("");
    setDateTo("");
    setAction("");
    setEntityType("");
    setActorType("");
  }

  const forbidden =
    isError && typeof error === "object" && error !== null && "status" in error &&
    (error as { status?: number }).status === 403;

  const rows = data?.rows ?? [];

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

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        This view consolidates the lifecycle evidence the AR module records —
        document creation, posting and cancellation, allocations, generated
        journals, customer changes, credit-control actions, selected automation
        lifecycle events, reminders, FX booking decisions and imports. Events
        that were never recorded do not appear, and sensitive values are withheld
        by the backend.
      </div>

      {/* ── Filters ── */}
      <section
        aria-label="Audit event filters"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-surface p-3"
      >
        <FilterField label="Search" htmlFor="audit-search">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="audit-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Document or entity identifier"
              className={`${FILTER_CONTROL_CLASS} pl-7`}
            />
          </div>
        </FilterField>

        <FilterField label="Date from" htmlFor="audit-date-from">
          <input
            id="audit-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          />
        </FilterField>

        <FilterField label="Date to" htmlFor="audit-date-to">
          <input
            id="audit-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          />
        </FilterField>

        <FilterField label="Action" htmlFor="audit-action">
          <select
            id="audit-action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          >
            <option value="">All actions</option>
            {AUDIT_FILTER_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {auditActionLabel(value)}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Entity" htmlFor="audit-entity">
          <select
            id="audit-entity"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          >
            <option value="">All entities</option>
            {AUDIT_ENTITY_TYPES.map((value) => (
              <option key={value} value={value}>
                {auditEntityLabel(value)}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Actor" htmlFor="audit-actor">
          <select
            id="audit-actor"
            value={actorType}
            onChange={(event) => setActorType(event.target.value)}
            className={FILTER_CONTROL_CLASS}
          >
            <option value="">All actors</option>
            {AUDIT_ACTOR_TYPES.map((value) => (
              <option key={value} value={value}>
                {value === "user" ? "User" : value === "system" ? "System" : "Unknown"}
              </option>
            ))}
          </select>
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
        <ViewerTableSkeleton rows={8} columns={6} />
      ) : isError ? (
        <ViewerError
          message="Audit events could not be loaded."
          onRetry={() => void refetch()}
        />
      ) : rows.length === 0 ? (
        <ViewerEmpty
          title="No audit events match the current filters."
          description={
            filtersActive
              ? "Adjust or clear the filters to see more activity."
              : "Recorded activity appears here as documents are created, posted and allocated."
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface">
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">
                Recorded audit events, newest first. Select an event to view its detail.
              </caption>
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-3 py-2 font-medium">When</th>
                  <th scope="col" className="px-3 py-2 font-medium">Action</th>
                  <th scope="col" className="px-3 py-2 font-medium">Entity</th>
                  <th scope="col" className="px-3 py-2 font-medium">Document</th>
                  <th scope="col" className="px-3 py-2 font-medium">Actor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Result</th>
                  <th scope="col" className="px-3 py-2 font-medium">Summary</th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Detail</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => {
                  const actor = presentAuditActor(event.actor);
                  return (
                    <tr key={event.event_id} className="border-b border-slate-50 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                        {formatDateTime(event.occurred_at)}
                      </td>
                      <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700">
                        {auditActionLabel(event.action)}
                      </th>
                      <td className="px-3 py-2 text-slate-600">
                        {auditEntityLabel(event.entity_type)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{event.entity_number ?? "—"}</td>
                      <td className="px-3 py-2">
                        <ActorCell label={actor.label} tone={actor.tone} />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{event.result ?? "—"}</td>
                      <td className="max-w-[22rem] px-3 py-2 text-xs text-slate-600">
                        {event.summary}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setSelected(event)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <CursorPagination
            label="Audit trail pagination"
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

      <AuditEventDialog event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function PageHeader() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/settings" className="hover:text-brand-600">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-slate-800">Audit Trail</span>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-brand-500" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Audit Trail</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-600">
            Read-only
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Review authoritative financial lifecycle and system activity recorded by
          the AR module.
        </p>
      </div>
    </div>
  );
}

/** Actor label with a text tone marker — "Unknown" is never shown as System. */
function ActorCell({ label, tone }: { label: string; tone: "user" | "system" | "unknown" }) {
  const className =
    tone === "user"
      ? "bg-slate-100 text-slate-700"
      : tone === "system"
        ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200"
        : "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  );
}

/**
 * Audit event detail. A dialog rather than a route: an event is a lightweight
 * drill-down, and its composite id (`kind:uuid`) is not a resource path.
 */
function AuditEventDialog({
  event,
  onClose,
}: {
  event: AuditEvent | null;
  onClose: () => void;
}) {
  const open = event !== null;
  const actor = event ? presentAuditActor(event.actor) : null;
  const metadata = event ? presentAuditMetadata(event) : null;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ds-overlay-enter fixed inset-0 z-50 ds-scrim" />
        <Dialog.Content className="ds-overlay-enter fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line-strong bg-surface-elevated p-5 shadow-elevated focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-sm font-semibold text-slate-900">
              {event ? auditActionLabel(event.action) : "Audit event"}
              {event?.entity_number ? ` · ${event.entity_number}` : ""}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-400"
              aria-label="Close audit event detail"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs text-slate-500">
            Recorded audit evidence for this event. Values the system classifies as
            sensitive are withheld.
          </Dialog.Description>

          {event && actor && metadata && (
            <div className="mt-4 space-y-4 text-sm">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <DetailField label="When">{formatDateTime(event.occurred_at)}</DetailField>
                <DetailField label="Action">{auditActionLabel(event.action)}</DetailField>
                <DetailField label="Entity">{auditEntityLabel(event.entity_type)}</DetailField>
                <DetailField label="Document">{event.entity_number ?? "—"}</DetailField>
                <DetailField label="Actor">
                  {actor.label}
                  {actor.detail && (
                    <span className="block text-[11px] text-slate-500">{actor.detail}</span>
                  )}
                </DetailField>
                <DetailField label="Result">{event.result ?? "—"}</DetailField>
              </dl>

              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-700">
                {event.summary}
              </div>

              {metadata.valueRedacted && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {REDACTED_VALUE_NOTICE}
                </p>
              )}
              {metadata.changeReasonRedacted && (
                <p className="text-[11px] text-slate-500">
                  A change reason was recorded but is not shown here.
                </p>
              )}

              {metadata.rows.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Recorded details
                  </h3>
                  <dl className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {metadata.rows.map((row) => (
                      <div key={row.key} className="flex justify-between gap-4 px-3 py-1.5">
                        <dt className="text-xs text-slate-500">{row.label}</dt>
                        <dd className="text-right text-xs font-medium text-slate-800">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-700">{children}</dd>
    </div>
  );
}

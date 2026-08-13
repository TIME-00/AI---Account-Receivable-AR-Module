"use client";

// ============================================================================
// Post-Gate-E — Journal Entry detail (READ-ONLY).
//
// A dedicated route, matching how Invoices and Receipts expose their detail —
// a journal entry is a financial record worth a linkable, refreshable page.
//
// Every amount is the backend's exact decimal string. Debit and credit are
// presented in adjacent right-aligned columns so the double entry can be
// compared at a glance, and the totals row repeats the header authority rather
// than re-deriving it on the client.
// ============================================================================

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import { useJournalEntryDetail } from "@/hooks/use-journal-audit";
import {
  canViewJournalEntries,
  journalSourceHref,
  journalSourceLabel,
  JOURNAL_VIEWER_ROLES,
} from "@/lib/journal-audit/contract";
import {
  ViewerError,
  ViewerLoading,
  ViewerPermissionDenied,
} from "@/components/features/journal-audit/states";
import { formatDateTime } from "@/lib/automation/format";
import { formatDate } from "@/lib/utils";
import { useRegisterCopilotEntity } from "@/providers/copilot-entity-provider";

const DENIED_MESSAGE =
  `The Journal Entries viewer is available to ${JOURNAL_VIEWER_ROLES.join(", ")}. ` +
  "AR Clerk does not have company-wide journal access, and System Admin access is configuration-only.";

export default function JournalEntryDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const { roles, isResolved, isLoading: roleLoading } = useUserRole();
  const allowed = canViewJournalEntries(roles);

  const { data, isLoading, isError, error, refetch } = useJournalEntryDetail(
    id,
    allowed && isResolved,
  );

  // AR Copilot names the entry by its JE number, never by the raw id.
  useRegisterCopilotEntity(
    data
      ? { entityType: "journal_entry", entityId: id, displayNumber: data.je_no }
      : null,
  );

  const status =
    isError && typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: number }).status
      : undefined;
  const forbidden = status === 403;
  const notFound = status === 404;

  if (roleLoading && !isResolved) {
    return (
      <Shell>
        <ViewerLoading label="Checking access" />
      </Shell>
    );
  }

  if (!allowed || forbidden) {
    return (
      <Shell>
        <ViewerPermissionDenied message={DENIED_MESSAGE} />
      </Shell>
    );
  }

  if (isLoading) {
    return (
      <Shell>
        <ViewerLoading label="Loading journal entry" />
      </Shell>
    );
  }

  if (notFound) {
    return (
      <Shell>
        <ViewerError message="This journal entry is not available for your company." />
      </Shell>
    );
  }

  if (isError || !data) {
    return (
      <Shell>
        <ViewerError
          message="This journal entry could not be loaded."
          onRetry={() => void refetch()}
        />
      </Shell>
    );
  }

  const sourceHref = journalSourceHref(data.source);

  return (
    <Shell>
      {/* ── Header ── */}
      <div className="glass-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <BookOpen className="h-5 w-5 text-brand-500" aria-hidden="true" />
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{data.je_no}</h1>
              <span
                className={
                  data.is_balanced
                    ? "rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                    : "rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200"
                }
              >
                {data.is_balanced ? "Balanced" : "Not balanced"}
              </span>
              {data.is_reversal && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                  Reversal entry
                </span>
              )}
              {data.is_reversed && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  Reversed
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {journalSourceLabel(data.source_type)} · {formatDate(data.je_date)} · period{" "}
              {data.posting_period}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Source document">
            {sourceHref ? (
              <Link href={sourceHref} className="font-medium text-brand-600 hover:underline">
                {data.source?.entity_number ?? data.source_doc_no}
              </Link>
            ) : (
              <span className="text-slate-700">{data.source_doc_no ?? "—"}</span>
            )}
          </Field>
          <Field label="Description">
            <span className="text-slate-700">{data.description ?? "—"}</span>
          </Field>
          <Field label="Transaction currency">
            <span className="text-slate-700">{data.currency}</span>
          </Field>
          <Field label="Company base currency">
            <span className="text-slate-700">{data.base_currency}</span>
          </Field>
          <Field label="Exchange rate booked">
            <span className="font-mono tabular-nums text-slate-700">{data.exchange_rate}</span>
          </Field>
          <Field label="Total debit">
            <span className="font-mono tabular-nums text-slate-800">
              {data.currency} {data.total_debit}
            </span>
          </Field>
          <Field label="Total credit">
            <span className="font-mono tabular-nums text-slate-800">
              {data.currency} {data.total_credit}
            </span>
          </Field>
          <Field label="Created">
            <span className="text-slate-700">{formatDateTime(data.created_at)}</span>
          </Field>
          <Field label="Created by">
            <span className="text-slate-700">
              {data.created_by ? `User ${data.created_by.slice(0, 8)}` : "Not recorded"}
            </span>
          </Field>
          {data.original_je_id && (
            <Field label="Reverses entry">
              <Link
                href={`/journal-entries/${encodeURIComponent(data.original_je_id)}`}
                className="font-medium text-brand-600 hover:underline"
              >
                View original entry
              </Link>
            </Field>
          )}
          {data.reversal_je_id && (
            <Field label="Reversed by entry">
              <Link
                href={`/journal-entries/${encodeURIComponent(data.reversal_je_id)}`}
                className="font-medium text-brand-600 hover:underline"
              >
                View reversing entry
              </Link>
            </Field>
          )}
        </dl>
      </div>

      {/* ── Lines ── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface">
        <table className="w-full min-w-[880px] text-sm">
          <caption className="sr-only">
            Journal entry lines in line-number order, with debit and credit amounts.
          </caption>
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-3 py-2 font-medium">#</th>
              <th scope="col" className="px-3 py-2 font-medium">GL Account</th>
              <th scope="col" className="px-3 py-2 font-medium">Type</th>
              <th scope="col" className="px-3 py-2 font-medium">Description</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Debit</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Credit</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Base Debit ({data.base_currency})
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Base Credit ({data.base_currency})
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.id} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2 text-slate-400">{line.line_no}</td>
                <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700">
                  <span className="font-mono text-xs">{line.account_code}</span>
                  <span className="block text-[11px] font-normal text-slate-500">
                    {line.account_name}
                  </span>
                </th>
                <td className="px-3 py-2 text-xs text-slate-500">{line.account_type}</td>
                <td className="px-3 py-2 text-slate-600">{line.description ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                  {line.debit_amount}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                  {line.credit_amount}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                  {line.base_debit}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                  {line.base_credit}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50/60 text-sm font-semibold">
              <td className="px-3 py-2" colSpan={4}>
                Totals ({data.currency})
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                {data.total_debit}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                {data.total_credit}
              </td>
              <td className="px-3 py-2" colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Journal entries are generated by the backend from posted AR documents and
        cannot be edited, reversed or deleted from this screen.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <Link
        href="/journal-entries"
        className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Journal Entries
      </Link>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

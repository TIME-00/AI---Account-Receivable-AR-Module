"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import {
  AutomationEmpty,
  AutomationError,
  AutomationLoading,
} from "@/components/features/automation/states";
import {
  FilterBar,
  FilterSelect,
  Pagination,
} from "@/components/features/automation/collection";
import { AutomationDialog } from "@/components/features/automation/dialog";
import {
  useDismissException,
  useExceptions,
  useResolveException,
  useRetryException,
} from "@/hooks/use-automation";
import { useUserRole } from "@/hooks/use-user-role";
import { ApiError } from "@/hooks/use-api";
import {
  EXCEPTION_LIFECYCLES,
  EXCEPTION_REASON_CODES,
  filterSafeMetadata,
  type ExceptionLifecycle,
  type ExceptionReasonCode,
} from "@/lib/automation/contract";
import {
  EXCEPTION_LIFECYCLE_LABEL,
  EXCEPTION_LIFECYCLE_TONE,
  exceptionReasonLabel,
} from "@/lib/automation/labels";
import { formatDateTime } from "@/lib/automation/format";

const EDIT_ROLES = ["AR Supervisor", "Finance Manager"];

/**
 * Render ONLY allowlisted scalar metadata (mirrors the backend safe-metadata
 * allowlist). A sensitive scalar is never shown merely because it is a
 * primitive; raw payloads, secrets, cursors, and stacks are dropped.
 */
function safeDetail(details: Record<string, unknown> | null | undefined): string {
  const parts = filterSafeMetadata(details)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export default function ExceptionQueuePage() {
  const { roles } = useUserRole();
  const canEdit = roles.some((r) => EDIT_ROLES.includes(r));

  const [page, setPage] = useState(1);
  const [lifecycle, setLifecycle] = useState<ExceptionLifecycle | undefined>();
  const [reason, setReason] = useState<ExceptionReasonCode | undefined>();
  const [noteFor, setNoteFor] = useState<{ id: string; action: "resolve" | "dismiss" } | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading, isError, isFetching, refetch } = useExceptions({
    page,
    page_size: 15,
    lifecycle_status: lifecycle,
    reason_code: reason,
  });
  const retry = useRetryException();
  const resolve = useResolveException();
  const dismiss = useDismissException();

  function onRetry(id: string) {
    // Retry re-enters the backend authoritative path; the frontend never
    // creates, posts, allocates, or modifies a financial record here.
    retry.mutate(
      { id },
      {
        onSuccess: () => toast.success("Exception re-queued for retry."),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "Retry was rejected."),
      },
    );
  }

  function submitNote() {
    if (!noteFor) return;
    if (note.trim().length === 0) {
      toast.error("A note is required.");
      return;
    }
    const mutation = noteFor.action === "resolve" ? resolve : dismiss;
    mutation.mutate(
      { id: noteFor.id, resolution_note: note.trim() },
      {
        onSuccess: () => {
          toast.success(noteFor.action === "resolve" ? "Exception resolved." : "Exception dismissed.");
          setNoteFor(null);
          setNote("");
        },
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "Action was rejected."),
      },
    );
  }

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterSelect
          label="Lifecycle"
          value={lifecycle}
          options={EXCEPTION_LIFECYCLES}
          optionLabel={(l) => EXCEPTION_LIFECYCLE_LABEL[l]}
          onChange={(v) => {
            setLifecycle(v);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Reason"
          value={reason}
          options={EXCEPTION_REASON_CODES}
          optionLabel={(r) => exceptionReasonLabel(r)}
          onChange={(v) => {
            setReason(v);
            setPage(1);
          }}
        />
      </FilterBar>

      {isLoading ? (
        <AutomationLoading label="Loading exceptions" />
      ) : isError || !data ? (
        <AutomationError onRetry={() => refetch()} />
      ) : data.rows.length === 0 ? (
        <AutomationEmpty
          title="No exceptions"
          description="Documents that cannot be processed safely appear here. Exceptions never create financial records."
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Lifecycle</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                  <th className="px-3 py-2 font-medium">Retries</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  {canEdit && <th className="px-3 py-2 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((exception) => (
                  <tr key={exception.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-700">
                      {exceptionReasonLabel(exception.reason_code)}
                    </td>
                    <td className="px-3 py-2">
                      <AutomationBadge
                        label={EXCEPTION_LIFECYCLE_LABEL[exception.lifecycle_status]}
                        tone={EXCEPTION_LIFECYCLE_TONE[exception.lifecycle_status]}
                      />
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">
                      {safeDetail(exception.safe_details)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {exception.retry_count ?? 0}
                      {exception.max_retries ? ` / ${exception.max_retries}` : ""}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDateTime(exception.created_at)}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {exception.lifecycle_status === "retryable" && (
                            <button
                              type="button"
                              onClick={() => onRetry(exception.id)}
                              disabled={retry.isPending}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                            >
                              Retry
                            </button>
                          )}
                          {(exception.lifecycle_status === "open" ||
                            exception.lifecycle_status === "retryable") && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setNoteFor({ id: exception.id, action: "resolve" });
                                  setNote("");
                                }}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700"
                              >
                                Resolve
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setNoteFor({ id: exception.id, action: "dismiss" });
                                  setNote("");
                                }}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700"
                              >
                                Dismiss
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={data.meta} page={page} onPage={setPage} isFetching={isFetching} />
        </div>
      )}

      {/* Mandatory-note dialog for resolve/dismiss (accessible Radix dialog). */}
      <AutomationDialog
        open={noteFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setNoteFor(null);
            setNote("");
          }
        }}
        title={noteFor?.action === "resolve" ? "Resolve exception" : "Dismiss exception"}
        description={
          noteFor?.action === "resolve"
            ? "Resolve this exception with a required note. Resolving does not create any financial record; the backend records the note and closes the exception."
            : "Dismiss this exception with a required note. Dismissing does not create any financial record; the backend records the note and closes the exception."
        }
        visuallyHiddenDescription
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setNoteFor(null);
                setNote("");
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitNote}
              disabled={resolve.isPending || dismiss.isPending}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Confirm
            </button>
          </>
        }
      >
        <label className="block text-xs font-medium text-slate-700">
          Resolution note (required)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            autoFocus
          />
        </label>
      </AutomationDialog>
    </div>
  );
}

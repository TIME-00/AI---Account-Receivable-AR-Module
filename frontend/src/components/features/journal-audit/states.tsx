"use client";

// ============================================================================
// Post-Gate-E — shared read-viewer states for the Journal and Audit viewers.
//
// Same visual language as the rest of the app (identical container, spacing and
// tone classes as the Gate E states) with neutral names, so the Journal and
// Audit pages do not import Automation-named components. Colour is never the
// only signal: every state carries an icon plus text.
// ============================================================================

import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Accessible loading state; announces progress to assistive technology. */
export function ViewerLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

/** Table-shaped skeleton so a slow first load keeps the page layout stable. */
export function ViewerTableSkeleton({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <span className="sr-only">Loading results…</span>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex gap-4 px-3 py-3" aria-hidden="true">
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <div
                key={columnIndex}
                className="h-3 flex-1 animate-pulse rounded bg-slate-100"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Error state. The message is a safe, sanitized sentence — a raw backend
 * message, SQL text or stack is never rendered here.
 */
export function ViewerError({
  message = "This information could not be loaded.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 p-6 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Valid zero-result state — deliberately not phrased as a failure. */
export function ViewerEmpty({
  title = "Nothing to show",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-10 text-center">
      <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-md text-xs text-slate-500">{description}</p>}
    </div>
  );
}

/**
 * Permission-denied surface. Shown both when the role is known to be
 * unauthorized and when a direct-URL visit is refused by the backend, so a raw
 * 403 body is never rendered.
 */
export function ViewerPermissionDenied({
  title = "You do not have permission to view this page",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-10 text-center"
    >
      <Lock className="h-6 w-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="max-w-md text-xs text-slate-500">{message}</p>
    </div>
  );
}

/**
 * Keyset (cursor) pagination control.
 *
 * The backend is cursor-based, so there is no total and no page count to show —
 * only a position indicator derived from how many cursors have been pushed.
 * Previous navigation works off a caller-held cursor stack rather than a
 * fabricated offset.
 */
export function CursorPagination({
  pageIndex,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  isFetching,
  label,
}: {
  pageIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  isFetching?: boolean;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"
    >
      <span aria-live="polite">
        Page {pageIndex + 1}
        {isFetching ? " · updating…" : ""}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={!hasPrevious || isFetching}
          onClick={onPrevious}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-semibold transition-colors",
            hasPrevious && !isFetching
              ? "border-slate-300 text-slate-700 hover:bg-slate-50"
              : "border-slate-200 text-slate-300",
          )}
        >
          <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          Previous
        </button>
        <button
          type="button"
          disabled={!hasNext || isFetching}
          onClick={onNext}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-semibold transition-colors",
            hasNext && !isFetching
              ? "border-slate-300 text-slate-700 hover:bg-slate-50"
              : "border-slate-200 text-slate-300",
          )}
        >
          Next
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

/** Small labelled filter shell used by both viewers. */
export function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-[9rem] flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[11px] font-medium text-slate-600">
        {label}
      </label>
      {children}
    </div>
  );
}

export const FILTER_CONTROL_CLASS =
  "h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-500";

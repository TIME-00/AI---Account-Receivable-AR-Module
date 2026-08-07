"use client";

import { AlertTriangle, Inbox, Loader2, Lock } from "lucide-react";

/** Accessible loading state; announces progress to screen readers. */
export function AutomationLoading({ label = "Loading" }: { label?: string }) {
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

/** Error + retry. The message is a safe, sanitized string — never a stack. */
export function AutomationError({
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

export function AutomationEmpty({
  title = "Nothing to show yet",
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
 * Clear permission-denied state for unauthorized roles.
 *
 * The copy is caller-supplied so each surface states the truth for THAT section
 * rather than a single inaccurate universal role list: automation access is not
 * uniform (operational monitoring is AR Supervisor / Finance Manager / Auditor;
 * System Admin is configuration-only; AR Clerk has limited Settings, directory,
 * and customer-ownership access). Direct-URL denial renders this safe surface —
 * never a raw 403 body. The default is deliberately neutral.
 */
export function AutomationPermissionDenied({
  title = "You do not have permission to access this Automation section",
  message = "This section is not available for your role.",
}: {
  title?: string;
  message?: string;
} = {}) {
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

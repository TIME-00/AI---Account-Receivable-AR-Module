// ============================================================================
// TSH Synergy AR — Gate B shared notification row
//
// Severity is conveyed by icon AND text (never colour alone). Read/unread and
// actionable state are always labelled. A deep link is rendered only when the
// backend value resolves to a controlled internal path.
// ============================================================================

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import {
  isNotificationActionable,
  resolveNotificationHref,
  type NotificationItem,
} from "@/lib/notifications";

const SEVERITY: Record<
  NotificationItem["severity"],
  { icon: typeof AlertCircle; label: string; color: string; bg: string }
> = {
  error: { icon: AlertCircle, label: "Error", color: "text-red-600", bg: "bg-red-50" },
  warning: { icon: AlertTriangle, label: "Review", color: "text-amber-600", bg: "bg-amber-50" },
};

interface NotificationRowProps {
  item: NotificationItem;
  onMarkRead?: (notificationKey: string) => void | Promise<unknown>;
  isMarkingRead?: boolean;
  compact?: boolean;
}

export function NotificationRow({
  item,
  onMarkRead,
  isMarkingRead = false,
  compact = false,
}: NotificationRowProps) {
  const router = useRouter();
  const severity = SEVERITY[item.severity];
  const Icon = severity.icon;
  const actionable = isNotificationActionable(item);
  const href = resolveNotificationHref(item.deep_link);

  const handleDeepLink = async (
    event: React.MouseEvent<HTMLAnchorElement>,
  ) => {
    if (!actionable || !onMarkRead) return;
    event.preventDefault();
    if (isMarkingRead) return;
    try {
      await onMarkRead(item.notification_key);
      router.push(href!);
    } catch {
      // Remain on the current page when acknowledgement fails. The mutation
      // retains its error state and no false read state or navigation occurs.
    }
  };

  const handleMarkRead = () => {
    if (!onMarkRead || isMarkingRead) return;
    void Promise.resolve(onMarkRead(item.notification_key)).catch(() => {
      // The owning page/dropdown exposes the mutation error. Swallow the
      // callback promise here to avoid an unhandled browser rejection.
    });
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3",
        compact ? "px-3 py-2.5" : "px-5 py-4",
        !actionable && "opacity-80",
      )}
    >
      <span className={cn("mt-0.5 shrink-0 rounded-lg p-2", severity.bg)}>
        <Icon className={cn("h-4 w-4", severity.color)} aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn("truncate text-sm font-medium text-slate-800", compact && "max-w-[220px]")}>
            {item.title}
          </p>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              severity.bg,
              severity.color,
            )}
          >
            {severity.label}
          </span>
          {/* Read/unread is labelled in text, not by colour alone. */}
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium",
              actionable ? "text-blue-600" : "text-slate-400",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                actionable ? "bg-blue-500" : "bg-slate-300",
              )}
              aria-hidden="true"
            />
            {actionable ? "Unread" : "Read"}
          </span>
        </div>

        <p className={cn("mt-0.5 text-xs text-slate-500", !compact && "text-slate-600")}>
          {item.message}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span>{formatDate(item.created_at)}</span>
          {href && (
            <Link
              href={href}
              onClick={handleDeepLink}
              aria-disabled={isMarkingRead || undefined}
              className="font-medium text-brand-600 hover:underline"
            >
              View import
            </Link>
          )}
          {!actionable && item.read_at && (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Check className="h-3 w-3" aria-hidden="true" /> Read {formatDate(item.read_at)}
            </span>
          )}
        </div>
      </div>

      {onMarkRead && actionable && (
        <button
          type="button"
          onClick={handleMarkRead}
          disabled={isMarkingRead}
          className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
        >
          {isMarkingRead ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            "Mark read"
          )}
        </button>
      )}
    </div>
  );
}

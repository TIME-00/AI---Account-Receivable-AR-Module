// ============================================================================
// TSH Synergy AR — Gate B Notifications page
//
// Import-alert-only. Cursor-paginated with an explicit "Load more" (no infinite
// scroll), read_state/type filters that reset accumulated rows, per-row read
// and a server-derived "mark all read". Initial requests never exceed limit=20.
// ============================================================================

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  Inbox,
  AlertCircle,
  Loader2,
  CheckCheck,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useNotificationList,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@/hooks/use-notifications";
import {
  NOTIFICATION_MAX_LIMIT,
  type NotificationFilters,
  type NotificationReadState,
  type NotificationType,
} from "@/lib/notifications";
import { NotificationRow } from "@/components/features/notifications/notification-row";

const READ_STATE_TABS: { value: NotificationReadState; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

const TYPE_TABS: { value: NotificationType | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "import_error", label: "Import errors" },
  { value: "import_review", label: "Import review" },
];

export default function NotificationsPage() {
  const [readState, setReadState] = useState<NotificationReadState>("all");
  const [typeFilter, setTypeFilter] = useState<NotificationType | "all">("all");

  const filters: NotificationFilters = {
    readState,
    type: typeFilter === "all" ? null : typeFilter,
  };

  // Filter changes rotate the query key, which resets the accumulated pages and
  // the cursor — no manual reset bookkeeping is required.
  const list = useNotificationList(filters, { limit: NOTIFICATION_MAX_LIMIT });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-blue-600">
          Dashboard
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-800">Notifications</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">
            Alerts derived from your imports — import errors and rows needing review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => markAll.mutate(filters.type)}
          disabled={markAll.isPending}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
        >
          {markAll.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Mark all read
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5" role="group" aria-label="Read state filter">
          {READ_STATE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setReadState(tab.value)}
              aria-pressed={readState === tab.value}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                readState === tab.value
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-surface text-slate-500 hover:bg-slate-50",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Type filter">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTypeFilter(tab.value)}
              aria-pressed={(typeFilter === "all" ? "all" : typeFilter) === tab.value}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                (typeFilter === "all" ? "all" : typeFilter) === tab.value
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-surface text-slate-500 hover:bg-slate-50",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {(markRead.isError || markAll.isError) && (
        <p role="alert" className="text-sm text-red-600">
          The notification could not be marked read. Please try again.
        </p>
      )}

      {/* List */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <Bell className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-700">Import alerts</h2>
        </div>

        {list.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading notifications…
          </div>
        ) : list.isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <AlertCircle className="h-8 w-8 text-red-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">Notifications are unavailable right now.</p>
            <button
              type="button"
              onClick={() => list.refetch()}
              className="mt-1 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : list.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Inbox className="h-10 w-10 text-slate-300" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-500">You&apos;re all caught up.</p>
            <p className="text-[11px] text-slate-400">
              There are no import alerts matching this filter.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {list.items.map((item) => (
                <li key={item.notification_key}>
                  <NotificationRow
                    item={item}
                    onMarkRead={(key) => markRead.mutateAsync(key)}
                    isMarkingRead={
                      markRead.isPending && markRead.variables === item.notification_key
                    }
                  />
                </li>
              ))}
            </ul>

            {list.hasMore && (
              <div className="flex justify-center border-t border-slate-100 px-5 py-4">
                <button
                  type="button"
                  onClick={() => list.fetchNextPage()}
                  disabled={list.isFetchingNextPage}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
                >
                  {list.isFetchingNextPage ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
                    </>
                  ) : (
                    "Load more"
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

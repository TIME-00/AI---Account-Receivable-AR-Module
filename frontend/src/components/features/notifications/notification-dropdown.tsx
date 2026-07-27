// ============================================================================
// TSH Synergy AR — Gate B header notification dropdown
//
// Single shared data contract (no duplicated unread-count implementation). The
// panel renders through a portal with a high stacking context so it never
// clips behind page cards/headers. Bounded ≤20 preview; keyboard + Escape +
// outside-click close with focus restoration to the trigger.
// ============================================================================

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bell, Inbox, Loader2, AlertCircle, CheckCheck } from "lucide-react";
import {
  NOTIFICATION_PREVIEW_LIMIT,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
  useNotificationSync,
  useUnreadNotificationCount,
} from "@/hooks/use-notifications";
import { DEFAULT_NOTIFICATION_FILTERS, formatUnreadBadge } from "@/lib/notifications";
import { NotificationRow } from "./notification-row";

export function NotificationDropdown() {
  // App-wide cross-tab + focus synchronization lives here (header is always
  // mounted in the dashboard shell), so it is set up exactly once.
  useNotificationSync();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const badge = formatUnreadBadge(unreadCount);

  const list = useNotificationList(DEFAULT_NOTIFICATION_FILTERS, {
    limit: NOTIFICATION_PREVIEW_LIMIT,
    enabled: open,
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const positionPanel = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({
        top: rect.bottom + 8,
        right: Math.max(window.innerWidth - rect.right, 8),
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open, positionPanel]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Escape + outside-click close.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        close(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, close]);

  const preview = list.items.slice(0, NOTIFICATION_PREVIEW_LIMIT);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-dropdown-panel"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
            aria-hidden="true"
          >
            {badge.visible}
          </span>
        )}
        {/* Exact count for assistive tech even when the pill is capped at 99+. */}
        <span className="sr-only" aria-live="polite">
          {badge.accessible}
        </span>
      </button>

      {mounted &&
        open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            id="notification-dropdown-panel"
            role="dialog"
            aria-label="Notifications"
            style={{ top: anchor.top, right: anchor.right }}
            className="fixed z-[100] w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-300/40"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Notifications
              </p>
              <button
                type="button"
                onClick={() => markAll.mutate(null)}
                disabled={markAll.isPending || unreadCount === 0}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-brand-600 transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-40"
              >
                <CheckCheck className="h-3 w-3" aria-hidden="true" /> Mark all read
              </button>
            </div>

            {(markRead.isError || markAll.isError) && (
              <p role="alert" className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                The notification could not be marked read. Please try again.
              </p>
            )}

            {list.isLoading ? (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
              </div>
            ) : list.isError ? (
              <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
                <AlertCircle className="h-6 w-6 text-red-300" aria-hidden="true" />
                <p className="text-sm text-slate-500">Notifications are unavailable right now.</p>
                <button
                  type="button"
                  onClick={() => list.refetch()}
                  className="mt-1 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Retry
                </button>
              </div>
            ) : preview.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
                <Inbox className="h-6 w-6 text-slate-300" aria-hidden="true" />
                <p className="text-sm text-slate-500">You&apos;re all caught up.</p>
                <p className="text-[11px] text-slate-400">
                  Import review and import error alerts appear here.
                </p>
              </div>
            ) : (
              <ul className="max-h-[22rem] divide-y divide-slate-100 overflow-y-auto">
                {preview.map((item) => (
                  <li key={item.notification_key}>
                    <NotificationRow
                      item={item}
                      compact
                      onMarkRead={(key) => markRead.mutateAsync(key)}
                      isMarkingRead={markRead.isPending && markRead.variables === item.notification_key}
                    />
                  </li>
                ))}
              </ul>
            )}

            <Link
              href="/notifications"
              onClick={() => close(false)}
              className="block border-t border-slate-200 px-3 py-2 text-center text-xs font-medium text-brand-600 transition-colors hover:bg-slate-50"
            >
              View all notifications
            </Link>
          </div>,
          document.body,
        )}
    </div>
  );
}

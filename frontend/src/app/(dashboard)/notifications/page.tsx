"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import {
  Bell,
  Inbox,
  Info,
  AlertTriangle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type { NotificationItem } from "@/types";

const SEVERITY_STYLE: Record<NotificationItem["severity"], { icon: typeof Info; color: string; bg: string }> = {
  info: { icon: Info, color: "text-blue-600", bg: "bg-blue-50" },
  warning: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
  error: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50" },
};

export default function NotificationsPage() {
  const router = useRouter();
  const { data: notifications, isLoading, isError } = useNotifications(50);
  const count = notifications?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-blue-600">Dashboard</Link>
        <span>/</span>
        <span className="font-medium text-slate-800">Notifications</span>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Notifications</h1>
          {count > 0 && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
              {count}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Live alerts derived from your AR activity — import reviews, import errors, and overdue receivables.
        </p>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <Bell className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Recent Notifications</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notifications…
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <AlertCircle className="h-8 w-8 text-red-300" />
            <p className="text-sm text-slate-500">Notifications are unavailable right now.</p>
            <p className="text-[11px] text-slate-400">Please refresh the page to try again.</p>
          </div>
        ) : count === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Inbox className="h-10 w-10 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">You&apos;re all caught up.</p>
            <p className="text-[11px] text-slate-400">
              There are no import reviews, import errors, or overdue AR alerts at the moment.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notifications!.map((n) => {
              const { icon: Icon, color, bg } = SEVERITY_STYLE[n.severity];
              return (
                <li key={n.id}>
                  <button
                    onClick={() => router.push(n.route)}
                    className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className={cn("mt-0.5 rounded-lg p-2", bg)}>
                      <Icon className={cn("h-4 w-4", color)} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">{n.title}</p>
                      <p className="text-xs text-slate-500">{n.message}</p>
                    </div>
                    {n.created_at && (
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatDate(n.created_at)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

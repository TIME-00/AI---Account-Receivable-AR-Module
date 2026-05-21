"use client";

import { cn } from "@/lib/utils";
import type { InvoiceStatus, ReceiptStatus, CustomerStatus } from "@/types";

type StatusType = InvoiceStatus | ReceiptStatus | CustomerStatus | string;

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  // Invoice statuses
  Draft:          { bg: "bg-slate-100",      text: "text-slate-600",    dot: "bg-slate-400" },
  Open:           { bg: "bg-blue-50",        text: "text-blue-700",     dot: "bg-blue-500" },
  "Partially Paid": { bg: "bg-amber-50",     text: "text-amber-700",    dot: "bg-amber-500" },
  Paid:           { bg: "bg-emerald-50",     text: "text-emerald-700",  dot: "bg-emerald-500" },
  Overdue:        { bg: "bg-red-50",         text: "text-red-700",      dot: "bg-red-500" },
  Cancelled:      { bg: "bg-gray-100",       text: "text-gray-500",     dot: "bg-gray-400" },
  "Written Off":  { bg: "bg-purple-50",      text: "text-purple-700",   dot: "bg-purple-500" },

  // Receipt statuses
  Posted:           { bg: "bg-blue-50",        text: "text-blue-700",     dot: "bg-blue-500" },
  "Fully Allocated": { bg: "bg-emerald-50",    text: "text-emerald-700",  dot: "bg-emerald-500" },
  Bounced:          { bg: "bg-red-50",          text: "text-red-700",      dot: "bg-red-500" },

  // Customer statuses
  Active:    { bg: "bg-emerald-50",  text: "text-emerald-700",  dot: "bg-emerald-500" },
  Inactive:  { bg: "bg-gray-100",    text: "text-gray-500",     dot: "bg-gray-400" },
  Blocked:   { bg: "bg-red-50",      text: "text-red-700",      dot: "bg-red-500" },
  "On Hold": { bg: "bg-amber-50",    text: "text-amber-700",    dot: "bg-amber-500" },
};

const defaultConfig = { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" };

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
  showDot?: boolean;
  size?: "sm" | "md";
}

export function StatusBadge({ status, className, showDot = true, size = "sm" }: StatusBadgeProps) {
  const config = statusConfig[status] ?? defaultConfig;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        config.bg,
        config.text,
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        className
      )}
    >
      {showDot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      )}
      {status}
    </span>
  );
}

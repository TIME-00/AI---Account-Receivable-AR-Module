"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: string; isPositive: boolean };
  variant?: "default" | "success" | "warning" | "danger" | "info";
  isLoading?: boolean;
}

const variantStyles = {
  default: {
    bg: "from-white to-slate-50",
    icon: "bg-brand-50 text-brand-600",
    border: "border-slate-200",
  },
  success: {
    bg: "from-emerald-50/50 to-white",
    icon: "bg-emerald-50 text-emerald-600",
    border: "border-emerald-200/60",
  },
  warning: {
    bg: "from-amber-50/50 to-white",
    icon: "bg-amber-50 text-amber-600",
    border: "border-amber-200/60",
  },
  danger: {
    bg: "from-red-50/50 to-white",
    icon: "bg-red-50 text-red-600",
    border: "border-red-200/60",
  },
  info: {
    bg: "from-blue-50/50 to-white",
    icon: "bg-blue-50 text-blue-600",
    border: "border-blue-200/60",
  },
};

export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = "default",
  isLoading = false,
}: KpiCardProps) {
  const styles = variantStyles[variant];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-gradient-to-br p-5 transition-all duration-300",
        "hover:shadow-md hover:shadow-slate-200/80 hover:-translate-y-0.5",
        "backdrop-blur-xl",
        styles.bg,
        styles.border
      )}
    >
      {/* Decorative shimmer */}
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-slate-100/40 to-transparent" />

      <div className="relative flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {title}
          </p>

          {isLoading ? (
            <div className="mt-2 h-8 w-32 animate-pulse rounded-md bg-slate-200/60" />
          ) : (
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">
              {value}
            </p>
          )}

          {subtitle && (
            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
          )}

          {trend && (
            <div className="mt-2 flex items-center gap-1">
              <span
                className={cn(
                  "text-xs font-semibold",
                  trend.isPositive ? "text-emerald-600" : "text-red-600"
                )}
              >
                {trend.isPositive ? "↑" : "↓"} {trend.value}
              </span>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
            styles.icon
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

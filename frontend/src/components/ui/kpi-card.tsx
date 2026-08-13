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

/**
 * Variant styling is limited to the icon chip and the border tint. The card
 * body deliberately stays on the neutral surface token in every variant: a
 * metric tile washed in colour competes with the number it exists to present,
 * and the figure is the hero on this screen.
 */
const variantStyles = {
  default: { icon: "bg-accent-muted text-brand-600", border: "border-line" },
  success: { icon: "bg-emerald-50 text-emerald-600", border: "border-emerald-200/70" },
  warning: { icon: "bg-amber-50 text-amber-600", border: "border-amber-200/70" },
  danger: { icon: "bg-red-50 text-red-600", border: "border-red-200/70" },
  info: { icon: "bg-blue-50 text-blue-600", border: "border-blue-200/70" },
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
        "ds-lift group relative overflow-hidden rounded-xl border bg-surface p-5 shadow-card",
        "hover:shadow-elevated",
        styles.border,
      )}
    >
      {/* Top hairline. In dark this reads as rim light catching the panel edge;
          in light it resolves to a near-invisible 4% line. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgb(var(--hairline) / calc(var(--hairline-alpha) * 6)), transparent)",
        }}
      />

      <div className="relative flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {title}
          </p>

          {isLoading ? (
            <div className="mt-2 h-8 w-32 animate-pulse rounded-md bg-slate-200/70" />
          ) : (
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {value}
            </p>
          )}

          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}

          {trend && (
            <div className="mt-2 flex items-center gap-1">
              <span
                className={cn(
                  "text-xs font-semibold",
                  trend.isPositive ? "text-emerald-600" : "text-red-600",
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
            "transition-transform duration-normal ease-emphasized group-hover:scale-105",
            styles.icon,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

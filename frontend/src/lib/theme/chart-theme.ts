// ============================================================================
// TSH Synergy AR — Chart Theme
//
// Recharts renders SVG presentation attributes, not Tailwind classes, so the
// token remap that themes the rest of the product cannot reach axis lines,
// grids or tooltips. Without this module the dashboard charts would keep
// painting light-grey grids and a white tooltip on the dark theme.
//
// Series colours are deliberately theme-independent: an aging bucket or a
// credit rating means the same thing in both themes, and a finance operator
// should not have to re-learn the palette when they switch appearance. Only
// the chart *chrome* — grid, axes, tooltip surface — follows the theme.
// ============================================================================

"use client";

import { useThemeOrDefault } from "@/providers/theme-provider";
import type { UiTheme } from "@/lib/theme/contract";

export interface ChartTheme {
  /** Grid rules and axis lines. */
  grid: string;
  /** Axis tick labels. */
  axis: string;
  /** Emphasised axis tick labels (category names). */
  axisStrong: string;
  /** Cursor/hover band behind the focused category. */
  cursor: string;
  tooltip: {
    background: string;
    border: string;
    borderRadius: string;
    fontSize: string;
    color: string;
  };
}

const CHROME: Record<UiTheme, ChartTheme> = {
  dark: {
    grid: "#1e293f",
    axis: "#6b7a99",
    axisStrong: "#a3b0c9",
    cursor: "rgba(77, 141, 255, 0.10)",
    tooltip: {
      background: "#121b2f",
      border: "1px solid #2c3a58",
      borderRadius: "8px",
      fontSize: "12px",
      color: "#e8edf7",
    },
  },
  light: {
    grid: "#e2e8f0",
    axis: "#64748b",
    axisStrong: "#334155",
    cursor: "rgba(37, 99, 235, 0.06)",
    tooltip: {
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      fontSize: "12px",
      color: "#1e293b",
    },
  },
};

/**
 * Aging buckets, ordered current → most overdue. Stable across themes: these
 * are the 500-step status hues, which stay vivid on either ground.
 */
export const AGING_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#f97316", "#ef4444"] as const;

/** Outstanding / overdue / collected composition. */
export const DONUT_COLORS = ["#3b82f6", "#ef4444", "#22c55e"] as const;

/** Credit rating scale, best → worst. */
export const RATING_COLORS: Record<string, string> = {
  AAA: "#22c55e",
  AA: "#10b981",
  A: "#3b82f6",
  B: "#f59e0b",
  C: "#f97316",
  D: "#ef4444",
};

/** Collection trend series. */
export const TREND_COLOR = "#10b981";
export const TREND_COLOR_ACTIVE = "#34d399";

export function chartThemeFor(theme: UiTheme): ChartTheme {
  return CHROME[theme];
}

/** Chart chrome for the theme currently painted. */
export function useChartTheme(): ChartTheme {
  return chartThemeFor(useThemeOrDefault());
}

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
  /**
   * Tooltip palette.
   *
   * Every text colour is named explicitly rather than inherited. Recharts'
   * `DefaultTooltipContent` styles each item with `entry.color || '#000'` and
   * only applies `contentStyle` to the outer wrapper, so an inherited colour
   * cannot reach the value text — that is exactly how black tooltip text
   * appeared on the dark theme. The shared `ChartTooltip` renders its own
   * content from these values, so no chart depends on that fallback.
   */
  tooltip: {
    background: string;
    border: string;
    borderRadius: string;
    fontSize: string;
    /** Base text colour, and the colour of the value itself. */
    color: string;
    /** Category / series title above the value. */
    titleColor: string;
    /** The plotted value — the highest-contrast text in the tooltip. */
    valueColor: string;
    /** Secondary caption under a value (units, series name). */
    captionColor: string;
    shadow: string;
  };
}

const CHROME: Record<UiTheme, ChartTheme> = {
  dark: {
    grid: "#1e293f",
    axis: "#6b7a99",
    axisStrong: "#a3b0c9",
    cursor: "rgba(77, 141, 255, 0.10)",
    tooltip: {
      // Elevated panel on the graphite ground, matching --surface-elevated.
      background: "#121b2f",
      border: "1px solid #2c3a58",
      borderRadius: "8px",
      fontSize: "12px",
      color: "#e8edf7",
      titleColor: "#a3b0c9", // 7.9:1 on the tooltip surface
      valueColor: "#e8edf7", // 14.6:1 — the number is the point of the tooltip
      captionColor: "#a3b0c9", // 7.9:1
      shadow:
        "0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 18px 40px -12px rgb(0 0 0 / 0.75)",
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
      titleColor: "#64748b", // 4.8:1 on white — muted but AA
      valueColor: "#1e293b", // 14.6:1
      captionColor: "#64748b", // 4.8:1
      shadow:
        "0 10px 15px -3px rgb(15 23 42 / 0.08), 0 4px 6px -4px rgb(15 23 42 / 0.05)",
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

// ============================================================================
// Chart theming.
//
// Recharts writes SVG attributes, so it bypasses the token remap entirely.
// These assertions exist because a light-grey grid and a white tooltip on the
// dark theme is the exact failure this module was added to prevent.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGING_COLORS,
  chartThemeFor,
  DONUT_COLORS,
  RATING_COLORS,
} from "@/lib/theme/chart-theme";

const CHARTS = path.resolve(__dirname, "../../components/features/dashboard");

describe("chart chrome follows the theme", () => {
  it("gives dark and light different grid, axis and tooltip colours", () => {
    const dark = chartThemeFor("dark");
    const light = chartThemeFor("light");

    expect(dark.grid).not.toBe(light.grid);
    expect(dark.axis).not.toBe(light.axis);
    expect(dark.tooltip.background).not.toBe(light.tooltip.background);
  });

  it("uses a dark tooltip surface in dark and a white one in light", () => {
    expect(chartThemeFor("light").tooltip.background).toBe("#ffffff");
    expect(chartThemeFor("dark").tooltip.background).toBe("#121b2f");
    expect(chartThemeFor("dark").tooltip.color).toBe("#e8edf7");
  });

  it("keeps axis labels legible against their own ground", () => {
    const luminance = (hex: string) => {
      const n = hex.replace("#", "");
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    // Dark axis text sits on a near-black ground and must be the lighter of
    // the two; light axis text sits on white and must be the darker.
    expect(luminance(chartThemeFor("dark").axisStrong)).toBeGreaterThan(
      luminance(chartThemeFor("light").axisStrong),
    );
  });
});

describe("series colour keeps its meaning across themes", () => {
  it("defines aging buckets from current to most overdue", () => {
    expect(AGING_COLORS).toHaveLength(5);
    expect(AGING_COLORS[0]).toBe("#22c55e");
    expect(AGING_COLORS[AGING_COLORS.length - 1]).toBe("#ef4444");
  });

  it("keeps every aging bucket visually distinct", () => {
    expect(new Set(AGING_COLORS).size).toBe(AGING_COLORS.length);
  });

  it("keeps every credit rating visually distinct", () => {
    const values = Object.values(RATING_COLORS);
    expect(new Set(values).size).toBe(values.length);
    expect(Object.keys(RATING_COLORS)).toEqual(["AAA", "AA", "A", "B", "C", "D"]);
  });

  it("keeps composition slices distinct", () => {
    expect(new Set(DONUT_COLORS).size).toBe(DONUT_COLORS.length);
  });

  it("does not vary series colour by theme — a rating means one thing", () => {
    // Series palettes are plain constants, not functions of the theme. If that
    // ever changes, an operator switching appearance would see a bucket change
    // colour, which is a data-integrity smell on a financial dashboard.
    expect(typeof AGING_COLORS[0]).toBe("string");
    expect(typeof RATING_COLORS.AAA).toBe("string");
  });
});

describe("no chart hard-codes theme chrome any more", () => {
  const chartFiles = readdirSync(CHARTS)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => path.join(CHARTS, f));

  it("finds the dashboard chart components", () => {
    expect(chartFiles.length).toBeGreaterThan(4);
  });

  it.each([
    ["#e2e8f0", "light grid line"],
    ["#64748b", "light axis label"],
    ["#ffffff", "white tooltip surface"],
  ])("has no literal %s (%s) left in a chart", (literal) => {
    const offenders = chartFiles
      .filter((f) => readFileSync(f, "utf8").includes(literal))
      .map((f) => path.basename(f));
    expect(offenders).toEqual([]);
  });

  it("no longer exports a fixed tooltip style constant", () => {
    const tooltip = readFileSync(path.join(CHARTS, "chart-tooltip.tsx"), "utf8");
    expect(tooltip).not.toContain("export const TOOLTIP_STYLE");
    // Superseded assertion: the shared `useTooltipStyle` hook returned a
    // `contentStyle` object, which Recharts applies ONLY to the tooltip's outer
    // wrapper. That could never colour the value text, which is why dark
    // tooltips rendered black numbers. The tooltip now renders its own content,
    // so the correct property to assert is that it reads the chart-theme
    // authority directly.
    expect(tooltip).toContain("useChartTheme");
  });

  it("renders tooltip content itself instead of relying on Recharts defaults", () => {
    // `DefaultTooltipContent` styles each item with `entry.color || '#000'`.
    // Any chart still passing `contentStyle` would be back on that code path.
    const offenders = chartFiles
      .filter((f) => readFileSync(f, "utf8").includes("contentStyle="))
      .map((f) => path.basename(f));
    expect(offenders).toEqual([]);
  });

  it("routes every chart tooltip through the one shared component", () => {
    const withTooltip = chartFiles.filter((f) =>
      readFileSync(f, "utf8").includes("<Tooltip"),
    );
    expect(withTooltip.length).toBeGreaterThan(0);
    for (const f of withTooltip) {
      const source = readFileSync(f, "utf8");
      expect(source, `${path.basename(f)} must use the shared tooltip`).toMatch(
        /content=\{\s*<ChartTooltip/,
      );
    }
  });
});

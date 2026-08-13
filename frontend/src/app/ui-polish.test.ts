// ============================================================================
// Post-modernization UI polish — static guards.
//
// Covers the three reported Production issues at the source level, plus the
// class of defect behind two of them: a filled `<hue>-600` surface carrying
// white text. The dark theme reverses the chromatic ramps, so those steps
// resolve to PALE colours and white text on them is unreadable.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");
const productionFiles = walk(SRC).filter((f) => !/\.(test|spec)\.tsx?$/.test(f));

/** Removes `/* … *\/` blocks and `//` line comments. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/**
 * Source with comments removed.
 *
 * These guards are about what the code *does*, not what it explains. A doc
 * comment that names the old broken class (`bg-blue-600`) so the next reader
 * understands why the token exists is exactly the documentation to keep — it
 * must not trip the guard that forbids actually using it.
 */
const code = (f: string) => stripComments(read(f));

function rgbTokens(css: string, token: string): Array<[number, number, number]> {
  return [...stripComments(css).matchAll(
    new RegExp(`${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`, "g"),
  )].map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channels = [r, g, b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

// ── The guards must still bite ──────────────────────────────────────────────

describe("comment stripping does not defang the guards", () => {
  it("removes a class named inside a comment", () => {
    expect(stripComments('// use bg-blue-600 here')).not.toContain("bg-blue-600");
    expect(stripComments("/* bg-blue-600 */")).not.toContain("bg-blue-600");
  });

  it("still sees the same class used in real markup", () => {
    const real = 'const c = cn("rounded-full bg-blue-600 text-white");';
    expect(stripComments(real)).toContain("bg-blue-600");
    expect(/\bbg-(blue)-(600|700|800)\b/.test(stripComments(real))).toBe(true);
  });

  it("does not eat a protocol-relative or URL slash", () => {
    const url = 'const u = "https://example.test/a";';
    expect(stripComments(url)).toContain("https://example.test/a");
  });
});

// ── Issue 1: stale Report Center copy ───────────────────────────────────────

describe("Report Center tells the truth about export", () => {
  const reportsPage = read(path.join(SRC, "app/(dashboard)/reports/page.tsx"));

  it("no longer renders a Coming Soon badge", () => {
    expect(reportsPage).not.toContain("Coming Soon");
  });

  it("no longer claims export is a future sprint", () => {
    expect(reportsPage).not.toContain("future sprint");
    expect(reportsPage).not.toContain("will be available");
  });

  it("states the accurate, currently-shipped export behaviour", () => {
    expect(reportsPage).toContain(
      "PDF and Excel exports are available within each report.",
    );
  });

  it("does not promise a global one-click export the page does not have", () => {
    // The page itself must not offer an export control; export lives on each
    // report. A disabled or dead button here is what created the confusion.
    expect(reportsPage).not.toMatch(/<button[^>]*disabled/);
    expect(reportsPage).not.toContain("ExportMenu");
  });

  it("is backed by a real export control on every report page", () => {
    const reportPages = [
      "app/(dashboard)/reports/aging/page.tsx",
      "app/(dashboard)/reports/invoices/page.tsx",
      "app/(dashboard)/reports/outstanding/page.tsx",
      "app/(dashboard)/reports/receipts/page.tsx",
    ];
    for (const p of reportPages) {
      expect(read(path.join(SRC, p)), `${p} should offer export`).toContain(
        "<ExportMenu",
      );
    }
  });

  it("offers PDF and Excel, matching the wording", () => {
    const exportMenu = read(
      path.join(SRC, "components/features/reports/export-menu.tsx"),
    );
    expect(exportMenu).toContain('pdf: "PDF"');
    expect(exportMenu).toContain('xlsx: "Excel"');
  });
});

// ── Issue 2: chart tooltips ─────────────────────────────────────────────────

describe("charts do not reintroduce hard-coded tooltip colours", () => {
  const chartFiles = walk(path.join(SRC, "components/features/dashboard")).filter(
    (f) => f.endsWith(".tsx") && !f.includes(".test."),
  );

  it("has no literal black anywhere in a chart component", () => {
    const offenders = chartFiles
      .filter((f) => /#000\b|#000000|rgb\(0,\s*0,\s*0\)|"black"/.test(code(f)))
      .map((f) => path.basename(f));
    expect(offenders).toEqual([]);
  });

  it("keeps every chart colour flowing from the chart-theme authority", () => {
    const usingRecharts = chartFiles.filter((f) => read(f).includes('from "recharts"'));
    expect(usingRecharts.length).toBe(4);
    for (const f of usingRecharts) {
      const source = read(f);
      expect(
        /useChartTheme|ChartTooltip|AGING_COLORS|DONUT_COLORS|TREND_COLOR/.test(source),
        `${path.basename(f)} must consume chart-theme`,
      ).toBe(true);
    }
  });

  it("themes the hover cursor instead of leaving the grey default", () => {
    for (const name of ["aging-chart.tsx", "credit-risk-chart.tsx"]) {
      const source = read(path.join(SRC, "components/features/dashboard", name));
      expect(source, `${name} needs a themed cursor`).toContain(
        "cursor={{ fill: chart.cursor }}",
      );
    }
  });

  it("wires the two charts named in the report to the shared tooltip", () => {
    for (const name of ["composition-chart.tsx", "credit-risk-chart.tsx"]) {
      const source = read(path.join(SRC, "components/features/dashboard", name));
      expect(source, `${name} must use ChartTooltip`).toMatch(
        /content=\{\s*<ChartTooltip/,
      );
    }
  });
});

// ── Issue 3 and its wider class ─────────────────────────────────────────────

describe("no filled reversed-ramp surface carries white text", () => {
  it("has no bg-<hue>-600/700 fill left in production source", () => {
    // Under the dark ramp these steps resolve to PALE colours (600 -> the
    // Tailwind 300 shade), so a filled surface built from them cannot carry
    // white text. `--brand-fill` / `--danger-fill` are the surface-safe tokens.
    const pattern =
      /\bbg-(blue|emerald|red|amber|green|purple|indigo|sky|orange|teal|violet|gray)-(600|700|800)\b/;
    const offenders = productionFiles
      .filter((f) => pattern.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("routes the destructive button through the danger fill token", () => {
    const button = read(path.join(SRC, "components/ui/loading-button.tsx"));
    expect(button).toContain("bg-feedback-danger-fill");
    expect(button).not.toContain("bg-red-600");
  });

  it("routes the primary button through the brand fill token", () => {
    const button = read(path.join(SRC, "components/ui/loading-button.tsx"));
    expect(button).toContain("bg-accent-fill");
  });

  it("does not hide a raw reversed-ramp gradient behind white control text", () => {
    // This is intentionally a bounded source guard, not a pretend CSS parser:
    // it catches the concrete failure mode in a local class-expression window,
    // including `cn()` and template/class-helper composition spread over lines.
    const rawGradient =
      /(?:from|via|to)-(?:brand|blue|emerald|red|amber|green|purple|indigo|sky|orange|teal|violet)-(?:600|700|800)/;
    const offenders = productionFiles.filter((f) => {
      const source = code(f);
      return [...source.matchAll(/text-white/g)].some(({ index = 0 }) =>
        rawGradient.test(source.slice(Math.max(0, index - 400), index + 400)),
      );
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("defines both fill scales in both themes", () => {
    // Comments stripped: the dark block explains itself by naming
    // `--brand-fill`, which would otherwise be counted as a third declaration.
    const css = stripComments(read(path.join(SRC, "app/globals.css")));
    for (const token of [
      "--brand-fill",
      "--brand-fill-hover",
      "--danger-fill",
      "--danger-fill-hover",
      "--chip-bg",
      "--chip-bg-hover",
      "--chip-border",
      "--chip-text",
    ]) {
      const occurrences = css.split(`${token}:`).length - 1;
      expect(occurrences, `${token} must exist in dark and light`).toBe(2);
    }
  });
});

describe("filter chips have one visual authority", () => {
  const customersPage = read(path.join(SRC, "app/(dashboard)/customers/page.tsx"));

  it("renders both filter groups through the shared component", () => {
    expect(customersPage).toContain("FilterChipGroup");
    expect(customersPage.match(/<FilterChipGroup/g)).toHaveLength(2);
  });

  it("no longer hand-rolls chip styling in the page", () => {
    expect(customersPage).not.toContain("bg-blue-600");
    expect(customersPage).not.toContain("bg-slate-100 text-slate-600");
  });

  it("keeps the emitted filter state wiring intact", () => {
    // The backend contract: `status` and `credit_rating` query fields.
    expect(customersPage).toContain("setStatusFilter");
    expect(customersPage).toContain("setRatingFilter");
    expect(customersPage).toContain("status: statusFilter");
    expect(customersPage).toContain("creditRating: ratingFilter");
  });

  it("keeps filter changes resetting pagination", () => {
    expect(customersPage).toContain("applyFilter(() => setStatusFilter");
    expect(customersPage).toContain("applyFilter(() => setRatingFilter");
  });
});

describe("filled controls and filter chips meet text contrast in both themes", () => {
  const css = read(path.join(SRC, "app/globals.css"));
  const white: [number, number, number] = [255, 255, 255];

  it.each([0, 1])("theme %s keeps selected-chip white text at AA", (theme) => {
    expect(contrastRatio(white, rgbTokens(css, "--brand-fill")[theme])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([0, 1])("theme %s keeps inactive-chip text at AA", (theme) => {
    expect(
      contrastRatio(
        rgbTokens(css, "--chip-text")[theme],
        rgbTokens(css, "--chip-bg")[theme],
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each([0, 1])("theme %s keeps destructive-button white text at AA", (theme) => {
    expect(contrastRatio(white, rgbTokens(css, "--danger-fill")[theme])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("shadowed interactive controls compose a visible focus ring", () => {
  const focus = read(path.join(SRC, "lib/focus-styles.ts"));

  it("defines one reusable ring that composes with Tailwind shadows", () => {
    expect(focus).toContain("focus-visible:ring-2");
    expect(focus).toContain("focus-visible:ring-accent");
    expect(focus).toContain("focus-visible:ring-offset-2");
    expect(focus).toContain("focus-visible:ring-offset-app-bg");
  });

  it("covers the theme toggle, filled buttons, chips, login CTA and segmented controls", () => {
    for (const relative of [
      "components/ui/theme-toggle.tsx",
      "components/ui/loading-button.tsx",
      "components/ui/filter-chip-group.tsx",
      "app/login/page.tsx",
      "app/(dashboard)/invoices/page.tsx",
      "app/(dashboard)/invoices/import/page.tsx",
      "app/(dashboard)/receipts/import/page.tsx",
    ]) {
      expect(read(path.join(SRC, relative)), relative).toContain(
        "COMPOSABLE_FOCUS_RING",
      );
    }
  });
});

// ── Regression guards for the modernization this builds on ──────────────────

describe("modernization invariants still hold", () => {
  it("introduces no dark: variants — theming stays token-driven", () => {
    const offenders = productionFiles
      .filter((f) => /\bdark:[a-z-]/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("introduces no literal white surface", () => {
    const offenders = productionFiles
      .filter((f) => /\bbg-white\b/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("keeps reduced motion honoured for the chip press affordance", () => {
    const css = read(path.join(SRC, "app/globals.css"));
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".ds-press:active");
    expect(reduced).toContain("transform: none !important");
  });

  it("keeps every production file under the 1000-line boundary", () => {
    const oversized = productionFiles
      .map((f) => ({ file: rel(f), lines: read(f).split("\n").length }))
      .filter((x) => x.lines > 1000);
    expect(oversized).toEqual([]);
  });
});

// ============================================================================
// Design System — token contract.
//
// The whole theming strategy rests on two invariants:
//
//   1. Dark tokens live on `:root`, so a document that never runs JavaScript
//      still paints dark. Light is an override, never the base.
//   2. Colour utilities resolve through CSS variables rather than fixed hexes,
//      which is what lets existing pages theme without `dark:` variants.
//
// These assertions read the real stylesheet and the real Tailwind config, so
// they fail if either invariant is quietly reverted.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const tailwind = readFileSync(path.join(ROOT, "tailwind.config.ts"), "utf8");

/** Extract the body of a top-level selector block from the stylesheet. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector} block`).toBeGreaterThan(-1);
  const from = css.indexOf("{", start);
  let depth = 0;
  for (let i = from; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(from + 1, i);
    }
  }
  throw new Error(`unterminated ${selector} block`);
}

const rootBlock = block(":root");
const lightBlock = block(".light");

function rgbToken(source: string, token: string): [number, number, number] {
  const match = source.match(new RegExp(`${token}: ([\\d ]+);`));
  expect(match, `missing ${token}`).toBeTruthy();
  return match![1].trim().split(/\s+/).map(Number) as [number, number, number];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: [number, number, number], background: [number, number, number]): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("theme token roots", () => {
  it("defines the dark palette on :root so dark is the no-JavaScript default", () => {
    expect(rootBlock).toContain("color-scheme: dark");
    // Deep blue-black ground, not a mid grey.
    expect(rootBlock).toContain("--app-bg: 7 11 22");
    expect(rootBlock).toContain("--surface: 13 20 36");
    expect(rootBlock).toContain("--text-primary: 232 237 247");
  });

  it("defines light as an override rather than the base", () => {
    expect(lightBlock).toContain("color-scheme: light");
    expect(lightBlock).toContain("--surface: 255 255 255");
    expect(lightBlock).toContain("--text-primary: 15 23 42");
    // The light block must come after :root so it can win.
    expect(css.indexOf(".light {")).toBeGreaterThan(css.indexOf(":root {"));
  });

  it("gives both themes the complete semantic vocabulary", () => {
    const required = [
      "--app-bg", "--surface", "--surface-elevated", "--surface-muted",
      "--border", "--border-muted", "--border-strong",
      "--text-primary", "--text-secondary", "--text-muted", "--text-inverse",
      "--brand", "--brand-hover", "--brand-muted",
      "--success", "--warning", "--danger", "--info",
      "--nav-bg", "--nav-item-hover", "--nav-item-active",
      "--table-bg", "--table-header", "--table-row-hover",
      "--input-bg", "--input-border", "--focus-ring",
      "--shadow-sm", "--shadow-card", "--shadow-elevated",
      "--glow-brand", "--glow-subtle",
    ];
    for (const token of required) {
      expect(rootBlock, `dark missing ${token}`).toContain(`${token}:`);
      expect(lightBlock, `light missing ${token}`).toContain(`${token}:`);
    }
  });

  it("defines one motion scale shared by both themes", () => {
    for (const token of [
      "--motion-fast", "--motion-normal", "--motion-slow",
      "--ease-standard", "--ease-emphasized",
    ]) {
      expect(rootBlock).toContain(`${token}:`);
    }
  });
});

describe("WCAG contrast authority", () => {
  it.each([
    ["dark", rootBlock],
    ["light", lightBlock],
  ] as const)("keeps %s text and controls at AA contrast", (_name, source) => {
    const surface = rgbToken(source, "--surface");
    const input = rgbToken(source, "--input-bg");
    const button = rgbToken(source, "--brand-fill");
    const buttonText = rgbToken(source, "--brand-contrast");

    for (const token of ["--text-primary", "--text-secondary", "--text-muted"]) {
      expect(contrast(rgbToken(source, token), surface), token).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(rgbToken(source, "--text-muted"), input), "placeholder").toBeGreaterThanOrEqual(4.5);
    expect(contrast(buttonText, button), "primary action").toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgbToken(source, "--focus-ring"), surface), "focus ring").toBeGreaterThanOrEqual(3);
  });

  it("keeps primary filled controls on the dedicated contrast-safe scale", () => {
    expect(tailwind).toContain('fill: "rgb(var(--brand-fill) / <alpha-value>)"');
    expect(css).toContain("--brand-fill-hover:");
    expect(css).toContain("--brand-fill-active:");
  });
});

describe("structural and status ramps are themeable", () => {
  it("routes the slate scale through variables in both themes", () => {
    for (const step of [50, 100, 200, 400, 600, 800, 900]) {
      expect(rootBlock).toContain(`--c-slate-${step}:`);
      expect(lightBlock).toContain(`--c-slate-${step}:`);
    }
  });

  it("reverses the slate ramp in dark so existing utilities stay correct", () => {
    // `bg-slate-50` is a page/card surface in the product: it must be the
    // darkest step in dark and the lightest in light.
    expect(rootBlock).toContain("--c-slate-50: 13 20 36");
    expect(lightBlock).toContain("--c-slate-50: 248 250 252");
    // `text-slate-900` is body copy: near-white in dark, near-black in light.
    expect(rootBlock).toContain("--c-slate-900: 232 237 247");
    expect(lightBlock).toContain("--c-slate-900: 15 23 42");
  });

  it("keeps critical status hues distinguishable from one another in dark", () => {
    // The 500 step carries status identity (dots, icons) and stays vivid in
    // both themes, so overdue/paid/partial can never collapse into each other.
    const read = (name: string) => {
      const m = rootBlock.match(new RegExp(`--c-${name}-500: ([\\d ]+);`));
      expect(m, `missing --c-${name}-500`).toBeTruthy();
      return m![1].trim();
    };
    const danger = read("red");
    const success = read("emerald");
    const warning = read("amber");
    const info = read("blue");
    expect(new Set([danger, success, warning, info]).size).toBe(4);
    // Unchanged from the light theme: status colour is not theme-dependent.
    expect(danger).toBe("239 68 68");
    expect(success).toBe("16 185 129");
  });

  it("turns status tints into dark washes while lifting their text", () => {
    // `bg-red-50 text-red-700` is the product's status-container idiom. In dark
    // the tint must go dark and the text must go light, or badges invert.
    const tint = rootBlock.match(/--c-red-50: ([\d ]+);/)![1].split(" ").map(Number);
    const text = rootBlock.match(/--c-red-700: ([\d ]+);/)![1].split(" ").map(Number);
    const luminance = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    expect(luminance(tint)).toBeLessThan(80);
    expect(luminance(text)).toBeGreaterThan(140);
  });
});

describe("Tailwind reads the tokens rather than fixed colours", () => {
  it("maps the slate scale to variables with alpha support", () => {
    expect(tailwind).toContain('50: "rgb(var(--c-slate-50) / <alpha-value>)"');
    expect(tailwind).toContain('900: "rgb(var(--c-slate-900) / <alpha-value>)"');
  });

  it("exposes semantic surface, table, nav and input colours", () => {
    for (const token of [
      "--surface", "--surface-elevated", "--surface-muted",
      "--table-bg", "--table-header", "--table-row-hover", "--table-border",
      "--nav-bg", "--nav-item-hover", "--nav-item-active",
      "--input-bg", "--input-border",
    ]) {
      expect(tailwind, `tailwind missing ${token}`).toContain(`var(${token})`);
    }
  });

  it("keeps the sidebar palette theme-aware instead of hard-coded dark", () => {
    // These were fixed hexes before modernization; a regression to a literal
    // would make the sidebar ignore the light theme entirely.
    expect(tailwind).not.toContain('bg: "#0a0f1e"');
    expect(tailwind).toContain('bg: "rgb(var(--nav-bg) / <alpha-value>)"');
  });

  it("exposes the motion scale as Tailwind duration and easing tokens", () => {
    expect(tailwind).toContain("var(--motion-fast)");
    expect(tailwind).toContain("var(--motion-normal)");
    expect(tailwind).toContain("var(--ease-emphasized)");
  });

  it("keeps class-based theming enabled", () => {
    expect(tailwind).toContain('darkMode: "class"');
  });
});

describe("shared surfaces are token-driven", () => {
  it("defines the surface primitives against tokens, not literal white", () => {
    for (const cls of [".ds-surface", ".ds-surface-elevated", ".ds-surface-muted", ".ds-glass"]) {
      expect(css).toContain(`${cls} {`);
    }
    const surface = block(".ds-surface");
    expect(surface).toContain("rgb(var(--surface))");
    expect(surface).toContain("rgb(var(--border))");
  });

  it("re-points the legacy glass/card helpers at tokens", () => {
    // These classes still exist in pages; they must no longer paint white.
    const glassCard = block(".glass-card");
    expect(glassCard).toContain("var(--surface-glass)");
    expect(glassCard).not.toContain("#fff");
    const chart = block(".chart-container");
    expect(chart).toContain("rgb(var(--surface))");
  });

  it("themes form controls through input tokens", () => {
    const input = block(".input-premium");
    expect(input).toContain("rgb(var(--input-bg))");
    expect(input).toContain("rgb(var(--input-border))");
  });

  it("gives focus a visible ring in both themes", () => {
    expect(css).toContain("*:focus-visible");
    expect(css).toContain("var(--focus-ring)");
  });
});

describe("dialogs and overlays", () => {
  it("defines the modal scrim as its own token in both themes", () => {
    // A `slate-950` scrim would invert to near-white under the reversed dark
    // ramp, washing the screen out instead of dimming it.
    expect(rootBlock).toContain("--scrim:");
    expect(rootBlock).toContain("--scrim-alpha:");
    expect(lightBlock).toContain("--scrim:");
    expect(lightBlock).toContain("--scrim-alpha:");
    expect(block(".ds-scrim")).toContain("rgb(var(--scrim) / var(--scrim-alpha))");
  });

  it("veils more heavily in dark, where the ground is already dark", () => {
    const darkAlpha = Number(rootBlock.match(/--scrim-alpha: ([\d.]+);/)![1]);
    const lightAlpha = Number(lightBlock.match(/--scrim-alpha: ([\d.]+);/)![1]);
    expect(darkAlpha).toBeGreaterThan(lightAlpha);
  });

  it("gives dialog surfaces an enter animation", () => {
    expect(css).toContain(".ds-overlay-enter");
    expect(css).toContain("@keyframes dsOverlayEnter");
  });

  it("gives dropdown menus their own, faster enter animation", () => {
    expect(css).toContain(".ds-menu-enter");
    expect(css).toContain("@keyframes dsMenuEnter");
    expect(block(".ds-menu-enter")).toContain("var(--motion-fast)");
  });
});

describe("motion system", () => {
  it("defines the entry, reveal and overlay primitives", () => {
    for (const cls of [
      ".ds-page-enter", ".ds-reveal", ".ds-overlay-enter",
      ".ds-menu-enter", ".ds-press", ".ds-lift", ".ds-brand-edge",
    ]) {
      expect(css, `missing ${cls}`).toContain(cls);
    }
  });

  it("animates only compositor-friendly properties on the reveal", () => {
    const reveal = block(".ds-reveal");
    expect(reveal).toContain("opacity");
    expect(reveal).toContain("transform");
    // Animating layout properties would cause reflow on every reveal.
    expect(reveal).not.toContain("height:");
    expect(reveal).not.toContain("margin:");
  });

  it("keeps content visible when the observer never runs", () => {
    expect(css).toContain(".no-js .ds-reveal");
  });

  it("restrains glow to dark and does not animate it", () => {
    // A pulsing glow is the difference between a console and a gaming rig.
    expect(css).not.toMatch(/animation:[^;]*glow/i);
    const light = lightBlock.match(/--glow-brand: ([^;]+);/)![1];
    expect(light).not.toContain("22px");
  });

  it("keeps the ambient wash static and dark-only", () => {
    expect(css).toContain(":root:not(.light) .ds-aurora::after");
    // A moving gradient behind financial data is exactly the distraction the
    // design brief rules out.
    expect(block(".ds-aurora::after")).not.toContain("animation:");
  });
});

describe("reduced motion", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

  it("declares a reduced-motion block", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("removes non-essential animation and transform", () => {
    expect(reduced).toContain("animation-duration: 1ms !important");
    expect(reduced).toContain("transition-duration: 1ms !important");
    expect(reduced).toContain(".ds-page-enter");
    expect(reduced).toContain(".ds-overlay-enter");
    expect(reduced).toContain("transform: none !important");
  });

  it("keeps revealed content visible rather than stuck transparent", () => {
    expect(reduced).toContain("opacity: 1 !important");
  });

  it("keeps the active-navigation indicator legible without its animation", () => {
    // The indicator conveys state, so it must remain drawn — only its growth
    // animation is dropped.
    expect(reduced).toContain('.ds-brand-edge[data-active="true"]::before');
    expect(reduced).toContain("scaleY(1) !important");
  });

  it("drops the decorative ambient wash entirely", () => {
    expect(reduced).toContain(".ds-aurora::after");
    expect(reduced).toContain("display: none !important");
  });
});

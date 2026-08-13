// ============================================================================
// AR Copilot — token contrast.
//
// The Copilot leans on the brand accent for its context chip, its "Go to"
// links, and its empty-state mark. Browser measurement caught `text-accent` on
// `bg-accent-muted` at 3.78:1 in Dark — below AA for the 10-11px type those
// elements use. This suite pins the corrected pairings against the real token
// values in `globals.css` so the regression cannot come back silently.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "../../../app/globals.css"),
  "utf8",
);

/**
 * Read a token from the Dark block (`:root`) or the Light block (`.light`).
 * Both define the same names, so the theme is selected by which block the
 * declaration falls in.
 */
function token(name: string, theme: "dark" | "light"): [number, number, number] {
  const blocks = CSS.split(/\.light\s*\{/);
  const source = theme === "dark" ? blocks[0] : blocks.slice(1).join("{");
  const match = new RegExp(`${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(
    source,
  );
  if (!match) throw new Error(`Token ${name} not found for ${theme}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

const themes = ["dark", "light"] as const;

describe("accent text on the muted accent surface", () => {
  it.each(themes)("clears AA in %s", (theme) => {
    // `--brand-hover` moves away from `--brand-muted` in BOTH themes: lighter
    // in Dark, darker in Light. That is why it is the correct resting colour
    // for small type on the muted brand surface, not merely a hover state.
    const ratio = contrast(
      token("--brand-hover", theme),
      token("--brand-muted", theme),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("documents why plain --brand was not enough in %s", (theme) => {
    // Kept as an explicit record of the measured defect rather than a comment.
    const ratio = contrast(token("--brand", theme), token("--brand-muted", theme));
    expect(ratio).toBeLessThan(4.5);
  });
});

describe("panel surfaces", () => {
  it.each(themes)("keeps primary answer text far above AA in %s", (theme) => {
    expect(
      contrast(token("--text-primary", theme), token("--surface-elevated", theme)),
    ).toBeGreaterThanOrEqual(7);
  });

  it.each(themes)("keeps the disclosure readable in %s", (theme) => {
    expect(
      contrast(token("--text-secondary", theme), token("--surface-muted", theme)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("keeps the inactive tab label legible in %s", (theme) => {
    expect(
      contrast(token("--text-muted", theme), token("--surface", theme)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("keeps white legible on the filled accent in %s", (theme) => {
    // The Copilot mark and the Send button are white on `--brand-fill`, the
    // surface-safe brand variant rather than the reversed `brand-600` ramp.
    expect(
      contrast([255, 255, 255], token("--brand-fill", theme)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("keeps evidence chip text legible in %s", (theme) => {
    expect(
      contrast(token("--chip-text", theme), token("--chip-bg", theme)),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// ─── Small uppercase labels ─────────────────────────────────────────────────
//
// A second browser pass measured the 10px labels the first one did not cover:
// the evidence kind ("INVOICE"), the "Sources" and "Go to" headings, and the
// disclosure detail heading. `--text-muted` failed AA on three of the four
// surfaces they sit on, so they all moved to `--text-secondary`.

describe("10px labels on the Copilot surfaces", () => {
  const pairs = [
    // Evidence kind label, inside a chip.
    ["--chip-bg", "evidence kind"],
    // "Sources" and "Go to", on the elevated answer card.
    ["--surface-elevated", "answer section headings"],
    // Disclosure detail heading, on the muted disclosure strip.
    ["--surface-muted", "disclosure detail heading"],
    // "Asked from …", the trim notice, and the composer hint, on the panel.
    ["--surface", "panel-level small text"],
  ] as const;

  it.each(
    themes.flatMap((theme) =>
      pairs.map(([surface, what]) => ({ theme, surface, what })),
    ),
  )("$what clears AA in $theme", ({ theme, surface }) => {
    expect(
      contrast(token("--text-secondary", theme), token(surface, theme)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("records the surfaces where --text-muted was measured below AA", () => {
    // Dark: 4.08 on the chip, 4.32 on the elevated card.
    // Light: 4.34 on the muted disclosure strip.
    // Kept as an executable record so a future "simplify to muted" change fails.
    expect(contrast(token("--text-muted", "dark"), token("--chip-bg", "dark")))
      .toBeLessThan(4.5);
    expect(
      contrast(token("--text-muted", "dark"), token("--surface-elevated", "dark")),
    ).toBeLessThan(4.5);
    expect(
      contrast(token("--text-muted", "light"), token("--surface-muted", "light")),
    ).toBeLessThan(4.5);
  });

  it.each(themes)(
    "keeps --text-muted acceptable on the plain panel surface in %s",
    (theme) => {
      // This is the one muted pairing the Copilot still relies on, for the
      // composer hint and the "Asked from …" caption.
      expect(
        contrast(token("--text-muted", theme), token("--surface", theme)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

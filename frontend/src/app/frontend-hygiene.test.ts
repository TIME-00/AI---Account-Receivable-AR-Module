// ============================================================================
// Frontend hygiene — refactor and dead-code guards.
//
// Static assertions over the real source tree. They exist to stop the specific
// regressions this modernization is vulnerable to: a literal white surface
// creeping back in, a second theme state appearing beside the provider, a
// deleted module leaving a dangling importer, or a file growing past the
// maintainability boundary.
// ============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

const allFiles = walk(SRC);
const productionFiles = allFiles.filter((f) => !/\.(test|spec)\.tsx?$/.test(f));
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");
const read = (f: string) => readFileSync(f, "utf8");

// ── Style consolidation ─────────────────────────────────────────────────────

describe("literal surface colours are gone", () => {
  it("has no `bg-white` left in production source", () => {
    const offenders = productionFiles
      .filter((f) => /\bbg-white\b/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("has no white gradient stops, which would stay white in dark", () => {
    const offenders = productionFiles
      .filter((f) => /\b(?:from|to|via)-white\b/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("still allows `text-white` where the foreground is white in both themes", () => {
    // Brand gradients carry white type deliberately; this documents that the
    // sweep was semantic rather than a blind find-and-replace.
    const usesTextWhite = productionFiles.some((f) => /\btext-white\b/.test(read(f)));
    expect(usesTextWhite).toBe(true);
  });

  it("introduces no `dark:` variants — theming goes through tokens", () => {
    const offenders = productionFiles
      .filter((f) => /\bdark:[a-z-]/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

// ── Single source of theme truth ────────────────────────────────────────────

describe("theme state is not duplicated", () => {
  const themeOwners = [
    "src/providers/theme-provider.tsx",
    "src/lib/theme/contract.ts",
    "src/lib/theme/storage.ts",
    "src/lib/theme/bootstrap.ts",
    "src/hooks/use-theme-preference.ts",
    "src/components/ui/theme-toggle.tsx",
  ];

  it("keeps every theme module present", () => {
    for (const f of themeOwners) {
      expect(existsSync(path.join(ROOT, f)), `missing ${f}`).toBe(true);
    }
  });

  it("writes the theme class from exactly one place", () => {
    // Reads are fine (the provider adopts whatever the bootstrap painted);
    // it is a second *writer* that would let two sources fight over the theme.
    const offenders = productionFiles
      .filter((f) => /classList\.(add|remove|toggle)\(/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual(["src/lib/theme/bootstrap.ts"]);
  });

  it("reads and writes the theme cache only through the storage module", () => {
    const offenders = productionFiles
      .filter((f) => !rel(f).startsWith("src/lib/theme/"))
      .filter((f) => /localStorage\.(get|set|remove)Item\(\s*["'`]ar\.ui\.theme/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("has no global unscoped theme key anywhere — that is the cross-user leak", () => {
    const offenders = productionFiles
      .filter((f) => /localStorage\.setItem\(\s*["'`]theme["'`]/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("routes preference traffic only through the reviewed auth path constant", () => {
    const offenders = productionFiles
      .filter((f) => rel(f) !== "src/lib/theme/contract.ts")
      .filter((f) => /["'`]\/auth\/ui-preferences/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

// ── Reach of the theme control ──────────────────────────────────────────────

describe("the theme control reaches every authenticated page", () => {
  const header = read(path.join(ROOT, "src/components/layout/header.tsx"));
  const dashboardLayout = read(path.join(ROOT, "src/app/(dashboard)/layout.tsx"));

  it("lives in the shared header", () => {
    expect(header).toContain("ThemeToggle");
  });

  it("offers it on narrow viewports through the account menu too", () => {
    expect(header).toContain('variant="menu"');
  });

  it("renders that header from the dashboard layout", () => {
    expect(dashboardLayout).toContain("<Header />");
  });

  it("puts every dashboard route under that layout", () => {
    // Route groups inherit the group layout, so a page inside `(dashboard)`
    // necessarily gets the header — and therefore the control.
    const group = path.join(SRC, "app/(dashboard)");
    const pages = walk(group).filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(20);
    // No nested layout may drop the shell.
    const nested = walk(group).filter(
      (f) => f.endsWith("layout.tsx") && f !== path.join(group, "layout.tsx"),
    );
    for (const f of nested) {
      expect(read(f), `${rel(f)} must render its children`).toContain("children");
    }
  });

  it("is mounted below the auth and query providers in the root layout", () => {
    const root = read(path.join(ROOT, "src/app/layout.tsx"));
    expect(root.indexOf("<AuthProvider>")).toBeLessThan(root.indexOf("<ThemeProvider>"));
    expect(root.indexOf("<QueryProvider>")).toBeLessThan(root.indexOf("<ThemeProvider>"));
  });

  it("renders the document dark on the server and boots the theme in <head>", () => {
    const root = read(path.join(ROOT, "src/app/layout.tsx"));
    expect(root).toContain('className="dark"');
    expect(root).toContain("THEME_BOOTSTRAP_SCRIPT");
    expect(root).toContain("suppressHydrationWarning");
  });
});

// ── Dead code ───────────────────────────────────────────────────────────────

describe("removed modules leave no importers", () => {
  const deleted = [
    { file: "src/hooks/use-lookups.ts", specifier: "hooks/use-lookups", symbols: ["useTaxCodeLookups", "usePaymentTermLookups"] },
    {
      file: "src/components/features/invoices/customer-search-overlay.tsx",
      specifier: "customer-search-overlay",
      symbols: ["CustomerSearchOverlay"],
    },
  ];

  it.each(deleted)("$file is gone", ({ file }) => {
    expect(existsSync(path.join(ROOT, file))).toBe(false);
  });

  it.each(deleted)("$file has no remaining importer or reference", ({ specifier, symbols }) => {
    const offenders = allFiles
      .filter((f) => {
        const s = read(f);
        return s.includes(specifier) || symbols.some((sym) => new RegExp(`\\b${sym}\\b`).test(s));
      })
      .map(rel)
      // This spec names them on purpose.
      .filter((f) => f !== "src/app/frontend-hygiene.test.ts");
    expect(offenders).toEqual([]);
  });

  it("ships no unused design-system wrapper components", () => {
    // `Surface`/`TableShell`/`PageShell`/`PageHeader` React wrappers were built
    // and then removed: the reuse they would have provided is already delivered
    // by the `.ds-*` class primitives, which every themed surface actually uses.
    // Shipping both would have been the overengineered abstraction the brief
    // warns against, and an unused component is dead code like any other.
    for (const f of ["src/components/ui/surface.tsx", "src/components/ui/page-shell.tsx"]) {
      expect(existsSync(path.join(ROOT, f)), `${f} should not exist`).toBe(false);
    }
    const offenders = allFiles
      .filter((f) => /@\/components\/ui\/(surface|page-shell)/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("keeps the class primitives that replaced them genuinely in use", () => {
    const used = (cls: string) =>
      productionFiles.filter((f) => new RegExp(`\\b${cls}\\b`).test(read(f))).length;
    for (const cls of ["ds-surface", "ds-press", "ds-overlay-enter", "input-premium"]) {
      expect(used(cls), `${cls} has no call sites`).toBeGreaterThan(0);
    }
  });

  it("removed the animation utilities that lost their last call site", () => {
    const tailwind = read(path.join(ROOT, "tailwind.config.ts"));
    expect(tailwind).not.toContain("shimmer");
    expect(tailwind).not.toContain("pulseSubtle");
    const css = read(path.join(ROOT, "src/app/globals.css"));
    expect(css).not.toContain(".card-interactive");
  });

  it("keeps the animations that are still referenced", () => {
    const tailwind = read(path.join(ROOT, "tailwind.config.ts"));
    for (const kept of ["fadeIn", "slideInRight"]) {
      expect(tailwind).toContain(kept);
    }
  });

  it("leaves no import pointing at a file that does not exist", () => {
    const broken: string[] = [];
    for (const f of allFiles) {
      const source = read(f);
      for (const m of source.matchAll(/from\s+["'](@\/[^"']+)["']/g)) {
        const target = path.join(SRC, m[1].slice(2));
        const found = [
          target, `${target}.ts`, `${target}.tsx`,
          path.join(target, "index.ts"), path.join(target, "index.tsx"),
        ].some((c) => existsSync(c) && statSync(c).isFile());
        if (!found) broken.push(`${rel(f)} -> ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

// ── Maintainability boundary ────────────────────────────────────────────────

describe("file size boundary", () => {
  it("keeps every production frontend file under 1000 lines", () => {
    const oversized = productionFiles
      .map((f) => ({ file: rel(f), lines: read(f).split("\n").length }))
      .filter((x) => x.lines > 1000);
    expect(oversized).toEqual([]);
  });

  it("keeps the new theme and motion modules small and single-purpose", () => {
    // Guards against the "theme-and-animation-utils" grab-bag the brief warns
    // about: each of these owns one responsibility.
    for (const f of [
      "src/lib/theme/contract.ts",
      "src/lib/theme/storage.ts",
      "src/lib/theme/bootstrap.ts",
      "src/providers/theme-provider.tsx",
      "src/hooks/use-theme-preference.ts",
      "src/hooks/use-reveal.ts",
      "src/components/ui/reveal.tsx",
      "src/components/ui/theme-toggle.tsx",
    ]) {
      const lines = read(path.join(ROOT, f)).split("\n").length;
      expect(lines, `${f} is ${lines} lines`).toBeLessThan(250);
    }
  });
});

// ── Performance guardrails ──────────────────────────────────────────────────

describe("motion performance guardrails", () => {
  it("adds no animation dependency", () => {
    const pkg = JSON.parse(read(path.join(ROOT, "package.json")));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ["framer-motion", "motion", "gsap", "react-spring", "@react-spring/web"]) {
      expect(deps[banned], `${banned} must not be added`).toBeUndefined();
    }
  });

  it("drives scroll reveal from IntersectionObserver, never a scroll listener", () => {
    const reveal = read(path.join(ROOT, "src/hooks/use-reveal.ts"));
    expect(reveal).toContain("IntersectionObserver");
    expect(reveal).not.toContain('addEventListener("scroll"');

    // The reveal system must not add a scroll listener anywhere. The one
    // remaining listener in the product is the notification popover's
    // repositioner, which predates this work and is attached only while the
    // panel is open — it is not a rendering loop.
    const ALLOWED = ["src/components/features/notifications/notification-dropdown.tsx"];
    const offenders = productionFiles
      .filter((f) => /addEventListener\(\s*["'`]scroll["'`]/.test(read(f)))
      .map(rel)
      .filter((f) => !ALLOWED.includes(f));
    expect(offenders).toEqual([]);
  });

  it("keeps that one popover listener scoped to its open state", () => {
    const dropdown = read(
      path.join(ROOT, "src/components/features/notifications/notification-dropdown.tsx"),
    );
    expect(dropdown).toContain("if (!open) return;");
    expect(dropdown).toContain('removeEventListener("scroll"');
  });

  it("runs no requestAnimationFrame render loop", () => {
    const offenders = productionFiles
      .filter((f) => /requestAnimationFrame/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

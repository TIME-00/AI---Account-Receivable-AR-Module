// ============================================================================
// AR Copilot hygiene — static guards over the real source tree.
//
// Some properties of this feature cannot be proven by rendering it: that no
// code path anywhere persists a conversation, that the stale "no external AI"
// wording is gone from the whole application rather than just the panel, and
// that the feature stayed split into maintainable modules. Those are asserted
// here against the files themselves.
// ============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_PRIVACY_CLAIMS } from "@/lib/ar-copilot/disclosure";

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

/** Every production file that makes up the AR Copilot feature. */
const copilotFiles = productionFiles.filter((f) =>
  /[\\/](ar-copilot|copilot-)/.test(f) ||
  /use-ar-copilot|use-copilot-context|copilot-entity-provider/.test(f)
);

/**
 * Strip comments before scanning for a forbidden token, so a file that
 * *documents* the rule is not reported as breaking it.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("the comment stripper is not defanging the guards", () => {
  it("still sees a token in real code", () => {
    expect(stripComments('const a = localStorage.setItem("k", v);')).toContain(
      "localStorage",
    );
  });

  it("removes a line comment that merely names a token", () => {
    expect(stripComments("// never touch localStorage here\nconst a = 1;"))
      .not.toContain("localStorage");
  });

  it("does not eat a URL's double slash", () => {
    expect(stripComments('const u = "https://example.com/x";')).toContain(
      "https://example.com/x",
    );
  });
});

describe("the feature exists and is wired in", () => {
  it("keeps the Copilot split into small modules rather than one file", () => {
    expect(copilotFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("has replaced the old AR Help panel", () => {
    expect(existsSync(path.join(SRC, "components/layout/ar-help-panel.tsx")))
      .toBe(false);
    const dangling = productionFiles
      .filter((f) => /ar-help-panel|ArHelpPanel/.test(read(f)))
      .map(rel);
    expect(dangling).toEqual([]);
  });

  it("offers AR Copilot from the sidebar", () => {
    const sidebar = read(path.join(SRC, "components/layout/sidebar.tsx"));
    expect(sidebar).toContain("AR Copilot");
    expect(sidebar).not.toContain("AR Help");
  });

  it("mounts the panel and the entity provider in the dashboard shell", () => {
    const layout = read(path.join(SRC, "app/(dashboard)/layout.tsx"));
    expect(layout).toContain("ArCopilotPanel");
    expect(layout).toContain("CopilotEntityProvider");
  });
});

describe("no review scaffolding survives into the product", () => {
  it("ships no preview, harness, or mock route", () => {
    // The Copilot's Dark/Light states were reviewed against a temporary
    // `/copilot-preview` route that stubbed `window.fetch`. Deleting it is easy
    // to forget, and it would ship an unauthenticated page that fakes an
    // authenticated session, so its absence is asserted rather than trusted.
    const routes = readdirSync(path.join(SRC, "app"))
      .filter((entry) => statSync(path.join(SRC, "app", entry)).isDirectory())
      .filter((entry) => /preview|harness|sandbox|scratch|mock|fixture|debug/i.test(entry));
    expect(routes).toEqual([]);
  });

  it("stubs no global transport in production source", () => {
    const offenders = productionFiles
      .filter((f) =>
        /(window|globalThis)\s*\.\s*fetch\s*=|__copilotPreviewStub/.test(
          stripComments(read(f)),
        )
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("leaves no file marked as temporary", () => {
    const offenders = productionFiles
      .filter((f) => /DELETED before this task completes/i.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("no conversation persistence", () => {
  it("never writes to localStorage, sessionStorage, or IndexedDB", () => {
    const offenders = copilotFiles
      .filter((f) =>
        /localStorage|sessionStorage|indexedDB|IDBDatabase/.test(
          stripComments(read(f)),
        )
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("leaves the unrelated theme and company stores untouched", () => {
    // Those are separate features with their own governance; the guard above
    // is scoped to the Copilot rather than banning storage application-wide.
    expect(read(path.join(SRC, "lib/theme/storage.ts"))).toContain(
      "localStorage",
    );
  });

  it("sends the conversation to exactly one endpoint", () => {
    const requests = copilotFiles.filter((f) =>
      /api\.(?:post|get|patch|del)\b|\bfetch\(/.test(stripComments(read(f)))
    );
    expect(requests.map(rel)).toEqual(["src/hooks/use-ar-copilot.ts"]);
    expect(read(path.join(SRC, "hooks/use-ar-copilot.ts"))).toContain(
      "COPILOT_CHAT_PATH",
    );
  });
});

describe("no unsanitized rendering", () => {
  it("uses no dangerouslySetInnerHTML anywhere in the feature", () => {
    const offenders = copilotFiles
      .filter((f) => /dangerouslySetInnerHTML/.test(stripComments(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("adds no dangerouslySetInnerHTML beyond the pre-existing theme bootstrap", () => {
    // `app/layout.tsx` inlines the author-written theme script to avoid a
    // first-paint flash. It is a fixed constant, not content from any
    // response, and predates this feature. Nothing else may use it.
    const offenders = productionFiles
      .filter((f) => /dangerouslySetInnerHTML/.test(stripComments(read(f))))
      .map(rel);
    expect(offenders).toEqual(["src/app/layout.tsx"]);
    expect(read(path.join(SRC, "app/layout.tsx"))).toContain(
      "THEME_BOOTSTRAP_SCRIPT",
    );
  });

  it("parses the response instead of casting it", () => {
    const offenders = copilotFiles
      .filter((f) => /as\s+CopilotChatResponse/.test(stripComments(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("stale privacy wording is gone application-wide", () => {
  it.each(STALE_PRIVACY_CLAIMS)("no file still claims %s", (claim) => {
    // The disclosure module names these phrases so they can be searched for;
    // it is the one legitimate place they appear.
    const offenders = productionFiles
      .filter((f) => !/ar-copilot[\\/]disclosure\.ts$/.test(f))
      .filter((f) => read(f).toLowerCase().includes(claim.toLowerCase()))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no longer claims the help surface never sends data anywhere", () => {
    const offenders = productionFiles
      .filter((f) => !/ar-copilot[\\/]disclosure\.ts$/.test(f))
      .filter((f) => /never sends your data|no external AI/i.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("states the OpenAI dependency in a single shared place", () => {
    const disclosure = read(path.join(SRC, "lib/ar-copilot/disclosure.ts"));
    expect(disclosure).toContain("AR Copilot uses OpenAI");
    expect(disclosure).toContain("read-only");
  });
});

describe("maintainable file size", () => {
  it("keeps every production frontend file under 1000 lines", () => {
    const offenders = productionFiles
      .map((f) => ({ file: rel(f), lines: read(f).split("\n").length }))
      .filter((entry) => entry.lines > 1000);
    expect(offenders).toEqual([]);
  });

  it("keeps every Copilot module comfortably small", () => {
    const offenders = copilotFiles
      .map((f) => ({ file: rel(f), lines: read(f).split("\n").length }))
      .filter((entry) => entry.lines > 400);
    expect(offenders).toEqual([]);
  });
});

describe("the frontend never touches backend authority", () => {
  it("references no service role or provider credential", () => {
    const offenders = copilotFiles
      .filter((f) =>
        /service_role|SERVICE_ROLE|OPENAI_API_KEY|sk-[A-Za-z0-9]/.test(read(f))
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("calls no Supabase RPC directly from the Copilot", () => {
    const offenders = copilotFiles
      .filter((f) => /\.rpc\(/.test(stripComments(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

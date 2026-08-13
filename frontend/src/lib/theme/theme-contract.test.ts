// ============================================================================
// Theme contract + first-paint cache.
//
// These cover the two properties the rest of the theme system relies on:
// anything unrecognised resolves to dark, and a cached preference can never be
// read across account boundaries.
// ============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  isUiTheme,
  normalizeTheme,
  oppositeTheme,
  readPreference,
  UI_PREFERENCE_PATH,
  UI_THEMES,
} from "@/lib/theme/contract";
import {
  clearActiveUser,
  readCachedTheme,
  readCachedThemeForUser,
  themeKeyForUser,
  writeCachedTheme,
} from "@/lib/theme/storage";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme/bootstrap";

describe("theme contract", () => {
  it("offers exactly dark and light — there is no System option", () => {
    expect([...UI_THEMES]).toEqual(["dark", "light"]);
  });

  it("defaults to dark", () => {
    expect(DEFAULT_THEME).toBe("dark");
  });

  it("targets the reviewed backend route", () => {
    expect(UI_PREFERENCE_PATH).toBe("/auth/ui-preferences");
  });

  it("accepts only the backend vocabulary", () => {
    expect(isUiTheme("dark")).toBe(true);
    expect(isUiTheme("light")).toBe(true);
    for (const bad of ["system", "DARK", "", null, undefined, 1, {}]) {
      expect(isUiTheme(bad)).toBe(false);
    }
  });

  it("fails safe to dark for any malformed theme", () => {
    for (const bad of ["system", "purple", "", null, undefined, 42, {}, []]) {
      expect(normalizeTheme(bad)).toBe("dark");
    }
    expect(normalizeTheme("light")).toBe("light");
  });

  it("reads a malformed backend envelope as an unsaved dark default", () => {
    expect(readPreference({ theme: "chartreuse", source: "saved" })).toEqual({
      theme: "dark",
      source: "default",
    });
    expect(readPreference(null)).toEqual({ theme: "dark", source: "default" });
    expect(readPreference({})).toEqual({ theme: "dark", source: "default" });
    expect(readPreference({ theme: "light", source: "saved" })).toEqual({
      theme: "light",
      source: "saved",
    });
  });

  it("toggles between the two themes", () => {
    expect(oppositeTheme("dark")).toBe("light");
    expect(oppositeTheme("light")).toBe("dark");
  });
});

describe("first-paint cache cross-user isolation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns dark when no account identity is resolved", () => {
    expect(readCachedTheme()).toBe("dark");
  });

  it("files each account's choice under its own key", () => {
    writeCachedTheme("user-a", "light");
    expect(window.localStorage.getItem(themeKeyForUser("user-a"))).toBe("light");
    expect(window.localStorage.getItem("ar.ui.theme.active")).toBeNull();
  });

  it("never serves one account's preference to another", () => {
    writeCachedTheme("user-a", "light");
    // user-b has never chosen a theme.
    expect(readCachedThemeForUser("user-b")).toBeNull();
  });

  it("always resolves unresolved identity to dark while retaining the account cache", () => {
    writeCachedTheme("user-a", "light");
    expect(readCachedTheme()).toBe("dark");

    clearActiveUser();

    // The signed-out operator's choice is retained for their own identified
    // return, but is never paintable while identity is unresolved.
    expect(readCachedTheme()).toBe("dark");
    expect(readCachedThemeForUser("user-a")).toBe("light");
  });

  it("keeps two accounts' choices independent on a shared workstation", () => {
    writeCachedTheme("user-a", "light");
    writeCachedTheme("user-b", "dark");

    expect(readCachedThemeForUser("user-a")).toBe("light");
    expect(readCachedThemeForUser("user-b")).toBe("dark");
    // No unbound pointer can make either choice authoritative before auth.
    expect(readCachedTheme()).toBe("dark");
  });

  it("ignores a corrupted cached value rather than painting it", () => {
    window.localStorage.setItem(themeKeyForUser("user-a"), "system");
    expect(readCachedTheme()).toBe("dark");
    expect(readCachedThemeForUser("user-a")).toBeNull();
  });

  it("ignores a write with no account to attribute it to", () => {
    writeCachedTheme(null, "light");
    expect(window.localStorage.getItem("ar.ui.theme.active")).toBeNull();
    expect(readCachedTheme()).toBe("dark");
  });

  it("ignores a stale legacy active-user pointer after a browser closes without logout", () => {
    window.localStorage.setItem("ar.ui.theme.active", "user-a");
    window.localStorage.setItem(themeKeyForUser("user-a"), "light");
    expect(readCachedTheme()).toBe("dark");
  });
});

describe("first-paint bootstrap script", () => {
  it("enforces the dark safe default while account identity is unresolved", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('classList.add("dark")');
    expect(THEME_BOOTSTRAP_SCRIPT).not.toContain('classList.add("light")');
  });

  it("does not read local storage or trust an unbound account pointer", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).not.toContain("localStorage");
    expect(THEME_BOOTSTRAP_SCRIPT).not.toContain("ar.ui.theme");
  });

  it("cannot break the document if storage throws", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("try{");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("catch(e){}");
  });

  it("ignores a previous user's stale cache after browser close without logout", () => {
    window.localStorage.clear();
    window.localStorage.setItem("ar.ui.theme.active", "user-a");
    window.localStorage.setItem(themeKeyForUser("user-a"), "light");
    document.documentElement.className = "light";

    new Function(THEME_BOOTSTRAP_SCRIPT)();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("leaves the document dark when no account is resolved", () => {
    window.localStorage.clear();
    document.documentElement.className = "dark";

    new Function(THEME_BOOTSTRAP_SCRIPT)();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });
});

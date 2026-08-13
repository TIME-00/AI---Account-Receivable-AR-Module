// ============================================================================
// TSH Synergy AR — Theme Provider
//
// Owns the resolution order for the active theme:
//
//   1. Dark, always, as the painted starting point.
//   2. The account-keyed cache, but ONLY after AuthProvider resolves the
//      current user id (see `lib/theme/storage.ts`).
//   3. The authenticated server preference, which supersedes both.
//
// Rule 3 is what makes rule 2 safe: whatever the cache guessed, the server's
// answer for the *currently authenticated* account wins as soon as it arrives.
// When the account changes or signs out, the theme returns to dark until an
// account-keyed cache or the new account's server preference resolves.
// ============================================================================

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useAuth } from "@/providers/auth-provider";
import {
  useThemePreferenceMutation,
  useThemePreferenceQuery,
} from "@/hooks/use-theme-preference";
import { applyThemeClass } from "@/lib/theme/bootstrap";
import {
  DEFAULT_THEME,
  oppositeTheme,
  type UiTheme,
} from "@/lib/theme/contract";
import {
  clearActiveUser,
  readCachedThemeForUser,
  writeCachedTheme,
} from "@/lib/theme/storage";

interface ThemeContextValue {
  /** The theme currently painted. Never null — dark is the resting state. */
  theme: UiTheme;
  /** True until the signed-in account's stored preference has been resolved. */
  isResolving: boolean;
  /** True while an explicit choice is being persisted. */
  isSaving: boolean;
  setTheme: (theme: UiTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Initialised to the default rather than to the DOM so the first client
  // render matches the server render exactly; the effect below adopts whatever
  // the pre-paint bootstrap actually applied.
  const [theme, setThemeState] = useState<UiTheme>(DEFAULT_THEME);

  const { data: preference, isFetching } = useThemePreferenceQuery(userId);
  const { mutate: persist, isPending: isSaving } =
    useThemePreferenceMutation(userId);

  // Tracks which account's server preference has already been adopted, so a
  // background refetch cannot overwrite a choice the operator just made.
  const adoptedForUser = useRef<string | null>(null);
  const previousUserId = useRef<string | null>(null);
  const currentUserId = useRef<string | null>(userId);
  currentUserId.current = userId;

  const applyTheme = useCallback((next: UiTheme) => {
    setThemeState(next);
    applyThemeClass(next);
  }, []);

  // ── Adopt whatever the pre-paint bootstrap decided ──────────────────────
  useEffect(() => {
    const painted: UiTheme = document.documentElement.classList.contains("light")
      ? "light"
      : "dark";
    setThemeState(painted);
  }, []);

  // ── Account identity changes ────────────────────────────────────────────
  // Covers sign-out and account switching on a shared workstation. Until the
  // new account's own preference arrives, the safe default is painted — one
  // operator's choice is never inherited by the next.
  useEffect(() => {
    if (previousUserId.current === userId) return;
    previousUserId.current = userId;

    if (!userId) {
      adoptedForUser.current = null;
      clearActiveUser();
      applyTheme(DEFAULT_THEME);
      return;
    }

    if (adoptedForUser.current === userId) return;

    // Identity is now authoritative enough to address only this account's
    // cache. Until this point the document stayed on the dark safe default.
    // This also covers a different account signing in on the same browser.
    applyTheme(readCachedThemeForUser(userId) ?? DEFAULT_THEME);
  }, [userId, applyTheme]);

  // ── Server preference is the authority ──────────────────────────────────
  useEffect(() => {
    if (!userId || !preference) return;
    if (adoptedForUser.current === userId) return;
    adoptedForUser.current = userId;
    applyTheme(preference.theme);
    // Only an explicit saved choice is worth caching for this account's next
    // identified session. A server-side default is not an explicit choice.
    if (preference.source === "saved") {
      writeCachedTheme(userId, preference.theme);
    } else {
      clearActiveUser();
    }
  }, [userId, preference, applyTheme]);

  // ── Explicit user choice ────────────────────────────────────────────────
  const setTheme = useCallback(
    (next: UiTheme) => {
      const previous = theme;
      if (next === previous) return;

      // Applied immediately: the control must feel instant regardless of
      // network latency.
      applyTheme(next);

      if (!userId) {
        // No authenticated account to attribute the choice to, so it is not
        // cached and not persisted — it lasts for this document only.
        return;
      }

      writeCachedTheme(userId, next);

      persist(next, {
        onSuccess: (saved) => {
          // Trust the server echo for the account that initiated the save.
          // A late response must never repaint a different account that has
          // since signed in on the same browser.
          writeCachedTheme(userId, saved.theme);
          if (currentUserId.current === userId) {
            applyTheme(saved.theme);
          }
        },
        onError: () => {
          // Never fail silently, and never leave the browser cache asserting
          // something the server did not accept: roll both back together so
          // local and server state stay in agreement.
          writeCachedTheme(userId, previous);
          if (currentUserId.current === userId) {
            applyTheme(previous);
            toast.error("Theme not saved", {
              description:
                "Your appearance preference could not be saved and has been reverted. Please try again.",
            });
          }
        },
      });
    },
    [theme, userId, applyTheme, persist],
  );

  const toggleTheme = useCallback(
    () => setTheme(oppositeTheme(theme)),
    [setTheme, theme],
  );

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isResolving: Boolean(userId) && isFetching,
        isSaving,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * For anything that reads or changes the theme. Throws outside the provider,
 * because a control that silently does nothing is worse than a loud failure.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

/**
 * For purely presentational consumers that only need to know which palette to
 * paint — charts, in practice. These render in isolation (unit tests, and any
 * future preview harness) where wiring up auth and the API just to draw a bar
 * chart would be absurd, so they fall back to the product default rather than
 * crashing. Nothing here can change the theme, so the fallback cannot mask a
 * real wiring bug.
 */
export function useThemeOrDefault(): UiTheme {
  return useContext(ThemeContext)?.theme ?? DEFAULT_THEME;
}

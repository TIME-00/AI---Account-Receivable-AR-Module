// ============================================================================
// TSH Synergy AR — UI Theme Contract
//
// Mirrors the backend `auth/contract.ts` vocabulary exactly. The backend is the
// long-term authority for an account's theme; this module is the single place
// the frontend agrees on what a theme *is*, so parsing, caching, first paint
// and the toggle can never disagree about the allowed values or the default.
// ============================================================================

export const UI_THEMES = ["dark", "light"] as const;

export type UiTheme = (typeof UI_THEMES)[number];

/**
 * Dark is the product default and also the safe fallback. Every path that
 * cannot establish an explicit, authenticated preference resolves here —
 * unparseable server payloads, an unresolved account, a cleared cache.
 */
export const DEFAULT_THEME: UiTheme = "dark";

/** Path on the auth Edge Function that owns the account-level preference. */
export const UI_PREFERENCE_PATH = "/auth/ui-preferences";

export interface UiPreferenceDto {
  theme: UiTheme;
  /** `default` means no row exists server-side; `saved` means an explicit choice. */
  source: "default" | "saved";
}

export function isUiTheme(value: unknown): value is UiTheme {
  return value === "dark" || value === "light";
}

/**
 * Fail-safe coercion. A malformed or unknown theme from any source is not an
 * error the user should have to resolve — it resolves to dark.
 */
export function normalizeTheme(value: unknown): UiTheme {
  return isUiTheme(value) ? value : DEFAULT_THEME;
}

/**
 * Reads a preference envelope defensively. The backend is trusted to be
 * well-formed, but a drifted or partial payload must never leave the UI in an
 * undefined visual state.
 */
export function readPreference(value: unknown): UiPreferenceDto {
  const record = (value ?? {}) as Record<string, unknown>;
  if (!isUiTheme(record.theme)) {
    return { theme: DEFAULT_THEME, source: "default" };
  }
  return {
    theme: record.theme,
    source: record.source === "saved" ? "saved" : "default",
  };
}

/** The other theme — used by the toggle and by keyboard shortcuts. */
export function oppositeTheme(theme: UiTheme): UiTheme {
  return theme === "dark" ? "light" : "dark";
}

// ============================================================================
// TSH Synergy AR — Theme First-Paint Cache
//
// CROSS-USER SAFETY IS THE POINT OF THIS MODULE.
//
// A single `localStorage.theme = "light"` would leak one operator's preference
// into the next operator's session on a shared finance workstation. Instead:
//
//   * every cached theme is filed under the account that chose it
//     (`ar.ui.theme.u.<userId>`);
//   * no global "active user" pointer exists: before authenticated identity
//     resolves, first paint is always the safe dark default;
//   * once identity resolves, only that account's keyed cache may accelerate
//     reconciliation while the server preference remains authoritative.
//
// The cache is only ever a paint accelerator. The authenticated server
// preference remains the authority and reconciles over it on every load.
// ============================================================================

import { DEFAULT_THEME, isUiTheme, type UiTheme } from "./contract";

/** Namespace is versioned so a future format change cannot misread old values. */
const PREFIX = "ar.ui.theme";

export function themeKeyForUser(userId: string): string {
  return `${PREFIX}.u.${userId}`;
}

/**
 * Storage access is wrapped because it throws in private-browsing modes and in
 * embedded webviews. A cache failure must degrade to "no cache", never to a
 * broken shell.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * No account identity is available during synchronous first paint, so an
 * account-bound preference cannot be selected safely. Unresolved identity is
 * always dark.
 */
export function readCachedTheme(): UiTheme {
  return DEFAULT_THEME;
}

/** The cached choice for one specific, already-authenticated account. */
export function readCachedThemeForUser(userId: string | null): UiTheme | null {
  const store = safeStorage();
  if (!store || !userId) return null;
  try {
    const cached = store.getItem(themeKeyForUser(userId));
    return isUiTheme(cached) ? cached : null;
  } catch {
    return null;
  }
}

/**
 * Records an authenticated account's theme. It is intentionally not made
 * globally active: consumers must already know the authenticated user id.
 */
export function writeCachedTheme(userId: string | null, theme: UiTheme): void {
  const store = safeStorage();
  if (!store || !userId) return;
  try {
    store.setItem(themeKeyForUser(userId), theme);
  } catch {
    /* Cache is optional; the server preference still governs. */
  }
}

/**
 * Retained as an explicit lifecycle hook for callers. There is no global
 * pointer to clear; account-keyed choices remain isolated for later sign-in.
 */
export function clearActiveUser(): void {
  // Deliberate no-op. Unresolved identity always resolves to dark.
}

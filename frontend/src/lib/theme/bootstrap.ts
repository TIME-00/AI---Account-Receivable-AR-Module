// ============================================================================
// TSH Synergy AR — First-Paint Theme Bootstrap
//
// The document is server-rendered with `class="dark"` and `globals.css` defines
// the dark tokens on `:root`, so the very first paint is dark even if this
// script never runs and even if JavaScript is disabled entirely. There is no
// white-then-dark flash to avoid, because white is never painted.
//
// No authenticated account identity is available synchronously in <head>.
// Therefore this bootstrap never reads account preferences: unresolved identity
// must remain dark. An account-keyed cache can be adopted only after AuthProvider
// resolves the current user, and the authenticated server preference then wins.
// ============================================================================

/**
 * Applies a theme to the document element.
 *
 * Both classes are managed explicitly: `.light` drives the token override in
 * `globals.css`, and `.dark` keeps Tailwind's class-based `dark:` variant
 * available to any component that needs a genuinely theme-specific rule.
 */
export function applyThemeClass(theme: "dark" | "light"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/**
 * The inline bootstrap, serialised for `dangerouslySetInnerHTML`.
 *
 * Deliberately dependency-free and wrapped in try/catch: storage access throws
 * in some privacy modes, and a bootstrap failure must leave the safe dark
 * default in place rather than break the document.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{
var r=document.documentElement;
r.classList.remove("light");
r.classList.add("dark");
r.style.colorScheme="dark";
}catch(e){}})();`;

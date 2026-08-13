/**
 * Composable keyboard-focus ring for controls that also own a Tailwind
 * `shadow-*`/glow utility. Both utilities participate in Tailwind's ring
 * box-shadow chain, so the component shadow cannot erase focus visibility.
 */
export const COMPOSABLE_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg";

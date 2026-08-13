// ============================================================================
// TSH Synergy AR — Scroll Reveal
//
// One IntersectionObserver is shared by every revealing element on the page.
// Registering a hundred sections therefore costs one observer, not a hundred,
// and no scroll listener is ever attached — the browser does the work off the
// main thread.
//
// Each element reveals exactly once and is then unobserved: content must not
// re-animate every time it drifts past the viewport edge, which is what makes
// scroll animation tiring rather than alive.
// ============================================================================

"use client";

import { useEffect, useRef, useState } from "react";

/** Reveal slightly before the element reaches the fold so it lands settled. */
const ROOT_MARGIN = "0px 0px -12% 0px";
const THRESHOLD = 0.05;

type RevealCallback = (revealed: true) => void;

let observer: IntersectionObserver | null = null;
const subscribers = new Map<Element, RevealCallback>();

function supportsObserver(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.IntersectionObserver === "function"
  );
}

function getObserver(): IntersectionObserver | null {
  if (!supportsObserver()) return null;
  if (observer) return observer;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = subscribers.get(entry.target);
        subscribers.delete(entry.target);
        observer?.unobserve(entry.target);
        callback?.(true);
      }
    },
    { rootMargin: ROOT_MARGIN, threshold: THRESHOLD },
  );
  return observer;
}

/**
 * Returns a ref to attach to the revealing element and whether it has revealed.
 *
 * Degrades to "already revealed" whenever observation is impossible — no
 * IntersectionObserver (older browsers, jsdom), or the operator has asked for
 * reduced motion. Content is never left hidden because an effect did not run.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const active = getObserver();
    if (!active || prefersReducedMotion) {
      setRevealed(true);
      return;
    }

    subscribers.set(element, () => setRevealed(true));
    active.observe(element);

    return () => {
      subscribers.delete(element);
      active.unobserve(element);
    };
  }, []);

  return { ref, revealed };
}

/** Test-only reset so a suite can install its own IntersectionObserver stub. */
export function __resetRevealObserver(): void {
  observer?.disconnect();
  observer = null;
  subscribers.clear();
}

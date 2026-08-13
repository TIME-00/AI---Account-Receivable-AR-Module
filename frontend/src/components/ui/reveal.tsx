"use client";

import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useReveal } from "@/hooks/use-reveal";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger within a group. Kept small — this is punctuation, not choreography. */
  delayMs?: number;
  /** Render as a semantic element where the wrapper would otherwise be a div. */
  as?: ElementType;
}

/**
 * Reveals a major content group as it enters the viewport.
 *
 * Intended for page sections — a metrics band, a chart, a table card — not for
 * individual rows. Animating a hundred table rows one by one is exactly the
 * kind of motion that makes a financial console feel slow, so the reveal unit
 * is deliberately coarse.
 *
 * Only opacity and transform are animated, so the effect stays on the
 * compositor, and `prefers-reduced-motion` removes it entirely (handled both in
 * `useReveal` and in the stylesheet, so neither path can leave content hidden).
 */
export function Reveal({
  children,
  className,
  delayMs = 0,
  as: Component = "div",
}: RevealProps) {
  const { ref, revealed } = useReveal<HTMLDivElement>();

  return (
    <Component
      ref={ref}
      data-revealed={revealed ? "true" : "false"}
      className={cn("ds-reveal", className)}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </Component>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { type BadgeTone, TONE_CLASS, TONE_DOT } from "@/lib/automation/labels";

interface AutomationBadgeProps {
  label: string;
  tone: BadgeTone;
  showDot?: boolean;
  className?: string;
}

/**
 * Gate E status badge. Status is never communicated by colour alone: the label
 * text always states the status, and the dot is decorative.
 */
export function AutomationBadge({
  label,
  tone,
  showDot = true,
  className,
}: AutomationBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])}
        />
      )}
      {label}
    </span>
  );
}

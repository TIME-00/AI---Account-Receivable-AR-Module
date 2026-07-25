"use client";

import { cn } from "@/lib/utils";
import { FX_TONE_CLASSES, type FxPresentation } from "@/lib/fx-presentation";
import {
  Equal,
  BookMarked,
  Landmark,
  PenLine,
  Archive,
  HelpCircle,
  CheckCircle2,
  Check,
  Clock,
  XCircle,
  AlertTriangle,
  History,
  ShieldAlert,
  AlertCircle,
  Lock,
  type LucideIcon,
} from "lucide-react";

// Explicit icon map (keeps lucide tree-shakeable; names come from fx-presentation).
const ICONS: Record<string, LucideIcon> = {
  Equal,
  BookMarked,
  Landmark,
  PenLine,
  Archive,
  HelpCircle,
  CheckCircle2,
  Check,
  Clock,
  XCircle,
  AlertTriangle,
  History,
  ShieldAlert,
  AlertCircle,
  Lock,
};

interface FxChipProps {
  presentation: FxPresentation;
  size?: "sm" | "md";
  /** When false, renders icon-only with the label as accessible text (dense tables). */
  showLabel?: boolean;
  className?: string;
}

/**
 * A provenance / decision-state chip. Colour is never the sole signal — every
 * chip carries an icon and a text (or accessible) label.
 */
export function FxChip({ presentation, size = "sm", showLabel = true, className }: FxChipProps) {
  const tone = FX_TONE_CLASSES[presentation.tone];
  const Icon = ICONS[presentation.icon] ?? HelpCircle;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset",
        tone.bg,
        tone.text,
        tone.ring,
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs",
        className,
      )}
      title={presentation.description}
    >
      <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5", "shrink-0")} aria-hidden="true" />
      {showLabel ? (
        <span>{presentation.label}</span>
      ) : (
        <span className="sr-only">{presentation.label}</span>
      )}
    </span>
  );
}

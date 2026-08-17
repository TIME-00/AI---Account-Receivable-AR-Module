"use client";

import type { BarChart3 } from "lucide-react";
import { cellText, humanizeKey } from "@/lib/ar-copilot/artifacts";

// ============================================================================
// Shared artifact chrome.
//
// Presentation only. Nothing here computes, sorts, rounds or infers: a card
// shows what the backend sent, in the order the backend sent it. There is no
// href and no interactive control in this file, so an artifact can never
// become navigation or an action.
// ============================================================================

export function ArtifactCard({
  icon: Icon,
  title,
  subtitle,
  badge,
  children,
}: {
  icon: typeof BarChart3;
  title: string;
  subtitle?: string | null;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-3 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon
          className="h-3.5 w-3.5 shrink-0 text-content-muted"
          aria-hidden="true"
        />
        <h4 className="text-xs font-semibold text-content">{title}</h4>
        {badge}
      </div>
      {subtitle && (
        <p className="mt-1 text-[11px] leading-relaxed text-content-secondary">
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

export type BadgeTone = "neutral" | "info" | "warn" | "danger";

export function Badge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
}) {
  const toneClass = tone === "danger"
    ? "border-feedback-danger/40 text-feedback-danger"
    : tone === "warn"
    ? "border-feedback-warning/40 text-feedback-warning"
    : tone === "info"
    ? "border-accent-fill/40 text-accent-fill"
    : "border-chip-border text-content-secondary";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneClass}`}
    >
      {children}
    </span>
  );
}

/** Severity and priority share the same three-level backend vocabulary. */
export const LEVEL_TONE: Record<"high" | "attention" | "info", BadgeTone> = {
  high: "danger",
  attention: "warn",
  info: "neutral",
};

/** A backend scalar dictionary, rendered key-by-key without reordering. */
export function FactList({
  facts,
}: {
  facts: Record<string, string | number | boolean | null>;
}) {
  const entries = Object.entries(facts);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-[10px] uppercase tracking-wide text-content-secondary">
            {humanizeKey(key)}
          </dt>
          <dd className="text-[11px] font-medium text-content">
            {cellText(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CodeChips({ codes }: { codes: readonly string[] }) {
  if (codes.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1">
      {codes.map((code) => (
        <li
          key={code}
          className="rounded border border-chip-border bg-chip-bg px-1.5 py-0.5 text-[10px] text-chip-text"
        >
          {code}
        </li>
      ))}
    </ul>
  );
}

// ============================================================================
// TSH Synergy AR — FX provenance & decision-state presentation mapping
// (Batch 9D-D). Pure, side-effect-free label/tone/icon derivation so the UI
// never communicates state by colour alone and never invents provenance.
// ============================================================================

import type {
  FxDecisionReadSummary,
  FxPostingEligibilityReason,
  FxSourceCategory,
} from "@/types/monetary";
import { normalizeCurrency } from "@/lib/currency";

/** Visual tone. Every tone is paired with an icon + text so colour is never the
 *  sole signal (WCAG 1.4.1). */
export type FxTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface FxPresentation {
  label: string;
  tone: FxTone;
  /** lucide-react icon name to render alongside the label. */
  icon: string;
  /** Longer explanation for tooltip / detail context. */
  description: string;
}

const SOURCE_LABELS: Record<string, FxPresentation> = {
  BASE_PARITY: {
    label: "Base parity",
    tone: "neutral",
    icon: "Equal",
    description: "Transaction currency equals the company base currency (rate 1.0000).",
  },
  CATALOG: {
    label: "Catalog rate",
    tone: "info",
    icon: "BookMarked",
    description: "Booked from the maintained exchange-rate catalog.",
  },
  REFERENCE_SELECTED: {
    label: "Reference-selected",
    tone: "info",
    icon: "Landmark",
    description: "Booked from a provider reference rate selected at booking time.",
  },
  MANUAL_OVERRIDE: {
    label: "Manual override",
    tone: "warning",
    icon: "PenLine",
    description: "Booking rate was manually overridden under governance approval.",
  },
  LEGACY_UNVERIFIED: {
    label: "Legacy rate unverified",
    tone: "warning",
    icon: "Archive",
    description:
      "The historical booked rate has no verified reference provenance. The displayed base amount is the historical booked snapshot — not a present market/MAS valuation.",
  },
};

const UNKNOWN_SOURCE: FxPresentation = {
  label: "Unknown source",
  tone: "neutral",
  icon: "HelpCircle",
  description: "No FX booking-rate source category is available for this record.",
};

export function fxSourcePresentation(source: FxSourceCategory | string | null | undefined): FxPresentation {
  if (!source) return UNKNOWN_SOURCE;
  return SOURCE_LABELS[source] ?? { ...UNKNOWN_SOURCE, label: String(source) };
}

const REASON_LABELS: Record<FxPostingEligibilityReason, FxPresentation> = {
  approved: {
    label: "Approved",
    tone: "success",
    icon: "CheckCircle2",
    description: "Booking-rate decision is approved and eligible to post.",
  },
  not_required: {
    label: "Standard rate",
    tone: "success",
    icon: "Check",
    description: "Deviation within tolerance — no override approval required.",
  },
  pending_approval: {
    label: "Pending approval",
    tone: "warning",
    icon: "Clock",
    description: "Booking-rate decision is awaiting governance approval.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    icon: "XCircle",
    description: "Booking-rate decision was rejected and cannot post.",
  },
  stale_decision: {
    label: "Stale reference",
    tone: "warning",
    icon: "AlertTriangle",
    description: "Reference rate is stale (older than the freshness window).",
  },
  non_current_decision: {
    label: "Superseded",
    tone: "neutral",
    icon: "History",
    description: "A newer booking-rate decision supersedes this one.",
  },
  blocked: {
    label: "Blocked",
    tone: "danger",
    icon: "ShieldAlert",
    description: "Deviation or state blocks posting under governance rules.",
  },
  inconsistent_state: {
    label: "Needs review",
    tone: "warning",
    icon: "AlertCircle",
    description: "Approval and lifecycle states are inconsistent — review required.",
  },
  missing_decision: {
    label: "No booking decision",
    tone: "neutral",
    icon: "HelpCircle",
    description: "No FX booking-rate decision is recorded for this document.",
  },
};

export function fxDecisionStatePresentation(
  reason: FxPostingEligibilityReason | null | undefined,
): FxPresentation {
  if (!reason) return REASON_LABELS.missing_decision;
  return REASON_LABELS[reason] ?? REASON_LABELS.missing_decision;
}

/**
 * Interpret a posting-eligibility reason in the document lifecycle context.
 *
 * The backend deliberately reports `blocked` for already-posted documents
 * because they cannot be posted again. That is not an error state for the
 * document and must not be rendered as a red "Blocked" chip beside the
 * authoritative booked-rate presentation. Draft `blocked` decisions remain a
 * genuine danger state.
 */
export function fxDecisionStatePresentationForDocument(
  reason: FxPostingEligibilityReason | null | undefined,
  documentPosted: boolean,
): FxPresentation | null {
  if (reason === "blocked" && documentPosted) return null;
  return fxDecisionStatePresentation(reason);
}

// ─── Governed FX rate presentation (B9DD-FEIR-007) ──────────────────────────

/**
 * Lifecycle-aware classification of the rate a surface may display.
 *
 * A raw `exchange_rate` column value is NOT interchangeable with a governed
 * booked rate: on a draft it is a working estimate, and on a posted document
 * without an FX booking decision there is no verified booking provenance at all.
 * Conflating them (e.g. `fx_decision?.booked_rate ?? exchange_rate`) presents an
 * ungoverned number as a booked snapshot, which this type exists to prevent.
 */
export type FxRateKind =
  | "base_parity"
  | "booked_snapshot"
  | "draft_estimate"
  | "manual_override"
  | "stale_reference"
  | "legacy_unverified"
  | "unavailable";

export interface FxRateDisplay {
  kind: FxRateKind;
  /** The rate to display, or null when nothing may be defensibly shown. */
  rate: number | null;
  /**
   * Explicit direction derived from the authoritative backend normalization
   * (`base = transaction × exchange_rate`, per migration 027
   * `ROUND(i.outstanding * i.exchange_rate, 2)`), e.g. "1 USD = 4.4500 MYR".
   * Null when either currency code or the rate is unknown.
   */
  directionLabel: string | null;
  /** Short caption naming the rate's lifecycle, e.g. "Booked rate". */
  caption: string;
  tone: FxTone;
  icon: string;
  /** Longer explanation suitable for a tooltip. */
  description: string;
}

/** Document statuses that mean "not yet posted" (rate is still an estimate). */
const DRAFT_STATUSES = new Set(["Draft"]);

/**
 * True when a document status implies a posted/terminal document carrying an
 * immutable booked-FX snapshot. Cancelled/Reversed documents were posted first,
 * so they retain their snapshot.
 */
export function isPostedDocumentStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return !DRAFT_STATUSES.has(status);
}

export interface ResolveFxRateInput {
  currency: string | null | undefined;
  baseCurrency: string | null | undefined;
  /** Whether the document is posted/terminal (see isPostedDocumentStatus). */
  documentPosted: boolean;
  /** FX booking decision read summary, when the backend supplied one. */
  decision?: FxDecisionReadSummary | null;
  /**
   * The document's raw `exchange_rate` column. Only ever used as a DRAFT
   * estimate — never promoted to a booked rate.
   */
  draftExchangeRate?: number | null;
}

function finite(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function direction(rate: number | null, currency: string | null, baseCurrency: string | null): string | null {
  if (rate === null || !currency || !baseCurrency) return null;
  return `1 ${currency} = ${rate.toFixed(4)} ${baseCurrency}`;
}

/**
 * Resolve what rate (if any) a surface may show, and how it must be labelled.
 *
 * Precedence is deliberate:
 *  1. base parity            — no FX applies
 *  2. draft                  — `exchange_rate` is an estimate, labelled as such
 *  3. posted + decision      — governed booked snapshot (or its exception state)
 *  4. posted, no decision    — UNAVAILABLE (never fall back to `exchange_rate`)
 */
export function resolveFxRateDisplay({
  currency,
  baseCurrency,
  documentPosted,
  decision,
  draftExchangeRate,
}: ResolveFxRateInput): FxRateDisplay {
  const code = normalizeCurrency(currency);
  const base = normalizeCurrency(baseCurrency);

  if (code !== null && base !== null && code === base) {
    return {
      kind: "base_parity",
      rate: 1,
      directionLabel: null,
      caption: "Base parity",
      tone: "neutral",
      icon: "Equal",
      description: "Transaction currency equals the company base currency; no conversion applies.",
    };
  }

  if (!documentPosted) {
    const rate = finite(decision?.booked_rate) ?? finite(draftExchangeRate);
    if (rate === null) {
      return {
        kind: "unavailable",
        rate: null,
        directionLabel: null,
        caption: "Rate not available",
        tone: "neutral",
        icon: "HelpCircle",
        description: "No exchange rate is available for this draft yet.",
      };
    }
    return {
      kind: "draft_estimate",
      rate,
      directionLabel: direction(rate, code, base),
      caption: "Estimated rate",
      tone: "info",
      icon: "Calculator",
      description:
        "Draft estimate using the current working rate. It is not booked and may change when the document is posted.",
    };
  }

  // Posted / terminal document.
  const bookedRate = finite(decision?.booked_rate);
  if (!decision || bookedRate === null) {
    return {
      kind: "unavailable",
      rate: null,
      directionLabel: null,
      caption: "Booked rate not available",
      tone: "warning",
      icon: "HelpCircle",
      description:
        "This posted document has no FX booking-rate decision, so no verified booked rate can be shown. The document's raw exchange_rate is deliberately NOT presented as a booked rate.",
    };
  }

  if (decision.source_category === "LEGACY_UNVERIFIED") {
    return {
      kind: "legacy_unverified",
      rate: bookedRate,
      directionLabel: direction(bookedRate, code, base),
      caption: "Legacy rate unverified",
      tone: "warning",
      icon: "Archive",
      description:
        "Historical record: the booked rate has no verified reference provenance. The displayed base amount is the historical booked snapshot, not a present market/MAS valuation.",
    };
  }

  if (decision.stale_reference) {
    return {
      kind: "stale_reference",
      rate: bookedRate,
      directionLabel: direction(bookedRate, code, base),
      caption: "Booked rate (stale reference)",
      tone: "warning",
      icon: "AlertTriangle",
      description: "Booked from a reference rate that was stale at booking time.",
    };
  }

  if (decision.source_category === "MANUAL_OVERRIDE") {
    return {
      kind: "manual_override",
      rate: bookedRate,
      directionLabel: direction(bookedRate, code, base),
      caption: "Booked rate (manual override)",
      tone: "warning",
      icon: "PenLine",
      description: "Booking rate was manually overridden under governance approval.",
    };
  }

  return {
    kind: "booked_snapshot",
    rate: bookedRate,
    directionLabel: direction(bookedRate, code, base),
    caption: "Booked rate",
    // Posted + booked: informational/neutral, never a danger "Blocked" state.
    // The rate is locked because the document is posted — not because anything
    // is wrong with it.
    tone: "info",
    icon: "Lock",
    description: "This document is already posted. Its booked exchange rate cannot be changed (rate locked).",
  };
}

/** Tailwind classes per tone (light-mode enterprise palette, matches StatusBadge). */
export const FX_TONE_CLASSES: Record<FxTone, { bg: string; text: string; ring: string }> = {
  neutral: { bg: "bg-slate-100", text: "text-slate-600", ring: "ring-slate-200" },
  info: { bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-200" },
  success: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
  warning: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200" },
  danger: { bg: "bg-red-50", text: "text-red-700", ring: "ring-red-200" },
};

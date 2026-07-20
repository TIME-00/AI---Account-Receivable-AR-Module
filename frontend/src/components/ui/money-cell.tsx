"use client";

import { cn } from "@/lib/utils";
import { formatMoneyNumber, normalizeCurrency, UNKNOWN_CURRENCY_LABEL } from "@/lib/currency";
import {
  fxSourcePresentation,
  fxDecisionStatePresentation,
  type FxRateDisplay,
} from "@/lib/fx-presentation";
import { FxChip } from "@/components/ui/fx-chip";
import type { FxPostingEligibilityReason, FxSourceCategory } from "@/types/monetary";

/**
 * Basis for the company-base amount:
 *  - "booked": immutable stored booking snapshot on a posted/terminal document.
 *              Rendered as an exact figure — NEVER prefixed with "≈".
 *  - "estimated": a draft preview using the current/estimated rate. May be
 *              prefixed with "≈" and labelled as an estimate.
 */
export type BaseBasis = "booked" | "estimated";

export interface MoneyCellProps {
  /** Authoritative transaction-currency amount. */
  amount: number;
  /** Transaction currency code (explicit — no MYR default). */
  currency: string | null | undefined;
  /** Authoritative company-base amount (stored snapshot or estimate). */
  baseAmount?: number | null;
  baseCurrency?: string | null;
  /** Backend `base_available`; when false, show an explicit unavailable state. */
  baseAvailable?: boolean;
  baseBasis?: BaseBasis;
  /**
   * Governed FX rate presentation from `resolveFxRateDisplay`. This carries the
   * rate, its direction ("1 USD = 4.4500 MYR") and its lifecycle. A bare rate
   * number is deliberately NOT accepted: callers cannot pass a raw
   * `exchange_rate` and have it rendered as though it were booked.
   */
  fxRate?: FxRateDisplay | null;
  /** FX source category from the booking decision. */
  source?: FxSourceCategory | string | null;
  /** Posting-eligibility reason (decision state). */
  decisionReason?: FxPostingEligibilityReason | null;
  /** Deviation percentage from the booking decision (detailed mode). */
  deviationPct?: number | null;
  mode?: "compact" | "detailed";
  align?: "left" | "right";
  /** Optional caption above the amount, e.g. "Outstanding". */
  label?: string;
  className?: string;
}

function isBaseParity(currency: string | null | undefined, baseCurrency: string | null | undefined): boolean {
  const c = normalizeCurrency(currency);
  const b = normalizeCurrency(baseCurrency);
  return c !== null && b !== null && c === b;
}

/**
 * Canonical multi-currency money display. Transaction amount + explicit currency
 * is always primary; company-base amount is secondary; booking provenance is
 * supporting metadata. Never fabricates a rate or defaults an unknown currency.
 */
export function MoneyCell({
  amount,
  currency,
  baseAmount,
  baseCurrency,
  baseAvailable,
  baseBasis = "booked",
  fxRate,
  source,
  decisionReason,
  deviationPct,
  mode = "compact",
  align = "left",
  label,
  className,
}: MoneyCellProps) {
  const code = normalizeCurrency(currency) ?? UNKNOWN_CURRENCY_LABEL;
  const parity = isBaseParity(currency, baseCurrency);
  const detailed = mode === "detailed";
  const alignCls = align === "right" ? "text-right items-end" : "text-left items-start";

  // Whether we should render a separate company-base line at all.
  const showBaseLine = !parity && baseCurrency != null;
  // Base value present & usable?
  const baseUsable =
    baseAvailable !== false && baseAmount !== null && baseAmount !== undefined && Number.isFinite(Number(baseAmount));
  const basePrefix = baseBasis === "estimated" ? "≈ " : "";
  const baseCaption = baseBasis === "estimated" ? "Estimated base" : "Booked base";

  const sourcePres = source ? fxSourcePresentation(source) : null;
  const decisionPres = decisionReason ? fxDecisionStatePresentation(decisionReason) : null;
  // In compact mode only surface a decision chip when it needs attention.
  const decisionIsException = decisionPres != null && decisionPres.tone !== "success";

  // A rate line is only shown in detailed mode, and only when the resolver
  // produced a defensible, directional rate.
  const showRate = detailed && fxRate != null && fxRate.directionLabel !== null;
  const showRateUnavailable = detailed && fxRate != null && fxRate.kind === "unavailable";

  return (
    <div className={cn("flex flex-col gap-0.5", alignCls, className)}>
      {label && <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>}

      {/* Primary: transaction amount + explicit currency */}
      <span className="font-semibold tabular-nums text-slate-900">
        <span className="text-[11px] font-medium text-slate-500">{code}</span>{" "}
        {formatMoneyNumber(amount)}
      </span>

      {/* Secondary: company-base amount */}
      {showBaseLine && (
        <span className="text-xs tabular-nums text-slate-500">
          {baseUsable ? (
            <>
              <span className="text-slate-400">{baseCaption}:</span> {basePrefix}
              {normalizeCurrency(baseCurrency)} {formatMoneyNumber(Number(baseAmount))}
            </>
          ) : (
            <span className="italic text-slate-400">Base not available</span>
          )}
        </span>
      )}

      {/* Supporting metadata: directional rate + provenance/decision chips */}
      {(detailed || decisionIsException) && (
        <div className={cn("mt-0.5 flex flex-wrap gap-1", align === "right" ? "justify-end" : "justify-start")}>
          {showRate && (
            <span
              title={fxRate!.description}
              className="inline-flex items-center rounded bg-slate-50 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200"
            >
              {fxRate!.caption}: {fxRate!.directionLabel}
            </span>
          )}
          {showRateUnavailable && (
            <span
              title={fxRate!.description}
              className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-200"
            >
              {fxRate!.caption}
            </span>
          )}
          {detailed && deviationPct != null && Number.isFinite(Number(deviationPct)) && (
            <span className="inline-flex items-center rounded bg-slate-50 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200">
              Δ {Number(deviationPct).toFixed(2)}%
            </span>
          )}
          {detailed && sourcePres && <FxChip presentation={sourcePres} />}
          {decisionPres && (detailed || decisionIsException) && (
            <FxChip presentation={decisionPres} showLabel={detailed || decisionIsException} />
          )}
        </div>
      )}
    </div>
  );
}

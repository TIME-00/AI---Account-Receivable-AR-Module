"use client";

// ============================================================================
// TSH Synergy AR — Shared governed FX rate field (Gate A)
//
// One component for BOTH Invoice and Receipt foreign-currency entry. It renders
// the governed state from useFxReferenceRate and enforces the backend authority
// model on the client:
//   * Normal (reference-selected) mode: the rate is READ-ONLY and the looked-up
//     `fx_reference_rate_id` is submitted — never an authoritative base total,
//     never a silent rate-1 fallback.
//   * Base parity: exact rate 1, clearly labelled, no reference id.
//   * Missing / stale: an explicit, actionable, blocked state with retry.
//   * Manual override: a SEPARATE explicit mode — reference id is forced null so
//     it can never coexist with a manual rate or override reason.
// Colour is never the only signal: every state carries an icon + text.
// ============================================================================

import { useEffect, useId } from "react";
import {
  AlertTriangle,
  Ban,
  Calculator,
  CheckCircle2,
  Equal,
  Landmark,
  Loader2,
  PenLine,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoneySafe } from "@/lib/currency";
import { roundTo2 } from "@/lib/invoice-calculator";
import { useFxReferenceRate } from "@/hooks/use-fx-reference-rate";
import { FX_TONE_CLASSES, type FxTone } from "@/lib/fx-presentation";

const MIN_OVERRIDE_REASON = 5;

export interface FxRateFieldProps {
  currency: string;
  baseCurrency: string | null;
  effectiveDate: string;
  /** Transaction amount, used only for a NON-authoritative estimated base. */
  amount?: number;
  /** Controlled governed selection (submitted as fx_reference_rate_id). */
  referenceRateId: string | null;
  onReferenceRateIdChange: (id: string | null) => void;
  /** Controlled manual override rate (submitted as exchange_rate in override mode). */
  manualRate: number | null;
  onManualRateChange: (rate: number | null) => void;
  /** Controlled override reason (submitted as fx_override_reason in override mode). */
  overrideReason: string;
  onOverrideReasonChange: (reason: string) => void;
  /** Whether the explicit manual-override mode is active. */
  overrideMode: boolean;
  onOverrideModeChange: (on: boolean) => void;
  /** Role gate: only show the manual-override affordance when permitted. */
  allowManualOverride?: boolean;
  /** Notifies the parent whether a governed submission is currently valid. */
  onSubmittableChange?: (canSubmit: boolean) => void;
  disabled?: boolean;
}

function toneRing(tone: FxTone): string {
  const c = FX_TONE_CLASSES[tone];
  return cn(c.bg, c.text, "ring-1", c.ring);
}

export function FxRateField({
  currency,
  baseCurrency,
  effectiveDate,
  amount = 0,
  referenceRateId,
  onReferenceRateIdChange,
  manualRate,
  onManualRateChange,
  overrideReason,
  onOverrideReasonChange,
  overrideMode,
  onOverrideModeChange,
  allowManualOverride = true,
  onSubmittableChange,
  disabled = false,
}: FxRateFieldProps) {
  const manualRateId = useId();
  const overrideReasonId = useId();
  const overrideReasonErrorId = `${overrideReasonId}-error`;
  const fx = useFxReferenceRate({
    currency,
    baseCurrency,
    effectiveDate,
    // Suspend reference lookups while an explicit manual override is active.
    enabled: !overrideMode,
  });

  const isParity = fx.mode === "base_parity";
  const reasonValid = overrideReason.trim().length >= MIN_OVERRIDE_REASON;
  const overrideValid = overrideMode && (manualRate ?? 0) > 0 && reasonValid;

  // ── Governed authority synchronisation (mutual exclusion) ─────────────────
  // Reference id is submitted ONLY in fresh-reference, non-override mode. In any
  // other state (parity, missing, stale, loading, override) it must be null so
  // it can never coexist with a manual rate/reason.
  useEffect(() => {
    const nextRef = !overrideMode && fx.mode === "reference" ? fx.referenceRateId : null;
    if (nextRef !== referenceRateId) onReferenceRateIdChange(nextRef);
  }, [overrideMode, fx.mode, fx.referenceRateId, referenceRateId, onReferenceRateIdChange]);

  // When leaving override mode, clear the manual rate/reason so they are never
  // submitted alongside a reference selection.
  useEffect(() => {
    if (!overrideMode) {
      if (manualRate !== null) onManualRateChange(null);
      if (overrideReason !== "") onOverrideReasonChange("");
    }
  }, [overrideMode, manualRate, overrideReason, onManualRateChange, onOverrideReasonChange]);

  // Report submittability to the parent (gates the form submit button).
  useEffect(() => {
    const canSubmit = overrideMode
      ? overrideValid
      : isParity || fx.canSubmitReference;
    onSubmittableChange?.(canSubmit);
  }, [overrideMode, overrideValid, isParity, fx.canSubmitReference, onSubmittableChange]);

  const estimatedBase =
    baseCurrency && amount > 0 && fx.rate !== null ? roundTo2(amount * fx.rate) : null;
  const overrideEstimatedBase =
    baseCurrency && amount > 0 && (manualRate ?? 0) > 0 ? roundTo2(amount * (manualRate as number)) : null;

  return (
    <div className="space-y-2" data-testid="fx-rate-field">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="block text-xs font-medium text-slate-600">
          Exchange Rate{" "}
          <span className="text-slate-400" data-testid="fx-direction-label">
            {isParity
              ? `(1 ${currency} = 1 ${baseCurrency ?? "base"})`
              : baseCurrency
              ? `(1 ${currency || "—"} → ${baseCurrency})`
              : "(→ company base)"}
          </span>
        </label>
        {allowManualOverride && !isParity && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onOverrideModeChange(!overrideMode)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
              "ring-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
              overrideMode
                ? "bg-amber-50 text-amber-700 ring-amber-200"
                : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100"
            )}
            aria-pressed={overrideMode}
          >
            <PenLine className="h-3 w-3" aria-hidden="true" />
            {overrideMode ? "Manual override on" : "Manual override"}
          </button>
        )}
      </div>

      {/* ── Manual override mode (explicit, separate governed authority) ── */}
      {overrideMode ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3" role="group" aria-label="Manual FX override">
          <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
            <PenLine className="h-3 w-3" aria-hidden="true" />
            Manual override — approval may be required based on deviation.
          </p>
          <label htmlFor={manualRateId} className="text-[11px] font-medium text-amber-800">
            Manual exchange rate
          </label>
          <input
            id={manualRateId}
            type="number"
            step="0.0001"
            min="0.0001"
            disabled={disabled}
            value={manualRate ?? ""}
            onChange={(e) => onManualRateChange(e.target.value === "" ? null : parseFloat(e.target.value))}
            className="h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-right font-mono text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
            placeholder="0.0000"
          />
          <label htmlFor={overrideReasonId} className="text-[11px] font-medium text-amber-800">
            Override reason
          </label>
          <textarea
            id={overrideReasonId}
            disabled={disabled}
            aria-invalid={overrideReason !== "" && !reasonValid}
            aria-describedby={overrideReason !== "" && !reasonValid ? overrideReasonErrorId : undefined}
            value={overrideReason}
            onChange={(e) => onOverrideReasonChange(e.target.value)}
            rows={2}
            placeholder="Reason for the manual override (min 5 characters)"
            className={cn(
              "w-full rounded-lg border bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1",
              reasonValid || overrideReason === ""
                ? "border-amber-300 focus:ring-amber-500"
                : "border-red-400 focus:ring-red-500"
            )}
          />
          {overrideReason !== "" && !reasonValid && (
            <p id={overrideReasonErrorId} className="text-[11px] text-red-500">
              Override reason must be at least {MIN_OVERRIDE_REASON} characters.
            </p>
          )}
          {overrideEstimatedBase !== null && (
            <p className="text-[10px] text-slate-500" data-testid="fx-estimated-base">
              Estimated base (not authoritative):{" "}
              <span className="font-mono text-slate-600">≈ {formatMoneySafe(overrideEstimatedBase, baseCurrency)}</span>
            </p>
          )}
        </div>
      ) : (
        <FxReferenceReadout
          fx={fx}
          currency={currency}
          baseCurrency={baseCurrency}
          estimatedBase={estimatedBase}
        />
      )}
    </div>
  );
}

// ── Read-only governed reference readout (non-override modes) ───────────────

function FxReferenceReadout({
  fx,
  currency,
  baseCurrency,
  estimatedBase,
}: {
  fx: ReturnType<typeof useFxReferenceRate>;
  currency: string;
  baseCurrency: string | null;
  estimatedBase: number | null;
}) {
  if (fx.mode === "base_parity") {
    return (
      <StateBox tone="neutral" icon={<Equal className="h-3.5 w-3.5" aria-hidden="true" />} testid="fx-state-parity">
        <span className="font-mono">1.0000</span> — base-currency parity. No conversion applies.
      </StateBox>
    );
  }

  if (fx.mode === "idle") {
    return (
      <StateBox tone="neutral" icon={<Calculator className="h-3.5 w-3.5" aria-hidden="true" />} testid="fx-state-idle">
        Select a currency and date to look up the governed reference rate.
      </StateBox>
    );
  }

  if (fx.mode === "loading") {
    return (
      <StateBox tone="info" icon={<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} testid="fx-state-loading" live>
        Looking up the reference rate…
      </StateBox>
    );
  }

  if (fx.mode === "error") {
    return (
      <StateBox tone="danger" icon={<Ban className="h-3.5 w-3.5" aria-hidden="true" />} testid="fx-state-error" live>
        <span>{fx.errorMessage ?? "Could not load the reference rate."}</span>
        <RetryButton onClick={fx.refetch} />
      </StateBox>
    );
  }

  if (fx.mode === "missing") {
    return (
      <StateBox tone="danger" icon={<Ban className="h-3.5 w-3.5" aria-hidden="true" />} testid="fx-state-missing" live>
        <span>No reference rate is available for {currency} → {baseCurrency} on this date. Submission is blocked.</span>
        <RetryButton onClick={fx.refetch} />
      </StateBox>
    );
  }

  if (fx.mode === "stale") {
    return (
      <StateBox tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />} testid="fx-state-stale" live>
        <span>
          Reference rate is stale{fx.ageDays !== null ? ` (${fx.ageDays} days old)` : ""}. It cannot be selected — use
          Manual override if permitted.
        </span>
        {fx.directionLabel && <span className="block font-mono text-[11px] text-amber-800">{fx.directionLabel}</span>}
      </StateBox>
    );
  }

  // Fresh reference — read-only rate, governed selection.
  return (
    <StateBox tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />} testid="fx-state-reference">
      <span className="flex items-center gap-1 font-mono text-sm text-slate-800" data-testid="fx-reference-rate">
        <Landmark className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        {fx.directionLabel}
      </span>
      <span className="block text-[11px] text-slate-500">
        Reference rate{fx.provider ? ` · ${fx.provider}` : ""}
        {fx.effectiveDate ? ` · effective ${fx.effectiveDate}` : ""} — selected automatically (read-only).
      </span>
      {estimatedBase !== null && baseCurrency && (
        <span className="block text-[10px] text-slate-500" data-testid="fx-estimated-base">
          Estimated base (not authoritative):{" "}
          <span className="font-mono text-slate-600">≈ {formatMoneySafe(estimatedBase, baseCurrency)}</span>
        </span>
      )}
    </StateBox>
  );
}

function StateBox({
  tone,
  icon,
  children,
  testid,
  live,
}: {
  tone: FxTone;
  icon: React.ReactNode;
  children: React.ReactNode;
  testid: string;
  live?: boolean;
}) {
  return (
    <div
      data-testid={testid}
      role="status"
      aria-live={live ? "polite" : undefined}
      className={cn("rounded-lg px-3 py-2 text-xs", toneRing(tone))}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 space-y-1">{children}</div>
      </div>
    </div>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1 rounded-md bg-white/70 px-2 py-0.5 text-[11px] font-medium ring-1 ring-current/20 hover:bg-white focus:outline-none focus-visible:ring-2"
    >
      <RefreshCw className="h-3 w-3" aria-hidden="true" />
      Retry
    </button>
  );
}

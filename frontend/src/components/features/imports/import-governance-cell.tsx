"use client";

// ============================================================================
// TSH Synergy AR — Import/OCR FX & governance provenance cell (B9DD-FEIR-008)
//
// Surfaces exactly the provenance an import row carries. Where the contract
// supplies nothing (e.g. a company-base amount before posting), an explicit
// unavailable state is shown rather than a computed or assumed value.
// Every state is icon + text — never colour alone.
// ============================================================================

import { cn } from "@/lib/utils";
import { formatMoneySafe } from "@/lib/currency";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import {
  readImportGovernance,
  resolveImportOrigin,
  IMPORT_POSTING_PRESENTATION,
  type ImportOriginEnvelope,
} from "@/lib/import-governance";
import { FX_TONE_CLASSES } from "@/lib/fx-presentation";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  HelpCircle,
  PenLine,
  ShieldAlert,
  XCircle,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Circle,
  CheckCircle2,
  ShieldAlert,
  XCircle,
  AlertTriangle,
  PenLine,
  HelpCircle,
};

export interface ImportGovernanceCellProps {
  mappedData: Record<string, unknown> | null | undefined;
  /**
   * B9DD-RR-005: the authoritative origin envelope — the import BATCH. Origin is
   * NOT read from `mapped_data`, because production never writes it there.
   * `null`/omitted is a real state and renders "Origin not available".
   */
  batch?: ImportOriginEnvelope | null;
  className?: string;
}

export function ImportGovernanceCell({ mappedData, batch, className }: ImportGovernanceCellProps) {
  const { baseCurrency } = useBaseCurrency();
  const g = readImportGovernance(mappedData);
  const origin = resolveImportOrigin(batch);
  const posting = IMPORT_POSTING_PRESENTATION[g.postingStatus];
  const PostingIcon = ICONS[posting.icon] ?? HelpCircle;
  const tone = FX_TONE_CLASSES[posting.tone];

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      {/* Transaction currency + amount — currency is always explicit */}
      <div className="flex items-center gap-1 text-xs">
        {g.currency ? (
          <>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
              {g.currency}
            </span>
            {g.amount !== null && (
              <span className="font-mono tabular-nums text-slate-700">
                {formatMoneySafe(g.amount, g.currency)}
              </span>
            )}
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] italic text-amber-700">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Currency not detected
          </span>
        )}
      </div>

      {/* Company-base amount: NOT booked until the document posts. */}
      <p className="text-[10px] text-slate-400">
        {g.postingStatus === "Posted" ? (
          <>Booked base recorded on the document{baseCurrency ? ` (${baseCurrency})` : ""}</>
        ) : (
          <>
            Base amount not booked yet
            {baseCurrency ? ` — company base is ${baseCurrency}` : ""}
          </>
        )}
      </p>

      {/* Imported rate + its governance consequence */}
      {g.exchangeRate !== null && (
        <span
          className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-700 ring-1 ring-inset ring-amber-200"
          title="An explicitly imported FX rate is governed as a MANUAL_OVERRIDE and requires review before posting."
        >
          <PenLine className="h-3 w-3" aria-hidden="true" />
          Imported rate
          {g.currency && baseCurrency
            ? `: 1 ${g.currency} = ${g.exchangeRate.toFixed(4)} ${baseCurrency}`
            : `: ${g.exchangeRate.toFixed(4)}`}
        </span>
      )}

      {/* Posting / hold state */}
      <span
        title={posting.description}
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
          tone.bg,
          tone.text,
          tone.ring,
        )}
      >
        <PostingIcon className="h-3 w-3" aria-hidden="true" />
        {posting.label}
      </span>

      {/* Non-postable reason, verbatim from the backend */}
      {g.postingError && (
        <p className="max-w-[260px] text-[10px] leading-snug text-amber-700">{g.postingError}</p>
      )}

      {/* Provenance / origin — from the BATCH envelope (B9DD-RR-005), never
          from mapped_data, which production does not populate with an origin. */}
      <div className="flex flex-wrap gap-1">
        {origin.kind === "unavailable" ? (
          <span className="inline-flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-[10px] italic text-slate-500 ring-1 ring-inset ring-slate-200">
            <HelpCircle className="h-3 w-3" aria-hidden="true" />
            {origin.label}
          </span>
        ) : (
          <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-inset ring-slate-200">
            {origin.label}
          </span>
        )}
        {/* Row-level marker the backend really does write into mapped_data. */}
        {g.manualFallback && (
          <span className="inline-flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-inset ring-slate-200">
            <PenLine className="h-3 w-3" aria-hidden="true" />
            Manual entry (OCR disabled)
          </span>
        )}
        {g.overrideReason && (
          <span
            className="max-w-[200px] truncate rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-inset ring-slate-200"
            title={g.overrideReason}
          >
            Reason: {g.overrideReason}
          </span>
        )}
        {g.lowConfidence && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 ring-1 ring-inset ring-amber-200">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Low OCR confidence
          </span>
        )}
      </div>
    </div>
  );
}

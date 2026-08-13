"use client";

import { AlertTriangle } from "lucide-react";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import { cn } from "@/lib/utils";
import { formatExactDecimal } from "@/lib/monetary-summary";
import type {
  NormalizedMonetarySummary,
  NormalizedMonetarySummaryV2,
} from "@/types";

const AMOUNT_BASIS_LABELS = {
  current_outstanding: "Outstanding",
  current_unallocated: "Unapplied",
  original_document_total: "Document total",
} as const;

interface MoneySummaryProps {
  summary: NormalizedMonetarySummary;
  title?: string;
  className?: string;
}

function exclusionWarning(count: number): string {
  return `Company-base total excludes ${count} document${count === 1 ? "" : "s"} without verified booked FX.`;
}

function CompanyBaseTotal({ summary }: { summary: NormalizedMonetarySummary }) {
  if (summary.contractVersion === 1) {
    return (
      <>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-slate-500">Company-base total</span>
          <span className="font-semibold text-slate-700">Not verified</span>
        </div>
        <p className="mt-1 text-xs text-amber-700">
          Company-base total verification is unavailable for this legacy summary.
        </p>
      </>
    );
  }

  return <CompanyBaseTotalV2 summary={summary} />;
}

/** Compact authority-aware base state for report breakdown tables/cards. */
export function CompactCompanyBase({
  summary,
}: {
  summary: NormalizedMonetarySummary;
}) {
  if (summary.contractVersion === 1) {
    return (
      <span className="text-sm font-medium text-amber-700" title="Legacy summary">
        Not verified
      </span>
    );
  }
  if (
    summary.matchingDocumentCount > 0 &&
    summary.authoritativeDocumentCount === 0
  ) {
    return <span className="text-sm font-medium text-amber-700">Not available</span>;
  }
  return (
    <span className="text-sm font-semibold tabular-nums text-slate-800">
      {summary.baseCurrency} {formatExactDecimal(summary.baseTotal ?? "0.00")}
      {summary.unavailableCount > 0 && (
        <span className="ml-1 text-xs font-normal text-amber-700">(partial)</span>
      )}
    </span>
  );
}

function CompanyBaseTotalV2({
  summary,
}: {
  summary: NormalizedMonetarySummaryV2;
}) {
  const empty = summary.matchingDocumentCount === 0;
  const allUnavailable =
    summary.matchingDocumentCount > 0 &&
    summary.authoritativeDocumentCount === 0;
  const partial =
    summary.authoritativeDocumentCount > 0 && summary.unavailableCount > 0;
  const label = partial
    ? "Authoritative company-base subtotal"
    : "Company-base total";
  const value = allUnavailable
    ? "Not available"
    : `${summary.baseCurrency} ${formatExactDecimal(summary.baseTotal ?? "0.00")}`;

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="font-semibold tabular-nums text-slate-900">{value}</span>
      </div>
      {!empty && summary.unavailableCount > 0 && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{exclusionWarning(summary.unavailableCount)}</span>
        </p>
      )}
    </>
  );
}

/**
 * Shared Invoice/Receipt monetary presentation. It renders backend-produced
 * native subtotals verbatim and never performs a cross-currency aggregation or
 * client-side FX conversion.
 */
export function MoneySummary({ summary, title, className }: MoneySummaryProps) {
  const amountLabel = AMOUNT_BASIS_LABELS[summary.amountBasis];

  return (
    <section
      className={cn("rounded-lg border border-slate-200 bg-surface p-3", className)}
      aria-label={title ?? amountLabel}
    >
      {title && (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h3>
      )}
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {amountLabel} by currency
        </p>
        <CurrencyTotals
          byCurrency={summary.byCurrency}
          baseCurrency={summary.baseCurrency}
          showBaseContribution
          emptyLabel="No records"
        />
      </div>
      <div className="mt-2 border-t border-slate-100 pt-2">
        <CompanyBaseTotal summary={summary} />
      </div>
    </section>
  );
}

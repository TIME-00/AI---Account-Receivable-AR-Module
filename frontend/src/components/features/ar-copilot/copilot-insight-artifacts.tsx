"use client";

import { ClipboardList, Lightbulb } from "lucide-react";
import {
  ArtifactCard,
  Badge,
  CodeChips,
  FactList,
  LEVEL_TONE,
} from "./copilot-artifact-shell";
import {
  cellText,
  humanizeKey,
  type CopilotAnalysisPayload,
  type CopilotDailyBriefPayload,
} from "@/lib/ar-copilot/artifacts";

// ============================================================================
// Analytical findings and the Daily Brief.
//
// Presentation only. No risk score is invented, no ranking is recomputed, no
// missing financial fact is inferred, and backend ordering is preserved
// exactly — the order the analyst returned items IS the finding.
// ============================================================================

const ANALYSIS_TITLE: Record<CopilotAnalysisPayload["analysis_type"], string> = {
  priority: "AR priority analysis",
  customer_risk: "Customer risk analysis",
  collection_health: "Collection health analysis",
  exposure_movement: "Exposure movement analysis",
  unapplied_cash: "Unapplied cash analysis",
  root_cause: "Root cause analysis",
};

export function AnalysisArtifact({
  analysis,
}: {
  analysis: CopilotAnalysisPayload;
}) {
  return (
    <ArtifactCard
      icon={Lightbulb}
      title={ANALYSIS_TITLE[analysis.analysis_type]}
      subtitle={`As of ${analysis.as_of}${
        analysis.base_currency ? ` · ${analysis.base_currency}` : ""
      }`}
      badge={analysis.status === "insufficient_evidence"
        ? <Badge tone="warn">Insufficient evidence</Badge>
        : <Badge tone="neutral">Complete</Badge>}
    >
      {analysis.priority_items.length > 0 && (
        <ul className="mt-2 space-y-2">
          {analysis.priority_items.map((item) => (
            <li
              key={`${item.entity_type}:${item.entity_id}:${item.category_rank}`}
              className="rounded border border-line bg-surface-muted p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={LEVEL_TONE[item.priority]}>{item.priority}</Badge>
                <span className="text-[11px] font-semibold text-content">
                  {item.label}
                </span>
                <Badge tone="neutral">{item.evidence_type}</Badge>
              </div>
              <CodeChips codes={item.reason_codes} />
              <FactList facts={item.facts} />
            </li>
          ))}
        </ul>
      )}

      {analysis.factors.length > 0 && (
        <div className="mt-2">
          <h5 className="text-[10px] font-semibold uppercase tracking-widest text-content-secondary">
            Contributing factors
          </h5>
          <ul className="mt-1 space-y-1.5">
            {analysis.factors.map((factor) => (
              <li
                key={`${factor.factor_code}:${factor.metric}`}
                className="rounded border border-line px-2 py-1.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-content">
                    {factor.factor_code}
                  </span>
                  <Badge tone="neutral">{factor.evidence_type}</Badge>
                </div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
                  <dt className="text-[10px] uppercase tracking-wide text-content-secondary">
                    {humanizeKey(factor.metric)}
                  </dt>
                  <dd className="text-[11px] text-content">
                    {cellText(factor.current_value)}
                    {factor.comparison_value !== null && (
                      <> (prior {cellText(factor.comparison_value)})</>
                    )}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.limitations.length > 0 && (
        <ul className="mt-2 space-y-1">
          {analysis.limitations.map((limitation) => (
            <li
              key={limitation}
              className="text-[10px] leading-relaxed text-content-secondary"
            >
              {limitation}
            </li>
          ))}
        </ul>
      )}
    </ArtifactCard>
  );
}

export function DailyBriefArtifact({
  brief,
}: {
  brief: CopilotDailyBriefPayload;
}) {
  return (
    <ArtifactCard
      icon={ClipboardList}
      title="Daily brief"
      subtitle={`As of ${brief.as_of} · generated on demand`}
    >
      {brief.items.length === 0
        ? (
          <p className="mt-2 text-[11px] text-content-secondary">
            No bounded insights for this date.
          </p>
        )
        : (
          // Backend ordering is preserved exactly; never re-sorted.
          <ol className="mt-2 space-y-2">
            {brief.items.map((item) => (
              <li
                key={item.id}
                className="rounded border border-line bg-surface-muted p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={LEVEL_TONE[item.severity]}>
                    {item.severity}
                  </Badge>
                  <span className="text-[11px] font-semibold text-content">
                    {item.title}
                  </span>
                  <Badge tone="neutral">{item.evidence_type}</Badge>
                </div>
                <CodeChips codes={item.reason_codes} />
                <FactList facts={item.facts} />
                {/* Shown as TEXT: `lib/ar-copilot/links.ts` is the only
                    navigation authority in this feature. */}
                <p className="mt-1.5 text-[10px] text-content-secondary">
                  Suggested screen:{" "}
                  <span className="font-medium text-content-secondary">
                    {item.recommended_next_screen}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        )}
    </ArtifactCard>
  );
}

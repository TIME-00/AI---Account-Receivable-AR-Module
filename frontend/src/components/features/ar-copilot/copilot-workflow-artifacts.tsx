"use client";

import { AlertTriangle, FileSearch, Lock } from "lucide-react";
import { ArtifactCard, Badge, CodeChips } from "./copilot-artifact-shell";
import {
  cellText,
  humanizeKey,
  type CopilotDocumentAnalysisPayload,
  type CopilotRecoveryPlanPayload,
} from "@/lib/ar-copilot/artifacts";

// ============================================================================
// Document analysis and exception recovery.
//
// Two authority rules held here:
//
//   1. Provenance stays separated. EXTRACTED candidates, the extraction's own
//      VALIDATED state, and the MATCHED customer resolution are three
//      different authority levels and are never blurred into one badge.
//   2. Recovery is advisory. Gate 1 cannot execute anything, so this file
//      renders no button, no form and no link — only evidence and suggested
//      review steps, each marked as requiring human confirmation.
// ============================================================================

export function DocumentAnalysisArtifact({
  document,
}: {
  document: CopilotDocumentAnalysisPayload;
}) {
  const extraction = document.extraction;
  return (
    <ArtifactCard
      icon={FileSearch}
      title="Document analysis"
      subtitle={`Document ${document.document_id}`}
      badge={document.classification_status
        ? <Badge tone="neutral">{document.classification_status}</Badge>
        : undefined}
    >
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-[10px] uppercase tracking-wide text-content-secondary">
          Document type
        </dt>
        <dd className="text-[11px] text-content">
          {cellText(document.document_type)}
        </dd>
        <dt className="text-[10px] uppercase tracking-wide text-content-secondary">
          Classification confidence
        </dt>
        <dd className="text-[11px] text-content">
          {cellText(document.classification_confidence)}
        </dd>
        <dt className="text-[10px] uppercase tracking-wide text-content-secondary">
          Critical field confidence
        </dt>
        <dd className="text-[11px] text-content">
          {cellText(document.critical_field_confidence)}
        </dd>
      </dl>

      {extraction
        ? (
          <div className="mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-[10px] font-semibold uppercase tracking-widest text-content-secondary">
                Extraction
              </h5>
              <Badge tone="info">
                Validation: {extraction.validation_status}
              </Badge>
            </div>
            <CodeChips codes={extraction.validation_codes} />
            {extraction.fields.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {extraction.fields.map((field) => (
                  <li
                    key={field.field}
                    className="flex flex-wrap items-center gap-2 rounded border border-line px-2 py-1"
                  >
                    <span className="text-[10px] uppercase tracking-wide text-content-secondary">
                      {humanizeKey(field.field)}
                    </span>
                    <span className="text-[11px] font-medium text-content">
                      {cellText(field.value)}
                    </span>
                    <Badge tone="warn">{field.provenance}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-content">
              <span className="text-[10px] uppercase tracking-wide text-content-secondary">
                Customer match
              </span>
              {extraction.customer_match.matched
                ? cellText(extraction.customer_match.customer_id)
                : "Not matched"}
              <Badge tone="info">{extraction.customer_match.provenance}</Badge>
              {extraction.customer_match.method && (
                <span className="text-[10px] text-content-secondary">
                  via {extraction.customer_match.method}
                </span>
              )}
            </p>
          </div>
        )
        : (
          <p className="mt-2 text-[11px] text-content-secondary">
            No bounded extraction result is stored for this document.
          </p>
        )}

      <p className="mt-2 text-[10px] leading-relaxed text-content-secondary">
        {document.provenance_note}
      </p>
    </ArtifactCard>
  );
}

export function RecoveryPlanArtifact({
  plan,
}: {
  plan: CopilotRecoveryPlanPayload;
}) {
  return (
    <ArtifactCard
      icon={AlertTriangle}
      title="Exception recovery analysis"
      subtitle={plan.explanation}
      badge={
        <>
          <Badge tone="neutral">{plan.lifecycle_status}</Badge>
          {plan.read_only && !plan.executable && (
            <Badge tone="info">Read-only analysis</Badge>
          )}
        </>
      }
    >
      <p className="mt-1.5 text-[11px] text-content">
        <span className="text-[10px] uppercase tracking-wide text-content-secondary">
          Reason code
        </span>{" "}
        {plan.reason_code}
      </p>
      {plan.candidate_resolutions.length > 0 && (
        <div className="mt-2">
          <h5 className="text-[10px] font-semibold uppercase tracking-widest text-content-secondary">
            Suggested review steps
          </h5>
          <ul className="mt-1 space-y-1.5">
            {plan.candidate_resolutions.map((candidate) => (
              <li
                key={candidate.resolution_type}
                className="rounded border border-line px-2 py-1.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-content">
                    {candidate.label}
                  </span>
                  {candidate.requires_human_confirmation && (
                    <Badge tone="warn">
                      <Lock
                        className="mr-1 inline h-2.5 w-2.5"
                        aria-hidden="true"
                      />
                      Requires human confirmation
                    </Badge>
                  )}
                </div>
                <CodeChips codes={candidate.supporting_evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-content-secondary">
        These are recommendations only. AR Copilot cannot retry, allocate,
        reassign, or send anything — use the governed AR screens to act.
      </p>
    </ArtifactCard>
  );
}

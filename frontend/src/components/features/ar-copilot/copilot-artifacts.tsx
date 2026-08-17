"use client";

import {
  AnalysisArtifact,
  DailyBriefArtifact,
} from "./copilot-insight-artifacts";
import { ReportArtifact } from "./copilot-report-artifact";
import {
  DocumentAnalysisArtifact,
  RecoveryPlanArtifact,
} from "./copilot-workflow-artifacts";
import type { CopilotArtifact } from "@/lib/ar-copilot/artifacts";

// ============================================================================
// Gate 1 analytical artifact rendering — entry point.
//
// Dispatch only. The union is closed and already strict-parsed by
// `lib/ar-copilot/artifacts.ts`, so an unrecognised kind cannot reach here:
// the whole response would have been rejected upstream and shown as the safe
// Copilot error instead.
//
// Everything below the dispatch is presentation only. No artifact carries an
// href, a component name, a formatter, or markup, and nothing here computes,
// sums, re-sorts or infers a financial value.
// ============================================================================

export function CopilotArtifactList({
  artifacts,
}: {
  artifacts: readonly CopilotArtifact[];
}) {
  if (artifacts.length === 0) return null;
  return (
    <div className="mt-1">
      {artifacts.map((artifact, index) => {
        switch (artifact.kind) {
          case "analysis":
            return (
              <AnalysisArtifact
                key={`analysis:${artifact.analysis.analysis_type}:${index}`}
                analysis={artifact.analysis}
              />
            );
          case "daily_brief":
            return (
              <DailyBriefArtifact
                key={`daily_brief:${artifact.daily_brief.as_of}:${index}`}
                brief={artifact.daily_brief}
              />
            );
          case "report":
            return (
              <ReportArtifact
                key={`report:${artifact.report.report_type}:${index}`}
                report={artifact.report}
                chart={artifact.chart}
              />
            );
          case "document_analysis":
            return (
              <DocumentAnalysisArtifact
                key={`document:${artifact.document_analysis.document_id}:${index}`}
                document={artifact.document_analysis}
              />
            );
          case "recovery_plan":
            return (
              <RecoveryPlanArtifact
                key={`recovery:${artifact.recovery_plan.exception_id}:${index}`}
                plan={artifact.recovery_plan}
              />
            );
        }
      })}
    </div>
  );
}

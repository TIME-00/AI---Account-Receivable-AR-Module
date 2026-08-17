"use client";

import { Table2 } from "lucide-react";
import { ChartFigure } from "./copilot-chart-artifact";
import {
  ArtifactCard,
  Badge,
  type BadgeTone,
  FactList,
} from "./copilot-artifact-shell";
import {
  cellText,
  type CopilotChartPayload,
  type CopilotReportPayload,
  coverageSummary,
} from "@/lib/ar-copilot/artifacts";

// Coverage is stated before rows and nothing here calculates, sorts, rounds,
// or derives financial values. Tables and summary facts preserve backend order
// and backend-provided scalar text exactly.

const COVERAGE_TONE: Record<
  CopilotReportPayload["coverage"]["status"],
  BadgeTone
> = {
  complete: "neutral",
  bounded_incomplete: "warn",
  insufficient_evidence: "warn",
};

function ReportSummary({ report }: { report: CopilotReportPayload }) {
  if (Object.keys(report.summary).length === 0) return null;
  return (
    <div
      data-report-summary=""
      className="mt-2 rounded border border-line/60 bg-surface-muted/40 p-2"
    >
      <h5 className="text-[10px] font-semibold uppercase tracking-wide text-content-secondary">
        Backend summary
      </h5>
      <FactList facts={report.summary} />
    </div>
  );
}

function ReportTable({ report }: { report: CopilotReportPayload }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          {report.title} — {coverageSummary(report.coverage)}
        </caption>
        <thead>
          <tr>
            {report.columns.map((column) => (
              <th
                key={column.field}
                scope="col"
                className="border-b border-line px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-content-secondary"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Backend row order is backend meaning; it is never re-sorted. */}
          {report.rows.map((row, index) => (
            <tr key={index} className="border-b border-line/60 last:border-0">
              {report.columns.map((column) => (
                <td
                  key={column.field}
                  className="whitespace-nowrap px-2 py-1 text-[11px] text-content"
                >
                  {cellText(row[column.field] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportArtifact({
  report,
  chart,
}: {
  report: CopilotReportPayload;
  chart: CopilotChartPayload | null;
}) {
  return (
    <ArtifactCard
      icon={Table2}
      title={report.title}
      subtitle={`${report.description} As of ${report.as_of}${
        report.base_currency ? ` · ${report.base_currency}` : ""
      }`}
      badge={
        <Badge tone={COVERAGE_TONE[report.coverage.status]}>
          {report.coverage.status.replaceAll("_", " ")}
        </Badge>
      }
    >
      <p className="mt-1.5 text-[11px] font-medium text-content-secondary">
        {coverageSummary(report.coverage)}
      </p>
      {report.coverage.reason
        ? (
          <p className="mt-1 text-[10px] leading-relaxed text-content-secondary">
            {report.coverage.reason}
          </p>
        )
        : null}
      <ReportSummary report={report} />
      <ReportTable report={report} />
      {chart
        ? (
          <ChartFigure
            chart={chart}
            partitionTotal={report.summary.partition_total}
          />
        )
        : null}
    </ArtifactCard>
  );
}

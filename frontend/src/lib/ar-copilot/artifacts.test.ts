import { describe, expect, it } from "vitest";
import { CopilotContractError, parseCopilotChatResponse } from "./contract";
import { cellText, coverageSummary } from "./artifacts";
import {
  analysisArtifact,
  boundedReportArtifact,
  dailyBriefArtifact,
  documentAnalysisArtifact,
  gate1Response,
  recoveryPlanArtifact,
  reportArtifact,
  v2Response,
} from "@/test/ar-copilot/gate1-artifacts";

// ============================================================================
// Gate 1 artifact contract.
//
// The rollout blocker these tests close: the strict response schema accepted
// only answer/evidence/links/status, so a valid backend response carrying
// `artifacts` failed parsing and collapsed into the safe Copilot error.
//
// The schema stays strict. These tests pin BOTH directions — the exact
// backend union parses, and everything outside it still fails closed.
// ============================================================================

const allowAll = () => true;

function parse(value: unknown) {
  return parseCopilotChatResponse(value, allowAll);
}

// Deep-clone so a mutation in one case cannot leak into another.
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("backward compatibility", () => {
  it("parses a Copilot v2 response with no artifacts key", () => {
    const parsed = parse(v2Response);
    expect(parsed.answer).toBe(
      "Allocation matches a Receipt to one or more Invoices.",
    );
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.artifacts).toEqual([]);
  });

  it("parses a response with an explicitly empty artifacts array", () => {
    expect(parse(gate1Response([])).artifacts).toEqual([]);
  });

  it("still drops unsafe links and still rejects unknown top-level fields", () => {
    expect(parse({ ...v2Response, links: [] }).links).toEqual([]);
    expect(() => parse({ ...v2Response, hint: "extra" })).toThrow(
      CopilotContractError,
    );
  });
});

describe("valid backend artifact fixtures", () => {
  const fixtures = [
    ["analysis", analysisArtifact],
    ["daily_brief", dailyBriefArtifact],
    ["report + chart", reportArtifact],
    ["bounded report without chart", boundedReportArtifact],
    ["document_analysis", documentAnalysisArtifact],
    ["recovery_plan", recoveryPlanArtifact],
  ] as const;

  it.each(fixtures)("parses the %s artifact", (_name, artifact) => {
    const parsed = parse(gate1Response([artifact]));
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0]?.kind).toBe(artifact.kind);
  });

  it("parses multiple artifacts up to the backend cap of four", () => {
    const parsed = parse(gate1Response([
      analysisArtifact,
      dailyBriefArtifact,
      reportArtifact,
      recoveryPlanArtifact,
    ]));
    expect(parsed.artifacts.map((item) => item.kind)).toEqual([
      "analysis",
      "daily_brief",
      "report",
      "recovery_plan",
    ]);
  });

  it("rejects more artifacts than the backend can emit", () => {
    expect(() =>
      parse(gate1Response([
        analysisArtifact,
        dailyBriefArtifact,
        reportArtifact,
        recoveryPlanArtifact,
        documentAnalysisArtifact,
      ]))
    ).toThrow(CopilotContractError);
  });

  it("preserves exact amount strings without reformatting", () => {
    const parsed = parse(gate1Response([reportArtifact]));
    const artifact = parsed.artifacts[0];
    expect(artifact?.kind).toBe("report");
    if (artifact?.kind !== "report") return;
    expect(artifact.report.rows[0].outstanding_amount).toBe("10000.00");
    expect(artifact.report.summary.report_total).toBe("20000.00");
  });
});

describe("strict rejection", () => {
  it("rejects an unknown artifact kind", () => {
    expect(() =>
      parse(gate1Response([{ kind: "forecast", forecast: { total: "1.00" } }]))
    ).toThrow(CopilotContractError);
  });

  it("rejects an unknown nested field inside a known artifact", () => {
    const artifact = clone(analysisArtifact);
    (artifact.analysis as unknown as Record<string, unknown>).confidence = 0.9;
    expect(() => parse(gate1Response([artifact]))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects an unknown field on the artifact envelope", () => {
    expect(() =>
      parse(gate1Response([{ ...clone(reportArtifact), renderer: "custom" }]))
    ).toThrow(CopilotContractError);
  });

  it("rejects a missing required artifact field", () => {
    const artifact = clone(recoveryPlanArtifact);
    delete (artifact.recovery_plan as unknown as Record<string, unknown>)
      .read_only;
    expect(() => parse(gate1Response([artifact]))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects a malformed artifact body", () => {
    expect(() => parse(gate1Response([{ kind: "analysis", analysis: null }])))
      .toThrow(CopilotContractError);
    expect(() => parse(gate1Response(["report"]))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects an unsupported chart type", () => {
    const artifact = clone(reportArtifact);
    (artifact.chart as unknown as Record<string, unknown>).chart_type =
      "scatter";
    expect(() => parse(gate1Response([artifact]))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects an unsupported report type, coverage status and authority", () => {
    for (
      const mutate of [
        (a: typeof reportArtifact) => {
          (a.report as unknown as Record<string, unknown>).report_type =
            "forecast";
        },
        (a: typeof reportArtifact) => {
          (a.report.coverage as unknown as Record<string, unknown>).status =
            "probably_complete";
        },
        (a: typeof reportArtifact) => {
          (a.report as unknown as Record<string, unknown>).authority =
            "model_estimate";
        },
      ]
    ) {
      const artifact = clone(reportArtifact);
      mutate(artifact);
      expect(() => parse(gate1Response([artifact]))).toThrow(
        CopilotContractError,
      );
    }
  });

  it("rejects an executable or non-read-only recovery plan", () => {
    for (const patch of [{ read_only: false }, { executable: true }]) {
      const artifact = clone(recoveryPlanArtifact);
      Object.assign(artifact.recovery_plan, patch);
      expect(() => parse(gate1Response([artifact]))).toThrow(
        CopilotContractError,
      );
    }
  });

  it("rejects a candidate that does not require human confirmation", () => {
    const artifact = clone(recoveryPlanArtifact);
    (artifact.recovery_plan.candidate_resolutions[0] as unknown as Record<
      string,
      unknown
    >).requires_human_confirmation = false;
    expect(() => parse(gate1Response([artifact]))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects a downgraded document provenance label", () => {
    for (
      const mutate of [
        (a: typeof documentAnalysisArtifact) => {
          (a.document_analysis.extraction!.fields[0] as unknown as Record<
            string,
            unknown
          >).provenance = "AUTHORITATIVE";
        },
        (a: typeof documentAnalysisArtifact) => {
          (a.document_analysis.extraction!.customer_match as unknown as Record<
            string,
            unknown
          >).provenance = "EXTRACTED";
        },
      ]
    ) {
      const artifact = clone(documentAnalysisArtifact);
      mutate(artifact);
      expect(() => parse(gate1Response([artifact]))).toThrow(
        CopilotContractError,
      );
    }
  });

  it("rejects arbitrary script, markup and URL payloads", () => {
    // A renderer instruction has no field to live in; adding one is rejected
    // as an unknown key, and hostile content in a typed slot is rejected by
    // that slot's own shape.
    const hostile: Array<Record<string, unknown>> = [
      {
        kind: "report",
        report: reportArtifact.report,
        chart: null,
        html: "<img onerror=alert(1)>",
      },
      {
        kind: "analysis",
        analysis: { ...clone(analysisArtifact.analysis), component: "Script" },
      },
    ];
    for (const artifact of hostile) {
      expect(() => parse(gate1Response([artifact]))).toThrow(
        CopilotContractError,
      );
    }

    // `recommended_next_screen` is the only path-shaped field in the union.
    for (
      const href of [
        "javascript:alert(1)",
        "data:text/html,<script>",
        "https://evil.example.com/steal",
        "//evil.example.com",
      ]
    ) {
      const artifact = clone(dailyBriefArtifact);
      artifact.daily_brief.items[0].recommended_next_screen = href;
      expect(() => parse(gate1Response([artifact]))).toThrow(
        CopilotContractError,
      );
    }
  });

  it("rejects non-scalar values inside open-keyed dictionaries", () => {
    const nested = clone(analysisArtifact);
    (nested.analysis.priority_items[0].facts as unknown as Record<
      string,
      unknown
    >).nested = { total: "1.00" };
    expect(() => parse(gate1Response([nested]))).toThrow(CopilotContractError);

    const arrayCell = clone(reportArtifact);
    (arrayCell.report.rows[0] as unknown as Record<string, unknown>)
      .outstanding_amount = ["10000.00"];
    expect(() => parse(gate1Response([arrayCell]))).toThrow(
      CopilotContractError,
    );

    const nestedSummary = clone(reportArtifact);
    (nestedSummary.report.summary as unknown as Record<string, unknown>)
      .report_total = { amount: "20000.00" };
    expect(() => parse(gate1Response([nestedSummary]))).toThrow(
      CopilotContractError,
    );
  });

  it("enforces reachable chart series bounds and one-series pie semantics", () => {
    const tooMany = clone(reportArtifact);
    tooMany.chart.series = Array.from({ length: 4 }, (_, index) => ({
      field: `metric_${index}`,
      label: `Metric ${index}`,
      format: "currency" as const,
    }));
    expect(() => parse(gate1Response([tooMany]))).toThrow(
      CopilotContractError,
    );

    const multiSeriesPie = clone(reportArtifact);
    multiSeriesPie.chart.series.push({
      field: "invoice_count",
      label: "Invoices",
      format: "currency",
    });
    expect(() => parse(gate1Response([multiSeriesPie]))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects oversized bounded arrays", () => {
    const artifact = clone(reportArtifact);
    artifact.report.rows = Array.from({ length: 51 }, () => ({
      aging_bucket: "Current",
      outstanding_amount: "1.00",
    }));
    expect(() => parse(gate1Response([artifact]))).toThrow(
      CopilotContractError,
    );
  });
});

describe("authority helpers", () => {
  it("never describes a bounded result as complete", () => {
    const bounded = coverageSummary(boundedReportArtifact.report.coverage);
    expect(bounded).toContain("Partial result");
    expect(bounded).toContain("42 matching");
    expect(bounded).not.toMatch(/^Complete/);
  });

  it("describes a complete result as complete", () => {
    expect(coverageSummary(reportArtifact.report.coverage)).toContain(
      "Complete result",
    );
  });

  it("describes an insufficient result without implying a finding", () => {
    expect(
      coverageSummary({
        status: "insufficient_evidence",
        source_total: null,
        returned_rows: 0,
        top_n_complete: null,
        reason: null,
      }),
    ).toContain("Insufficient evidence");
  });

  it("renders scalars without inventing or rounding values", () => {
    expect(cellText("10000.00")).toBe("10000.00");
    expect(cellText(null)).toBe("—");
    expect(cellText(false)).toBe("No");
    expect(cellText(3)).toBe("3");
  });
});

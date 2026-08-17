import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotArtifactList } from "./copilot-artifacts";
import { CopilotMessage } from "./copilot-message";
import type {
  CopilotArtifact,
  CopilotChartPayload,
} from "@/lib/ar-copilot/artifacts";
import {
  analysisArtifact,
  boundedReportArtifact,
  dailyBriefArtifact,
  documentAnalysisArtifact,
  recoveryPlanArtifact,
  reportArtifact,
} from "@/test/ar-copilot/gate1-artifacts";

// ============================================================================
// Artifact rendering + authority presentation.
//
// Two things these tests protect. First, the structured payloads actually
// reach the screen alongside the narrative answer. Second — and this is the
// part that matters for a finance surface — the UI never upgrades what the
// backend said: a bounded subset is not shown as the whole population, an
// extraction candidate is not shown as an authoritative value, and a
// read-only recommendation offers no way to execute anything.
// ============================================================================

function renderArtifacts(artifacts: CopilotArtifact[]) {
  return render(<CopilotArtifactList artifacts={artifacts} />);
}

const multiSeriesBarArtifact: CopilotArtifact = {
  kind: "report",
  report: {
    report_type: "invoice_summary",
    title: "Invoice metrics",
    description: "Authorized invoice metrics in backend order.",
    as_of: "2026-08-16",
    base_currency: "MYR",
    columns: [
      { field: "document", label: "Document", format: "text" },
      { field: "total_amount", label: "Total", format: "currency" },
      {
        field: "outstanding_amount",
        label: "Outstanding",
        format: "currency",
      },
      { field: "invoice_count", label: "Invoices", format: "number" },
    ],
    rows: [
      {
        document: "INV-002",
        total_amount: "12000.00",
        outstanding_amount: "10000.00",
        invoice_count: 2,
      },
      {
        document: "INV-001",
        total_amount: "7000.00",
        outstanding_amount: "6000.00",
        invoice_count: 1,
      },
    ],
    summary: { row_count: 2 },
    coverage: {
      status: "complete",
      source_total: 2,
      returned_rows: 2,
      top_n_complete: null,
      reason: null,
    },
    authority: "authoritative_rows",
  },
  chart: {
    chart_type: "bar",
    title: "Invoice metrics",
    x_field: "document",
    series: [
      { field: "total_amount", label: "Total", format: "currency" },
      {
        field: "outstanding_amount",
        label: "Outstanding",
        format: "currency",
      },
      { field: "invoice_count", label: "Invoices", format: "number" },
    ],
    data: [
      {
        document: "INV-002",
        total_amount: "12000.00",
        outstanding_amount: "10000.00",
        invoice_count: 2,
      },
      {
        document: "INV-001",
        total_amount: "7000.00",
        outstanding_amount: "6000.00",
        invoice_count: 1,
      },
    ],
    is_truncated: false,
    displayed_points: 2,
    total_available_points: 2,
  },
};

const collectionLineChart: CopilotChartPayload = {
  chart_type: "line",
  title: "Collection trend",
  x_field: "period",
  series: [
    {
      field: "collection_amount",
      label: "Collections",
      format: "currency",
    },
    { field: "receipt_count", label: "Receipts", format: "number" },
  ],
  data: [
    { period: "2026-06", collection_amount: "8000.00", receipt_count: 4 },
    { period: "2026-07", collection_amount: "9000.00", receipt_count: 5 },
    { period: "2026-08", collection_amount: "11000.00", receipt_count: 7 },
  ],
  is_truncated: false,
  displayed_points: 3,
  total_available_points: 3,
};

const collectionLineArtifact: CopilotArtifact = {
  kind: "report",
  report: {
    report_type: "collections",
    title: "Collection trend",
    description: "Authorized collection periods in backend order.",
    as_of: "2026-08-16",
    base_currency: "MYR",
    columns: [
      { field: "period", label: "Period", format: "date" },
      {
        field: "collection_amount",
        label: "Collections",
        format: "currency",
      },
      { field: "receipt_count", label: "Receipts", format: "number" },
    ],
    rows: collectionLineChart.data,
    summary: { row_count: 3, ordered_period_series: true },
    coverage: {
      status: "complete",
      source_total: 3,
      returned_rows: 3,
      top_n_complete: null,
      reason: null,
    },
    authority: "authoritative_rows",
  },
  chart: collectionLineChart,
};

describe("conversational answers are unchanged", () => {
  it("renders a v2 assistant turn with no artifact markup", () => {
    render(
      <ul>
        <CopilotMessage
          turn={{
            id: "a1",
            role: "assistant",
            answer: "Allocation matches a Receipt to one or more Invoices.",
            evidence: [],
            links: [],
            artifacts: [],
          }}
        />
      </ul>,
    );
    expect(
      screen.getByText(
        "Allocation matches a Receipt to one or more Invoices.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders the answer and the artifacts together, answer first", () => {
    const { container } = render(
      <ul>
        <CopilotMessage
          turn={{
            id: "a2",
            role: "assistant",
            answer: "Here are the authorized results.",
            evidence: [],
            links: [],
            artifacts: [reportArtifact],
          }}
        />
      </ul>,
    );
    const answer = screen.getByText("Here are the authorized results.");
    const heading = screen.getByRole("heading", { name: "Aging by bucket" });
    expect(answer).toBeInTheDocument();
    expect(
      answer.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector("table")).toBeInTheDocument();
  });

  it("renders nothing at all for an empty artifact list", () => {
    const { container } = renderArtifacts([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("analysis artifact", () => {
  it("renders priority items, factors and limitations", () => {
    renderArtifacts([analysisArtifact]);
    expect(
      screen.getByRole("heading", { name: "AR priority analysis" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Zenith Bhd")).toBeInTheDocument();
    expect(screen.getByText("OVERDUE_EXPOSURE_CONCENTRATED"))
      .toBeInTheDocument();
    expect(screen.getByText("AUTHORITATIVE_FACT")).toBeInTheDocument();
    expect(screen.getByText("CURRENT_OVERDUE_EXPOSURE_AVAILABLE"))
      .toBeInTheDocument();
    expect(
      screen.getByText(/do not infer customer intent/i),
    ).toBeInTheDocument();
  });

  it("shows the exact backend amount without reformatting", () => {
    renderArtifacts([analysisArtifact]);
    expect(screen.getAllByText("20000.00").length).toBeGreaterThan(0);
  });

  it("labels an insufficient-evidence analysis as such", () => {
    const insufficient = {
      ...analysisArtifact,
      analysis: {
        ...analysisArtifact.analysis,
        status: "insufficient_evidence" as const,
      },
    };
    renderArtifacts([insufficient]);
    expect(screen.getByText("Insufficient evidence")).toBeInTheDocument();
  });
});

describe("daily brief artifact", () => {
  it("renders bounded insights in backend order", () => {
    const twoItems = {
      ...dailyBriefArtifact,
      daily_brief: {
        ...dailyBriefArtifact.daily_brief,
        items: [
          dailyBriefArtifact.daily_brief.items[0],
          {
            ...dailyBriefArtifact.daily_brief.items[0],
            id: "second",
            title: "Acme Bhd",
            severity: "info" as const,
          },
        ],
      },
    };
    renderArtifacts([twoItems]);
    const items = screen.getAllByRole("listitem");
    const titles = items
      .map((item) => item.textContent ?? "")
      .filter((text) => text.includes("Bhd"));
    expect(titles[0]).toContain("Zenith Bhd");
    expect(titles.some((text) => text.includes("Acme Bhd"))).toBe(true);
  });

  it("shows the recommended screen as text, never as a link", () => {
    renderArtifacts([dailyBriefArtifact]);
    expect(
      screen.getByText(
        `/customers/${
          dailyBriefArtifact.daily_brief.items[0].entity_refs[0].entity_id
        }`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("report artifact", () => {
  it("renders an accessible table with backend column labels", () => {
    renderArtifacts([reportArtifact]);
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Bucket" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Outstanding" }),
    ).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(6); // header + 5
  });

  it("does not sum or recompute rows", () => {
    renderArtifacts([reportArtifact]);
    const tableText = screen.getByRole("table").textContent ?? "";
    expect(tableText).toContain("10000.00");
    expect(tableText).not.toContain("20000.00");

    const summary = screen.getByRole("heading", { name: "Backend summary" })
      .closest<HTMLElement>("[data-report-summary]")!;
    const reportTotal = within(summary).getByText("Report total");
    expect(reportTotal.parentElement?.querySelector("dd")?.textContent)
      .toBe("20000.00");
  });

  it("renders an actual pie composition rather than bar geometry", () => {
    renderArtifacts([reportArtifact]);
    const figure = screen.getByRole("figure");
    const pie = figure.querySelector('[data-chart-geometry="pie"]');
    expect(pie?.querySelector("svg")).toBeInTheDocument();
    expect(pie?.querySelectorAll("[data-pie-slice]")).toHaveLength(5);
    expect(figure.querySelector('[data-chart-geometry="bar"]')).toBeNull();
    expect(within(figure).getByText("Over 90")).toBeInTheDocument();
    expect(within(figure).getByText("1000.00")).toBeInTheDocument();
    expect(figure.querySelector("script")).toBeNull();
  });

  it("renders every bar series and keeps exact values visible", () => {
    const { container } = renderArtifacts([multiSeriesBarArtifact]);
    const figure = screen.getByRole("figure");
    expect(figure.querySelector('[data-chart-geometry="bar"]'))
      .toBeInTheDocument();
    expect(figure.querySelector('[data-chart-geometry="line"]')).toBeNull();
    expect(figure.querySelectorAll("[data-bar-series]")).toHaveLength(6);
    for (
      const field of ["total_amount", "outstanding_amount", "invoice_count"]
    ) {
      expect(figure.querySelectorAll(`[data-bar-series="${field}"]`))
        .toHaveLength(2);
    }
    for (
      const value of ["12000.00", "10000.00", "2", "7000.00", "6000.00", "1"]
    ) {
      expect(within(figure).getByText(value)).toBeInTheDocument();
    }
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders actual line geometry for every series in backend point order", () => {
    renderArtifacts([collectionLineArtifact]);
    const figure = screen.getByRole("figure");
    const line = figure.querySelector('[data-chart-geometry="line"]');
    expect(line).toBeInTheDocument();
    expect(line?.querySelectorAll("svg")).toHaveLength(2);
    expect(line?.querySelectorAll("[data-line-path]")).toHaveLength(2);
    expect(line?.querySelector('[data-line-series="collection_amount"]'))
      .toBeInTheDocument();
    expect(line?.querySelector('[data-line-series="receipt_count"]'))
      .toBeInTheDocument();
    expect(figure.querySelector('[data-chart-geometry="bar"]')).toBeNull();

    const points = [...figure.querySelectorAll("[data-chart-point]")];
    expect(points.map((point) => point.textContent)).toEqual([
      expect.stringContaining("2026-06"),
      expect.stringContaining("2026-07"),
      expect.stringContaining("2026-08"),
    ]);
    for (const value of ["8000.00", "9000.00", "11000.00", "4", "5", "7"]) {
      expect(within(figure).getByText(value)).toBeInTheDocument();
    }
  });

  it("renders backend summary changes without changing identical rows", () => {
    const changed = {
      ...reportArtifact,
      report: {
        ...reportArtifact.report,
        summary: {
          ...reportArtifact.report.summary,
          report_total: "21000.00",
        },
      },
      chart: null,
    };
    renderArtifacts([changed]);
    const summary = screen.getByRole("heading", { name: "Backend summary" })
      .closest<HTMLElement>("[data-report-summary]")!;
    expect(within(summary).getByText("21000.00")).toBeInTheDocument();
    expect(screen.getByRole("table").textContent).not.toContain("21000.00");
  });

  it("renders no summary when the backend summary is empty", () => {
    renderArtifacts([{
      ...boundedReportArtifact,
      report: { ...boundedReportArtifact.report, summary: {} },
    }]);
    expect(screen.queryByRole("heading", { name: "Backend summary" }))
      .not.toBeInTheDocument();
  });

  it("keeps insufficient coverage visible when backend metadata is present", () => {
    renderArtifacts([{
      ...boundedReportArtifact,
      report: {
        ...boundedReportArtifact.report,
        coverage: {
          status: "insufficient_evidence" as const,
          source_total: null,
          returned_rows: 1,
          top_n_complete: null,
          reason: "The backend cannot prove a complete result.",
        },
      },
    }]);
    expect(screen.getByText("insufficient evidence")).toBeInTheDocument();
    expect(screen.getAllByText(/Insufficient evidence/).length)
      .toBeGreaterThan(0);
    expect(screen.getByText("Matching document count")).toBeInTheDocument();
    expect(screen.queryByText(/Complete result/)).not.toBeInTheDocument();
  });

  it("omits the chart figure when the backend sent none", () => {
    renderArtifacts([boundedReportArtifact]);
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("surfaces chart truncation", () => {
    const truncated = {
      ...reportArtifact,
      chart: {
        ...reportArtifact.chart,
        is_truncated: true,
        displayed_points: 5,
        total_available_points: 31,
      },
    };
    renderArtifacts([truncated]);
    expect(screen.getByText("5 of 31 points")).toBeInTheDocument();
  });
});

describe("authority presentation", () => {
  it("never presents a bounded report as complete", () => {
    renderArtifacts([boundedReportArtifact]);
    // Stated twice on purpose: once visibly, once in the table caption for
    // screen readers. Both must carry the partial wording.
    const stated = screen.getAllByText(
      /Partial result — 1 row shown of 42 matching/,
    );
    expect(stated.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("bounded incomplete")).toBeInTheDocument();
    expect(screen.queryByText(/Complete result/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/intentionally returned a bounded subset/),
    ).toBeInTheDocument();
  });

  it("states coverage before the rows", () => {
    const { container } = renderArtifacts([boundedReportArtifact]);
    const coverage = [...container.querySelectorAll("p")].find((node) =>
      node.textContent?.startsWith("Partial result")
    );
    const tbody = screen.getByRole("table").querySelector("tbody");
    expect(coverage).toBeDefined();
    expect(
      coverage!.compareDocumentPosition(tbody!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps EXTRACTED distinct from MATCHED and from validation status", () => {
    renderArtifacts([documentAnalysisArtifact]);
    expect(screen.getAllByText("EXTRACTED")).toHaveLength(2);
    expect(screen.getByText("MATCHED")).toBeInTheDocument();
    expect(screen.getByText("Validation: validated")).toBeInTheDocument();
    expect(screen.queryByText("AUTHORITATIVE")).not.toBeInTheDocument();
    expect(
      screen.getByText(/not authoritative booked values/),
    ).toBeInTheDocument();
  });

  it("does not display raw provider payload, paths or credentials", () => {
    const { container } = renderArtifacts([documentAnalysisArtifact]);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/attachment_id|oauth|token|\/var\/|C:\\/i);
  });

  it("presents exception recovery as read-only with no executable control", () => {
    const { container } = renderArtifacts([recoveryPlanArtifact]);
    expect(screen.getByText("Read-only analysis")).toBeInTheDocument();
    expect(screen.getByText("Requires human confirmation"))
      .toBeInTheDocument();
    expect(screen.getByText(/cannot retry, allocate, reassign, or send/))
      .toBeInTheDocument();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("presents a candidate as a review step, not a performed action", () => {
    renderArtifacts([recoveryPlanArtifact]);
    expect(
      screen.getByRole("heading", { name: "Suggested review steps" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Review customer match candidates"))
      .toBeInTheDocument();
  });
});

describe("multilingual presentation", () => {
  it("renders non-English labels while leaving identifiers and amounts intact", () => {
    const localized = {
      ...boundedReportArtifact,
      report: {
        ...boundedReportArtifact.report,
        title: "发票摘要",
        description: "已授权的有界结果。",
        columns: [
          { field: "document", label: "单据", format: "text" as const },
          {
            field: "outstanding_amount",
            label: "未结金额",
            format: "currency" as const,
          },
        ],
      },
    };
    renderArtifacts([localized]);
    expect(screen.getByRole("heading", { name: "发票摘要" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "单据" }))
      .toBeInTheDocument();
    // Identifier, currency code and exact amount are never translated.
    expect(screen.getByText("INV-202608-00001")).toBeInTheDocument();
    expect(screen.getByText("9000.00")).toBeInTheDocument();
    expect(screen.getAllByText(/MYR/).length).toBeGreaterThan(0);
  });

  it("renders a Malay recovery explanation unchanged", () => {
    const localized = {
      ...recoveryPlanArtifact,
      recovery_plan: {
        ...recoveryPlanArtifact.recovery_plan,
        explanation: "Bukti aliran kerja melaporkan customer_unresolved.",
      },
    };
    renderArtifacts([localized]);
    expect(
      screen.getByText("Bukti aliran kerja melaporkan customer_unresolved."),
    ).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("gives every artifact a semantic heading and region", () => {
    const { container } = renderArtifacts([
      analysisArtifact,
      dailyBriefArtifact,
      reportArtifact,
      recoveryPlanArtifact,
    ]);
    expect(container.querySelectorAll("section")).toHaveLength(4);
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(4);
  });

  it("gives the report table a caption describing its coverage", () => {
    renderArtifacts([boundedReportArtifact]);
    const caption = screen.getByRole("table").querySelector("caption");
    expect(caption?.textContent).toContain("Invoice Summary");
    expect(caption?.textContent).toContain("Partial result");
  });

  it("carries chart values as text rather than colour alone", () => {
    renderArtifacts([reportArtifact]);
    const figure = screen.getByRole("figure");
    for (const value of ["10000.00", "5000.00", "2500.00", "1500.00"]) {
      expect(within(figure).getByText(value)).toBeInTheDocument();
    }
  });
});

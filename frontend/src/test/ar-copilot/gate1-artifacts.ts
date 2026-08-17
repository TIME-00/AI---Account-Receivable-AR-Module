// ============================================================================
// Gate 1 artifact fixtures.
//
// Every shape here is transcribed from the actual backend emission sites, not
// invented:
//
//   analysis         backend/.../analyst-service.ts  (analysisOutcome)
//   daily_brief      backend/.../analyst-engine.ts   (buildDailyBrief)
//   report + chart   backend/.../analyst-report-service.ts + buildChartSpec
//   document_analysis backend/.../analyst-service.ts (analyzeAutomationDocument)
//   recovery_plan    backend/.../analyst-service.ts  (analyzeExceptionRecovery)
//
// Test-only module: nothing in `src/app` or `src/components` imports it, so it
// never reaches a production bundle.
// ============================================================================

const CUSTOMER_ID = "3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607";
const DOCUMENT_ID = "9c8b7a65-4321-4def-9012-3456789abcde";
const EXCEPTION_ID = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";

export const analysisArtifact = {
  kind: "analysis" as const,
  analysis: {
    analysis_type: "priority" as const,
    as_of: "2026-08-16",
    base_currency: "MYR",
    status: "complete" as const,
    priority_items: [{
      category: "customer_exposure" as const,
      category_rank: 1,
      priority: "high" as const,
      reason_codes: ["OVERDUE_EXPOSURE_CONCENTRATED"],
      entity_type: "customer",
      entity_id: CUSTOMER_ID,
      label: "Zenith Bhd",
      facts: {
        overdue_amount: "20000.00",
        base_currency: "MYR",
        open_invoice_count: 3,
        is_credit_hold: false,
        oldest_due_date: null,
      },
      evidence_type: "AUTHORITATIVE_FACT" as const,
    }],
    factors: [{
      factor_code: "CURRENT_OVERDUE_EXPOSURE_AVAILABLE",
      impact_direction: "increases_attention" as const,
      metric: "overdue_amount",
      current_value: "20000.00",
      comparison_value: null,
      absolute_change: null,
      percentage_change: null,
      period_key: "2026-08",
      comparison_period_key: "2026-07",
      evidence_type: "DETERMINISTIC_DERIVATION" as const,
      entity_refs: [{
        entity_type: "customer",
        entity_id: CUSTOMER_ID,
        label: "Zenith Bhd",
      }],
    }],
    limitations: [
      "Factors describe stored balance and allocation evidence; they do not infer customer intent or payment behavior.",
    ],
  },
};

export const dailyBriefArtifact = {
  kind: "daily_brief" as const,
  daily_brief: {
    as_of: "2026-08-16",
    generation: "on_demand" as const,
    items: [{
      id: `customer:${CUSTOMER_ID}:2026-08-16`,
      type: "overdue_exposure" as const,
      severity: "high" as const,
      title: "Zenith Bhd",
      reason_codes: ["OVERDUE_EXPOSURE_CONCENTRATED"],
      facts: { overdue_amount: "20000.00", base_currency: "MYR" },
      entity_refs: [{
        entity_type: "customer",
        entity_id: CUSTOMER_ID,
        label: "Zenith Bhd",
      }],
      recommended_next_screen: `/customers/${CUSTOMER_ID}`,
      evidence_type: "AUTHORITATIVE_FACT" as const,
    }],
  },
};

/** A complete, chartable aging report — the canonical five-bucket partition. */
export const reportArtifact = {
  kind: "report" as const,
  report: {
    report_type: "aging" as const,
    title: "Aging by bucket",
    description: "Complete authorized aging partition.",
    as_of: "2026-08-16",
    base_currency: "MYR",
    columns: [
      { field: "aging_bucket", label: "Bucket", format: "text" as const },
      {
        field: "outstanding_amount",
        label: "Outstanding",
        format: "currency" as const,
      },
    ],
    rows: [
      { aging_bucket: "Current", outstanding_amount: "10000.00" },
      { aging_bucket: "1-30", outstanding_amount: "5000.00" },
      { aging_bucket: "31-60", outstanding_amount: "2500.00" },
      { aging_bucket: "61-90", outstanding_amount: "1500.00" },
      { aging_bucket: "Over 90", outstanding_amount: "1000.00" },
    ],
    summary: {
      row_count: 5,
      report_total: "20000.00",
      canonical_partition_complete: true,
      partition_total: "20000.00",
    },
    coverage: {
      status: "complete" as const,
      source_total: 5,
      returned_rows: 5,
      top_n_complete: null,
      reason: null,
    },
    authority: "authoritative_rows" as const,
  },
  chart: {
    chart_type: "pie" as const,
    title: "Aging by bucket",
    x_field: "aging_bucket",
    series: [{
      field: "outstanding_amount",
      label: "Outstanding",
      format: "currency" as const,
    }],
    data: [
      { aging_bucket: "Current", outstanding_amount: "10000.00" },
      { aging_bucket: "1-30", outstanding_amount: "5000.00" },
      { aging_bucket: "31-60", outstanding_amount: "2500.00" },
      { aging_bucket: "61-90", outstanding_amount: "1500.00" },
      { aging_bucket: "Over 90", outstanding_amount: "1000.00" },
    ],
    is_truncated: false,
    displayed_points: 5,
    total_available_points: 5,
  },
};

/** A bounded document report with no chart — the truncation-sensitive case. */
export const boundedReportArtifact = {
  kind: "report" as const,
  report: {
    report_type: "invoice_summary" as const,
    title: "Invoice Summary",
    description:
      "Authoritative rows from a bounded result; the complete matching set is larger.",
    as_of: "2026-08-16",
    base_currency: "MYR",
    columns: [
      { field: "document", label: "Document", format: "text" as const },
      {
        field: "outstanding_amount",
        label: "Outstanding",
        format: "currency" as const,
      },
    ],
    rows: [{ document: "INV-202608-00001", outstanding_amount: "9000.00" }],
    summary: {
      row_count: 1,
      matching_document_count: 42,
      transaction_currency: "MYR",
      multi_currency: false,
      sort_applied_before_limit: true,
    },
    coverage: {
      status: "bounded_incomplete" as const,
      source_total: 42,
      returned_rows: 1,
      top_n_complete: true,
      reason:
        "The request intentionally returned a bounded subset of the matching documents.",
    },
    authority: "authoritative_rows" as const,
  },
  chart: null,
};

export const documentAnalysisArtifact = {
  kind: "document_analysis" as const,
  document_analysis: {
    document_id: DOCUMENT_ID,
    document_type: "invoice",
    classification_status: "classified",
    classification_confidence: "0.94",
    critical_field_confidence: "0.88",
    processing_time: "2026-08-16T02:15:00.000Z",
    extraction: {
      validation_status: "validated",
      validation_codes: ["ARITHMETIC_OK"],
      fields: [
        {
          field: "invoice_no",
          value: "INV-202608-00001",
          provenance: "EXTRACTED" as const,
        },
        {
          field: "total_amount",
          value: "9000.00",
          provenance: "EXTRACTED" as const,
        },
      ],
      customer_match: {
        matched: true,
        customer_id: CUSTOMER_ID,
        method: "exact_name",
        provenance: "MATCHED" as const,
      },
      validated_at: "2026-08-16T02:16:00.000Z",
    },
    provenance_note:
      "Extracted candidates are not authoritative booked values; validation and linked AR records retain their own authority.",
  },
};

export const recoveryPlanArtifact = {
  kind: "recovery_plan" as const,
  recovery_plan: {
    exception_id: EXCEPTION_ID,
    reason_code: "customer_unresolved",
    lifecycle_status: "open",
    explanation:
      "Stored workflow evidence reports customer_unresolved. Review the bounded evidence before using an existing governed recovery screen.",
    candidate_resolutions: [{
      resolution_type: "review_customer_match",
      label: "Review customer match candidates",
      supporting_evidence: ["customer_unresolved", "open"],
      requires_human_confirmation: true as const,
    }],
    read_only: true as const,
    executable: false as const,
  },
};

/** A Copilot v2 response: no `artifacts` key at all. */
export const v2Response = {
  answer: "Allocation matches a Receipt to one or more Invoices.",
  evidence: [{
    kind: "system_guide",
    id: "receipt-allocation",
    label: "Receipt allocation",
    number: null,
  }],
  links: [],
  status: {
    request_id: "req-1",
    provider: "openai",
    model: "test-model",
    tool_names: [],
    tool_call_count: 0,
  },
};

export function gate1Response(artifacts: unknown[]) {
  return {
    ...v2Response,
    answer: "Here are the authorized results.",
    evidence: [],
    artifacts,
  };
}

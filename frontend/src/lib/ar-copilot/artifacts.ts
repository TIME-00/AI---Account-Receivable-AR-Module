// ============================================================================
// AR Copilot — Gate 1 analytical artifact contract (frontend).
//
// Mirrors the reviewed backend contract EXACTLY:
//   backend/supabase/functions/ar-copilot/contract.ts        (CopilotArtifact)
//   backend/supabase/functions/ar-copilot/analyst-contract.ts (DTOs + bounds)
//   backend/supabase/functions/ar-copilot/analyst-service.ts  (emission sites)
//
// Design rules this module exists to hold:
//
//   1. STRICT, FAIL-CLOSED. Every object is `.strict()`. An unknown artifact
//      kind, an unknown nested field, a malformed value, or a missing required
//      field rejects the WHOLE response. There is no passthrough, no
//      `z.unknown()`, no `z.any()`, and no unrestricted object anywhere.
//   2. NO RENDERER INSTRUCTIONS. The backend never sends markup, component
//      names, formatter code, callbacks, or URLs inside an artifact. This
//      schema has no field that could carry one, so a renderer cannot be
//      steered by model output.
//   3. BOUNDED. Array and key-count limits mirror the backend ANALYST_MAX_*
//      constants, so a hostile or buggy payload cannot produce unbounded DOM.
//
// Shared bounds, vocabularies and scalar primitives live in
// `artifact-primitives.ts` — one contract, two files, only because Copilot
// modules are held under 400 lines.
// ============================================================================

import { z } from "zod";
import {
  ANALYSIS_EVIDENCE_TYPES,
  ANALYSIS_TYPES,
  ANALYST_MAX_CHART_POINTS,
  ANALYST_MAX_DAILY_BRIEF_ITEMS,
  ANALYST_MAX_DOCUMENT_FIELDS,
  ANALYST_MAX_PRIORITY_ITEMS,
  ANALYST_MAX_RECOVERY_CANDIDATES,
  ANALYST_MAX_REPORT_ROWS,
  boundedScalarRecord,
  CHART_TYPES,
  codeText,
  COLUMN_FORMATS,
  COPILOT_MAX_ARTIFACTS,
  COVERAGE_STATUSES,
  currencyCode,
  entityRefSchema,
  internalScreenPath,
  isoDate,
  longText,
  MAX_CHART_SERIES,
  MAX_ENTITY_REFS,
  MAX_FACTORS,
  MAX_LIMITATIONS,
  MAX_REASON_CODES,
  MAX_REPORT_COLUMNS,
  MAX_SUPPORTING_EVIDENCE,
  MAX_VALIDATION_CODES,
  NON_HEURISTIC_EVIDENCE_TYPES,
  REPORT_TYPES,
  rowCellValue,
  scalarValue,
  SERIES_FORMATS,
  shortText,
  timestampText,
} from "./artifact-primitives";

export * from "./artifact-primitives";

// ─── analysis ───────────────────────────────────────────────────────────────

const analysisFactorSchema = z.object({
  factor_code: codeText,
  impact_direction: z.enum([
    "increases_attention",
    "reduces_attention",
    "neutral",
  ]),
  metric: codeText,
  current_value: z.union([z.string().max(120), z.number().finite(), z.null()]),
  comparison_value: z.union([
    z.string().max(120),
    z.number().finite(),
    z.null(),
  ]),
  absolute_change: z.string().max(120).nullable(),
  percentage_change: z.string().max(120).nullable(),
  period_key: z.string().max(20).nullable().optional(),
  comparison_period_key: z.string().max(20).nullable().optional(),
  evidence_type: z.enum(ANALYSIS_EVIDENCE_TYPES),
  entity_refs: z.array(entityRefSchema).max(MAX_ENTITY_REFS),
}).strict();

const priorityItemSchema = z.object({
  category: z.enum([
    "customer_exposure",
    "cash_application",
    "workflow_exception",
  ]),
  category_rank: z.number().int().min(0).max(1_000),
  priority: z.enum(["high", "attention", "info"]),
  reason_codes: z.array(codeText).max(MAX_REASON_CODES),
  entity_type: codeText,
  entity_id: codeText,
  label: shortText,
  facts: boundedScalarRecord(scalarValue),
  evidence_type: z.enum(NON_HEURISTIC_EVIDENCE_TYPES),
}).strict();

export const analysisPayloadSchema = z.object({
  analysis_type: z.enum(ANALYSIS_TYPES),
  as_of: isoDate,
  base_currency: currencyCode,
  status: z.enum(["complete", "insufficient_evidence"]),
  priority_items: z.array(priorityItemSchema).max(ANALYST_MAX_PRIORITY_ITEMS),
  factors: z.array(analysisFactorSchema).max(MAX_FACTORS),
  limitations: z.array(longText).max(MAX_LIMITATIONS),
}).strict();

// ─── daily_brief ────────────────────────────────────────────────────────────

const proactiveInsightSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(["overdue_exposure", "unapplied_cash", "automation_exception"]),
  severity: z.enum(["info", "attention", "high"]),
  title: shortText,
  reason_codes: z.array(codeText).max(MAX_REASON_CODES),
  facts: boundedScalarRecord(scalarValue),
  entity_refs: z.array(entityRefSchema).max(MAX_ENTITY_REFS),
  recommended_next_screen: internalScreenPath,
  evidence_type: z.enum(NON_HEURISTIC_EVIDENCE_TYPES),
}).strict();

export const dailyBriefPayloadSchema = z.object({
  as_of: isoDate,
  generation: z.literal("on_demand"),
  items: z.array(proactiveInsightSchema).max(ANALYST_MAX_DAILY_BRIEF_ITEMS),
}).strict();

// ─── report + chart ─────────────────────────────────────────────────────────

const reportColumnSchema = z.object({
  field: codeText,
  label: shortText,
  format: z.enum(COLUMN_FORMATS),
}).strict();

export const reportCoverageSchema = z.object({
  status: z.enum(COVERAGE_STATUSES),
  source_total: z.number().int().min(0).nullable(),
  returned_rows: z.number().int().min(0),
  top_n_complete: z.boolean().nullable(),
  reason: longText.nullable(),
}).strict();

export const reportPayloadSchema = z.object({
  report_type: z.enum(REPORT_TYPES),
  title: shortText,
  description: longText,
  as_of: isoDate,
  base_currency: currencyCode,
  columns: z.array(reportColumnSchema).max(MAX_REPORT_COLUMNS),
  rows: z.array(boundedScalarRecord(rowCellValue)).max(ANALYST_MAX_REPORT_ROWS),
  summary: boundedScalarRecord(scalarValue),
  coverage: reportCoverageSchema,
  /** The backend emits exactly one authority level for report rows. */
  authority: z.literal("authoritative_rows"),
}).strict();

const chartSeriesSchema = z.object({
  field: codeText,
  label: shortText,
  format: z.enum(SERIES_FORMATS),
}).strict();

export const chartPayloadSchema = z.object({
  chart_type: z.enum(CHART_TYPES),
  title: shortText,
  x_field: codeText,
  series: z.array(chartSeriesSchema).min(1).max(MAX_CHART_SERIES),
  data: z.array(boundedScalarRecord(rowCellValue)).max(
    ANALYST_MAX_CHART_POINTS,
  ),
  is_truncated: z.boolean(),
  displayed_points: z.number().int().min(0).max(ANALYST_MAX_CHART_POINTS),
  total_available_points: z.number().int().min(0),
}).strict().superRefine((chart, context) => {
  if (chart.chart_type === "pie" && chart.series.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["series"],
      message: "A pie chart requires exactly one backend series.",
    });
  }
});

// ─── document_analysis ──────────────────────────────────────────────────────

/** Extraction candidates are labelled EXTRACTED and are never authoritative. */
const documentFieldSchema = z.object({
  field: codeText,
  value: z.string().max(200).nullable(),
  provenance: z.literal("EXTRACTED"),
}).strict();

const customerMatchSchema = z.object({
  matched: z.boolean(),
  customer_id: codeText.nullable(),
  method: codeText.nullable(),
  provenance: z.literal("MATCHED"),
}).strict();

const documentExtractionSchema = z.object({
  validation_status: codeText,
  validation_codes: z.array(codeText).max(MAX_VALIDATION_CODES),
  fields: z.array(documentFieldSchema).max(ANALYST_MAX_DOCUMENT_FIELDS),
  customer_match: customerMatchSchema,
  validated_at: timestampText,
}).strict();

export const documentAnalysisPayloadSchema = z.object({
  document_id: codeText,
  document_type: codeText.nullable(),
  classification_status: codeText.nullable(),
  classification_confidence: codeText.nullable(),
  critical_field_confidence: codeText.nullable(),
  processing_time: timestampText,
  extraction: documentExtractionSchema.nullable(),
  provenance_note: longText,
}).strict();

// ─── recovery_plan ──────────────────────────────────────────────────────────

const recoveryCandidateSchema = z.object({
  resolution_type: codeText,
  label: shortText,
  supporting_evidence: z.array(codeText).max(MAX_SUPPORTING_EVIDENCE),
  /** Gate 1 emits this as a constant; a `false` here would be off-contract. */
  requires_human_confirmation: z.literal(true),
}).strict();

export const recoveryPlanPayloadSchema = z.object({
  exception_id: codeText,
  reason_code: codeText,
  lifecycle_status: codeText,
  explanation: longText,
  candidate_resolutions: z.array(recoveryCandidateSchema).max(
    ANALYST_MAX_RECOVERY_CANDIDATES,
  ),
  /** Gate 1 recovery analysis is advisory. Both literals are load-bearing. */
  read_only: z.literal(true),
  executable: z.literal(false),
}).strict();

// ─── Discriminated union ────────────────────────────────────────────────────

export const copilotArtifactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("analysis"), analysis: analysisPayloadSchema })
    .strict(),
  z.object({
    kind: z.literal("daily_brief"),
    daily_brief: dailyBriefPayloadSchema,
  }).strict(),
  z.object({
    kind: z.literal("report"),
    report: reportPayloadSchema,
    chart: chartPayloadSchema.nullable(),
  }).strict(),
  z.object({
    kind: z.literal("document_analysis"),
    document_analysis: documentAnalysisPayloadSchema,
  }).strict(),
  z.object({
    kind: z.literal("recovery_plan"),
    recovery_plan: recoveryPlanPayloadSchema,
  }).strict(),
]);

export const copilotArtifactsSchema = z.array(copilotArtifactSchema).max(
  COPILOT_MAX_ARTIFACTS,
);

export type CopilotAnalysisPayload = z.infer<typeof analysisPayloadSchema>;
export type CopilotDailyBriefPayload = z.infer<typeof dailyBriefPayloadSchema>;
export type CopilotReportPayload = z.infer<typeof reportPayloadSchema>;
export type CopilotReportCoverage = z.infer<typeof reportCoverageSchema>;
export type CopilotChartPayload = z.infer<typeof chartPayloadSchema>;
export type CopilotDocumentAnalysisPayload = z.infer<
  typeof documentAnalysisPayloadSchema
>;
export type CopilotRecoveryPlanPayload = z.infer<
  typeof recoveryPlanPayloadSchema
>;
export type CopilotArtifact = z.infer<typeof copilotArtifactSchema>;

// ─── Presentation helpers (no recomputation of authoritative values) ────────

/**
 * Human-readable coverage wording.
 *
 * A bounded result is never described as complete, and an insufficient result
 * is never described as a finding. Nothing is derived here; this only restates
 * what `coverage` already says.
 */
export function coverageSummary(coverage: CopilotReportCoverage): string {
  const shown = `${coverage.returned_rows} row${
    coverage.returned_rows === 1 ? "" : "s"
  } shown`;
  if (coverage.status === "complete") return `Complete result — ${shown}.`;
  if (coverage.status === "insufficient_evidence") {
    return `Insufficient evidence — ${shown}.`;
  }
  const total = coverage.source_total === null
    ? "a larger matching set"
    : `${coverage.source_total} matching`;
  const ranked = coverage.top_n_complete === true
    ? " The ranking within this subset is authoritative."
    : "";
  return `Partial result — ${shown} of ${total}.${ranked}`;
}

/** Cell text. Values are already exact strings from the backend; no rounding. */
export function cellText(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Turn a snake_case backend key into a readable label without translating it. */
export function humanizeKey(key: string): string {
  return key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

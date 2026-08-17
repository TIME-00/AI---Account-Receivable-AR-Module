// ============================================================================
// AR Copilot — Gate 1 artifact primitives.
//
// Bounds, closed vocabularies and the scalar building blocks shared by every
// artifact schema. Split out of `artifacts.ts` only to keep each Copilot
// module inside the repository's 400-line budget; the contract is one unit.
//
// Mirrors backend/supabase/functions/ar-copilot/analyst-contract.ts.
// ============================================================================

import { z } from "zod";

// ─── Bounds (mirror analyst-contract.ts ANALYST_MAX_*) ──────────────────────

export const ANALYST_MAX_PRIORITY_ITEMS = 10;
export const ANALYST_MAX_REPORT_ROWS = 50;
export const ANALYST_MAX_CHART_POINTS = 20;
export const ANALYST_MAX_DAILY_BRIEF_ITEMS = 8;
export const ANALYST_MAX_DOCUMENT_FIELDS = 10;
export const ANALYST_MAX_RECOVERY_CANDIDATES = 4;

/** `uniqueArtifacts()` in ar-copilot/service.ts caps the response at four. */
export const COPILOT_MAX_ARTIFACTS = 4;

/** Frontend defensive bounds for backend arrays with no explicit server cap. */
export const MAX_FACTORS = 24;
export const MAX_REASON_CODES = 12;
export const MAX_ENTITY_REFS = 10;
export const MAX_LIMITATIONS = 8;
export const MAX_REPORT_COLUMNS = 12;
/** Report plans accept at most three metrics, so no reachable chart has more. */
export const MAX_CHART_SERIES = 3;
export const MAX_VALIDATION_CODES = 12;
export const MAX_SUPPORTING_EVIDENCE = 6;
const MAX_SCALAR_RECORD_KEYS = 24;

// ─── Closed vocabularies ────────────────────────────────────────────────────

export const ANALYSIS_TYPES = [
  "priority",
  "customer_risk",
  "collection_health",
  "exposure_movement",
  "unapplied_cash",
  "root_cause",
] as const;

export const ANALYSIS_EVIDENCE_TYPES = [
  "AUTHORITATIVE_FACT",
  "DETERMINISTIC_DERIVATION",
  "DIRECT_WORKFLOW_EVIDENCE",
  "HEURISTIC_OBSERVATION",
] as const;

/** Priority items and proactive insights never carry the heuristic tier. */
export const NON_HEURISTIC_EVIDENCE_TYPES = [
  "AUTHORITATIVE_FACT",
  "DETERMINISTIC_DERIVATION",
  "DIRECT_WORKFLOW_EVIDENCE",
] as const;

export const REPORT_TYPES = [
  "aging",
  "invoice_summary",
  "receipt_summary",
  "customer_outstanding",
  "collections",
  "overdue_exposure",
] as const;

/** The complete allow-list of chart types the reviewed contract can emit. */
export const CHART_TYPES = ["bar", "line", "pie"] as const;

export const COVERAGE_STATUSES = [
  "complete",
  "bounded_incomplete",
  "insufficient_evidence",
] as const;

export const COLUMN_FORMATS = ["text", "currency", "number", "date"] as const;
export const SERIES_FORMATS = ["currency", "number", "percent"] as const;

export type AnalysisType = (typeof ANALYSIS_TYPES)[number];
export type AnalysisEvidenceType = (typeof ANALYSIS_EVIDENCE_TYPES)[number];
export type AnalystReportType = (typeof REPORT_TYPES)[number];
export type CopilotChartType = (typeof CHART_TYPES)[number];
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

// ─── Primitive building blocks ──────────────────────────────────────────────

export const shortText = z.string().min(1).max(200);
export const codeText = z.string().min(1).max(120);
export const longText = z.string().min(1).max(600);

/** ISO calendar date, as every `as_of` on the wire is produced. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Timestamps arrive as free-form ISO strings from stored rows. */
export const timestampText = z.string().min(1).max(60).nullable();

/** ISO-4217 shape. The backend restricts the actual set server-side. */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/).nullable();

/**
 * A dictionary value. Scalar only — no nested object or array can appear in an
 * open-keyed dictionary, so no artifact payload can smuggle structure past the
 * renderer.
 */
export const scalarValue = z.union([
  z.string().max(300),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/** Report and chart row cells never carry booleans in the backend DTOs. */
export const rowCellValue = z.union([
  z.string().max(300),
  z.number().finite(),
  z.null(),
]);

const SCALAR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,58}$/;

/**
 * A bounded open-keyed scalar dictionary.
 *
 * The backend genuinely types `facts`, report `summary` and row cells as
 * `Record<string, scalar>`, so strictness here is by VALUE TYPE, KEY SHAPE and
 * KEY COUNT rather than by an invented key list. Anything non-scalar, an
 * oversized key set, or a key that is not snake_case rejects the response.
 */
export function boundedScalarRecord(
  value: z.ZodTypeAny,
  maxKeys = MAX_SCALAR_RECORD_KEYS,
) {
  return z.record(z.string(), value).refine(
    (record) => {
      const keys = Object.keys(record);
      return keys.length <= maxKeys &&
        keys.every((key) => SCALAR_KEY_PATTERN.test(key));
    },
    { message: "Unsupported dictionary key set." },
  );
}

export const entityRefSchema = z.object({
  entity_type: codeText,
  entity_id: codeText,
  label: shortText,
}).strict();

/**
 * A deterministic in-app destination the backend recommends (for example
 * `/allocations`). Validated as an internal path and rendered as TEXT, never
 * as an href: `lib/ar-copilot/links.ts` remains the only navigation authority
 * in this feature.
 */
export const internalScreenPath = z.string().regex(
  /^\/[A-Za-z0-9/_-]{0,120}$/,
);

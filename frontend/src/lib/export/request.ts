// ============================================================================
// TSH Synergy AR — Gate C report export: request building + envelope mapping
//
// Pure, framework-free helpers. The request only ever carries the report's own
// authoritative filters and sort — never pagination, never company_id/user_id,
// never a client-computed total.
// ============================================================================

import {
  type ExportDataset,
  type ExportOversizeDetails,
  type ExportReportType,
} from "./types";
import { parseExportDataset } from "./parse";
import {
  ExportAuthorizationError,
  ExportNetworkError,
  ExportOversizeError,
  ExportValidationError,
} from "./errors";

export const EXPORT_PATHS: Record<ExportReportType, string> = {
  aging: "/reports/export/aging",
  invoices: "/reports/export/invoices",
  receipts: "/reports/export/receipts",
  "customer-outstanding": "/reports/export/customer-outstanding",
};

/** Exactly the query keys each export route accepts (mirrors backend QUERY_SPECS). */
const ALLOWED_PARAMS: Record<ExportReportType, readonly string[]> = {
  aging: ["as_of_date", "search", "sort", "order"],
  invoices: [
    "date_from",
    "date_to",
    "status",
    "doc_type",
    "currency",
    "search",
    "sort",
    "order",
  ],
  receipts: [
    "date_from",
    "date_to",
    "status",
    "payment_method",
    "currency",
    "search",
    "sort",
    "order",
  ],
  "customer-outstanding": [
    "as_of_date",
    "credit_rating",
    "customer_status",
    "search",
    "sort",
    "order",
  ],
};

/** Keys that must NEVER be forwarded to an export route, regardless of input. */
const FORBIDDEN_PARAMS = new Set([
  "page",
  "page_size",
  "cursor",
  "company_id",
  "user_id",
]);

export interface ExportRequest {
  path: string;
  params: Record<string, string>;
}

/**
 * Build the export request for `type` from a page's current filters. Only keys
 * the route accepts survive; empty values, pagination, identity and any
 * total-bearing key are dropped by construction.
 */
export function buildExportRequest(
  type: ExportReportType,
  filters: Record<string, string | undefined>,
): ExportRequest {
  const allowed = ALLOWED_PARAMS[type];
  const params: Record<string, string> = {};
  for (const key of allowed) {
    if (FORBIDDEN_PARAMS.has(key) || key.includes("total")) continue;
    const value = filters[key];
    if (typeof value === "string" && value.trim().length > 0) {
      params[key] = value.trim();
    }
  }
  return { path: EXPORT_PATHS[type], params };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOversizeDetails(raw: unknown): ExportOversizeDetails | undefined {
  if (!isObject(raw)) return undefined;
  const { row_limit, payload_limit_bytes, estimated_rows } = raw;
  if (
    row_limit === 5000 &&
    payload_limit_bytes === 8388608 &&
    typeof estimated_rows === "number" &&
    Number.isSafeInteger(estimated_rows) &&
    estimated_rows >= 0
  ) {
    return { row_limit, payload_limit_bytes, estimated_rows };
  }
  return undefined;
}

/**
 * Map an export HTTP response (status + decoded JSON body) to a validated
 * dataset, or throw the matching typed error. The response uses the backend's
 * export envelope: `{ data }` on success, `{ error }` on failure.
 */
export function mapExportResponse(
  type: ExportReportType,
  status: number,
  body: unknown,
): ExportDataset {
  const errorEnvelope = isObject(body) && isObject(body.error) ? body.error : undefined;
  const code = typeof errorEnvelope?.code === "string" ? errorEnvelope.code : undefined;

  if (status === 200) {
    if (!isObject(body) || !("data" in body)) {
      throw new ExportValidationError("The export response was not understood.");
    }
    return parseExportDataset(type, body.data);
  }

  if (status === 422 && code === "EXPORT_DATASET_TOO_LARGE") {
    throw new ExportOversizeError(
      "This report is too large to export. Narrow the filters (e.g. a shorter date range) and try again.",
      readOversizeDetails(errorEnvelope?.details),
    );
  }

  if (status === 401 || status === 403) {
    throw new ExportAuthorizationError();
  }

  if (status === 400 || status === 422) {
    throw new ExportValidationError();
  }

  throw new ExportNetworkError();
}

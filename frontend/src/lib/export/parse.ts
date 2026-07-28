// ============================================================================
// TSH Synergy AR — Gate C report export: strict fail-closed parser
//
// Mirrors the backend export contract exactly. Any structural or type
// deviation throws ExportParseError so the UI surfaces a controlled error
// rather than rendering fabricated or partial data. No monetary value is ever
// recomputed; decimal strings pass through verbatim.
// ============================================================================

import {
  type ExportBreakdownRow,
  type ExportCurrencyTotal,
  type ExportDataset,
  EXPORT_REPORT_TYPES,
  type ExportReportType,
  type ExportSummary,
} from "./types";
import { type FieldSpec, REPORT_SPECS } from "./schema";

export class ExportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportParseError";
  }
}

const MONEY_RE = /^-?\d+\.\d{2}$/;
const RATE_RE = /^-?\d+(?:\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
// PostgreSQL's uuid type accepts the canonical 8-4-4-4-12 hexadecimal shape
// without requiring RFC version/variant bits. Fixed tenant identifiers (for
// example the P1 demo company) are valid database UUIDs even when those bits
// are zero, so the export parser must mirror PostgreSQL rather than narrowing
// the backend contract to generated RFC UUIDs.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new ExportParseError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reqString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`Export field "${field}" must be a non-empty string.`);
  }
  return value;
}

function reqInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`Export field "${field}" must be a non-negative integer.`);
  }
  return value;
}

function reqMoney(value: unknown, field: string): string {
  const text = reqString(value, field);
  if (!MONEY_RE.test(text)) fail(`Export money field "${field}" is malformed.`);
  return text;
}

function reqCurrency(value: unknown, field: string): string {
  const text = reqString(value, field);
  if (!CURRENCY_RE.test(text)) {
    fail(`Export currency field "${field}" is malformed.`);
  }
  return text;
}

function reqId(value: unknown, field: string): string {
  const text = reqString(value, field);
  if (!UUID_RE.test(text)) fail(`Export id field "${field}" is malformed.`);
  return text;
}

function reqDate(value: unknown, field: string): string {
  const text = reqString(value, field);
  if (!DATE_RE.test(text)) fail(`Export date field "${field}" is malformed.`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    fail(`Export date field "${field}" is malformed.`);
  }
  return text;
}

function assertExactKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const actual = Object.keys(raw);
  const allowedSet = new Set(allowed);
  if (actual.some((key) => !allowedSet.has(key))) {
    fail(`Export field "${field}" contains an unsupported member.`);
  }
  if (allowed.some((key) => !(key in raw))) {
    fail(`Export field "${field}" is missing a required member.`);
  }
}

/** Validate one row field per its spec; returns the validated value (string | null). */
function parseField(spec: FieldSpec, raw: Record<string, unknown>): string | null {
  const value = raw[spec.key];
  switch (spec.kind) {
    case "id": {
      return reqId(value, spec.key);
    }
    case "text":
      return reqString(value, spec.key);
    case "text_null":
      if (value === null) return null;
      return reqString(value, spec.key);
    case "enum": {
      const text = reqString(value, spec.key);
      if (!spec.enumValues?.includes(text)) {
        fail(`Export enum field "${spec.key}" has an unsupported value.`);
      }
      return text;
    }
    case "enum_null": {
      if (value === null) return null;
      const text = reqString(value, spec.key);
      if (!spec.enumValues?.includes(text)) {
        fail(`Export enum field "${spec.key}" has an unsupported value.`);
      }
      return text;
    }
    case "currency":
      return reqCurrency(value, spec.key);
    case "date": {
      return reqDate(value, spec.key);
    }
    case "date_null": {
      if (value === null) return null;
      return reqDate(value, spec.key);
    }
    case "money":
      return reqMoney(value, spec.key);
    case "rate": {
      const text = reqString(value, spec.key);
      if (!RATE_RE.test(text)) fail(`Export rate field "${spec.key}" is malformed.`);
      return text;
    }
  }
}

function parseCurrencyTotals(value: unknown): ExportCurrencyTotal[] {
  if (!Array.isArray(value)) fail("Export summary native_by_currency must be an array.");
  return value.map((raw, index) => {
    if (!isObject(raw)) fail(`native_by_currency[${index}] must be an object.`);
    assertExactKeys(
      raw,
      ["currency", "row_count", "native_total", "base_total"],
      `native_by_currency[${index}]`,
    );
    return {
      currency: reqCurrency(raw.currency, `native_by_currency[${index}].currency`),
      row_count: reqInt(raw.row_count, `native_by_currency[${index}].row_count`),
      native_total: reqMoney(raw.native_total, `native_by_currency[${index}].native_total`),
      base_total: reqMoney(raw.base_total, `native_by_currency[${index}].base_total`),
    };
  });
}

function parseBreakdown(
  value: unknown,
  dimension: string,
  enumValues: readonly string[],
  totalKeys: string[],
  sourceKey: string,
): ExportBreakdownRow[] {
  if (!Array.isArray(value)) fail(`Export summary ${sourceKey} must be an array.`);
  return value.map((raw, index) => {
    if (!isObject(raw)) fail(`${sourceKey}[${index}] must be an object.`);
    assertExactKeys(
      raw,
      [dimension, "count", ...totalKeys],
      `${sourceKey}[${index}]`,
    );
    const dimensionValue = reqString(raw[dimension], `${sourceKey}[${index}].${dimension}`);
    if (!enumValues.includes(dimensionValue)) {
      fail(`${sourceKey}[${index}].${dimension} has an unsupported value.`);
    }
    const totals: Record<string, string> = {};
    for (const key of totalKeys) {
      totals[key] = reqMoney(raw[key], `${sourceKey}[${index}].${key}`);
    }
    return {
      key: dimensionValue,
      count: reqInt(raw.count, `${sourceKey}[${index}].count`),
      totals,
    };
  });
}

function parseSummary(
  raw: unknown,
  type: ExportReportType,
  baseCurrency: string,
): ExportSummary {
  if (!isObject(raw)) fail("Export summary must be an object.");
  const spec = REPORT_SPECS[type];
  assertExactKeys(
    raw,
    [
      "base_currency",
      ...spec.summaryCounts.map((field) => field.key),
      ...spec.summaryTotals.map((field) => field.key),
      "native_by_currency",
      ...spec.breakdowns.map((breakdown) => breakdown.sourceKey),
    ],
    "summary",
  );

  const summaryBase = reqCurrency(raw.base_currency, "summary.base_currency");
  if (summaryBase !== baseCurrency) {
    fail("Export summary base currency does not match the company.");
  }

  const counts: Record<string, number> = {};
  for (const c of spec.summaryCounts) {
    counts[c.key] = reqInt(raw[c.key], `summary.${c.key}`);
  }

  const totals: Record<string, string> = {};
  for (const t of spec.summaryTotals) {
    totals[t.key] = reqMoney(raw[t.key], `summary.${t.key}`);
  }

  const breakdowns: Record<string, ExportBreakdownRow[]> = {};
  for (const b of spec.breakdowns) {
    breakdowns[b.sourceKey] = parseBreakdown(
      raw[b.sourceKey],
      b.dimension,
      b.enumValues,
      b.totals.map((t) => t.key),
      b.sourceKey,
    );
  }

  return {
    base_currency: summaryBase,
    counts,
    totals,
    native_by_currency: parseCurrencyTotals(raw.native_by_currency),
    breakdowns,
  };
}

/**
 * Parse and validate the raw export response body for `type`. `raw` is the full
 * decoded JSON body of a successful export response (the `{ data: … }` envelope
 * already unwrapped to its `data` object by the caller).
 */
export function parseExportDataset(
  type: ExportReportType,
  data: unknown,
): ExportDataset {
  if (!EXPORT_REPORT_TYPES.includes(type)) fail("Unknown export report type.");
  if (!isObject(data)) fail("Export payload is not an object.");
  assertExactKeys(
    data,
    [
      "schema_version",
      "report_type",
      "generated_at",
      "company",
      "filters",
      "sort",
      "row_count",
      "summary",
      "rows",
    ],
    "payload",
  );

  if (data.schema_version !== 1) fail("Unsupported export schema version.");
  if (data.report_type !== type) fail("Export report type mismatch.");

  const generatedAt = reqString(data.generated_at, "generated_at");
  const parsedTime = new Date(generatedAt);
  if (Number.isNaN(parsedTime.getTime()) || parsedTime.toISOString() !== generatedAt) {
    fail("Export generated_at is not a valid ISO-8601 UTC timestamp.");
  }

  const companyRaw = data.company;
  if (!isObject(companyRaw)) fail("Export company metadata is malformed.");
  assertExactKeys(companyRaw, ["id", "name", "base_currency", "timezone"], "company");
  const timezone = reqString(companyRaw.timezone, "company.timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    fail("Export company timezone is invalid.");
  }
  const company = {
    id: reqId(companyRaw.id, "company.id"),
    name: reqString(companyRaw.name, "company.name"),
    base_currency: reqCurrency(companyRaw.base_currency, "company.base_currency"),
    timezone,
  };

  const spec = REPORT_SPECS[type];
  const filtersRaw = data.filters;
  if (!isObject(filtersRaw)) fail("Export filters must be an object.");
  const filters: Record<string, string> = {};
  for (const key of Object.keys(filtersRaw)) {
    const filterSpec = spec.filterFields[key];
    if (!filterSpec) fail(`Export filter "${key}" is unsupported.`);
    const parsed = parseField(filterSpec, filtersRaw);
    if (parsed === null) fail(`Export filter "${key}" cannot be null.`);
    if (key === "search" && (parsed !== parsed.trim() || parsed.length > 200)) {
      fail("Export search filter is not normalized.");
    }
    filters[key] = parsed;
  }
  for (const required of spec.requiredFilters) {
    if (!(required in filters)) fail(`Export filter "${required}" is required.`);
  }
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) {
    fail("Export date range is invalid.");
  }

  const sortRaw = data.sort;
  if (!isObject(sortRaw)) fail("Export sort must be an object.");
  assertExactKeys(sortRaw, ["field", "order"], "sort");
  const sortField = reqString(sortRaw.field, "sort.field");
  if (!spec.sortFields.includes(sortField)) {
    fail("Export sort field is unsupported.");
  }
  const sortOrder = sortRaw.order;
  if (sortOrder !== "asc" && sortOrder !== "desc") {
    fail("Export sort order must be asc or desc.");
  }

  if (!Array.isArray(data.rows)) fail("Export rows must be an array.");
  const rowIds = new Set<string>();
  const rows = data.rows.map((raw, index) => {
    if (!isObject(raw)) fail(`Export row ${index} is malformed.`);
    assertExactKeys(raw, spec.fields.map((field) => field.key), `rows[${index}]`);
    const row: Record<string, string | null> = {};
    for (const field of spec.fields) {
      row[field.key] = parseField(field, raw);
    }
    const rowId = row[spec.idField];
    if (typeof rowId !== "string" || rowIds.has(rowId)) {
      fail("Export rows contain a duplicate or malformed stable identifier.");
    }
    rowIds.add(rowId);
    if (
      typeof row.base_currency === "string" &&
      row.base_currency !== company.base_currency
    ) {
      fail("Export row base currency does not match the company.");
    }
    return row;
  });

  const rowCount = reqInt(data.row_count, "row_count");
  if (rowCount > 5000) {
    fail("Export row_count exceeds the supported dataset limit.");
  }
  if (rowCount !== rows.length) {
    fail("Export row_count does not match the number of rows.");
  }
  const summary = parseSummary(data.summary, type, company.base_currency);
  for (const countField of spec.summaryCounts) {
    if (summary.counts[countField.key] !== rowCount) {
      fail(`Export summary count "${countField.key}" does not match row_count.`);
    }
  }
  for (const breakdown of Object.values(summary.breakdowns)) {
    if (breakdown.reduce((total, row) => total + row.count, 0) !== rowCount) {
      fail("Export breakdown counts do not match row_count.");
    }
  }

  return {
    schema_version: 1,
    report_type: type,
    generated_at: generatedAt,
    company,
    filters,
    sort: { field: sortField, order: sortOrder },
    row_count: rowCount,
    summary,
    rows,
  };
}

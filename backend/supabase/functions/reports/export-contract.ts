import {
  CREDIT_RATINGS,
  CUSTOMER_STATUSES,
  DOC_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  RECEIPT_STATUSES,
} from "../_shared/constants.ts";
import { BusinessError, ValidationError } from "../_shared/errors.ts";
import { SUPPORTED_OPERATIONAL_CURRENCIES } from "../_shared/validators.ts";

export const EXPORT_ROW_LIMIT = 5_000;
export const EXPORT_PAYLOAD_LIMIT_BYTES = 8_388_608;
export const EXPORT_PAGE_SIZE = 200;
export const EXPORT_OVERSIZE_MESSAGE =
  "The filtered report exceeds the export limit. Narrow the report filters and try again.";

export type ExportReportType =
  | "aging"
  | "invoices"
  | "receipts"
  | "customer-outstanding";
export type SortOrder = "asc" | "desc";

export interface ExportCompany {
  id: string;
  name: string;
  base_currency: string;
  timezone: string;
}

export interface ExportSort {
  field: string;
  order: SortOrder;
}

export interface ExportDataset<
  TRow extends Record<string, unknown> = Record<string, unknown>,
  TSummary extends Record<string, unknown> = Record<string, unknown>,
> {
  schema_version: 1;
  report_type: ExportReportType;
  generated_at: string;
  company: ExportCompany;
  filters: Record<string, string>;
  sort: ExportSort;
  row_count: number;
  summary: TSummary;
  rows: TRow[];
}

export interface ExportQuery {
  filters: Record<string, string>;
  sort: ExportSort;
}

type QuerySpec = {
  required?: readonly string[];
  optional: readonly string[];
  sorts: readonly string[];
  defaultSort: string;
  defaultOrder: SortOrder;
};

const QUERY_SPECS: Record<ExportReportType, QuerySpec> = {
  aging: {
    required: ["as_of_date"],
    optional: ["as_of_date", "search", "sort", "order"],
    sorts: [
      "customer_code",
      "customer_name",
      "outstanding_base",
      "overdue_base",
    ],
    defaultSort: "customer_code",
    defaultOrder: "asc",
  },
  invoices: {
    optional: [
      "date_from",
      "date_to",
      "status",
      "doc_type",
      "currency",
      "search",
      "sort",
      "order",
    ],
    sorts: [
      "invoice_date",
      "invoice_no",
      "customer_name",
      "total_amount",
      "base_total",
      "outstanding",
    ],
    defaultSort: "invoice_date",
    defaultOrder: "desc",
  },
  receipts: {
    optional: [
      "date_from",
      "date_to",
      "status",
      "payment_method",
      "currency",
      "search",
      "sort",
      "order",
    ],
    sorts: [
      "receipt_date",
      "receipt_no",
      "customer_name",
      "receipt_amount",
      "base_amount",
      "unallocated_amount",
    ],
    defaultSort: "receipt_date",
    defaultOrder: "desc",
  },
  "customer-outstanding": {
    required: ["as_of_date"],
    optional: [
      "as_of_date",
      "credit_rating",
      "customer_status",
      "search",
      "sort",
      "order",
    ],
    sorts: [
      "customer_code",
      "customer_name",
      "outstanding_base",
      "overdue_base",
    ],
    defaultSort: "customer_code",
    defaultOrder: "asc",
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEARCH_MAX_LENGTH = 200;

function requireUniqueParameters(url: URL, allowed: readonly string[]): void {
  for (const key of new Set(url.searchParams.keys())) {
    if (!allowed.includes(key)) {
      throw new ValidationError(
        `Query parameter "${key}" is not accepted by this export route.`,
      );
    }
    if (url.searchParams.getAll(key).length !== 1) {
      throw new ValidationError(
        `Query parameter "${key}" must be supplied at most once.`,
      );
    }
  }
}

function parseDate(value: string, field: string): string {
  if (!DATE_RE.test(value)) {
    throw new ValidationError(`${field} must be a valid YYYY-MM-DD date.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ValidationError(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function parseOptionalSearch(value: string | null): string | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > SEARCH_MAX_LENGTH) {
    throw new ValidationError(
      `search must not exceed ${SEARCH_MAX_LENGTH} characters.`,
    );
  }
  return normalized;
}

function parseExactEnum(
  value: string | null,
  allowed: readonly string[],
  field: string,
): string | undefined {
  if (value === null) return undefined;
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} has an unsupported value.`);
  }
  return value;
}

export function parseExportQuery(
  type: ExportReportType,
  url: URL,
): ExportQuery {
  const spec = QUERY_SPECS[type];
  requireUniqueParameters(url, spec.optional);

  for (const required of spec.required ?? []) {
    if (!url.searchParams.has(required)) {
      throw new ValidationError(`${required} is required.`);
    }
  }

  const filters: Record<string, string> = {};
  const dateFields = type === "aging" || type === "customer-outstanding"
    ? ["as_of_date"]
    : ["date_from", "date_to"];
  for (const field of dateFields) {
    const value = url.searchParams.get(field);
    if (value !== null) filters[field] = parseDate(value, field);
  }
  if (
    filters.date_from && filters.date_to && filters.date_from > filters.date_to
  ) {
    throw new ValidationError("date_from must not be after date_to.");
  }

  const search = parseOptionalSearch(url.searchParams.get("search"));
  if (search !== undefined) filters.search = search;

  if (type === "invoices") {
    const status = parseExactEnum(
      url.searchParams.get("status"),
      INVOICE_STATUSES,
      "status",
    );
    const docType = parseExactEnum(
      url.searchParams.get("doc_type"),
      DOC_TYPES,
      "doc_type",
    );
    const currency = parseExactEnum(
      url.searchParams.get("currency"),
      SUPPORTED_OPERATIONAL_CURRENCIES,
      "currency",
    );
    if (status) filters.status = status;
    if (docType) filters.doc_type = docType;
    if (currency) filters.currency = currency;
  } else if (type === "receipts") {
    const status = parseExactEnum(
      url.searchParams.get("status"),
      RECEIPT_STATUSES,
      "status",
    );
    const paymentMethod = parseExactEnum(
      url.searchParams.get("payment_method"),
      PAYMENT_METHODS,
      "payment_method",
    );
    const currency = parseExactEnum(
      url.searchParams.get("currency"),
      SUPPORTED_OPERATIONAL_CURRENCIES,
      "currency",
    );
    if (status) filters.status = status;
    if (paymentMethod) filters.payment_method = paymentMethod;
    if (currency) filters.currency = currency;
  } else if (type === "customer-outstanding") {
    const creditRating = parseExactEnum(
      url.searchParams.get("credit_rating"),
      CREDIT_RATINGS,
      "credit_rating",
    );
    const customerStatus = parseExactEnum(
      url.searchParams.get("customer_status"),
      CUSTOMER_STATUSES,
      "customer_status",
    );
    if (creditRating) filters.credit_rating = creditRating;
    if (customerStatus) filters.customer_status = customerStatus;
  }

  const sortField = url.searchParams.get("sort") ?? spec.defaultSort;
  if (!spec.sorts.includes(sortField)) {
    throw new ValidationError("sort has an unsupported value.");
  }
  const orderText = url.searchParams.get("order") ?? spec.defaultOrder;
  if (orderText !== "asc" && orderText !== "desc") {
    throw new ValidationError("order must be asc or desc.");
  }

  return { filters, sort: { field: sortField, order: orderText } };
}

export class ExportDatasetTooLargeError extends BusinessError {
  constructor(estimatedRows: number) {
    super(
      "EXPORT_DATASET_TOO_LARGE",
      EXPORT_OVERSIZE_MESSAGE,
      422,
      {
        row_limit: EXPORT_ROW_LIMIT,
        payload_limit_bytes: EXPORT_PAYLOAD_LIMIT_BYTES,
        estimated_rows: Math.max(0, Math.trunc(estimatedRows)),
      },
    );
  }
}

function expandExponent(value: string): string {
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
  if (!match) return value;
  const sign = match[1];
  const whole = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4]);
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${
    digits.slice(decimalIndex)
  }`;
}

export function decimalString(value: unknown, field: string): string {
  if (
    typeof value !== "string" && typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new Error(`Invalid decimal value for ${field}.`);
  }
  const text = expandExponent(String(value).trim());
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid decimal value for ${field}.`);
  const negative = match[1] === "-";
  const whole = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const isZero = whole === "0" && fraction.length === 0;
  return `${negative && !isZero ? "-" : ""}${whole}${
    fraction ? `.${fraction}` : ""
  }`;
}

export function moneyToMinor(value: unknown, field: string): bigint {
  const normalized = decimalString(value, field);
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/)!;
  const fraction = match[3] ?? "";
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    throw new Error(`Invalid monetary scale for ${field}.`);
  }
  return BigInt(`${match[1]}${match[2]}`) * 100n +
    BigInt(`${match[1]}${(fraction + "00").slice(0, 2)}`);
}

export function minorToMoney(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${
    String(absolute % 100n).padStart(2, "0")
  }`;
}

export function multiplyMoneyByRate(
  monetaryValue: unknown,
  rateValue: unknown,
  field: string,
): bigint {
  const monetaryMinor = moneyToMinor(monetaryValue, field);
  const rate = decimalString(rateValue, `${field}.rate`);
  const match = rate.match(/^(-?)(\d+)(?:\.(\d+))?$/)!;
  const scale = (match[3] ?? "").length;
  const rateNumerator = BigInt(`${match[1]}${match[2]}${match[3] ?? ""}`);
  const denominator = 10n ** BigInt(scale);
  const numerator = monetaryMinor * rateNumerator;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

export function assertIsoUtc(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Invalid ISO-8601 UTC value for ${field}.`);
  }
  return value;
}

export function assertIanaTimeZone(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Company timezone is unavailable.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(
      new Date(0),
    );
  } catch {
    throw new Error("Company timezone is invalid.");
  }
  return normalized;
}

export function serializedUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function enforcePayloadLimit(dataset: ExportDataset): ExportDataset {
  if (serializedUtf8Bytes({ data: dataset }) > EXPORT_PAYLOAD_LIMIT_BYTES) {
    throw new ExportDatasetTooLargeError(dataset.row_count);
  }
  return dataset;
}

export function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", {
    sensitivity: "base",
    numeric: true,
  });
}

export function compareDecimal(left: string, right: string): number {
  const leftMinor = moneyToMinor(left, "sort");
  const rightMinor = moneyToMinor(right, "sort");
  return leftMinor < rightMinor ? -1 : leftMinor > rightMinor ? 1 : 0;
}

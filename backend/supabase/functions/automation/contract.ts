import { ValidationError } from "../_shared/errors.ts";

export const AUTOMATION_CONTRACT_VERSION = "gate-e.1" as const;
export const AUTOMATION_PAGE_MAX = 100;
export const AUTOMATION_PAGE_DEFAULT = 25;
export const PROVIDERS = ["gmail", "microsoft"] as const;
export const OPERATING_MODES = [
  "disabled",
  "observe_only",
  "draft_only",
  "straight_through",
] as const;

export type MailboxProviderType = typeof PROVIDERS[number];
export type AutomationOperatingMode = typeof OPERATING_MODES[number];
export type DocumentType =
  | "invoice"
  | "receipt"
  | "payment_advice"
  | "unsupported"
  | "ambiguous";

export interface PageRequest {
  page: number;
  page_size: number;
}

export interface PageMeta extends PageRequest {
  total: number;
  has_more: boolean;
}

export interface AutomationEnvelope<T> {
  success: true;
  data: T;
  meta?: PageMeta;
  contract_version: typeof AUTOMATION_CONTRACT_VERSION;
}

export function automationSuccess<T>(
  data: T,
  meta?: PageMeta,
): AutomationEnvelope<T> {
  return {
    success: true,
    data,
    ...(meta ? { meta } : {}),
    contract_version: AUTOMATION_CONTRACT_VERSION,
  };
}

export function parsePage(url: URL): PageRequest {
  const pageText = url.searchParams.get("page") ?? "1";
  const sizeText = url.searchParams.get("page_size") ??
    String(AUTOMATION_PAGE_DEFAULT);
  if (!/^[1-9][0-9]*$/.test(pageText) || !/^[1-9][0-9]*$/.test(sizeText)) {
    throw new ValidationError("page and page_size must be positive integers.");
  }
  const page = Number(pageText);
  const page_size = Number(sizeText);
  if (page_size > AUTOMATION_PAGE_MAX) {
    throw new ValidationError(
      `page_size must not exceed ${AUTOMATION_PAGE_MAX}.`,
      { field: "page_size", max: AUTOMATION_PAGE_MAX },
    );
  }
  return { page, page_size };
}

export function assertQueryParameters(
  url: URL,
  allowed: readonly string[],
): void {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || seen.has(key)) {
      throw new ValidationError(
        "Query parameters do not match the automation contract.",
        {
          field: key,
          reason: seen.has(key) ? "duplicate" : "unsupported",
        },
      );
    }
    seen.add(key);
  }
}

export function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = [],
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => value[key] === undefined);
  if (unexpected.length || missing.length) {
    throw new ValidationError(
      "Request body does not match the automation contract.",
      {
        unexpected_fields: unexpected.sort(),
        missing_fields: missing.sort(),
      },
    );
  }
}

export function requireBoundedText(
  value: unknown,
  field: string,
  max: number,
): string {
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    value.trim().length > max
  ) {
    throw new ValidationError(
      `${field} must be a non-empty string of at most ${max} characters.`,
      {
        field,
        max,
      },
    );
  }
  return value.trim();
}

export function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must be YYYY-MM-DD.`, { field });
  }
  if (!isSemanticIsoDate(value)) {
    throw new ValidationError(`${field} must be a real calendar date.`, {
      field,
    });
  }
  return value;
}

const ISO_DATE_COMPONENTS = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_COMPONENTS =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validGregorianComponents(
  year: number,
  month: number,
  day: number,
): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= days[month - 1];
}

export function isSemanticIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_COMPONENTS.exec(value);
  if (!match) return false;
  return validGregorianComponents(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );
}

export function isSemanticIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP_COMPONENTS.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);
  if (
    !validGregorianComponents(year, month, day) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 14 || offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function normalizeEmail(value: unknown, field = "email"): string {
  const email = requireBoundedText(value, field, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError(`${field} must be a valid email address.`, {
      field,
    });
  }
  return email;
}

export function normalizePhone(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = requireBoundedText(value, "phone", 30);
  const normalized = raw.replace(/[\s().-]/g, "");
  if (!/^\+[1-9][0-9]{6,14}$/.test(normalized)) {
    throw new ValidationError(
      "phone must be an international number in E.164 form.",
      { field: "phone" },
    );
  }
  return normalized;
}

export function requireProvider(value: unknown): MailboxProviderType {
  if (value !== "gmail" && value !== "microsoft") {
    throw new ValidationError("provider_type must be gmail or microsoft.", {
      field: "provider_type",
    });
  }
  return value;
}

export function requireOperatingMode(value: unknown): AutomationOperatingMode {
  if (!OPERATING_MODES.includes(value as AutomationOperatingMode)) {
    throw new ValidationError("Invalid automation operating mode.", {
      field: "operating_mode",
      allowed: OPERATING_MODES,
    });
  }
  return value as AutomationOperatingMode;
}

export function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(`${field} must be a boolean.`, { field });
  }
  return value;
}

export function safeErrorCode(value: unknown): string {
  if (typeof value !== "string") return "PROVIDER_UNAVAILABLE";
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(
    0,
    80,
  );
  return normalized || "PROVIDER_UNAVAILABLE";
}

export interface ClassificationCandidate {
  schema_version: 1;
  document_type: DocumentType;
  confidence: number;
  critical_field_confidence: number;
  provider: string;
  model: string;
  provider_version: string;
  trace_id: string;
}

export interface ExtractedCustomerCandidate {
  customer_code?: string;
  registration_identifier?: string;
  email?: string;
  company_name?: string;
  invoice_reference?: string;
}

export interface InvoiceExtraction {
  schema_version: 1;
  document_type: "invoice";
  customer: ExtractedCustomerCandidate;
  invoice_date: string;
  due_date: string;
  currency: string;
  reference_no?: string;
  subtotal: string;
  tax_total: string;
  total: string;
  lines: Array<{
    description: string;
    quantity: string;
    unit_price: string;
    line_total: string;
  }>;
}

export interface ReceiptExtraction {
  schema_version: 1;
  document_type: "receipt";
  customer: ExtractedCustomerCandidate;
  receipt_date: string;
  currency: string;
  amount: string;
  payment_method: string;
  reference_no?: string;
  invoice_references: string[];
}

export type FinancialExtraction = InvoiceExtraction | ReceiptExtraction;

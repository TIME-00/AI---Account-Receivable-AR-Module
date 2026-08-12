import { ValidationError } from "../_shared/errors.ts";

export const JOURNAL_SOURCE_TYPES = [
  "INV",
  "RCT",
  "CN",
  "DN",
  "REV",
  "ADJ",
  "WO",
] as const;
export const JOURNAL_MAX_PAGE_SIZE = 50;

export type JournalSourceType = typeof JOURNAL_SOURCE_TYPES[number];

export interface JournalCursor {
  created_at: string;
  id: string;
}

export interface JournalListParams {
  limit: number;
  cursor: JournalCursor | null;
  q: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  sourceType: JournalSourceType | null;
  currency: string | null;
  accountCode: string | null;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ACCOUNT_CODE_PATTERN = /^[A-Za-z0-9._/-]{1,30}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function decodeBase64Url(value: string): string {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new ValidationError("cursor must be unpadded base64url JSON.", {
      field: "cursor",
    });
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - value.length % 4) % 4);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    );
  } catch {
    throw new ValidationError("cursor is not valid base64url data.", {
      field: "cursor",
    });
  }
}

function encodeBase64Url(value: unknown): string {
  const binary = Array.from(
    new TextEncoder().encode(JSON.stringify(value)),
    (byte) => String.fromCharCode(byte),
  ).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/u,
    "",
  );
}

function exactOne(url: URL, key: string): string | null {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) {
    throw new ValidationError(`Query parameter "${key}" must appear once.`, {
      field: key,
    });
  }
  return values[0] ?? null;
}

function parseDate(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (
    !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new ValidationError(`${field} must be a valid YYYY-MM-DD date.`, {
      field,
    });
  }
  return value;
}

function parseBoundedText(
  value: string | null,
  field: string,
  maximum: number,
): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (
    normalized.length < 1 || normalized.length > maximum ||
    containsControlCharacter(normalized)
  ) {
    throw new ValidationError(
      `${field} must contain 1 to ${maximum} safe characters.`,
      {
        field,
      },
    );
  }
  return normalized;
}

export function encodeJournalCursor(cursor: JournalCursor): string {
  return encodeBase64Url(cursor);
}

export function parseJournalCursor(value: string | null): JournalCursor | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(value));
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("cursor must contain valid JSON.", {
      field: "cursor",
    });
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 2) {
    throw new ValidationError(
      "cursor JSON must contain only created_at and id.",
      {
        field: "cursor",
      },
    );
  }
  if (
    typeof parsed.created_at !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(parsed.created_at) ||
    Number.isNaN(Date.parse(parsed.created_at))
  ) {
    throw new ValidationError(
      "cursor.created_at must be an ISO-8601 timestamp.",
      {
        field: "cursor.created_at",
      },
    );
  }
  if (typeof parsed.id !== "string" || !UUID_PATTERN.test(parsed.id)) {
    throw new ValidationError("cursor.id must be a UUID.", {
      field: "cursor.id",
    });
  }
  return { created_at: parsed.created_at, id: parsed.id.toLowerCase() };
}

export function parseJournalListParams(url: URL): JournalListParams {
  const allowed = new Set([
    "limit",
    "cursor",
    "q",
    "date_from",
    "date_to",
    "source_type",
    "currency",
    "account_code",
  ]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new ValidationError(`Query parameter "${key}" is not supported.`, {
        field: key,
      });
    }
  }

  const limitText = exactOne(url, "limit");
  const limit = limitText === null ? 25 : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > JOURNAL_MAX_PAGE_SIZE) {
    throw new ValidationError("limit must be an integer from 1 to 50.", {
      field: "limit",
    });
  }

  const sourceTypeText = exactOne(url, "source_type");
  if (
    sourceTypeText !== null &&
    !JOURNAL_SOURCE_TYPES.includes(sourceTypeText as JournalSourceType)
  ) {
    throw new ValidationError("source_type is not supported.", {
      field: "source_type",
    });
  }

  const currencyText = exactOne(url, "currency");
  const currency = currencyText?.trim().toUpperCase() ?? null;
  if (currency !== null && !CURRENCY_PATTERN.test(currency)) {
    throw new ValidationError("currency must be a three-letter code.", {
      field: "currency",
    });
  }

  const accountCode = parseBoundedText(
    exactOne(url, "account_code"),
    "account_code",
    30,
  );
  if (accountCode !== null && !ACCOUNT_CODE_PATTERN.test(accountCode)) {
    throw new ValidationError("account_code contains unsupported characters.", {
      field: "account_code",
    });
  }

  const dateFrom = parseDate(exactOne(url, "date_from"), "date_from");
  const dateTo = parseDate(exactOne(url, "date_to"), "date_to");
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    throw new ValidationError("date_from must not be later than date_to.");
  }

  return {
    limit,
    cursor: parseJournalCursor(exactOne(url, "cursor")),
    q: parseBoundedText(exactOne(url, "q"), "q", 100),
    dateFrom,
    dateTo,
    sourceType: sourceTypeText as JournalSourceType | null,
    currency,
    accountCode,
  };
}

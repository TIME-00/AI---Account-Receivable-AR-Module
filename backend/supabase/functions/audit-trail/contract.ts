import { ValidationError } from "../_shared/errors.ts";

export const AUDIT_MAX_PAGE_SIZE = 50;
export const AUDIT_ACTOR_TYPES = ["user", "system", "unknown"] as const;
export const AUDIT_ENTITY_TYPES = [
  "invoice",
  "credit_note",
  "debit_note",
  "receipt",
  "allocation",
  "credit_note_allocation",
  "journal_entry",
  "customer",
  "report",
  "automation",
  "reminder",
  "reminder_delivery",
  "fx_booking_decision",
  "import_batch",
] as const;

export type AuditActorType = typeof AUDIT_ACTOR_TYPES[number];
export type AuditEntityType = typeof AUDIT_ENTITY_TYPES[number];

export interface AuditCursor {
  occurred_at: string;
  event_id: string;
}

export interface AuditListParams {
  limit: number;
  cursor: AuditCursor | null;
  dateFrom: string | null;
  dateTo: string | null;
  action: string | null;
  entityType: AuditEntityType | null;
  actorType: AuditActorType | null;
  actorUserId: string | null;
  result: string | null;
  q: string | null;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID_PATTERN =
  /^[a-z][a-z0-9_]{1,40}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

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

function boundedText(
  value: string | null,
  field: string,
  max: number,
): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (
    normalized.length < 1 || normalized.length > max ||
    containsControlCharacter(normalized)
  ) {
    throw new ValidationError(
      `${field} must contain 1 to ${max} safe characters.`,
      { field },
    );
  }
  return normalized;
}

function date(value: string | null, field: string): string | null {
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

function token(value: string | null, field: string): string | null {
  const normalized = boundedText(value, field, 50)?.toLowerCase() ?? null;
  if (normalized !== null && !TOKEN_PATTERN.test(normalized)) {
    throw new ValidationError(`${field} contains unsupported characters.`, {
      field,
    });
  }
  return normalized;
}

export function encodeAuditCursor(cursor: AuditCursor): string {
  return encodeBase64Url(cursor);
}

export function parseAuditCursor(value: string | null): AuditCursor | null {
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
      "cursor JSON must contain only occurred_at and event_id.",
      { field: "cursor" },
    );
  }
  if (
    typeof parsed.occurred_at !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(parsed.occurred_at) ||
    Number.isNaN(Date.parse(parsed.occurred_at))
  ) {
    throw new ValidationError(
      "cursor.occurred_at must be an ISO-8601 timestamp.",
      { field: "cursor.occurred_at" },
    );
  }
  if (
    typeof parsed.event_id !== "string" ||
    !EVENT_ID_PATTERN.test(parsed.event_id)
  ) {
    throw new ValidationError("cursor.event_id is malformed.", {
      field: "cursor.event_id",
    });
  }
  return { occurred_at: parsed.occurred_at, event_id: parsed.event_id };
}

export function validateAuditEventId(value: string): void {
  if (!EVENT_ID_PATTERN.test(value)) {
    throw new ValidationError("audit event id is malformed.", {
      field: "event_id",
    });
  }
}

export function parseAuditListParams(url: URL): AuditListParams {
  const allowed = new Set([
    "limit",
    "cursor",
    "date_from",
    "date_to",
    "action",
    "entity_type",
    "actor_type",
    "actor_user_id",
    "result",
    "q",
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
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_MAX_PAGE_SIZE) {
    throw new ValidationError("limit must be an integer from 1 to 50.", {
      field: "limit",
    });
  }

  const entityTypeText = exactOne(url, "entity_type")?.toLowerCase() ?? null;
  if (
    entityTypeText !== null &&
    !AUDIT_ENTITY_TYPES.includes(entityTypeText as AuditEntityType)
  ) {
    throw new ValidationError("entity_type is not supported.", {
      field: "entity_type",
    });
  }
  const actorTypeText = exactOne(url, "actor_type")?.toLowerCase() ?? null;
  if (
    actorTypeText !== null &&
    !AUDIT_ACTOR_TYPES.includes(actorTypeText as AuditActorType)
  ) {
    throw new ValidationError("actor_type is not supported.", {
      field: "actor_type",
    });
  }
  const actorUserId = exactOne(url, "actor_user_id")?.toLowerCase() ?? null;
  if (actorUserId !== null && !UUID_PATTERN.test(actorUserId)) {
    throw new ValidationError("actor_user_id must be a UUID.", {
      field: "actor_user_id",
    });
  }
  const dateFrom = date(exactOne(url, "date_from"), "date_from");
  const dateTo = date(exactOne(url, "date_to"), "date_to");
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    throw new ValidationError("date_from must not be later than date_to.");
  }

  return {
    limit,
    cursor: parseAuditCursor(exactOne(url, "cursor")),
    dateFrom,
    dateTo,
    action: token(exactOne(url, "action"), "action"),
    entityType: entityTypeText as AuditEntityType | null,
    actorType: actorTypeText as AuditActorType | null,
    actorUserId,
    result: token(exactOne(url, "result"), "result"),
    q: boundedText(exactOne(url, "q"), "q", 100),
  };
}

import { ValidationError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";

export const NOTIFICATION_TYPES = ["import_error", "import_review"] as const;
export const NOTIFICATION_READ_STATES = ["all", "unread", "read"] as const;
export const NOTIFICATION_MAX_PAGE_SIZE = 20;

export type NotificationType = typeof NOTIFICATION_TYPES[number];
export type NotificationReadState = typeof NOTIFICATION_READ_STATES[number];

export interface NotificationCursor {
  created_at: string;
  notification_key: string;
}

export interface ParsedNotificationKey {
  notificationKey: string;
  importBatchId: string;
  conditionType: NotificationType;
}

export interface NotificationListParams {
  limit: number;
  cursor: NotificationCursor | null;
  readState: NotificationReadState;
  type: NotificationType | null;
}

const NOTIFICATION_KEY_PATTERN =
  /^import:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(import_error|import_review)$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new ValidationError(`${context} contains unsupported fields.`, {
      fields: unexpected,
    });
  }
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

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  const json = JSON.stringify(cursor);
  const binary = Array.from(
    new TextEncoder().encode(json),
    (byte) => String.fromCharCode(byte),
  ).join("");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function parseNotificationKey(value: unknown): ParsedNotificationKey {
  if (typeof value !== "string") {
    throw new ValidationError("notification_key must be a string.", {
      field: "notification_key",
    });
  }
  const normalized = value.trim().toLowerCase();
  const match = NOTIFICATION_KEY_PATTERN.exec(normalized);
  if (!match) {
    throw new ValidationError("notification_key is malformed.", {
      field: "notification_key",
    });
  }
  validateUUID(match[1], "notification_key.import_batch_id");
  return {
    notificationKey: normalized,
    importBatchId: match[1],
    conditionType: match[2] as NotificationType,
  };
}

export function parseNotificationCursor(
  value: string | null,
): NotificationCursor | null {
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
  if (!isRecord(parsed)) {
    throw new ValidationError("cursor JSON must be an object.", {
      field: "cursor",
    });
  }
  assertExactKeys(parsed, ["created_at", "notification_key"], "cursor");
  if (
    typeof parsed.created_at !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(parsed.created_at) ||
    Number.isNaN(Date.parse(parsed.created_at))
  ) {
    throw new ValidationError(
      "cursor.created_at must be an ISO-8601 UTC timestamp.",
      {
        field: "cursor.created_at",
      },
    );
  }
  const key = parseNotificationKey(parsed.notification_key);
  return {
    created_at: parsed.created_at,
    notification_key: key.notificationKey,
  };
}

function parseType(value: string | null): NotificationType | null {
  if (value === null) return null;
  if (!NOTIFICATION_TYPES.includes(value as NotificationType)) {
    throw new ValidationError("type must be import_error or import_review.", {
      field: "type",
    });
  }
  return value as NotificationType;
}

export function parseNotificationListParams(url: URL): NotificationListParams {
  const allowed = new Set(["limit", "cursor", "read_state", "type"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new ValidationError(`Query parameter "${key}" is not supported.`, {
        field: key,
      });
    }
    if (url.searchParams.getAll(key).length !== 1) {
      throw new ValidationError(`Query parameter "${key}" must appear once.`, {
        field: key,
      });
    }
  }

  const limitText = url.searchParams.get("limit");
  const limit = limitText === null
    ? NOTIFICATION_MAX_PAGE_SIZE
    : Number(limitText);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > NOTIFICATION_MAX_PAGE_SIZE
  ) {
    throw new ValidationError("limit must be an integer from 1 to 20.", {
      field: "limit",
    });
  }

  const readStateText = url.searchParams.get("read_state") ?? "all";
  if (
    !NOTIFICATION_READ_STATES.includes(readStateText as NotificationReadState)
  ) {
    throw new ValidationError("read_state must be all, unread, or read.", {
      field: "read_state",
    });
  }

  return {
    limit,
    cursor: parseNotificationCursor(url.searchParams.get("cursor")),
    readState: readStateText as NotificationReadState,
    type: parseType(url.searchParams.get("type")),
  };
}

export function parseReadOneBody(value: unknown): ParsedNotificationKey {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  assertExactKeys(value, ["notification_key"], "Request body");
  return parseNotificationKey(value.notification_key);
}

export function parseReadAllBody(
  value: unknown,
): { type: NotificationType | null } {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  assertExactKeys(value, ["type"], "Request body");
  if (value.type === undefined || value.type === null) return { type: null };
  if (typeof value.type !== "string") {
    throw new ValidationError("type must be a string.", { field: "type" });
  }
  return { type: parseType(value.type) };
}

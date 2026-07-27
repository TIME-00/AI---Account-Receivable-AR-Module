// ============================================================================
// TSH Synergy AR — Gate B Notifications shared frontend contract
//
// Import-alert-only notifications. `overdue_ar` is fully de-scoped and must
// never be produced, requested or displayed here.
//
// This module mirrors the committed backend envelopes EXACTLY (see
// backend/supabase/functions/notifications/{service,contract}.ts):
//   • GET  /notifications              → { data: NotificationItem[], meta }
//   • GET  /notifications/unread-count → { unread_count }
//   • POST /notifications/read         → { notification_key, read_at }
//   • POST /notifications/read-all     → { acknowledged_count, completed_at }
//
// The cursor is OPAQUE: the frontend never decodes or constructs it — it only
// echoes `meta.next_cursor` back as the `cursor` query parameter.
// ============================================================================

/** Backend caps the list page size at 20; the frontend never exceeds it. */
export const NOTIFICATION_MAX_LIMIT = 20;

export const NOTIFICATION_TYPES = ["import_error", "import_review"] as const;
export const NOTIFICATION_READ_STATES = ["all", "unread", "read"] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationReadState = (typeof NOTIFICATION_READ_STATES)[number];

/** One derived import alert, exactly as returned by the list RPC. */
export interface NotificationItem {
  notification_key: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: "warning" | "error";
  created_at: string;
  source: { type: "import_batch"; id: string };
  deep_link: string | null;
  read_at: string | null;
}

/** `meta` envelope of GET /notifications. */
export interface NotificationListMeta {
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface NotificationListPage {
  data: NotificationItem[];
  meta: NotificationListMeta;
}

export interface NotificationReadOneResult {
  notification_key: string;
  read_at: string;
}

export interface NotificationReadAllResult {
  acknowledged_count: number;
  completed_at: string;
}

export interface NotificationFilters {
  readState: NotificationReadState;
  type: NotificationType | null;
}

export const DEFAULT_NOTIFICATION_FILTERS: NotificationFilters = {
  readState: "all",
  type: null,
};

// ─── Request builders ────────────────────────────────────────────────────────

/** Clamp any requested limit into the backend-accepted 1..20 window. */
export function clampNotificationLimit(limit?: number): number {
  if (!Number.isFinite(limit ?? NaN)) return NOTIFICATION_MAX_LIMIT;
  const rounded = Math.floor(limit as number);
  if (rounded < 1) return 1;
  if (rounded > NOTIFICATION_MAX_LIMIT) return NOTIFICATION_MAX_LIMIT;
  return rounded;
}

/**
 * Build the query params for GET /notifications. Only the four approved
 * parameters are ever sent; `company_id`/`user_id`/`read_at` are derived from
 * the authenticated context server-side and are never included here.
 */
export function notificationListParams(
  filters: NotificationFilters,
  cursor: string | null,
  limit: number = NOTIFICATION_MAX_LIMIT,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    limit: clampNotificationLimit(limit),
    read_state: filters.readState,
  };
  if (filters.type) params.type = filters.type;
  // The cursor is opaque; it is echoed verbatim and never decoded.
  if (cursor) params.cursor = cursor;
  return params;
}

/** Read-one body — only the validated notification key, nothing else. */
export function readOneBody(notificationKey: string): { notification_key: string } {
  return { notification_key: notificationKey };
}

/**
 * Read-all body. The server derives the complete actionable set; the frontend
 * NEVER sends a client-generated list of keys. Only an optional type scope.
 */
export function readAllBody(
  type: NotificationType | null,
): Record<string, never> | { type: NotificationType } {
  return type ? { type } : {};
}

// ─── Defensive response parsing (malformed backend fails safely) ─────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTIFICATION_KEY_PATTERN =
  /^import:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(import_error|import_review)$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function parseNotificationKeyParts(
  value: unknown,
): { sourceId: string; type: NotificationType } | null {
  if (typeof value !== "string") return null;
  const match = NOTIFICATION_KEY_PATTERN.exec(value);
  if (!match || !UUID_PATTERN.test(match[1])) return null;
  return { sourceId: match[1], type: match[2] as NotificationType };
}

export function isNotificationItem(value: unknown): value is NotificationItem {
  if (!isRecord(value)) return false;
  const source = value.source;
  const key = parseNotificationKeyParts(value.notification_key);
  const expectedSeverity =
    value.type === "import_error"
      ? "error"
      : value.type === "import_review"
        ? "warning"
        : null;
  return (
    key !== null &&
    (value.type === "import_error" || value.type === "import_review") &&
    key.type === value.type &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    value.severity === expectedSeverity &&
    isIsoTimestamp(value.created_at) &&
    isRecord(source) &&
    source.type === "import_batch" &&
    typeof source.id === "string" &&
    UUID_PATTERN.test(source.id) &&
    key.sourceId.toLowerCase() === source.id.toLowerCase() &&
    typeof value.deep_link === "string" &&
    (value.read_at === null || isIsoTimestamp(value.read_at))
  );
}

/**
 * Validate the list envelope. Throws on any malformed shape so the query lands
 * in its error state rather than rendering partial/garbage rows.
 */
export function parseNotificationListPage(
  data: unknown,
  meta: unknown,
): NotificationListPage {
  if (!Array.isArray(data) || !data.every(isNotificationItem)) {
    throw new Error("Malformed notifications response.");
  }
  if (
    !isRecord(meta) ||
    typeof meta.has_more !== "boolean" ||
    !Number.isSafeInteger(meta.limit) ||
    (meta.limit as number) < 1 ||
    (meta.limit as number) > NOTIFICATION_MAX_LIMIT ||
    data.length > (meta.limit as number)
  ) {
    throw new Error("Malformed notifications metadata.");
  }
  const nextCursor = meta.next_cursor;
  if (
    (meta.has_more &&
      (typeof nextCursor !== "string" || nextCursor.length === 0)) ||
    (!meta.has_more && nextCursor !== null)
  ) {
    throw new Error("Malformed notifications cursor.");
  }
  const keys = data.map((item) => item.notification_key);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Duplicate notifications in response.");
  }
  return {
    data: data as NotificationItem[],
    meta: {
      limit: meta.limit as number,
      next_cursor: nextCursor as string | null,
      has_more: meta.has_more,
    },
  };
}

/** Parse the unread-count envelope; never derived from loaded list rows. */
export function parseUnreadCount(data: unknown): number {
  if (!isRecord(data)) throw new Error("Malformed unread-count response.");
  const count = data.unread_count;
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    throw new Error("Malformed unread-count value.");
  }
  return count as number;
}

export function parseNotificationReadOneResult(
  data: unknown,
): NotificationReadOneResult {
  if (!isRecord(data)) throw new Error("Malformed notification read response.");
  const key = parseNotificationKeyParts(data.notification_key);
  if (!key || !isIsoTimestamp(data.read_at)) {
    throw new Error("Malformed notification read response.");
  }
  return {
    notification_key: data.notification_key as string,
    read_at: data.read_at,
  };
}

export function parseNotificationReadAllResult(
  data: unknown,
): NotificationReadAllResult {
  if (
    !isRecord(data) ||
    !Number.isSafeInteger(data.acknowledged_count) ||
    (data.acknowledged_count as number) < 0 ||
    !isIsoTimestamp(data.completed_at)
  ) {
    throw new Error("Malformed notification read-all response.");
  }
  return {
    acknowledged_count: data.acknowledged_count as number,
    completed_at: data.completed_at,
  };
}

// ─── Presentation helpers ────────────────────────────────────────────────────

/** A notification is actionable while its source condition is still unread. */
export function isNotificationActionable(item: NotificationItem): boolean {
  return item.read_at === null;
}

/**
 * Cap the unread badge to a compact label while preserving the exact count for
 * assistive technology (e.g. visible "99+" but accessible "128 unread").
 */
export function formatUnreadBadge(count: number): { visible: string; accessible: string } {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return {
    visible: safe > 99 ? "99+" : String(safe),
    accessible: safe === 1 ? "1 unread notification" : `${safe} unread notifications`,
  };
}

// ─── Safe deep links ─────────────────────────────────────────────────────────

/**
 * Frontend pages that a notification deep link is allowed to target. The
 * backend currently emits `/imports/<uuid>`, for which there is no frontend
 * page — that path is intentionally NOT navigable here, so we render no link
 * rather than a broken 404 or a misleading invoice/receipt guess.
 */
const SAFE_DEEP_LINK_PREFIXES = [
  "/invoices/import",
  "/receipts/import",
  "/invoices",
  "/receipts",
  "/customers",
] as const;

/**
 * Resolve a controlled, internal notification href.
 *
 * Returns `null` unless the backend-provided value is a pure internal absolute
 * path (no scheme, no protocol-relative `//`, no whitespace) that begins with a
 * known safe prefix. This blocks `javascript:`, external URLs and arbitrary
 * navigation, and never invents a link the backend did not provide.
 */
export function resolveNotificationHref(
  deepLink: string | null | undefined,
): string | null {
  if (typeof deepLink !== "string") return null;
  const value = deepLink.trim();
  if (!/^\/[A-Za-z0-9\-_/]*$/.test(value)) return null; // internal path only
  if (value.startsWith("//")) return null; // protocol-relative
  if (value.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return SAFE_DEEP_LINK_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`),
  )
    ? value
    : null;
}

// ─── Cross-tab broadcast ─────────────────────────────────────────────────────

export interface NotificationBroadcast {
  kind: "read-one" | "read-all";
  companyId: string;
  userId: string;
}

/** Company- and user-scoped channel name; isolates tenants and users. */
export function notificationChannelName(companyId: string, userId: string): string {
  return `ar-notifications:${companyId}:${userId}`;
}

/** Accept a broadcast only when it is well-formed and same-company/same-user. */
export function isValidNotificationBroadcast(
  message: unknown,
  companyId: string,
  userId: string,
): message is NotificationBroadcast {
  if (!isRecord(message)) return false;
  return (
    (message.kind === "read-one" || message.kind === "read-all") &&
    message.companyId === companyId &&
    message.userId === userId &&
    companyId.trim().length > 0 &&
    userId.trim().length > 0
  );
}

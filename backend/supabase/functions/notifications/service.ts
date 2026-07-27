import type { SupabaseClient } from "supabase";
import type { AuthContext } from "../_shared/auth.ts";
import { throwDatabaseError } from "../_shared/db.ts";
import type {
  NotificationListParams,
  NotificationType,
  ParsedNotificationKey,
} from "./contract.ts";
import { encodeNotificationCursor } from "./contract.ts";

export interface NotificationItem {
  notification_key: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: "warning" | "error";
  created_at: string;
  source: { type: "import_batch"; id: string };
  deep_link: string;
  read_at: string | null;
}

export interface NotificationListResult {
  data: NotificationItem[];
  meta: {
    limit: number;
    next_cursor: string | null;
    has_more: boolean;
  };
}

interface ListRpcResult {
  rows?: NotificationItem[];
  has_more?: boolean;
}

interface ReadOneResult {
  notification_key: string;
  read_at: string;
}

interface ReadAllResult {
  acknowledged_count: number;
  completed_at: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTIFICATION_KEY_PATTERN =
  /^import:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(import_error|import_review)$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function isNotificationItem(value: unknown): value is NotificationItem {
  if (!isRecord(value) || !isRecord(value.source)) return false;
  const keyMatch = typeof value.notification_key === "string"
    ? NOTIFICATION_KEY_PATTERN.exec(value.notification_key)
    : null;
  if (!keyMatch) return false;

  const sourceId = value.source.id;
  const notificationType = value.type;
  const expectedSeverity = notificationType === "import_error"
    ? "error"
    : notificationType === "import_review"
    ? "warning"
    : null;

  return UUID_PATTERN.test(String(sourceId)) &&
    keyMatch[1].toLowerCase() === String(sourceId).toLowerCase() &&
    keyMatch[2] === notificationType &&
    value.source.type === "import_batch" &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    value.severity === expectedSeverity &&
    isIsoTimestamp(value.created_at) &&
    typeof value.deep_link === "string" &&
    value.deep_link.startsWith("/") &&
    (value.read_at === null || isIsoTimestamp(value.read_at));
}

function invalidRpcResult(): never {
  throw new Error("Notification RPC returned an invalid result");
}

export interface NotificationServiceContract {
  list(
    auth: AuthContext,
    params: NotificationListParams,
  ): Promise<NotificationListResult>;
  unreadCount(auth: AuthContext): Promise<number>;
  readOne(
    auth: AuthContext,
    key: ParsedNotificationKey,
  ): Promise<ReadOneResult>;
  readAll(
    auth: AuthContext,
    type: NotificationType | null,
  ): Promise<ReadAllResult>;
}

export class NotificationService implements NotificationServiceContract {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await this.client.rpc(functionName, params);
    if (error) {
      throwDatabaseError(error, `Notification RPC ${functionName} failed`);
    }
    return data as T;
  }

  async list(
    auth: AuthContext,
    params: NotificationListParams,
  ): Promise<NotificationListResult> {
    const result = await this.rpc<ListRpcResult>(
      "notification_list_import_alerts",
      {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
        p_limit: params.limit,
        p_cursor_created_at: params.cursor?.created_at ?? null,
        p_cursor_notification_key: params.cursor?.notification_key ?? null,
        p_read_state: params.readState,
        p_notification_type: params.type,
      },
    );
    if (
      !isRecord(result) ||
      !Array.isArray(result.rows) ||
      typeof result.has_more !== "boolean" ||
      result.rows.length > params.limit ||
      !result.rows.every(isNotificationItem)
    ) {
      invalidRpcResult();
    }
    const rows = result.rows as NotificationItem[];
    const hasMore = result.has_more;
    if (hasMore && rows.length === 0) invalidRpcResult();
    const last = rows.at(-1);
    return {
      data: rows,
      meta: {
        limit: params.limit,
        has_more: hasMore,
        next_cursor: hasMore && last
          ? encodeNotificationCursor({
            created_at: last.created_at,
            notification_key: last.notification_key,
          })
          : null,
      },
    };
  }

  async unreadCount(auth: AuthContext): Promise<number> {
    const result = await this.rpc<number>(
      "notification_unread_import_alert_count",
      {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
      },
    );
    if (!Number.isSafeInteger(result) || result < 0) invalidRpcResult();
    return result;
  }

  async readOne(
    auth: AuthContext,
    key: ParsedNotificationKey,
  ): Promise<ReadOneResult> {
    const result = await this.rpc<ReadOneResult>(
      "notification_mark_import_read",
      {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
        p_notification_key: key.notificationKey,
        p_import_batch_id: key.importBatchId,
        p_condition_type: key.conditionType,
      },
    );
    if (
      !isRecord(result) ||
      result.notification_key !== key.notificationKey ||
      !isIsoTimestamp(result.read_at)
    ) {
      invalidRpcResult();
    }
    await this.pruneBestEffort(auth);
    return result as ReadOneResult;
  }

  async readAll(
    auth: AuthContext,
    type: NotificationType | null,
  ): Promise<ReadAllResult> {
    const result = await this.rpc<ReadAllResult>(
      "notification_mark_all_import_read",
      {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
        p_notification_type: type,
      },
    );
    if (
      !isRecord(result) ||
      !Number.isSafeInteger(result.acknowledged_count) ||
      (result.acknowledged_count as number) < 0 ||
      !isIsoTimestamp(result.completed_at)
    ) {
      invalidRpcResult();
    }
    await this.pruneBestEffort(auth);
    return result as unknown as ReadAllResult;
  }

  private async pruneBestEffort(auth: AuthContext): Promise<void> {
    try {
      await this.rpc<number>("notification_prune_import_acknowledgements", {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
        p_limit: 500,
      });
    } catch {
      // Retention maintenance must never turn an acknowledged user action into
      // a false failure. The RPC itself is bounded and service-role-only.
      console.warn("[notifications] bounded acknowledgement pruning deferred");
    }
  }
}

// ============================================================================
// TSH Synergy AR — Gate B notification hooks
//
// Import-alert-only. Every query identity is scoped to the authenticated
// company AND user (plus filter/cursor where applicable), so a company switch
// or user switch can never surface the previous context's notifications or
// acknowledgement state. The cursor is opaque and never decoded here.
// ============================================================================

"use client";

import { useEffect, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import { useAuthContext } from "@/hooks/use-auth-context";
import { useCompanyStore } from "@/stores/company-store";
import {
  NOTIFICATION_MAX_LIMIT,
  clampNotificationLimit,
  isValidNotificationBroadcast,
  notificationChannelName,
  notificationListParams,
  parseNotificationListPage,
  parseNotificationReadAllResult,
  parseNotificationReadOneResult,
  parseUnreadCount,
  readAllBody,
  readOneBody,
  type NotificationFilters,
  type NotificationItem,
  type NotificationListPage,
  type NotificationType,
} from "@/lib/notifications";

/** Root cache namespace — invalidating this prefix refetches list + unread. */
const NOTIFICATIONS_KEY = "notifications";

/** Bounded preview size for the header dropdown (still a real ≤20 page). */
export const NOTIFICATION_PREVIEW_LIMIT = 6;

function notificationIdentityKey(companyId: string, userId: string) {
  return [NOTIFICATIONS_KEY, companyId, userId] as const;
}

function notificationListKey(
  companyId: string,
  userId: string,
  filters: NotificationFilters,
  limit: number,
) {
  return [
    ...notificationIdentityKey(companyId, userId),
    "list",
    { readState: filters.readState, type: filters.type, limit },
  ] as const;
}

function notificationUnreadKey(companyId: string, userId: string) {
  return [...notificationIdentityKey(companyId, userId), "unread-count"] as const;
}

function useNotificationIdentity(): { companyId: string; userId: string; ready: boolean } {
  const companyId = useCompanyStore((state) => state.companyId);
  const { data: auth } = useAuthContext();
  const userId = auth?.user.id ?? "";
  return {
    companyId,
    userId,
    ready: companyId.trim().length > 0 && userId.trim().length > 0,
  };
}

/**
 * Best-effort cross-tab broadcast after a successful acknowledgement. Opens a
 * short-lived company/user-scoped channel; failures are swallowed so a real
 * acknowledgement is never turned into a false error.
 */
function postNotificationBroadcast(
  kind: "read-one" | "read-all",
  companyId: string,
  userId: string,
): void {
  if (typeof BroadcastChannel === "undefined") return;
  if (!companyId || !userId) return;
  try {
    const channel = new BroadcastChannel(notificationChannelName(companyId, userId));
    channel.postMessage({ kind, companyId, userId });
    channel.close();
  } catch {
    // Broadcasting is advisory only.
  }
}

// ─── List (cursor-paginated, Load more) ──────────────────────────────────────

export interface UseNotificationListResult {
  items: NotificationItem[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  isRefetching: boolean;
}

/**
 * Cursor-paginated notification list. Filter changes produce a new query key,
 * which resets the accumulated pages. Pages append via `fetchNextPage`; the
 * opaque `next_cursor` is echoed verbatim, so there are no duplicates or skips.
 */
export function useNotificationList(
  filters: NotificationFilters,
  options?: { limit?: number; enabled?: boolean },
): UseNotificationListResult {
  const api = useApi();
  const { companyId, userId, ready } = useNotificationIdentity();
  const limit = clampNotificationLimit(options?.limit ?? NOTIFICATION_MAX_LIMIT);
  const enabled = ready && (options?.enabled ?? true);

  const query = useInfiniteQuery<NotificationListPage>({
    queryKey: notificationListKey(companyId, userId, filters, limit),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const res = await api.getWithMeta<unknown>("/notifications", {
        params: notificationListParams(filters, pageParam as string | null, limit),
      });
      return parseNotificationListPage(res.data, res.meta);
    },
    getNextPageParam: (lastPage) =>
      lastPage.meta.has_more ? lastPage.meta.next_cursor : undefined,
    enabled,
    staleTime: 30_000,
  });

  return {
    items: (query.data?.pages ?? []).flatMap((page) => page.data),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    hasMore: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
    },
    refetch: () => query.refetch(),
    isRefetching: query.isRefetching,
  };
}

// ─── Unread count (independent of the list page) ─────────────────────────────

/**
 * Unread badge count — a dedicated query, never derived from loaded list rows,
 * so it stays correct with more than 20 unread notifications.
 */
export function useUnreadNotificationCount() {
  const api = useApi();
  const { companyId, userId, ready } = useNotificationIdentity();

  return useQuery({
    queryKey: notificationUnreadKey(companyId, userId),
    queryFn: async () => {
      const data = await api.get<unknown>("/notifications/unread-count");
      return parseUnreadCount(data);
    },
    enabled: ready,
    staleTime: 30_000,
  });
}

// ─── Read-one / read-all mutations ───────────────────────────────────────────

/** Mark a single notification read (idempotent server-side). */
export function useMarkNotificationRead() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId, userId } = useNotificationIdentity();

  return useMutation({
    mutationFn: async (notificationKey: string) => {
      if (!companyId || !userId) {
        throw new Error("Notification identity is unavailable.");
      }
      const identity = { companyId, userId };
      const result = await api.post<unknown>(
        "/notifications/read",
        readOneBody(notificationKey),
        { silent: true },
      );
      return {
        result: parseNotificationReadOneResult(result),
        identity,
      };
    },
    onSuccess: ({ identity }) => {
      qc.invalidateQueries({
        queryKey: notificationIdentityKey(identity.companyId, identity.userId),
      });
      postNotificationBroadcast(
        "read-one",
        identity.companyId,
        identity.userId,
      );
    },
  });
}

/**
 * Mark every currently-actionable notification read. The server derives the
 * full set; only an optional type scope is sent — never a client key list.
 */
export function useMarkAllNotificationsRead() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId, userId } = useNotificationIdentity();

  return useMutation({
    mutationFn: async (type: NotificationType | null) => {
      if (!companyId || !userId) {
        throw new Error("Notification identity is unavailable.");
      }
      const identity = { companyId, userId };
      const result = await api.post<unknown>(
        "/notifications/read-all",
        readAllBody(type),
        { silent: true },
      );
      return {
        result: parseNotificationReadAllResult(result),
        identity,
      };
    },
    onSuccess: ({ identity }) => {
      qc.invalidateQueries({
        queryKey: notificationIdentityKey(identity.companyId, identity.userId),
      });
      postNotificationBroadcast(
        "read-all",
        identity.companyId,
        identity.userId,
      );
    },
  });
}

// ─── Cross-tab + focus synchronization ───────────────────────────────────────

/**
 * Refresh notifications when the window regains focus, and when another tab of
 * the SAME company/user broadcasts an acknowledgement. Listeners are cleaned up
 * on unmount and re-bound when the identity changes; cross-company/user
 * messages are ignored.
 */
export function useNotificationSync(): void {
  const qc = useQueryClient();
  const { companyId, userId, ready } = useNotificationIdentity();
  const previousIdentity = useRef<{ companyId: string; userId: string } | null>(
    null,
  );

  useEffect(() => {
    const previous = previousIdentity.current;
    const current = ready ? { companyId, userId } : null;

    if (
      previous &&
      (!current ||
        previous.companyId !== current.companyId ||
        previous.userId !== current.userId)
    ) {
      qc.removeQueries({
        queryKey: notificationIdentityKey(
          previous.companyId,
          previous.userId,
        ),
      });
    }
    previousIdentity.current = current;

    if (!current) return;

    const invalidate = () =>
      qc.invalidateQueries({
        queryKey: notificationIdentityKey(companyId, userId),
      });

    const handleFocus = () => invalidate();
    window.addEventListener("focus", handleFocus);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(
          notificationChannelName(companyId, userId),
        );
        channel.onmessage = (event: MessageEvent) => {
          if (isValidNotificationBroadcast(event.data, companyId, userId)) {
            invalidate();
          }
        };
      } catch {
        channel = null;
      }
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      channel?.close();
    };
  }, [qc, companyId, userId, ready]);
}

// ============================================================================
// Gate B — shared notification contract tests.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_MAX_LIMIT,
  clampNotificationLimit,
  notificationListParams,
  readOneBody,
  readAllBody,
  parseNotificationListPage,
  parseUnreadCount,
  parseNotificationReadOneResult,
  parseNotificationReadAllResult,
  isNotificationActionable,
  formatUnreadBadge,
  resolveNotificationHref,
  notificationChannelName,
  isValidNotificationBroadcast,
  type NotificationItem,
} from "@/lib/notifications";

const item: NotificationItem = {
  notification_key: "import:11111111-1111-4111-8111-111111111111:import_error",
  type: "import_error",
  title: "Import completed with errors",
  message: "Batch 1 (invoice) has 2 error rows.",
  severity: "error",
  created_at: "2026-07-26T12:00:00+00:00",
  source: { type: "import_batch", id: "11111111-1111-4111-8111-111111111111" },
  deep_link: "/invoices/import",
  read_at: null,
};

describe("limit clamping", () => {
  it("never exceeds 20 and never drops below 1", () => {
    expect(clampNotificationLimit(50)).toBe(20);
    expect(clampNotificationLimit(21)).toBe(20);
    expect(clampNotificationLimit(0)).toBe(1);
    expect(clampNotificationLimit(-5)).toBe(1);
    expect(clampNotificationLimit(undefined)).toBe(NOTIFICATION_MAX_LIMIT);
    expect(clampNotificationLimit(10)).toBe(10);
  });
});

describe("list params", () => {
  it("sends only the four approved parameters and echoes the opaque cursor", () => {
    const params = notificationListParams(
      { readState: "unread", type: "import_error" },
      "OPAQUE_CURSOR",
      50,
    );
    expect(params).toEqual({
      limit: 20,
      read_state: "unread",
      type: "import_error",
      cursor: "OPAQUE_CURSOR",
    });
    expect(params).not.toHaveProperty("company_id");
    expect(params).not.toHaveProperty("user_id");
    expect(params).not.toHaveProperty("read_at");
  });

  it("omits type when null and cursor when absent", () => {
    const params = notificationListParams({ readState: "all", type: null }, null);
    expect(params).toEqual({ limit: 20, read_state: "all" });
  });
});

describe("read bodies", () => {
  it("read-one sends only the notification key", () => {
    expect(readOneBody(item.notification_key)).toEqual({
      notification_key: item.notification_key,
    });
  });

  it("read-all never sends a client key list", () => {
    expect(readAllBody(null)).toEqual({});
    expect(readAllBody("import_review")).toEqual({ type: "import_review" });
    expect(JSON.stringify(readAllBody(null))).not.toContain("notification_key");
  });
});

describe("defensive parsing", () => {
  it("parses a valid list page", () => {
    const page = parseNotificationListPage([item], {
      limit: 20,
      next_cursor: "NEXT",
      has_more: true,
    });
    expect(page.data).toHaveLength(1);
    expect(page.meta.next_cursor).toBe("NEXT");
    expect(page.meta.has_more).toBe(true);
  });

  it("throws on malformed rows or metadata", () => {
    expect(() =>
      parseNotificationListPage([{ bad: true }], {
        limit: 20,
        next_cursor: null,
        has_more: false,
      }),
    ).toThrow();
    expect(() =>
      parseNotificationListPage([item], {
        limit: 20,
        next_cursor: null,
        has_more: "yes",
      }),
    ).toThrow();
    expect(() =>
      parseNotificationListPage("nope", {
        limit: 20,
        next_cursor: null,
        has_more: false,
      }),
    ).toThrow();
    expect(() =>
      parseNotificationListPage([item], {
        limit: 20,
        has_more: true,
        next_cursor: 5,
      }),
    ).toThrow();
    expect(() =>
      parseNotificationListPage([item], {
        limit: "20",
        next_cursor: null,
        has_more: false,
      }),
    ).toThrow();
    expect(() =>
      parseNotificationListPage([item], {
        limit: 20,
        next_cursor: null,
        has_more: true,
      }),
    ).toThrow();
    expect(() =>
      parseNotificationListPage([item], {
        limit: 20,
        next_cursor: "unexpected",
        has_more: false,
      }),
    ).toThrow();
  });

  it("rejects an overdue_ar type (fully de-scoped)", () => {
    const bad = { ...item, type: "overdue_ar" };
    expect(() =>
      parseNotificationListPage([bad], {
        limit: 20,
        next_cursor: null,
        has_more: false,
      }),
    ).toThrow();
  });

  it("parses and strictly validates unread and mutation responses", () => {
    expect(parseUnreadCount({ unread_count: 128 })).toBe(128);
    expect(() => parseUnreadCount({ unread_count: -1 })).toThrow();
    expect(() => parseUnreadCount({ unread_count: 1.5 })).toThrow();
    expect(() => parseUnreadCount({ unread_count: "128" })).toThrow();
    expect(() => parseUnreadCount(null)).toThrow();

    expect(
      parseNotificationReadOneResult({
        notification_key: item.notification_key,
        read_at: "2026-07-26T13:00:00+00:00",
      }),
    ).toEqual({
      notification_key: item.notification_key,
      read_at: "2026-07-26T13:00:00+00:00",
    });
    expect(() =>
      parseNotificationReadOneResult({
        notification_key: "invalid",
        read_at: "2026-07-26T13:00:00+00:00",
      }),
    ).toThrow();
    expect(() =>
      parseNotificationReadOneResult({
        notification_key: item.notification_key,
        read_at: "not-a-date",
      }),
    ).toThrow();

    expect(
      parseNotificationReadAllResult({
        acknowledged_count: 25,
        completed_at: "2026-07-26T13:00:00+00:00",
      }),
    ).toEqual({
      acknowledged_count: 25,
      completed_at: "2026-07-26T13:00:00+00:00",
    });
    expect(() =>
      parseNotificationReadAllResult({
        acknowledged_count: "25",
        completed_at: "2026-07-26T13:00:00+00:00",
      }),
    ).toThrow();
  });
});

describe("presentation helpers", () => {
  it("marks unread items actionable and read items not", () => {
    expect(isNotificationActionable(item)).toBe(true);
    expect(isNotificationActionable({ ...item, read_at: "2026-07-26T13:00:00+00:00" })).toBe(
      false,
    );
  });

  it("caps the badge visibly while keeping the exact accessible count", () => {
    expect(formatUnreadBadge(128)).toEqual({
      visible: "99+",
      accessible: "128 unread notifications",
    });
    expect(formatUnreadBadge(1)).toEqual({
      visible: "1",
      accessible: "1 unread notification",
    });
    expect(formatUnreadBadge(0).visible).toBe("0");
  });
});

describe("safe deep links", () => {
  it("accepts controlled internal paths", () => {
    expect(resolveNotificationHref("/invoices/import")).toBe("/invoices/import");
    expect(resolveNotificationHref("/receipts/import")).toBe("/receipts/import");
    expect(resolveNotificationHref("/invoices/abc-1")).toBe("/invoices/abc-1");
  });

  it("rejects unmapped, external and dangerous values", () => {
    expect(resolveNotificationHref("/imports/11111111")).toBeNull(); // no such frontend page
    expect(resolveNotificationHref("javascript:alert(1)")).toBeNull();
    expect(resolveNotificationHref("https://evil.test")).toBeNull();
    expect(resolveNotificationHref("//evil.test")).toBeNull();
    expect(resolveNotificationHref("/invoices import")).toBeNull();
    expect(resolveNotificationHref("/invoices/../settings")).toBeNull();
    expect(resolveNotificationHref("/invoices/./abc")).toBeNull();
    expect(resolveNotificationHref(null)).toBeNull();
    expect(resolveNotificationHref(undefined)).toBeNull();
  });
});

describe("cross-tab broadcast isolation", () => {
  const companyId = "co-1";
  const userId = "user-1";

  it("builds a company+user scoped channel name", () => {
    expect(notificationChannelName(companyId, userId)).toBe("ar-notifications:co-1:user-1");
  });

  it("accepts only same-company/same-user well-formed messages", () => {
    expect(
      isValidNotificationBroadcast({ kind: "read-all", companyId, userId }, companyId, userId),
    ).toBe(true);
    expect(
      isValidNotificationBroadcast({ kind: "read-one", companyId, userId }, companyId, userId),
    ).toBe(true);
    // wrong company / user / kind / shape
    expect(
      isValidNotificationBroadcast({ kind: "read-all", companyId: "co-2", userId }, companyId, userId),
    ).toBe(false);
    expect(
      isValidNotificationBroadcast({ kind: "read-all", companyId, userId: "user-2" }, companyId, userId),
    ).toBe(false);
    expect(
      isValidNotificationBroadcast({ kind: "spoof", companyId, userId }, companyId, userId),
    ).toBe(false);
    expect(isValidNotificationBroadcast("nope", companyId, userId)).toBe(false);
  });
});

// ============================================================================
// Gate B — notification hook / cache-identity tests.
// ============================================================================

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createFakeApi,
  createTestQueryClient,
  route,
  type FakeApi,
} from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";
import type { NotificationItem } from "@/lib/notifications";

let fakeApi: FakeApi;
let authUserId: string;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({
    data: authUserId ? { user: { id: authUserId, email: null } } : undefined,
  }),
}));

import {
  useNotificationList,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationSync,
} from "@/hooks/use-notifications";
import { DEFAULT_NOTIFICATION_FILTERS } from "@/lib/notifications";

function notificationBatchId(sequence: number): string {
  return `11111111-1111-4111-8111-${String(sequence).padStart(12, "0")}`;
}

function makeItem(
  sequence = 1,
  overrides: Partial<Omit<NotificationItem, "notification_key" | "source">> = {},
): NotificationItem {
  const batchId = notificationBatchId(sequence);
  const type = overrides.type ?? "import_error";
  return {
    notification_key: `import:${batchId}:${type}`,
    type,
    title: "Import completed with errors",
    message: "Batch 1 has 2 error rows.",
    severity: type === "import_error" ? "error" : "warning",
    created_at: "2026-07-26T12:00:00+00:00",
    source: { type: "import_batch", id: batchId },
    deep_link: "/invoices/import",
    read_at: null,
    ...overrides,
  };
}

function stableWrapper() {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  authUserId = "user-1";
  useCompanyStore.getState().setCompany("co-1", "Company One", "MYR");
});

describe("useNotificationList — cursor pagination and scoping", () => {
  it("caps the limit at 20 and echoes the opaque cursor across Load more without duplicates", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (params) => {
        if (!params.cursor) {
          return {
            data: [makeItem(1)],
            meta: { limit: params.limit, next_cursor: "CURSOR_2", has_more: true },
          };
        }
        return {
          data: [makeItem(2)],
          meta: { limit: params.limit, next_cursor: null, has_more: false },
        };
      }),
    ]);

    const { wrapper } = stableWrapper();
    const { result } = renderHook(
      () => useNotificationList(DEFAULT_NOTIFICATION_FILTERS, { limit: 50 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    // Requested limit is clamped to 20 even though 50 was asked for.
    expect(fakeApi.calls[0].params.limit).toBe(20);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    // Second page used the opaque cursor from the first page's meta.
    const secondCall = fakeApi.calls.find((c) => c.params.cursor === "CURSOR_2");
    expect(secondCall).toBeDefined();
    expect(result.current.items.map((i) => i.notification_key)).toEqual([
      makeItem(1).notification_key,
      makeItem(2).notification_key,
    ]);
    expect(result.current.hasMore).toBe(false);
  });

  it("does not query until company and user identity are both available", () => {
    authUserId = "";
    fakeApi = createFakeApi([route("/notifications", () => ({ data: [], meta: { has_more: false } }))]);
    const { wrapper } = stableWrapper();
    const { result } = renderHook(
      () => useNotificationList(DEFAULT_NOTIFICATION_FILTERS),
      { wrapper },
    );
    expect(result.current.isLoading).toBe(false);
    expect(fakeApi.calls).toHaveLength(0);
  });

  it("resets accumulation and re-requests with cursor cleared when the filter changes", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (params) => ({
        data: [makeItem(params.read_state === "all" ? 3 : 4)],
        meta: { limit: params.limit, next_cursor: "C", has_more: true },
      })),
    ]);
    const { wrapper } = stableWrapper();
    const { result, rerender } = renderHook(
      ({ readState }: { readState: "all" | "unread" }) =>
        useNotificationList({ readState, type: null }),
      { wrapper, initialProps: { readState: "all" as "all" | "unread" } },
    );

    await waitFor(() =>
      expect(result.current.items[0]?.notification_key).toBe(
        makeItem(3).notification_key,
      ),
    );
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    rerender({ readState: "unread" });
    // New filter key → fresh single page, cursor reset to undefined.
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]?.notification_key).toBe(
        makeItem(4).notification_key,
      );
    });
    const unreadCall = fakeApi.calls.find((c) => c.params.read_state === "unread");
    expect(unreadCall?.params.cursor).toBeUndefined();
  });

  it("company switch cannot display the previous company's notifications", async () => {
    let companySequence = 5;
    fakeApi = createFakeApi([
      route("/notifications", (params) => ({
        data: [makeItem(companySequence)],
        meta: { limit: params.limit, next_cursor: null, has_more: false },
      })),
    ]);
    const { wrapper } = stableWrapper();
    const { result } = renderHook(
      () => useNotificationList(DEFAULT_NOTIFICATION_FILTERS),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.items[0]?.notification_key).toBe(
        makeItem(5).notification_key,
      ),
    );

    act(() => {
      companySequence = 6;
      authUserId = "user-2";
      useCompanyStore.getState().setCompany("co-2", "Company Two", "SGD");
    });
    await waitFor(() =>
      expect(result.current.items[0]?.notification_key).toBe(
        makeItem(6).notification_key,
      ),
    );
  });

  it("surfaces an error state when the backend envelope is malformed", async () => {
    fakeApi = createFakeApi([
      route("/notifications", () => ({ data: [{ bogus: true }], meta: { has_more: false } })),
    ]);
    const { wrapper } = stableWrapper();
    const { result } = renderHook(
      () => useNotificationList(DEFAULT_NOTIFICATION_FILTERS),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useUnreadNotificationCount — independent of loaded rows", () => {
  it("reports counts greater than the page size", async () => {
    fakeApi = createFakeApi([
      route("/notifications/unread-count", () => ({ data: { unread_count: 128 } })),
    ]);
    const { wrapper } = stableWrapper();
    const { result } = renderHook(() => useUnreadNotificationCount(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(128));
  });
});

describe("read-one / read-all mutations", () => {
  it("read-one refetches the list and unread count", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (params) => ({
        data: [makeItem()],
        meta: { limit: params.limit, next_cursor: null, has_more: false },
      })),
      route("/notifications/unread-count", () => ({ data: { unread_count: 3 } })),
    ]);
    (fakeApi.post as Mock).mockResolvedValue({
      notification_key: makeItem().notification_key,
      read_at: "2026-07-26T13:00:00+00:00",
    });
    const { wrapper } = stableWrapper();
    const { result } = renderHook(
      () => ({
        list: useNotificationList(DEFAULT_NOTIFICATION_FILTERS),
        unread: useUnreadNotificationCount(),
        readOne: useMarkNotificationRead(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.items).toHaveLength(1));
    await waitFor(() => expect(result.current.unread.data).toBe(3));

    const listCallsBefore = fakeApi.calls.filter((c) => c.path === "/notifications").length;
    const unreadCallsBefore = fakeApi.calls.filter((c) => c.path === "/notifications/unread-count").length;

    await act(async () => {
      await result.current.readOne.mutateAsync("import:11111111-1111-4111-8111-111111111111:import_error");
    });

    // Only the notification key was posted.
    expect(fakeApi.post).toHaveBeenCalledWith(
      "/notifications/read",
      { notification_key: "import:11111111-1111-4111-8111-111111111111:import_error" },
      { silent: true },
    );

    await waitFor(() => {
      const listCallsAfter = fakeApi.calls.filter((c) => c.path === "/notifications").length;
      const unreadCallsAfter = fakeApi.calls.filter((c) => c.path === "/notifications/unread-count").length;
      expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
      expect(unreadCallsAfter).toBeGreaterThan(unreadCallsBefore);
    });
  });

  it("read-all sends only an optional type scope and never a client key list", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (params) => ({
        data: [], meta: { limit: params.limit, next_cursor: null, has_more: false },
      })),
    ]);
    (fakeApi.post as Mock).mockResolvedValue({
      acknowledged_count: 25,
      completed_at: "2026-07-26T13:00:00+00:00",
    });
    const { wrapper } = stableWrapper();
    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(null);
    });
    expect(fakeApi.post).toHaveBeenCalledWith("/notifications/read-all", {}, { silent: true });

    await act(async () => {
      await result.current.mutateAsync("import_error");
    });
    expect(fakeApi.post).toHaveBeenLastCalledWith(
      "/notifications/read-all",
      { type: "import_error" },
      { silent: true },
    );
    const bodies = (fakeApi.post as Mock).mock.calls.map((c) => JSON.stringify(c[1]));
    expect(bodies.every((b) => !b.includes("notification_key"))).toBe(true);
  });

  it("rejects malformed mutation responses without invalidating cached data", async () => {
    fakeApi = createFakeApi([]);
    (fakeApi.post as Mock).mockResolvedValue({
      notification_key: makeItem().notification_key,
      read_at: "not-a-date",
    });
    const { client, wrapper } = stableWrapper();
    client.setQueryData(
      ["notifications", "co-1", "user-1", "unread-count"],
      4,
    );
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync(makeItem().notification_key);
      }),
    ).rejects.toThrow(/malformed notification read response/i);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("keeps a pending acknowledgement bound to its originating identity", async () => {
    fakeApi = createFakeApi([]);
    let resolveRead: ((value: unknown) => void) | undefined;
    (fakeApi.post as Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const { client, wrapper } = stableWrapper();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, rerender } = renderHook(
      () => useMarkNotificationRead(),
      { wrapper },
    );

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync(makeItem().notification_key);
    });
    await waitFor(() => expect(resolveRead).toBeTypeOf("function"));

    act(() => {
      authUserId = "user-2";
      useCompanyStore.getState().setCompany("co-2", "Company Two", "SGD");
    });
    rerender();
    await act(async () => {
      resolveRead?.({
        notification_key: makeItem().notification_key,
        read_at: "2026-07-26T13:00:00+00:00",
      });
      await pending!;
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["notifications", "co-1", "user-1"],
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["notifications", "co-2", "user-2"],
    });
  });
});

describe("useNotificationSync — cross-tab + focus", () => {
  class MockBroadcastChannel {
    static instances: MockBroadcastChannel[] = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    closed = false;
    constructor(public name: string) {
      MockBroadcastChannel.instances.push(this);
    }
    postMessage() {}
    close() {
      this.closed = true;
    }
    emit(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }

  beforeEach(() => {
    MockBroadcastChannel.instances = [];
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      MockBroadcastChannel;
  });

  it("refetches on same-company/user broadcast, ignores others, and cleans up", async () => {
    fakeApi = createFakeApi([
      route("/notifications/unread-count", () => ({ data: { unread_count: 1 } })),
    ]);
    const { wrapper } = stableWrapper();
    const { result, unmount } = renderHook(
      () => {
        useNotificationSync();
        return useUnreadNotificationCount();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    const channel = MockBroadcastChannel.instances.find((c) =>
      c.name === "ar-notifications:co-1:user-1",
    );
    expect(channel).toBeDefined();

    const before = fakeApi.calls.length;
    act(() => channel!.emit({ kind: "read-all", companyId: "co-2", userId: "user-1" }));
    // Wrong company ignored — no refetch.
    expect(fakeApi.calls.length).toBe(before);
    act(() => channel!.emit({ kind: "read-all", companyId: "co-1", userId: "user-2" }));
    act(() => channel!.emit({ kind: "spoof", companyId: "co-1", userId: "user-1" }));
    expect(fakeApi.calls.length).toBe(before);

    act(() => channel!.emit({ kind: "read-all", companyId: "co-1", userId: "user-1" }));
    await waitFor(() => expect(fakeApi.calls.length).toBeGreaterThan(before));

    unmount();
    expect(channel!.closed).toBe(true);
  });

  it("refetches when the window regains focus", async () => {
    fakeApi = createFakeApi([
      route("/notifications/unread-count", () => ({ data: { unread_count: 2 } })),
    ]);
    const { wrapper } = stableWrapper();
    const { result } = renderHook(
      () => {
        useNotificationSync();
        return useUnreadNotificationCount();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(2));
    const before = fakeApi.calls.length;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(fakeApi.calls.length).toBeGreaterThan(before));
  });

  it("removes the previous identity cache and rebinds on company/user change", async () => {
    fakeApi = createFakeApi([
      route("/notifications/unread-count", () => ({ data: { unread_count: 2 } })),
    ]);
    const { client, wrapper } = stableWrapper();
    const { rerender } = renderHook(
      () => {
        useNotificationSync();
        return useUnreadNotificationCount();
      },
      { wrapper },
    );
    await waitFor(() =>
      expect(
        client.getQueryData(["notifications", "co-1", "user-1", "unread-count"]),
      ).toBe(2),
    );

    act(() => {
      authUserId = "user-2";
      useCompanyStore.getState().setCompany("co-2", "Company Two", "SGD");
    });
    rerender();

    await waitFor(() =>
      expect(
        client.getQueryData(["notifications", "co-1", "user-1", "unread-count"]),
      ).toBeUndefined(),
    );
    await waitFor(() =>
      expect(
        client.getQueryData(["notifications", "co-2", "user-2", "unread-count"]),
      ).toBe(2),
    );
    expect(
      MockBroadcastChannel.instances.some(
        (channel) => channel.name === "ar-notifications:co-2:user-2",
      ),
    ).toBe(true);
  });

  it("degrades safely when BroadcastChannel construction is blocked", async () => {
    class ThrowingBroadcastChannel {
      constructor() {
        throw new Error("blocked");
      }
    }
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      ThrowingBroadcastChannel;
    fakeApi = createFakeApi([
      route("/notifications/unread-count", () => ({ data: { unread_count: 1 } })),
    ]);
    const { wrapper } = stableWrapper();
    const { result } = renderHook(
      () => {
        useNotificationSync();
        return useUnreadNotificationCount();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(fakeApi.calls.length).toBeGreaterThan(1));
  });
});

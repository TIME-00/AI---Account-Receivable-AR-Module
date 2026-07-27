// ============================================================================
// Gate B — Notifications dropdown + full page component tests.
// ============================================================================

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { renderWithProviders, createFakeApi, route, type FakeApi } from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";
import type { NotificationItem } from "@/lib/notifications";

let fakeApi: FakeApi;
const routerPush = vi.fn();

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({ data: { user: { id: "user-1", email: null } } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { NotificationDropdown } from "@/components/features/notifications/notification-dropdown";
import NotificationsPage from "@/app/(dashboard)/notifications/page";

function notificationBatchId(sequence: number): string {
  return `11111111-1111-4111-8111-${String(sequence).padStart(12, "0")}`;
}

function item(
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
    deep_link: "/imports/11111111-1111-4111-8111-111111111111",
    read_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  routerPush.mockReset();
  useCompanyStore.getState().setCompany("co-1", "Company One", "MYR");
});

describe("NotificationDropdown", () => {
  it("shows the exact unread count accessibly while capping the visible pill at 99+", async () => {
    fakeApi = createFakeApi([
      route("/notifications/unread-count", () => ({ data: { unread_count: 128 } })),
      route("/notifications", (p) => ({
        data: [],
        meta: { limit: p.limit, next_cursor: null, has_more: false },
      })),
    ]);
    renderWithProviders(<NotificationDropdown />);
    await waitFor(() =>
      expect(screen.getByText("128 unread notifications")).toBeInTheDocument(),
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("opens a portal panel with a bounded preview, closes on Escape and restores focus", async () => {
    fakeApi = createFakeApi([
      route("/notifications/unread-count", () => ({ data: { unread_count: 2 } })),
      route("/notifications", (p) => ({
        data: [item(1, { title: "First alert" })],
        meta: { limit: p.limit, next_cursor: null, has_more: false },
      })),
    ]);
    renderWithProviders(<NotificationDropdown />);

    const trigger = await screen.findByRole("button", { name: "Notifications" });
    act(() => trigger.click());

    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(await within(panel).findByText("First alert")).toBeInTheDocument();
    // bounded preview requests at most NOTIFICATION_PREVIEW_LIMIT (<= 20)
    const listCall = fakeApi.calls.find((c) => c.path === "/notifications");
    expect(Number(listCall?.params.limit)).toBeLessThanOrEqual(20);
    // Full-page link present
    expect(within(panel).getByRole("link", { name: /view all notifications/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });
});

describe("NotificationsPage", () => {
  it("loads at most 20 initially and appends more without duplicates via Load more", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (p) => {
        if (!p.cursor) {
          return {
            data: [
              item(2, { title: "Alert A" }),
              item(3, { title: "Alert B" }),
            ],
            meta: { limit: p.limit, next_cursor: "CUR2", has_more: true },
          };
        }
        return {
          data: [item(4, { title: "Alert C" })],
          meta: { limit: p.limit, next_cursor: null, has_more: false },
        };
      }),
    ]);
    renderWithProviders(<NotificationsPage />);

    await waitFor(() => expect(screen.getByText("Alert A")).toBeInTheDocument());
    // initial request limit never exceeds 20
    expect(Number(fakeApi.calls[0].params.limit)).toBe(20);

    const loadMore = screen.getByRole("button", { name: /load more/i });
    act(() => loadMore.click());

    await waitFor(() => expect(screen.getByText("Alert C")).toBeInTheDocument());
    // no duplicate rows
    expect(screen.getAllByText("Alert A")).toHaveLength(1);
    // end of list — Load more disappears
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument(),
    );
  });

  it("resets accumulated rows when the filter changes", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (p) => ({
        data: [
          item(p.read_state === "all" ? 5 : 6, {
            title: `State ${p.read_state}`,
          }),
        ],
        meta: { limit: p.limit, next_cursor: null, has_more: false },
      })),
    ]);
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("State all")).toBeInTheDocument());

    act(() => screen.getByRole("button", { name: "Unread", pressed: false }).click());
    await waitFor(() => expect(screen.getByText("State unread")).toBeInTheDocument());
    expect(screen.queryByText("State all")).not.toBeInTheDocument();
  });

  it("renders a controlled empty state, not a failure, when there are no alerts", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (p) => ({
        data: [],
        meta: { limit: p.limit, next_cursor: null, has_more: false },
      })),
    ]);
    renderWithProviders(<NotificationsPage />);
    await waitFor(() =>
      expect(screen.getByText(/you're all caught up/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("shows an error state with retry on malformed responses", async () => {
    fakeApi = createFakeApi([
      route("/notifications", () => ({ data: [{ bad: true }], meta: { has_more: false } })),
    ]);
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText(/unavailable right now/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("marks a row read and sends only the notification key", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (p) => ({
        data: [item(7, { title: "Read me" })],
        meta: { limit: p.limit, next_cursor: null, has_more: false },
      })),
    ]);
    (fakeApi.post as Mock).mockResolvedValue({
      notification_key: item(7).notification_key,
      read_at: "2026-07-26T13:00:00+00:00",
    });
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("Read me")).toBeInTheDocument());

    act(() => screen.getByRole("button", { name: /mark read/i }).click());
    await waitFor(() =>
      expect(fakeApi.post).toHaveBeenCalledWith(
        "/notifications/read",
        { notification_key: item(7).notification_key },
        { silent: true },
      ),
    );
  });

  it("acknowledges an unread safe deep link before navigating and fails closed", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (p) => ({
        data: [item(8, { title: "Linked alert", deep_link: "/invoices/import" })],
        meta: { limit: p.limit, next_cursor: null, has_more: false },
      })),
    ]);
    let resolveRead: ((value: unknown) => void) | undefined;
    (fakeApi.post as Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("Linked alert")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("link", { name: /view import/i }));
    await waitFor(() => expect(resolveRead).toBeTypeOf("function"));
    expect(routerPush).not.toHaveBeenCalled();
    await act(async () => {
      resolveRead?.({
        notification_key: item(8).notification_key,
        read_at: "2026-07-26T13:00:00+00:00",
      });
    });
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/invoices/import"));

    routerPush.mockReset();
    (fakeApi.post as Mock).mockRejectedValueOnce(new Error("read failed"));
    fireEvent.click(screen.getByRole("link", { name: /view import/i }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalledTimes(2));
    expect(routerPush).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("alert"),
      ).toHaveTextContent(/could not be marked read/i),
    );
  });

  it("mark-all sends the current type scope and never a client key list", async () => {
    fakeApi = createFakeApi([
      route("/notifications", (p) => ({
        data: [item()],
        meta: { limit: p.limit, next_cursor: null, has_more: false },
      })),
    ]);
    (fakeApi.post as Mock).mockResolvedValue({
      acknowledged_count: 1,
      completed_at: "2026-07-26T13:00:00+00:00",
    });
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("Import completed with errors")).toBeInTheDocument());

    act(() => screen.getByRole("button", { name: /mark all read/i }).click());
    await waitFor(() =>
      expect(fakeApi.post).toHaveBeenCalledWith("/notifications/read-all", {}, { silent: true }),
    );
    const body = (fakeApi.post as Mock).mock.calls[0][1];
    expect(JSON.stringify(body)).not.toContain("notification_key");
  });
});

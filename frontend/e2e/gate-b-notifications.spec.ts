import { expect, test } from "@playwright/test";
import {
  assertReadOnlyBrowserDiagnosticsClean,
  installLocalAuditProxy,
  observeReadOnlyBrowserDiagnostics,
} from "./gate-b-readonly-diagnostics";

// ============================================================================
// Gate B — Notifications dropdown + full page (frontend behaviour).
//
// Structural / keyboard / a11y behaviours that hold regardless of the data
// state (the Gate B notification Edge functions are not deployed, so data may
// legitimately be empty or unavailable). This spec is strictly READ-ONLY: it
// never marks a notification read or read-all, so it is safe against any target.
// It runs only against a local base URL.
// ============================================================================

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "";
function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}
const isLocal = isLoopbackHttpUrl(baseURL);

test.describe("Gate B notifications UI", () => {
  test.skip(!isLocal, "Gate B frontend is local-only until its authorized deployment.");
  test.beforeEach(async ({ page }) => {
    await installLocalAuditProxy(page);
    observeReadOnlyBrowserDiagnostics(page);
  });
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    assertReadOnlyBrowserDiagnosticsClean(page);
  });

  test("opens the notification dropdown as a portal, closes on Escape and restores focus", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

    const bell = page.getByRole("button", { name: "Notifications" });
    await expect(bell).toBeVisible();
    await bell.click();

    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: /view all notifications/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(bell).toBeFocused();
  });

  test("full notifications page renders bounded filters and an import-alert list region", async ({
    page,
  }) => {
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("group", { name: /read state filter/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unread", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: /type filter/i })).toBeVisible();
    await expect(page.getByText("Import alerts", { exact: true })).toBeVisible();
    // Never presents overdue alerts (import-alert-only).
    await expect(page.getByText(/overdue/i)).toHaveCount(0);
  });
});

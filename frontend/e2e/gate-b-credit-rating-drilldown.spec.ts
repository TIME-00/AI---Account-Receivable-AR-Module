import { expect, test } from "@playwright/test";
import {
  assertReadOnlyBrowserDiagnosticsClean,
  installLocalAuditProxy,
  observeReadOnlyBrowserDiagnostics,
} from "./gate-b-readonly-diagnostics";

// ============================================================================
// Gate B — Dashboard credit-rating drill-down (frontend behaviour).
//
// The drill-down navigation, URL state, active-rating chip and clear control
// are pure frontend behaviours. They are only present on a build that includes
// the Gate B frontend, so this spec runs ONLY against a local base URL and
// skips against the production shell (where Gate B is not yet deployed).
// Read-only throughout — navigation only, no mutation.
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

test.describe("Gate B credit-rating drill-down", () => {
  test.skip(!isLocal, "Gate B frontend is local-only until its authorized deployment.");
  test.beforeEach(async ({ page }) => {
    await installLocalAuditProxy(page);
    observeReadOnlyBrowserDiagnostics(page);
  });
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    assertReadOnlyBrowserDiagnosticsClean(page);
  });

  test("drills from the dashboard rating chart into the filtered aging view and clears it", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

    const ratingGroup = page.getByRole("group", { name: /drill down by credit rating/i });
    await expect(ratingGroup).toBeVisible();

    // Activate the first available rating control (keyboard-accessible button).
    const firstRating = ratingGroup.getByRole("button").first();
    const ratingLabel = (await firstRating.getAttribute("aria-label")) ?? "";
    const match = ratingLabel.match(/credit rating (AAA|AA|A|B|C|D)\b/i);
    const rating = match?.[1] ?? "A";

    await firstRating.click();

    await expect(page).toHaveURL(new RegExp(`/reports/aging\\?credit_rating=${rating}`));
    await expect(page.getByText(new RegExp(`credit rating: ${rating}`, "i"))).toBeVisible();

    // Clear the filter — returns to the unfiltered report.
    await page.getByRole("button", { name: /clear credit rating filter/i }).click();
    await expect(page).toHaveURL(/\/reports\/aging(?:$|\?)/);
    await expect(page.getByText(/credit rating:/i)).toHaveCount(0);
  });
});

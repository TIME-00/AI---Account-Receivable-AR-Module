import { existsSync, readFileSync, statSync } from "node:fs";
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { buildRawExport } from "../src/lib/export/test/export-fixtures";
import type { ExportReportType } from "../src/lib/export/types";

// ============================================================================
// Gate C — Report export (PDF / XLSX) frontend behaviour.
//
// The four export controls, client-side generation and download are pure
// frontend behaviours only present on a build that includes the Gate C
// frontend, so this spec runs ONLY against a local base URL and skips against
// the production shell (where Gate C is not deployed).
//
// Export responses are ALWAYS intercepted with synthetic JSON — no real
// Production/Supabase export dataset is ever requested or downloaded. Read-only
// throughout: the export routes are GET-only and never mutate.
// ============================================================================

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "";
function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}
const isLocal = isLoopbackHttpUrl(baseURL);

type GateCWorkerFixtures = {
  authenticatedContext: BrowserContext;
};

/**
 * Reuse one authenticated context per browser project while keeping one fresh
 * page per test. Long serial runs must not repeatedly consume the same saved
 * refresh token from separate contexts. The configured storageState path is
 * passed directly to Playwright and is never read, copied, rewritten or logged.
 */
const test = base.extend<{ page: Page }, GateCWorkerFixtures>({
  authenticatedContext: [
    async ({ browser }, use, workerInfo) => {
      const projectUse = workerInfo.project.use;
      const context = await browser.newContext({
        acceptDownloads: true,
        baseURL: projectUse.baseURL as string | undefined,
        storageState: projectUse.storageState,
        viewport: projectUse.viewport,
        userAgent: projectUse.userAgent,
        deviceScaleFactor: projectUse.deviceScaleFactor,
        hasTouch: projectUse.hasTouch,
        isMobile: projectUse.isMobile,
        locale: projectUse.locale,
        colorScheme: projectUse.colorScheme,
        recordVideo: { dir: workerInfo.project.outputDir },
      });
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],
  page: async ({ authenticatedContext }, use, testInfo) => {
    const page = await authenticatedContext.newPage();
    page.setDefaultTimeout(
      typeof testInfo.project.use.actionTimeout === "number"
        ? testInfo.project.use.actionTimeout
        : 15_000,
    );
    page.setDefaultNavigationTimeout(
      typeof testInfo.project.use.navigationTimeout === "number"
        ? testInfo.project.use.navigationTimeout
        : 30_000,
    );
    await use(page);
    await page.close();
  },
});

interface PageSpec {
  path: string;
  type: ExportReportType;
  filenamePrefix: string;
  requiredFilters: string[];
}

const PAGES: PageSpec[] = [
  { path: "/reports/aging", type: "aging", filenamePrefix: "ar-aging-report", requiredFilters: ["as_of_date"] },
  { path: "/reports/invoices", type: "invoices", filenamePrefix: "invoice-summary", requiredFilters: ["date_from", "date_to"] },
  { path: "/reports/receipts", type: "receipts", filenamePrefix: "receipt-summary", requiredFilters: ["date_from", "date_to"] },
  { path: "/reports/outstanding", type: "customer-outstanding", filenamePrefix: "customer-outstanding", requiredFilters: ["as_of_date"] },
];

const FORBIDDEN_PARAMS = ["page", "page_size", "cursor", "company_id", "user_id"];

interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: string[];
}

function collectDiagnostics(
  page: Page,
  allowResponseFailure?: (status: number, url: URL) => boolean,
  allowConsoleError?: (message: string) => boolean,
): Diagnostics {
  const diagnostics: Diagnostics = { consoleErrors: [], pageErrors: [], failedResponses: [] };
  page.on("console", (m) => {
    if (m.type() === "error" && !allowConsoleError?.(m.text())) {
      diagnostics.consoleErrors.push(m.text());
    }
  });
  page.on("pageerror", (e) => diagnostics.pageErrors.push(e.message));
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = new URL(response.url());
    if (allowResponseFailure?.(status, url)) return;
    diagnostics.failedResponses.push(`${status} ${url.pathname}`);
  });
  return diagnostics;
}

function assertNoRuntimeErrors(diagnostics: Diagnostics): void {
  expect(diagnostics.pageErrors, diagnostics.pageErrors.join("\n")).toEqual([]);
  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join("\n")).toEqual([]);
  expect(diagnostics.failedResponses, diagnostics.failedResponses.join("\n")).toEqual([]);
}

/** Intercept the export route and capture the request params it received. */
async function interceptExport(
  page: Page,
  type: ExportReportType,
  handler: (route: Route) => Promise<void> | void,
): Promise<{ lastParams: URLSearchParams | null }> {
  const captured: { lastParams: URLSearchParams | null } = { lastParams: null };
  await page.route(`**/reports/export/${type}*`, async (route) => {
    captured.lastParams = new URL(route.request().url()).searchParams;
    await handler(route);
  });
  return captured;
}

function ok(type: ExportReportType) {
  return (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: buildRawExport(type, { count: 6 }) }),
    });
}

async function openExportMenu(page: Page) {
  const trigger = page.getByRole("button", { name: /^export$/i });
  await expect(trigger).toBeEnabled({ timeout: 30_000 });
  await trigger.click();
  return page.getByRole("menu", { name: /choose export format/i });
}

test.describe("Gate C report export", () => {
  test.skip(!isLocal, "Gate C frontend is local-only until its authorized deployment.");

  for (const spec of PAGES) {
    test(`${spec.path}: exports PDF with the page filters and no pagination`, async ({ page }) => {
      const diagnostics = collectDiagnostics(page);
      const captured = await interceptExport(page, spec.type, ok(spec.type));

      await page.goto(spec.path, { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

      const menu = await openExportMenu(page);
      await expect(menu.getByRole("menuitem", { name: /export as pdf/i })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: /export as excel/i })).toBeVisible();

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        menu.getByRole("menuitem", { name: /export as pdf/i }).click(),
      ]);

      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^${spec.filenamePrefix}_\\d{4}-\\d{2}-\\d{2}\\.pdf$`),
      );
      const file = await download.path();
      expect(file && existsSync(file) && statSync(file).size > 0).toBe(true);
      expect(readFileSync(file!).subarray(0, 5).toString("ascii")).toBe("%PDF-");

      // The export request carried the report's own filters — never pagination
      // or identity.
      const params = captured.lastParams!;
      for (const key of spec.requiredFilters) expect(params.has(key)).toBe(true);
      for (const key of FORBIDDEN_PARAMS) expect(params.has(key)).toBe(false);
      expect([...params.keys()].sort()).toEqual(spec.requiredFilters.slice().sort());

      await expect(page.getByRole("status")).toContainText(/downloaded/i);
      assertNoRuntimeErrors(diagnostics);
    });
  }

  test("/reports/invoices: exports a non-empty XLSX with the correct extension", async ({ page }) => {
    const diagnostics = collectDiagnostics(page);
    await interceptExport(page, "invoices", ok("invoices"));

    await page.goto("/reports/invoices", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

    const menu = await openExportMenu(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      menu.getByRole("menuitem", { name: /export as excel/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^invoice-summary_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const file = await download.path();
    expect(file && statSync(file).size > 0).toBe(true);
    expect(readFileSync(file!).subarray(0, 2).toString("ascii")).toBe("PK");
    assertNoRuntimeErrors(diagnostics);
  });

  test("/reports/aging: exports an empty XLSX as a valid workbook", async ({ page }) => {
    const diagnostics = collectDiagnostics(page);
    const captured = await interceptExport(page, "aging", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: buildRawExport("aging", { count: 0 }) }),
      }));

    await page.goto("/reports/aging", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

    const menu = await openExportMenu(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      menu.getByRole("menuitem", { name: /export as excel/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^ar-aging-report_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const file = await download.path();
    expect(file && statSync(file).size > 0).toBe(true);
    expect(readFileSync(file!).subarray(0, 2).toString("ascii")).toBe("PK");
    expect(captured.lastParams?.has("as_of_date")).toBe(true);
    for (const key of FORBIDDEN_PARAMS) expect(captured.lastParams?.has(key)).toBe(false);
    await expect(page.getByRole("status")).toContainText(/downloaded/i);
    assertNoRuntimeErrors(diagnostics);
  });

  test("/reports/aging: renders the oversize error and does not download", async ({ page }) => {
    const diagnostics = collectDiagnostics(
      page,
      (status, url) => status === 422 && url.pathname.endsWith("/reports/export/aging"),
      (message) =>
        message ===
          "Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)",
    );
    await interceptExport(page, "aging", (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "EXPORT_DATASET_TOO_LARGE",
            message: "too big",
            details: { row_limit: 5000, payload_limit_bytes: 8388608, estimated_rows: 9000 },
          },
        }),
      }));

    await page.goto("/reports/aging", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
    const menu = await openExportMenu(page);

    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await menu.getByRole("menuitem", { name: /export as pdf/i }).click();

    await expect(page.getByRole("status")).toContainText(/too large/i);
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
    expect(downloaded).toBe(false);
    assertNoRuntimeErrors(diagnostics);
  });

  test("/reports/aging: renders a safe error for a malformed response", async ({ page }) => {
    const diagnostics = collectDiagnostics(page);
    await interceptExport(page, "aging", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { schema_version: 1, report_type: "aging", rows: "nope" } }),
      }));

    await page.goto("/reports/aging", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
    const menu = await openExportMenu(page);

    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await menu.getByRole("menuitem", { name: /export as pdf/i }).click();

    await expect(page.getByRole("status")).toContainText(/malformed|could not|failed|reached|not be/i);
    expect(downloaded).toBe(false);
    assertNoRuntimeErrors(diagnostics);
  });

  test("/reports/aging: export menu is keyboard operable and Escape restores focus", async ({ page }) => {
    const diagnostics = collectDiagnostics(page);
    await interceptExport(page, "aging", ok("aging"));

    await page.goto("/reports/aging", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

    const trigger = page.getByRole("button", { name: /^export$/i });
    await trigger.click();
    const menu = page.getByRole("menu", { name: /choose export format/i });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    assertNoRuntimeErrors(diagnostics);
  });
});

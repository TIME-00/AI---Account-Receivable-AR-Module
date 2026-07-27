import { expect, type Page } from "@playwright/test";

interface BrowserDiagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: string[];
}

const diagnosticsByPage = new WeakMap<Page, BrowserDiagnostics>();

function requireLoopbackHttpOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new Error("Gate B local proxy targets must be loopback HTTP origins.");
  }
  return url;
}

/**
 * When an independently-owned process has left port 3100 serving stale assets,
 * tests may proxy only the local application resources to an isolated audit
 * build. The browser URL remains 127.0.0.1:3100, so the configured storageState
 * stays origin-scoped without being read or copied.
 */
export async function installLocalAuditProxy(page: Page): Promise<void> {
  const targetText = process.env.PLAYWRIGHT_LOCAL_PROXY_TARGET;
  if (!targetText) return;
  const source = requireLoopbackHttpOrigin(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
  );
  const target = requireLoopbackHttpOrigin(targetText);

  await page.route(`${source.origin}/**`, async (route) => {
    try {
      const requested = new URL(route.request().url());
      const proxied = new URL(
        `${requested.pathname}${requested.search}`,
        target.origin,
      );
      const response = await route.fetch({ url: proxied.toString() });
      const body = await response.body();
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body,
      });
    } catch (error) {
      // A speculative Next prefetch can be cancelled exactly as the test closes
      // the page. Playwright then reports an already-handled/disposed route even
      // though the application request completed or was intentionally aborted.
      // This narrow teardown race is not an allow-list for HTTP/console errors;
      // those remain captured below and still fail the test.
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Route is already handled") ||
        message.includes("Response has been disposed") ||
        message.includes("Test ended")
      ) {
        return;
      }
      throw error;
    }
  });
}

/**
 * Surface real runtime and network failures in local Gate B browser checks.
 * Query strings and fragments are omitted so diagnostics cannot retain
 * credential-like URL material.
 */
export function observeReadOnlyBrowserDiagnostics(
  page: Page,
): void {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  diagnosticsByPage.set(page, { consoleErrors, pageErrors, failedResponses });

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    failedResponses.push(
      `${response.status()} ${response.request().resourceType()} ${url.origin}${url.pathname}`,
    );
  });

}

export function assertReadOnlyBrowserDiagnosticsClean(page: Page): void {
  const diagnostics = diagnosticsByPage.get(page);
  if (!diagnostics) throw new Error("Browser diagnostics were not installed.");
  expect(
    diagnostics.pageErrors,
    `Uncaught page errors:\n${diagnostics.pageErrors.join("\n")}`,
  ).toEqual([]);
  expect(
    diagnostics.failedResponses,
    `HTTP error responses:\n${diagnostics.failedResponses.join("\n")}`,
  ).toEqual([]);
  expect(
    diagnostics.consoleErrors,
    `Browser console errors:\n${diagnostics.consoleErrors.join("\n")}`,
  ).toEqual([]);
}

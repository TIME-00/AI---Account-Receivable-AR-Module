import { expect, test } from "@playwright/test";

const PRODUCTION_ORIGIN = "https://account-receivable-module.vercel.app";
const FAVICON_404_CONSOLE =
  "Failed to load resource: the server responded with a status of 404 ()";

interface FailedResponseMetadata {
  url: string;
  status: number;
  method: string;
  resourceType: string;
}

/**
 * System Chrome may request the optional conventional favicon even though the
 * deployed shell does not advertise one. Keep this allow-list exact: any
 * query, method, status, resource type, origin or path difference must fail.
 */
export function isKnownOptionalProductionFavicon404(
  failure: FailedResponseMetadata,
): boolean {
  try {
    const url = new URL(failure.url);
    return failure.status === 404 &&
      failure.method === "GET" &&
      failure.resourceType === "other" &&
      url.origin === PRODUCTION_ORIGIN &&
      url.pathname === "/favicon.ico" &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

test.describe("Authenticated AR smoke", () => {
  test("demo user can open the protected read-only surfaces without browser errors", async ({
    page,
  }) => {
    const consoleErrors: Array<{ text: string; locationUrl: string }> = [];
    const pageErrors: string[] = [];
    const failedResponses = new Set<string>();
    const knownOptionalFaviconUrls = new Set<string>();
    const cdpRequests = new Map<string, { url: string; method: string }>();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (event) => {
      cdpRequests.set(event.requestId, {
        url: event.request.url,
        method: event.request.method,
      });
    });
    cdp.on("Network.responseReceived", (event) => {
      if (event.response.status < 400) return;
      const request = cdpRequests.get(event.requestId);
      const failure = {
        url: event.response.url,
        status: event.response.status,
        method: request?.method ?? "UNKNOWN",
        resourceType: event.type.toLowerCase(),
      };
      if (isKnownOptionalProductionFavicon404(failure)) {
        knownOptionalFaviconUrls.add(failure.url);
        return;
      }
      failedResponses.add(
        `${failure.status} ${failure.resourceType} ${failure.url}`,
      );
    });

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push({
          text: message.text(),
          locationUrl: message.location().url,
        });
      }
    });

    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    page.on("response", (response) => {
      const status = response.status();

      if (status >= 400) {
        const failure = {
          url: response.url(),
          status,
          method: response.request().method(),
          resourceType: response.request().resourceType(),
        };
        if (isKnownOptionalProductionFavicon404(failure)) {
          knownOptionalFaviconUrls.add(failure.url);
          return;
        }
        failedResponses.add(
          `${status} ${response.request().resourceType()} ${response.url()}`,
        );
      }
    });

    // -------------------------------------------------------------------------
    // Dashboard and notification dropdown entry point
    // -------------------------------------------------------------------------

    await page.goto("/", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
    await expect(
      page.getByRole("heading", {
        name: "AR Dashboard",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Notifications",
      }),
    ).toBeVisible();

    // -------------------------------------------------------------------------
    // Invoices
    // -------------------------------------------------------------------------

    await page.goto("/invoices", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
    await expect(page).toHaveURL(/\/invoices(?:[/?#]|$)/);

    await expect(
      page.getByRole("heading", {
        name: "Invoice Management",
      }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", {
        name: /new invoice/i,
      }),
    ).toBeVisible();

    await expect(
      page.getByText("All statuses", {
        exact: true,
      }),
    ).toBeVisible();

    // -------------------------------------------------------------------------
    // Receipts
    // -------------------------------------------------------------------------

    await page.goto("/receipts", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
    await expect(page).toHaveURL(/\/receipts(?:[/?#]|$)/);

    await expect(
      page.getByRole("heading", {
        name: /receipt/i,
      }).first(),
    ).toBeVisible();

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------

    await page.goto("/settings", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
    await expect(page).toHaveURL(/\/settings(?:[/?#]|$)/);

    await expect(
      page.getByText(/feature status/i).first(),
    ).toBeVisible();

    // -------------------------------------------------------------------------
    // Browser validation
    // -------------------------------------------------------------------------

    expect(
      pageErrors,
      `Uncaught page errors:\n${pageErrors.join("\n")}`,
    ).toEqual([]);

    const unexpectedConsoleErrors = consoleErrors.filter((entry) =>
      !(
        entry.text === FAVICON_404_CONSOLE &&
        knownOptionalFaviconUrls.has(entry.locationUrl)
      )
    );
    expect(
      unexpectedConsoleErrors,
      `Browser console errors:\n${unexpectedConsoleErrors.map((entry) => entry.text).join("\n")}`,
    ).toEqual([]);

    expect(
      [...failedResponses],
      `HTTP error responses:\n${[...failedResponses].join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("Production browser diagnostic allow-list", () => {
  test("ignores only the exact optional favicon 404", () => {
    const exact = {
      url: `${PRODUCTION_ORIGIN}/favicon.ico`,
      status: 404,
      method: "GET",
      resourceType: "other",
    };
    expect(isKnownOptionalProductionFavicon404(exact)).toBe(true);
    expect(
      isKnownOptionalProductionFavicon404({
        ...exact,
        url: `${PRODUCTION_ORIGIN}/missing.js`,
      }),
    ).toBe(false);
    expect(
      isKnownOptionalProductionFavicon404({ ...exact, status: 500 }),
    ).toBe(false);
    expect(
      isKnownOptionalProductionFavicon404({
        ...exact,
        url: `${PRODUCTION_ORIGIN}/functions/v1/reports`,
        resourceType: "fetch",
      }),
    ).toBe(false);
    expect(
      isKnownOptionalProductionFavicon404({
        ...exact,
        resourceType: "image",
      }),
    ).toBe(false);
  });
});

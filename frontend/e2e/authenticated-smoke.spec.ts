import { expect, test } from "@playwright/test";

test.describe("Authenticated AR smoke", () => {
  test("demo user can open the protected read-only surfaces without browser errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedResponses: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    page.on("response", (response) => {
      const status = response.status();

      if (status >= 400) {
        failedResponses.push(
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

    expect(
      consoleErrors,
      `Browser console errors:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);

    expect(
      failedResponses,
      `HTTP error responses:\n${failedResponses.join("\n")}`,
    ).toEqual([]);
  });
});

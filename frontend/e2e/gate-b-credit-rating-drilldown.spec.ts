import { expect, test } from "@playwright/test";
import {
  assertReadOnlyBrowserDiagnosticsClean,
  installLocalAuditProxy,
  observeReadOnlyBrowserDiagnostics,
} from "./gate-b-readonly-diagnostics";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "";
const browserOrigin = process.env.PLAYWRIGHT_BROWSER_ORIGIN ?? baseURL;
const proxyTarget = process.env.PLAYWRIGHT_LOCAL_PROXY_TARGET ?? "";
function isLoopback(value: string): boolean {
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
const isLocal = isLoopback(baseURL) || isLoopback(proxyTarget);

async function installLocalApplicationProxy(
  page: import("@playwright/test").Page,
) {
  if (!proxyTarget) {
    await installLocalAuditProxy(page);
    return;
  }
  const source = new URL(browserOrigin);
  const target = new URL(proxyTarget);
  await page.route(`${source.origin}/**`, async (route) => {
    const requested = new URL(route.request().url());
    const proxied = new URL(
      `${requested.pathname}${requested.search}`,
      target.origin,
    );
    const response = await route.fetch({ url: proxied.toString() });
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: await response.body(),
    });
  });
}

function appUrl(path: string): string {
  return new URL(path, browserOrigin).toString();
}

async function installSyntheticLocalSession(
  page: import("@playwright/test").Page,
) {
  await page.route("https://fonts.googleapis.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/css",
      body: "",
    });
  });
  await page.addInitScript(() => {
    const encode = (value: object) =>
      btoa(JSON.stringify(value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    const now = Math.floor(Date.now() / 1000);
    const userId = crypto.randomUUID();
    const session = {
      access_token: [
        encode({ alg: "HS256", typ: "JWT" }),
        encode({
          aud: "authenticated",
          exp: now + 3600,
          iat: now,
          role: "authenticated",
          sub: userId,
        }),
        encode({ nonce: crypto.randomUUID() }),
      ].join("."),
      refresh_token: crypto.randomUUID(),
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: userId,
        aud: "authenticated",
        role: "authenticated",
        email: "browser-test@example.invalid",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
      },
    };
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        return JSON.stringify(session);
      }
      return originalGetItem.call(this, key);
    };
  });
}

async function installGateBMocks(page: import("@playwright/test").Page) {
  await page.route("**/functions/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/auth/me")
      ? {
          user: { id: "user-e2e", email: null },
          company: {
            id: "co-e2e",
            code: "E2E",
            name: "E2E Company",
            base_currency: "MYR",
            country: "MY",
          },
          roles: ["Finance Manager"],
          highest_role: "Finance Manager",
          capabilities: {
            can_read_operational_data: true,
            can_read_reports: true,
          },
        }
      : path.endsWith("/reports/dashboard")
        ? {
            meta: {
              company_id: "co-e2e",
              base_currency: "MYR",
              as_of_date: "2026-07-29",
              calculated_at: "2026-07-29T08:00:00Z",
              scope: "company",
              trend_months: 6,
            },
            kpis: {
              total_outstanding_ar: 0,
              overdue_outstanding: 0,
              overdue_invoice_count: 0,
              unapplied_cash: 0,
              current_month_collections: 0,
              current_month_posted_invoices: 0,
              import_rows_needing_review: 0,
            },
            invoice_status_counts: {
              open: 0,
              partially_paid: 0,
              overdue_status: 0,
              paid: 0,
              unpaid_total: 0,
            },
            aging_buckets: [],
            collection_trend: [],
            top_outstanding_customers: [],
            credit_rating_distribution: [],
            customer_credit_rating_distribution: {
              population: "VISIBLE_CUSTOMERS",
              included_statuses: [
                "Active",
                "Inactive",
                "Blocked",
                "On Hold",
              ],
              rows: [
                { rating: "AAA", customer_count: 0 },
                { rating: "AA", customer_count: 0 },
                { rating: "A", customer_count: 1 },
                { rating: "B", customer_count: 0 },
                { rating: "C", customer_count: 0 },
                { rating: "D", customer_count: 0 },
              ],
            },
          }
        : path.endsWith("/customers")
          ? [
              {
                id: "00000000-0000-4000-8000-000000000001",
                company_id: "co-e2e",
                customer_id: "C0001",
                customer_name: "Gate B Customer",
                customer_type: "Corporate",
                status: "Active",
                is_deleted: false,
                is_hidden: false,
                credit_rating: "A",
              },
            ]
          : [];
    const meta = path.endsWith("/customers")
      ? { total: 1, page: 1, page_size: 25 }
      : undefined;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data,
        ...(meta ? { meta } : {}),
      }),
    });
  });
}

test.describe("Gate B credit-rating drill-down", () => {
  test.skip(!isLocal, "Gate B frontend is local-only until deployment.");

  test.beforeEach(async ({ page }) => {
    await installSyntheticLocalSession(page);
    await installLocalApplicationProxy(page);
    observeReadOnlyBrowserDiagnostics(page);
    await installGateBMocks(page);
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    assertReadOnlyBrowserDiagnosticsClean(page);
  });

  test("opens the customer dialog and retains the aging-report drill-down link", async ({
    page,
  }) => {
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });

    const rating = page.getByRole("button", {
      name: "View customers rated A",
      exact: true,
    });
    await expect(rating).toBeVisible();
    await rating.click();

    const dialog = page.getByRole("dialog", { name: "Customers rated A" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "View aging report" }),
    ).toHaveAttribute("href", "/reports/aging?credit_rating=A");
    await expect(page).toHaveURL(/\/$/);
  });
});

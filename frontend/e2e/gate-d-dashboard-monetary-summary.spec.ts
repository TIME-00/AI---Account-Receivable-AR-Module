import { expect, test, type Page } from "@playwright/test";
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

async function installLocalApplicationProxy(page: Page): Promise<void> {
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

async function installSyntheticLocalSession(page: Page): Promise<void> {
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
    const accessToken = [
      encode({ alg: "HS256", typ: "JWT" }),
      encode({
        aud: "authenticated",
        exp: now + 3600,
        iat: now,
        role: "authenticated",
        sub: userId,
      }),
      encode({ nonce: crypto.randomUUID() }),
    ].join(".");
    const session = {
      access_token: accessToken,
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

type SummaryVariant =
  | "v1"
  | "complete"
  | "partial"
  | "all-unavailable"
  | "empty";

export interface GateDMockState {
  dashboardACount: number;
  customerATotal: number;
  invoiceSummary: SummaryVariant;
  receiptSummary: SummaryVariant;
  customerMode: "success" | "loading" | "empty" | "error";
  dashboardCalls: number;
  customerCalls: number;
}

function v1Summary(
  currentBasis: "current_outstanding" | "current_unallocated",
) {
  const summary = (
    amountBasis: string,
    normalizationBasis: string,
  ) => ({
    row_count: 2,
    amount_basis: amountBasis,
    base_total: 545,
    base_currency: "MYR",
    by_currency: [
      { currency: "MYR", amount: 100, base_amount: 100, count: 1 },
      { currency: "USD", amount: 100, base_amount: 445, count: 1 },
    ],
    meta: {
      base_currency: "MYR",
      multi_currency: true,
      normalization_basis: normalizationBasis,
    },
  });
  return {
    current_balance_summary: summary(
      currentBasis,
      "current_balance_x_booked_rate",
    ),
    document_total_summary: summary(
      "original_document_total",
      "original_booked_base_snapshot",
    ),
  };
}

function v2Summary(
  currentBasis: "current_outstanding" | "current_unallocated",
  variant: Exclude<SummaryVariant, "v1">,
) {
  const summary = (amountBasis: string, normalizationBasis: string) => {
    const groups =
      variant === "empty"
        ? []
        : variant === "all-unavailable"
          ? [
              {
                currency: "USD",
                amount: "100.00",
                base_amount: null,
                count: 2,
                authoritative_document_count: 0,
                unavailable_count: 2,
                base_available: false,
              },
            ]
          : [
              {
                currency: "MYR",
                amount: "125.50",
                base_amount: "125.50",
                count: 1,
                authoritative_document_count: 1,
                unavailable_count: 0,
                base_available: true,
              },
              {
                currency: "USD",
                amount: "100.00",
                base_amount: variant === "complete" ? "450.00" : null,
                count: 2,
                authoritative_document_count:
                  variant === "complete" ? 2 : 0,
                unavailable_count: variant === "complete" ? 0 : 2,
                base_available: variant === "complete",
              },
            ];
    const matching = groups.reduce((sum, group) => sum + group.count, 0);
    const authoritative = groups.reduce(
      (sum, group) => sum + group.authoritative_document_count,
      0,
    );
    const unavailable = matching - authoritative;
    return {
      row_count: matching,
      matching_document_count: matching,
      authoritative_document_count: authoritative,
      unavailable_count: unavailable,
      base_available: unavailable === 0,
      amount_basis: amountBasis,
      base_currency: "MYR",
      base_total:
        variant === "empty"
          ? "0.00"
          : variant === "all-unavailable"
            ? null
            : variant === "complete"
              ? "575.50"
              : "125.50",
      by_currency: groups,
      unavailable_by_currency: groups
        .filter((group) => group.unavailable_count > 0)
        .map((group) => ({
          currency: group.currency,
          document_count: group.unavailable_count,
        })),
      meta: {
        contract_version: 2,
        base_currency: "MYR",
        multi_currency: groups.length > 1,
        normalization_basis: normalizationBasis,
        authority_basis: "current_consistent_booked_fx_decision",
      },
    };
  };
  return {
    current_balance_summary: summary(
      currentBasis,
      "current_balance_x_booked_rate",
    ),
    document_total_summary: summary(
      "original_document_total",
      "original_booked_base_snapshot",
    ),
  };
}

function collectionSummary(
  basis: "current_outstanding" | "current_unallocated",
  variant: SummaryVariant,
) {
  return variant === "v1"
    ? v1Summary(basis)
    : v2Summary(basis, variant);
}

function dashboardFixture(aCount: number) {
  return {
    meta: {
      company_id: "co-e2e",
      base_currency: "MYR",
      as_of_date: "2026-07-29",
      calculated_at: "2026-07-29T08:00:00Z",
      scope: "company",
      trend_months: 6,
    },
    kpis: {
      total_outstanding_ar: 100,
      overdue_outstanding: 25,
      overdue_invoice_count: 1,
      unapplied_cash: 10,
      current_month_collections: 50,
      current_month_posted_invoices: 1,
      import_rows_needing_review: 0,
    },
    invoice_status_counts: {
      open: 1,
      partially_paid: 0,
      overdue_status: 1,
      paid: 1,
      unpaid_total: 2,
    },
    aging_buckets: [],
    collection_trend: [],
    top_outstanding_customers: [],
    credit_rating_distribution: [
      { rating: "A", customer_count: 1, outstanding_base: 100 },
    ],
    customer_credit_rating_distribution: {
      population: "VISIBLE_CUSTOMERS",
      included_statuses: ["Active", "Inactive", "Blocked", "On Hold"],
      rows: [
        { rating: "AAA", customer_count: 0 },
        { rating: "AA", customer_count: 0 },
        { rating: "A", customer_count: aCount },
        { rating: "B", customer_count: 0 },
        { rating: "C", customer_count: 0 },
        { rating: "D", customer_count: 0 },
      ],
    },
    total_invoices: 3,
    open_invoices: 1,
    overdue_invoices: 1,
    total_receipts: 1,
    total_ar_balance: 100,
    total_overdue_balance: 25,
    total_credit_balance: 10,
    overdue_percentage: 25,
  };
}

const customer = (index: number) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  company_id: "co-e2e",
  customer_id: `客户-${String(index).padStart(3, "0")}`,
  customer_name:
    index === 1 ? "Müller 商事 Zero Balance" : `Rated Customer ${index}`,
  customer_type: "Corporate",
  status: index % 2 ? "Active" : "On Hold",
  is_deleted: false,
  is_hidden: false,
  credit_rating: "A",
});

function invoiceRow() {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    invoice_no: "INV-E2E-001",
    customer_name: "Müller 商事 Zero Balance",
    customer_id: "00000000-0000-4000-8000-000000000001",
    doc_type: "Invoice",
    invoice_date: "2026-07-01",
    due_date: "2026-07-31",
    currency: "USD",
    total_amount: 100,
    base_total: 445,
    outstanding: 100,
    status: "Open",
    base_available: false,
    fx_posting_eligibility: {
      gate: "fx_governance",
      eligible: false,
      reason: "missing_decision",
    },
    fx_decision: null,
    fx_decision_id: null,
  };
}

function receiptRow() {
  return {
    id: "00000000-0000-4000-8000-000000000201",
    receipt_no: "RCP-E2E-001",
    receipt_date: "2026-07-02",
    customer_name: "Müller 商事 Zero Balance",
    customer_id: "00000000-0000-4000-8000-000000000001",
    payment_method: "TT",
    currency: "USD",
    receipt_amount: 100,
    base_amount: 445,
    allocated_amount: 0,
    unallocated_amount: 100,
    status: "Posted",
    base_available: false,
    fx_posting_eligibility: {
      gate: "fx_governance",
      eligible: false,
      reason: "missing_decision",
    },
    fx_decision: null,
    fx_decision_id: null,
  };
}

export async function installGateDMocks(
  page: Page,
  overrides: Partial<GateDMockState> = {},
): Promise<GateDMockState> {
  const state: GateDMockState = {
    dashboardACount: 26,
    customerATotal: 26,
    invoiceSummary: "v1",
    receiptSummary: "v1",
    customerMode: "success",
    dashboardCalls: 0,
    customerCalls: 0,
    ...overrides,
  };

  await page.route("**/functions/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const respond = async (
      data: unknown,
      meta?: Record<string, unknown>,
      success = true,
    ) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          success
            ? { success: true, data, ...(meta ? { meta } : {}) }
            : {
                success: false,
                error: {
                  code: "TEST_UNAVAILABLE",
                  message: "Unable to load requested data.",
                },
              },
        ),
      });
    };

    if (path.endsWith("/auth/me")) {
      await respond({
        user: { id: "user-e2e", email: "demo@example.invalid" },
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
          can_create_invoice: true,
          can_post_invoice: true,
          can_create_receipt: true,
          can_post_receipt: true,
        },
      });
      return;
    }
    if (path.endsWith("/reports/dashboard")) {
      state.dashboardCalls += 1;
      await respond(dashboardFixture(state.dashboardACount));
      return;
    }
    if (path.endsWith("/customers")) {
      state.customerCalls += 1;
      if (url.searchParams.has("credit_rating")) {
        if (state.customerMode === "loading") {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        if (state.customerMode === "error") {
          await respond(null, undefined, false);
          return;
        }
        if (state.customerMode === "empty") {
          await respond([], { total: 0, page: 1, page_size: 25 });
          return;
        }
        const pageNumber = Number(url.searchParams.get("page") ?? "1");
        const start = pageNumber === 1 ? 1 : 26;
        const count =
          pageNumber === 1
            ? Math.min(25, state.customerATotal)
            : Math.max(0, state.customerATotal - 25);
        await respond(
          Array.from({ length: count }, (_, offset) => customer(start + offset)),
          {
            total: state.customerATotal,
            page: pageNumber,
            page_size: 25,
          },
        );
        return;
      }
      await respond([customer(1)], {
        total: 1,
        page: 1,
        page_size: 100,
      });
      return;
    }
    if (path.endsWith("/invoices")) {
      await respond([invoiceRow()], {
        total: state.invoiceSummary === "empty" ? 0 : 3,
        page: 1,
        page_size: Number(url.searchParams.get("page_size") ?? "15"),
        summary: collectionSummary(
          "current_outstanding",
          state.invoiceSummary,
        ),
      });
      return;
    }
    if (path.endsWith("/receipts")) {
      await respond([receiptRow()], {
        total: state.receiptSummary === "empty" ? 0 : 2,
        page: 1,
        page_size: Number(url.searchParams.get("page_size") ?? "15"),
        summary: collectionSummary(
          "current_unallocated",
          state.receiptSummary,
        ),
      });
      return;
    }
    await respond([], { total: 0, page: 1, page_size: 25 });
  });
  return state;
}

test.describe("Gate D dashboard and monetary summaries", () => {
  test.skip(!isLocal, "Gate D frontend is local-only until deployment.");

  test.beforeEach(async ({ page }) => {
    await installSyntheticLocalSession(page);
    await installLocalApplicationProxy(page);
    observeReadOnlyBrowserDiagnostics(page);
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    assertReadOnlyBrowserDiagnosticsClean(page);
  });

  test("opens the all-visible rating dialog with paging, links, keyboard and focus restoration", async ({
    page,
  }) => {
    await installGateDMocks(page);
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });

    const rating = page.getByRole("button", {
      name: "View customers rated A",
      exact: true,
    });
    await expect(rating).toBeVisible();
    await rating.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Customers rated A" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Müller 商事 Zero Balance")).toBeVisible();
    await expect(dialog.getByText("客户-001")).toBeVisible();
    await expect(dialog.getByText("26 matching customers")).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "Müller 商事 Zero Balance" }),
    ).toHaveAttribute(
      "href",
      "/customers/00000000-0000-4000-8000-000000000001",
    );
    await expect(
      dialog.getByRole("link", { name: "View aging report" }),
    ).toHaveAttribute("href", "/reports/aging?credit_rating=A");

    await dialog
      .getByRole("button", { name: "Next customer page" })
      .click();
    await expect(dialog.getByText("Rated Customer 26")).toBeVisible();
    await expect(dialog.getByText("Page 2 of 2")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(rating).toBeFocused();
  });

  test("renders v1 and every v2 authority state without false base totals", async ({
    page,
  }) => {
    const state = await installGateDMocks(page);

    await page.goto(appUrl("/invoices"), { waitUntil: "domcontentloaded" });
    await expect(page.getByText("INV-E2E-001")).toBeVisible();
    await expect(page.getByText("Not verified").first()).toBeVisible();
    await expect(page.getByText("MYR 545.00")).toHaveCount(0);

    await page.goto(appUrl("/receipts"), { waitUntil: "domcontentloaded" });
    await expect(page.getByText("RCP-E2E-001")).toBeVisible();
    await expect(page.getByText("Not verified").first()).toBeVisible();

    for (const variant of [
      "complete",
      "partial",
      "all-unavailable",
    ] as const) {
      state.invoiceSummary = variant;
      await page.goto(appUrl("/invoices"), { waitUntil: "domcontentloaded" });
      await expect(page.getByText("INV-E2E-001")).toBeVisible();
      if (variant === "complete") {
        await expect(page.getByText("MYR 575.50").first()).toBeVisible();
      } else if (variant === "partial") {
        await expect(
          page.getByText("Authoritative company-base subtotal").first(),
        ).toBeVisible();
        await expect(
          page
            .getByText(/excludes 2 documents without verified booked FX/i)
            .first(),
        ).toBeVisible();
      } else {
        await expect(page.getByText("Not available").first()).toBeVisible();
        await expect(page.getByText("MYR 0.00")).toHaveCount(0);
      }

      state.receiptSummary = variant;
      await page.goto(appUrl("/receipts"), { waitUntil: "domcontentloaded" });
      await expect(page.getByText("RCP-E2E-001")).toBeVisible();
      if (variant === "complete") {
        await expect(page.getByText("MYR 575.50").first()).toBeVisible();
      } else if (variant === "partial") {
        await expect(
          page.getByText("Authoritative company-base subtotal").first(),
        ).toBeVisible();
      } else {
        await expect(page.getByText("Not available").first()).toBeVisible();
      }
    }

    state.invoiceSummary = "v1";
    await page.goto(appUrl("/reports/invoices"), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Not verified").first()).toBeVisible();
    state.receiptSummary = "v1";
    await page.goto(appUrl("/reports/receipts"), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Not verified").first()).toBeVisible();
  });

  test("bounds reconciliation, exposes manual refresh, and recovers when counts align", async ({
    page,
  }) => {
    const state = await installGateDMocks(page, {
      dashboardACount: 1,
      customerATotal: 2,
    });
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "View customers rated A", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Customers rated A" });
    await expect(
      dialog.getByText("Customer data changed. Refresh to view the latest list."),
    ).toBeVisible();
    expect(state.dashboardCalls).toBe(2);
    expect(state.customerCalls).toBe(2);

    state.dashboardACount = 2;
    await dialog.getByRole("button", { name: "Refresh" }).click();
    await expect(dialog.getByText("2 matching customers")).toBeVisible();
    expect(state.dashboardCalls).toBe(3);
    expect(state.customerCalls).toBe(3);
  });

  test("keeps the dialog controlled through loading, empty and error states", async ({
    page,
  }) => {
    const state = await installGateDMocks(page, {
      dashboardACount: 0,
      customerATotal: 0,
      customerMode: "loading",
    });
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "View customers rated A", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Customers rated A" });
    await expect(
      dialog.getByText("Loading customers for this rating."),
    ).toBeVisible();
    await expect(dialog.getByText("No customers with rating A.")).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    state.customerMode = "error";
    await page
      .getByRole("button", { name: "View customers rated B", exact: true })
      .click();
    const errorDialog = page.getByRole("dialog", {
      name: "Customers rated B",
    });
    await expect(
      errorDialog.getByText("Unable to load customers for this rating."),
    ).toBeVisible();
    await expect(
      errorDialog.getByRole("button", { name: "Retry" }),
    ).toBeVisible();
  });
});

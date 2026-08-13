import { expect, test, type Page, type Response } from "@playwright/test";

type CopilotStatus = {
  request_id: string;
  tool_names: string[];
  tool_call_count: number;
};

type CopilotResult = {
  status: CopilotStatus;
  evidence: Array<{ kind: string; id: string }>;
  links: Array<{ href: string }>;
};

async function ask(page: Page, question: string): Promise<CopilotResult> {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/functions/v1/ar-copilot/chat")
  );
  const composer = page.getByLabel("Ask AR Copilot a question");
  await composer.fill(question);
  await page.getByRole("button", { name: "Send question" }).click();
  const response: Response = await responsePromise;
  expect(response.status()).toBe(200);
  const envelope = await response.json() as {
    data?: {
      answer?: unknown;
      status?: Partial<CopilotStatus>;
      evidence?: Array<{ kind: string; id: string }>;
      links?: Array<{ href: string }>;
    };
  };
  const payload = envelope.data ?? {};
  expect(typeof payload.answer).toBe("string");
  expect(payload.answer).not.toContain("temporarily unavailable");
  expect(typeof payload.status?.request_id).toBe("string");
  expect(Array.isArray(payload.status?.tool_names)).toBe(true);
  expect(Number.isSafeInteger(payload.status?.tool_call_count)).toBe(true);
  expect(Array.isArray(payload.evidence)).toBe(true);
  expect(Array.isArray(payload.links)).toBe(true);
  await expect(page.locator("[data-copilot-pending]")).toHaveCount(0);
  return {
    status: payload.status as CopilotStatus,
    evidence: payload.evidence ?? [],
    links: payload.links ?? [],
  };
}

async function openCopilot(page: Page): Promise<void> {
  await page.getByRole("button", { name: "AR Copilot" }).click();
  await expect(page.getByRole("dialog", { name: "AR Copilot" })).toBeVisible();
}

test.describe("Production AR Copilot live remediation", () => {
  test("Finance session supports multi-turn, system guide, and live overdue reads", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
    await openCopilot(page);

    const greeting = await ask(page, "Hi");
    expect(greeting.status.tool_call_count).toBe(0);

    const followUp = await ask(page, "How are you today?");
    expect(followUp.status.tool_call_count).toBe(0);

    const guide = await ask(page, "What is unapplied cash?");
    expect(guide.status.tool_names.every((name) => name === "search_system_guide")).toBe(true);

    const live = await ask(page, "How many overdue invoices are there right now?");
    expect(live.status.tool_names.some((name) => name !== "search_system_guide")).toBe(true);
    expect(live.status.tool_call_count).toBeGreaterThan(0);
  });

  test("existing Invoice and Receipt contexts return bounded evidence and safe links", async ({
    page,
  }) => {
    await page.goto("/invoices", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
    const invoiceRow = page.locator("tbody tr").first();
    await expect(invoiceRow).toBeVisible();
    await invoiceRow.click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/i);
    await openCopilot(page);
    const invoice = await ask(page, "Why is this invoice still open?");
    expect(invoice.evidence.some((item) =>
      ["invoice", "credit_note", "debit_note"].includes(item.kind)
    )).toBe(true);
    expect(invoice.links.every((link) => link.href.startsWith("/"))).toBe(true);

    await page.getByRole("button", { name: "Close AR Copilot" }).click();
    await page.goto("/receipts", { waitUntil: "domcontentloaded" });
    const receiptRow = page.locator("tbody tr").first();
    await expect(receiptRow).toBeVisible();
    await receiptRow.click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/i);
    await openCopilot(page);
    const receipt = await ask(page, "Why is this receipt still unapplied?");
    expect(receipt.evidence.some((item) => item.kind === "receipt")).toBe(true);
    expect(receipt.links.every((link) => link.href.startsWith("/"))).toBe(true);
  });
});

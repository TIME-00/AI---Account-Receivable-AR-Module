import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { generateReportPdf, PDF_FONT_URL } from "./pdf";
import { parseExportDataset } from "./parse";
import { ALL_REPORT_TYPES, buildRawExport } from "./test/export-fixtures";

async function pdfSignature(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return String.fromCharCode(...bytes.slice(0, 5));
}

async function inspectPdf(blob: Blob): Promise<{ pages: number; text: string }> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = getDocument({
    data,
    useSystemFonts: false,
    isEvalSupported: false,
  });
  const pdf = await task.promise;
  const text: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
    }
    return { pages: pdf.numPages, text: text.join("\n") };
  } finally {
    await pdf.destroy();
  }
}

beforeAll(async () => {
  const font = await readFile(
    resolve(process.cwd(), "public/fonts/NotoSansCJKsc-Regular.otf"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      if (url !== PDF_FONT_URL) throw new Error(`Unexpected test fetch: ${url}`);
      return new Response(font, {
        status: 200,
        headers: { "content-type": "font/otf" },
      });
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("generateReportPdf", () => {
  it("produces a valid, non-empty PDF for every populated report", async () => {
    for (const type of ALL_REPORT_TYPES) {
      const dataset = parseExportDataset(type, buildRawExport(type, { count: 4 }));
      const blob = await generateReportPdf(dataset);
      expect(blob.type).toBe("application/pdf");
      expect(blob.size).toBeGreaterThan(0);
      expect(await pdfSignature(blob)).toBe("%PDF-");
    }
  }, 30000);

  it("produces a valid PDF for an empty report", async () => {
    const dataset = parseExportDataset("aging", buildRawExport("aging", { count: 0 }));
    const blob = await generateReportPdf(dataset);
    expect(blob.size).toBeGreaterThan(0);
    expect(await pdfSignature(blob)).toBe("%PDF-");
  }, 20000);

  it("embeds readable Simplified/Traditional Chinese, Japanese and accented Latin text", async () => {
    const raw = buildRawExport("invoices", { count: 4 }) as {
      company: { name: string };
      rows: Array<{ customer_name: string }>;
    };
    raw.company.name = "北京客户有限公司";
    raw.rows[0].customer_name = "北京客户有限公司";
    raw.rows[1].customer_name = "張氏企業有限公司";
    raw.rows[2].customer_name = "株式会社東京";
    raw.rows[3].customer_name = "Société Générale";
    const dataset = parseExportDataset("invoices", raw);
    const blob = await generateReportPdf(dataset);
    const inspected = await inspectPdf(blob);
    const compactText = inspected.text.replace(/\s+/gu, "");
    for (const expected of [
      "北京客户有限公司",
      "張氏企業有限公司",
      "株式会社東京",
      "Société Générale",
    ]) {
      expect(compactText).toContain(expected.replace(/\s+/gu, ""));
    }
    expect(inspected.text).not.toMatch(/[?�]/u);
  }, 60000);

  it("spans multiple pages for a large row set with repeated headers", async () => {
    const dataset = parseExportDataset("invoices", buildRawExport("invoices", { count: 120 }));
    const blob = await generateReportPdf(dataset);
    const inspected = await inspectPdf(blob);
    expect(inspected.pages).toBeGreaterThan(1);
    expect(inspected.text.match(/Invoice\s+No/g)?.length ?? 0).toBeGreaterThan(1);
  }, 60000);

  it("generates all 5,000 authorized lightweight rows without truncation", async () => {
    const dataset = parseExportDataset(
      "aging",
      buildRawExport("aging", { count: 5_000 }),
    );
    const blob = await generateReportPdf(dataset);
    expect(await pdfSignature(blob)).toBe("%PDF-");
    const inspected = await inspectPdf(blob);
    expect(inspected.text).toContain("CUST-00000");
    expect(inspected.text).toContain("CUST-04999");
    expect(inspected.text.replace(/\s+/gu, "")).toContain("5000record(s)");
  }, 180000);
});

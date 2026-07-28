import { describe, expect, it } from "vitest";
import {
  formatDecimalString,
  formatMoneyWithCurrency,
  neutralizeSpreadsheetText,
} from "./format";
import { buildExportFilename } from "./filename";
import { parseExportDataset } from "./parse";
import { buildRawExport } from "./test/export-fixtures";

describe("formatDecimalString", () => {
  it("groups the integer part and preserves fractional digits and sign exactly", () => {
    expect(formatDecimalString("1234567.50")).toBe("1,234,567.50");
    expect(formatDecimalString("0.00")).toBe("0.00");
    expect(formatDecimalString("-5.00")).toBe("-5.00");
    expect(formatDecimalString("999.99")).toBe("999.99");
    expect(formatDecimalString("1000.00")).toBe("1,000.00");
  });

  it("does not introduce floating point error", () => {
    expect(formatDecimalString("0.10")).toBe("0.10");
    expect(formatDecimalString("100000000000.01")).toBe("100,000,000,000.01");
  });

  it("prefixes the currency code", () => {
    expect(formatMoneyWithCurrency("42.50", "MYR")).toBe("MYR 42.50");
  });
});

describe("neutralizeSpreadsheetText", () => {
  it("neutralizes every dangerous formula prefix", () => {
    for (const prefix of [
      "=",
      "+",
      "-",
      "@",
      "\t",
      "\r",
      "\n",
      " =",
      "  +",
      "\u00a0-",
      "\ufeff@",
      " \t",
      " \r",
      " \n",
    ]) {
      expect(neutralizeSpreadsheetText(`${prefix}CMD()`).startsWith("'")).toBe(true);
    }
  });

  it("neutralizes exactly once", () => {
    const once = neutralizeSpreadsheetText(' =HYPERLINK("http://evil","x")');
    expect(once).toBe('\' =HYPERLINK("http://evil","x")');
    expect(neutralizeSpreadsheetText(once)).toBe(once);
  });

  it("leaves ordinary text untouched", () => {
    expect(neutralizeSpreadsheetText("Customer 001")).toBe("Customer 001");
    expect(neutralizeSpreadsheetText("CUST-00001")).toBe("CUST-00001");
    expect(neutralizeSpreadsheetText("")).toBe("");
  });
});

describe("buildExportFilename", () => {
  it("uses a safe stem, date stamp and correct extension", () => {
    const aging = parseExportDataset("aging", buildRawExport("aging"));
    expect(buildExportFilename(aging, "pdf")).toBe("ar-aging-report_2026-07-27.pdf");
    expect(buildExportFilename(aging, "xlsx")).toBe("ar-aging-report_2026-07-27.xlsx");

    const invoices = parseExportDataset("invoices", buildRawExport("invoices"));
    expect(buildExportFilename(invoices, "pdf")).toBe("invoice-summary_2026-07-31.pdf");
  });

  it("only ever contains a safe filename character set", () => {
    const dataset = parseExportDataset("receipts", buildRawExport("receipts"));
    const name = buildExportFilename(dataset, "xlsx");
    expect(name).toMatch(/^[a-z0-9._-]+\.xlsx$/);
    expect(name).not.toMatch(/[\\/]/);
  });
});

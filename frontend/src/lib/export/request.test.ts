import { describe, expect, it } from "vitest";
import { buildExportRequest, mapExportResponse } from "./request";
import {
  ExportAuthorizationError,
  ExportNetworkError,
  ExportOversizeError,
  ExportValidationError,
} from "./errors";
import { buildRawExport } from "./test/export-fixtures";

describe("buildExportRequest", () => {
  it("forwards only the report's own filters and sort", () => {
    const { path, params } = buildExportRequest("invoices", {
      date_from: "2026-07-01",
      date_to: "2026-07-31",
      status: "Open",
      sort: "base_total",
      order: "asc",
    });
    expect(path).toBe("/reports/export/invoices");
    expect(params).toEqual({
      date_from: "2026-07-01",
      date_to: "2026-07-31",
      status: "Open",
      sort: "base_total",
      order: "asc",
    });
  });

  it("never forwards pagination, identity or client totals", () => {
    const { params } = buildExportRequest("aging", {
      as_of_date: "2026-07-27",
      page: "3",
      page_size: "50",
      cursor: "abc",
      company_id: "c",
      user_id: "u",
      outstanding_base_total: "999",
    } as Record<string, string>);
    expect(params).toEqual({ as_of_date: "2026-07-27" });
    for (const forbidden of ["page", "page_size", "cursor", "company_id", "user_id"]) {
      expect(params).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(params).some((k) => k.includes("total"))).toBe(false);
  });

  it("drops empty and undefined values", () => {
    const { params } = buildExportRequest("receipts", {
      date_from: "",
      date_to: undefined,
      search: "  ",
    });
    expect(params).toEqual({});
  });
});

describe("mapExportResponse", () => {
  it("parses a 200 data envelope", () => {
    const dataset = mapExportResponse("aging", 200, { data: buildRawExport("aging") });
    expect(dataset.report_type).toBe("aging");
  });

  it("maps the exact 422 oversize contract", () => {
    let thrown: unknown;
    try {
      mapExportResponse("aging", 422, {
        error: {
          code: "EXPORT_DATASET_TOO_LARGE",
          message: "too big",
          details: { row_limit: 5000, payload_limit_bytes: 8388608, estimated_rows: 5001 },
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExportOversizeError);
    expect((thrown as ExportOversizeError).details).toEqual({
      row_limit: 5000,
      payload_limit_bytes: 8388608,
      estimated_rows: 5001,
    });
  });

  it("does not trust an oversize code on the wrong HTTP status", () => {
    expect(() =>
      mapExportResponse("aging", 500, {
        error: {
          code: "EXPORT_DATASET_TOO_LARGE",
          details: { row_limit: 5000, payload_limit_bytes: 8388608, estimated_rows: 5001 },
        },
      })
    ).toThrow(ExportNetworkError);
  });

  it("ignores malformed oversize details while preserving controlled UX", () => {
    let thrown: unknown;
    try {
      mapExportResponse("aging", 422, {
        error: {
          code: "EXPORT_DATASET_TOO_LARGE",
          details: { row_limit: 4999, payload_limit_bytes: 8388608, estimated_rows: -1 },
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExportOversizeError);
    expect((thrown as ExportOversizeError).details).toBeUndefined();
  });

  it("maps 401/403 to an authorization error", () => {
    expect(() => mapExportResponse("aging", 401, {})).toThrow(ExportAuthorizationError);
    expect(() => mapExportResponse("aging", 403, {})).toThrow(ExportAuthorizationError);
  });

  it("maps 400/422 (non-oversize) to a validation error", () => {
    expect(() => mapExportResponse("aging", 400, { error: { code: "VALIDATION_ERROR" } }))
      .toThrow(ExportValidationError);
  });

  it("maps other statuses to a network error", () => {
    expect(() => mapExportResponse("aging", 500, {})).toThrow(ExportNetworkError);
  });

  it("rejects a 200 without a data field", () => {
    expect(() => mapExportResponse("aging", 200, { nope: true })).toThrow(
      ExportValidationError,
    );
  });
});

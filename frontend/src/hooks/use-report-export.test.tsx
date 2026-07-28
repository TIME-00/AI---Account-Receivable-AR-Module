import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRawExport } from "@/lib/export/test/export-fixtures";

const rawFetch = vi.fn();
const identity = vi.hoisted(() => ({
  companyId: "00000009-0000-4000-8000-000000000001",
  userId: "00000008-0000-4000-8000-000000000001",
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({ rawFetch }),
}));
vi.mock("@/stores/company-store", () => ({
  useCompanyStore: (selector: (state: { companyId: string }) => unknown) =>
    selector({ companyId: identity.companyId }),
}));
vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({
    data: identity.userId ? { user: { id: identity.userId } } : undefined,
  }),
}));

const generateReportPdf = vi.fn();
const generateReportXlsx = vi.fn();
const downloadBlob = vi.fn();
vi.mock("@/lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export")>();
  return {
    ...actual,
    generateReportPdf: (...args: unknown[]) => generateReportPdf(...args),
    generateReportXlsx: (...args: unknown[]) => generateReportXlsx(...args),
    downloadBlob: (...args: unknown[]) => downloadBlob(...args),
  };
});

import { useReportExport } from "./use-report-export";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  identity.companyId = "00000009-0000-4000-8000-000000000001";
  identity.userId = "00000008-0000-4000-8000-000000000001";
  rawFetch.mockReset();
  generateReportPdf.mockReset().mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
  generateReportXlsx.mockReset().mockResolvedValue(new Blob(["xlsx"]));
  downloadBlob.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("useReportExport", () => {
  it("fetches, generates a PDF and downloads it on success", async () => {
    rawFetch.mockResolvedValue(jsonResponse(200, { data: buildRawExport("aging") }));
    const { result } = renderHook(() => useReportExport("aging"));

    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(generateReportPdf).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("generates an XLSX when the xlsx format is chosen", async () => {
    rawFetch.mockResolvedValue(jsonResponse(200, { data: buildRawExport("invoices") }));
    const { result } = renderHook(() => useReportExport("invoices"));
    act(() => result.current.run("xlsx", { date_from: "2026-07-01", date_to: "2026-07-31" }));
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(generateReportXlsx).toHaveBeenCalledTimes(1);
    expect(generateReportPdf).not.toHaveBeenCalled();
  });

  it("sends only report filters — never pagination, identity or totals", async () => {
    rawFetch.mockResolvedValue(jsonResponse(200, { data: buildRawExport("aging") }));
    const { result } = renderHook(() => useReportExport("aging"));
    act(() =>
      result.current.run("pdf", {
        as_of_date: "2026-07-27",
        page: "2",
        page_size: "50",
        company_id: "c",
        user_id: "u",
      } as Record<string, string>)
    );
    await waitFor(() => expect(result.current.status).toBe("success"));
    const [, , opts] = rawFetch.mock.calls[0];
    expect(opts.params).toEqual({ as_of_date: "2026-07-27" });
  });

  it("blocks a duplicate concurrent export", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    rawFetch.mockReturnValue(new Promise<Response>((res) => (resolveFetch = res)));
    const { result } = renderHook(() => useReportExport("aging"));

    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    expect(rawFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch(jsonResponse(200, { data: buildRawExport("aging") }));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("maps the oversize 422 response to an oversize error without downloading", async () => {
    rawFetch.mockResolvedValue(
      jsonResponse(422, {
        error: {
          code: "EXPORT_DATASET_TOO_LARGE",
          message: "too big",
          details: { row_limit: 5000, payload_limit_bytes: 8388608, estimated_rows: 5001 },
        },
      }),
    );
    const { result } = renderHook(() => useReportExport("aging"));
    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.kind).toBe("oversize");
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("maps an authorization failure", async () => {
    rawFetch.mockResolvedValue(jsonResponse(403, { error: { code: "AUTH" } }));
    const { result } = renderHook(() => useReportExport("aging"));
    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.kind).toBe("authorization");
  });

  it("does not report success when file generation fails", async () => {
    rawFetch.mockResolvedValue(jsonResponse(200, { data: buildRawExport("aging") }));
    generateReportPdf.mockRejectedValue(
      new (await import("@/lib/export")).ExportGenerationError(),
    );
    const { result } = renderHook(() => useReportExport("aging"));
    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.kind).toBe("generation");
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("fails closed with a sanitized validation error for a malformed dataset", async () => {
    const malformed = buildRawExport("aging");
    malformed.company = { id: "not-a-uuid", name: "Leaked relation.sql", base_currency: "MYR", timezone: "UTC" };
    rawFetch.mockResolvedValue(jsonResponse(200, { data: malformed }));
    const { result } = renderHook(() => useReportExport("aging"));
    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.kind).toBe("validation");
    expect(result.current.error?.message).not.toMatch(/uuid|relation|sql/i);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("does not report success when the browser download action fails", async () => {
    rawFetch.mockResolvedValue(jsonResponse(200, { data: buildRawExport("aging") }));
    downloadBlob.mockImplementation(() => {
      throw new Error("anchor click failed");
    });
    const { result } = renderHook(() => useReportExport("aging"));
    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.kind).toBe("generation");
    expect(result.current.error?.message).not.toContain("anchor");
  });

  it("aborts and ignores a late response after the authenticated company changes", async () => {
    let resolveFirst: (response: Response) => void = () => {};
    rawFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    rawFetch.mockResolvedValueOnce(
      jsonResponse(200, { data: buildRawExport("aging") }),
    );
    const { result, rerender } = renderHook(() => useReportExport("aging"));

    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    identity.companyId = "00000009-0000-4000-8000-000000000002";
    rerender();
    await waitFor(() => expect(result.current.status).toBe("idle"));

    await act(async () => {
      resolveFirst(jsonResponse(200, { data: buildRawExport("aging") }));
      await Promise.resolve();
    });
    expect(generateReportPdf).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();

    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(rawFetch).toHaveBeenCalledTimes(2);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("fails before fetch when the authenticated user context is unavailable", async () => {
    identity.userId = "";
    const { result } = renderHook(() => useReportExport("aging"));
    expect(result.current.isReady).toBe(false);
    act(() => result.current.run("pdf", { as_of_date: "2026-07-27" }));
    expect(result.current.status).toBe("error");
    expect(result.current.error?.kind).toBe("authorization");
    expect(rawFetch).not.toHaveBeenCalled();
  });
});

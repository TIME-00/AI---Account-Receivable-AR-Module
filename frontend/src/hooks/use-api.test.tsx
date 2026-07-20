// ============================================================================
// §17 — getWithMeta shares the canonical request implementation.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { Providers } from "@/test/harness";

// `vi.mock` factories are hoisted above module scope, so the spies they close
// over must be created with `vi.hoisted`.
const { toastError, getSession } = vi.hoisted(() => ({
  toastError: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })),
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession } },
  API_BASE_URL: "https://api.test/functions/v1",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_URL: "https://api.test",
}));

vi.mock("@/stores/company-store", () => ({
  useCompanyStore: (selector: (s: { companyId: string }) => unknown) => selector({ companyId: "co-123" }),
}));

import { useApi, ApiError } from "@/hooks/use-api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("useApi().getWithMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns data AND the meta envelope (pagination + monetary summary)", async () => {
    const summary = { current_balance_summary: { base_total: 545 } };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: [{ id: "inv-1" }], meta: { total: 1001, page: 2, page_size: 20, summary } }),
    );

    const { result } = renderHook(() => useApi(), { wrapper: Providers });
    const res = await result.current.getWithMeta<Array<{ id: string }>>("/invoices", { params: { page: 2 } });

    expect(res.data).toEqual([{ id: "inv-1" }]);
    expect(res.meta?.total).toBe(1001);
    expect(res.meta?.page).toBe(2);
    expect(res.meta?.summary).toEqual(summary);
  });

  it("injects the same auth and company headers as get, and forwards query params", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [], meta: {} }));

    const { result } = renderHook(() => useApi(), { wrapper: Providers });
    await result.current.getWithMeta("/invoices", { params: { page: 3, status: "Open", empty: undefined } });
    const metaCall = fetchMock.mock.calls[0];

    await result.current.get("/invoices", { params: { page: 3, status: "Open" } });
    const getCall = fetchMock.mock.calls[1];

    // Same headers via the one canonical implementation.
    expect(metaCall[1].headers["Authorization"]).toBe("Bearer test-token");
    expect(metaCall[1].headers["X-Company-Id"]).toBe("co-123");
    expect(metaCall[1].headers).toEqual(getCall[1].headers);
    expect(metaCall[1].method).toBe("GET");

    const url = new URL(metaCall[0] as string);
    expect(url.pathname).toBe("/functions/v1/invoices");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("status")).toBe("Open");
    // undefined params are dropped, exactly as `get` does.
    expect(url.searchParams.has("empty")).toBe(false);
  });

  it("maps envelope errors to ApiError and toasts, like get", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: false, error: { code: "BR-REC-003", message: "Currency mismatch" } }, 400),
    );

    const { result } = renderHook(() => useApi(), { wrapper: Providers });
    await expect(result.current.getWithMeta("/invoices")).rejects.toBeInstanceOf(ApiError);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it("honours silent mode (no toast)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: false, error: { code: "NOT_FOUND", message: "missing" } }, 404),
    );

    const { result } = renderHook(() => useApi(), { wrapper: Providers });
    await expect(result.current.getWithMeta("/invoices/x", { silent: true })).rejects.toBeInstanceOf(ApiError);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("handles a non-JSON response without throwing on success", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => "plain-body",
    } as unknown as Response);

    const { result } = renderHook(() => useApi(), { wrapper: Providers });
    const res = await result.current.getWithMeta<string>("/health");
    expect(res.data).toBe("plain-body");
    expect(res.meta).toBeUndefined();
  });

  it("get() unwraps to data only, preserving its existing contract", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: { id: "x" }, meta: { total: 1 } }),
    );

    const { result } = renderHook(() => useApi(), { wrapper: Providers });
    const data = await result.current.get<{ id: string }>("/invoices/x");
    expect(data).toEqual({ id: "x" });
  });
});

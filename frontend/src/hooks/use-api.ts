// ============================================================================
// TSH Synergy AR — Global API Hook
// Wraps fetch() with automatic header injection, typed responses, and
// BR-xxx error code parsing with toast notifications.
// ============================================================================

"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { supabase, API_BASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useCompanyStore } from "@/stores/company-store";
import { getErrorMessage } from "@/lib/error-messages";
import type { APIResponse, APIMeta } from "@/types";
import {
  GATE_E_CONTRACT_VERSION,
  successEnvelopeSchema,
  errorEnvelopeSchema,
} from "@/lib/automation/contract";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RequestOptions {
  /** Skip the automatic error toast (caller handles errors) */
  silent?: boolean;
  /** Additional headers to merge */
  headers?: Record<string, string>;
  /** Override the base URL (e.g. for AI endpoint) */
  baseUrl?: string;
  /** Custom query params */
  params?: Record<string, string | number | boolean | undefined>;
  /**
   * Abort signal (e.g. from TanStack Query) so a superseded request — such as
   * one issued before a company switch — is cancelled and can never resolve
   * into stale UI. Non-Gate-E callers may omit it (behavior unchanged).
   */
  signal?: AbortSignal;
  /**
   * When set to the Gate E contract version, the COMPLETE response envelope is
   * strict-parsed through the frozen `successEnvelopeSchema` /
   * `errorEnvelopeSchema` Zod schemas before EITHER its `data` or its `error` is
   * trusted. Both schemas pin `contract_version` via `z.literal` and reject
   * unknown top-level / nested fields, so version drift, an unknown field, a
   * malformed error, a non-JSON body, or a 2xx `success:false` all fail closed
   * (`MALFORMED_RESPONSE`) rather than feeding unchecked data into the UI.
   * Non-Gate-E callers omit it (behavior unchanged).
   */
  contractVersion?: string;
}

export interface ApiClient {
  get: <T = unknown>(path: string, opts?: RequestOptions) => Promise<T>;
  /**
   * Like `get`, but returns the response `data` together with the `meta`
   * envelope (pagination + Batch 9D-D authoritative monetary `summary`).
   */
  getWithMeta: <T = unknown>(path: string, opts?: RequestOptions) => Promise<{ data: T; meta?: APIMeta }>;
  post: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => Promise<T>;
  patch: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => Promise<T>;
  del: <T = unknown>(path: string, opts?: RequestOptions) => Promise<T>;
  /** Raw fetch with headers injected — for streaming responses */
  rawFetch: (path: string, init?: RequestInit, opts?: RequestOptions) => Promise<Response>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * useApi — Global API Hook
 *
 * Automatically injects:
 * - `Authorization: Bearer <jwt>` from Supabase session
 * - `X-Company-Id: <uuid>` from Zustand company store
 * - `Content-Type: application/json` for POST/PATCH
 *
 * Parses `APIResponse<T>` envelope and extracts `data` on success.
 * On error, shows a toast with the BR-xxx error message.
 *
 * @example
 * ```tsx
 * const api = useApi();
 * const data = await api.get<DashboardSummary>("/reports/dashboard");
 * ```
 */
export function useApi(): ApiClient {
  const companyId = useCompanyStore((s) => s.companyId);

  /**
   * Build request headers with auth token and company ID.
   */
  const buildHeaders = useCallback(
    async (extra?: Record<string, string>): Promise<Record<string, string>> => {
      const headers: Record<string, string> = {
        "apikey": SUPABASE_ANON_KEY,
        "X-Company-Id": companyId,
        ...extra,
      };

      // Get current session token
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      return headers;
    },
    [companyId]
  );

  /**
   * Build the full URL with optional query params.
   */
  const buildUrl = useCallback(
    (path: string, params?: Record<string, string | number | boolean | undefined>, baseUrl?: string): string => {
      const base = baseUrl ?? API_BASE_URL;
      const url = new URL(`${base}${path}`);
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== "") {
            url.searchParams.append(key, String(value));
          }
        });
      }
      return url.toString();
    },
    []
  );

  /**
   * Core request handler — the SINGLE canonical implementation.
   *
   * Returns the parsed `data` together with the response `meta` envelope. `get`
   * unwraps to `data` for its existing callers; `getWithMeta` returns both.
   * Keeping one implementation means auth headers, company/tenant headers, query
   * params, base URL, silent mode, error mapping, the auth redirect and non-JSON
   * handling cannot drift apart between the two (§17).
   */
  const request = useCallback(
    async <T = unknown>(
      method: string,
      path: string,
      body?: unknown,
      opts: RequestOptions = {}
    ): Promise<{ data: T; meta?: APIMeta }> => {
      const headers = await buildHeaders(opts.headers);

      if (body && (method === "POST" || method === "PATCH")) {
        headers["Content-Type"] = "application/json";
      }

      const url = buildUrl(path, opts.params, opts.baseUrl);

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: opts.signal,
      });

      // Handle non-JSON responses
      const contentType = res.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        // Gate E boundary: a versioned response MUST be a JSON envelope. A
        // non-JSON body (HTML error page, plain text, empty body) can be neither
        // a valid success nor a valid error envelope, so it fails closed WITHOUT
        // surfacing the raw response text — a non-JSON Gate E error must never
        // leak provider/stack text into the UI.
        if (opts.contractVersion) {
          if (!opts.silent) {
            toast.error("Request Failed", {
              description: "The response could not be read.",
            });
          }
          throw new ApiError(
            "MALFORMED_RESPONSE",
            "The Gate E response was not a JSON envelope.",
            res.status,
          );
        }
        if (!res.ok) {
          const text = await res.text();
          if (!opts.silent) {
            toast.error("Request Failed", {
              description: text || `HTTP ${res.status}`,
            });
          }
          throw new ApiError("NETWORK_ERROR", text || `HTTP ${res.status}`, res.status);
        }
        return { data: (await res.text()) as unknown as T, meta: undefined };
      }

      // Parse API response envelope. Malformed JSON fails closed with a safe,
      // typed error rather than surfacing a raw SyntaxError — this matters most
      // for the Gate E versioned boundary, which must never trust an
      // unparseable body as either a success or an error envelope.
      let json: APIResponse<T> & { contract_version?: unknown };
      try {
        json = await res.json();
      } catch {
        if (!opts.silent) {
          toast.error("Request Failed", {
            description: "The response could not be read.",
          });
        }
        throw new ApiError(
          "MALFORMED_RESPONSE",
          "The response body was not valid JSON.",
          res.status,
        );
      }

      // Gate E boundary: when a contract version is required, the COMPLETE
      // envelope is strict-parsed through the frozen `gate-e.1` Zod schemas —
      // `successEnvelopeSchema` / `errorEnvelopeSchema` — before EITHER its data
      // or its error is trusted. This is the real network path (not a test), so
      // a server that drifts from the wire contract can never feed unchecked
      // data into success OR error handling. Both schemas pin
      // `contract_version` via `z.literal` and reject unknown top-level and
      // nested error fields (`.strict()`), so version/shape drift fails closed
      // here — including a 2xx body that falsely carries `success:false`.
      if (opts.contractVersion === GATE_E_CONTRACT_VERSION) {
        const success = (json as { success?: unknown }).success === true;

        if (success) {
          const parsed = successEnvelopeSchema.safeParse(json);
          // A success envelope is only valid on a 2xx status; a 2xx-only
          // contract forbids `success:true` on a failed HTTP status.
          if (!parsed.success || !res.ok) {
            if (!opts.silent) {
              toast.error("Request Failed", {
                description: "The response did not match the expected contract.",
              });
            }
            throw new ApiError(
              "MALFORMED_RESPONSE",
              "The Gate E success envelope did not match the gate-e.1 contract.",
              res.status,
            );
          }
          return { data: parsed.data.data as T, meta: parsed.data.meta };
        }

        // Anything that is not `success:true` is treated as an error envelope —
        // including an HTTP 2xx that carries `success:false`, which is NEVER
        // surfaced as success. It must still strict-parse (non-empty string
        // code, no unknown nested fields, pinned version) or it fails closed.
        const parsedError = errorEnvelopeSchema.safeParse(json);
        if (!parsedError.success) {
          if (!opts.silent) {
            toast.error("Request Failed", {
              description: "The response did not match the expected contract.",
            });
          }
          throw new ApiError(
            "MALFORMED_RESPONSE",
            "The Gate E error envelope did not match the gate-e.1 contract.",
            res.status,
          );
        }

        const error = parsedError.data.error;
        const friendlyMessage = getErrorMessage(error.code, error.message);
        if (!opts.silent) {
          toast.error(friendlyMessage, {
            description: error.code !== "INTERNAL_ERROR" ? `Error code: ${error.code}` : undefined,
            duration: 6000,
          });
        }
        if (res.status === 401 || error.code === "AUTHENTICATION_ERROR") {
          setTimeout(() => {
            window.location.href = "/login";
          }, 1500);
        }
        throw new ApiError(
          error.code,
          friendlyMessage,
          res.status,
          error.details as Record<string, unknown> | undefined,
        );
      }

      if (!json.success || json.error) {
        const error = json.error!;
        const errorCode = error.code;
        const friendlyMessage = getErrorMessage(errorCode, error.message);

        if (!opts.silent) {
          // Show toast with error code badge
          toast.error(friendlyMessage, {
            description: errorCode !== "INTERNAL_ERROR" ? `Error code: ${errorCode}` : undefined,
            duration: 6000,
          });
        }

        // Special handling: auth errors → redirect to login
        if (res.status === 401 || errorCode === "AUTHENTICATION_ERROR") {
          // Use setTimeout to avoid blocking the error throw
          setTimeout(() => {
            window.location.href = "/login";
          }, 1500);
        }

        throw new ApiError(errorCode, friendlyMessage, res.status, error.details);
      }

      return { data: json.data as T, meta: json.meta };
    },
    [buildHeaders, buildUrl]
  );

  /**
   * Raw fetch with header injection — for streaming responses.
   */
  const rawFetch = useCallback(
    async (path: string, init?: RequestInit, opts: RequestOptions = {}): Promise<Response> => {
      const headers = await buildHeaders(opts.headers);
      const url = buildUrl(path, opts.params, opts.baseUrl);

      return fetch(url, {
        ...init,
        headers: {
          ...headers,
          ...init?.headers,
        },
      });
    },
    [buildHeaders, buildUrl]
  );

  return {
    get: <T = unknown>(path: string, opts?: RequestOptions) =>
      request<T>("GET", path, undefined, opts).then((r) => r.data),
    getWithMeta: <T = unknown>(path: string, opts?: RequestOptions) =>
      request<T>("GET", path, undefined, opts),
    post: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>("POST", path, body, opts).then((r) => r.data),
    patch: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>("PATCH", path, body, opts).then((r) => r.data),
    del: <T = unknown>(path: string, opts?: RequestOptions) =>
      request<T>("DELETE", path, undefined, opts).then((r) => r.data),
    rawFetch,
  };
}

// ─── Error Class ────────────────────────────────────────────────────────────

/**
 * Typed API error with error code, message, HTTP status, and optional details.
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

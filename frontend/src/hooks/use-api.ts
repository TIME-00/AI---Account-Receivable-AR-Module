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
import type { APIResponse } from "@/types";

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
}

interface ApiClient {
  get: <T = unknown>(path: string, opts?: RequestOptions) => Promise<T>;
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
   * Core request handler.
   */
  const request = useCallback(
    async <T = unknown>(
      method: string,
      path: string,
      body?: unknown,
      opts: RequestOptions = {}
    ): Promise<T> => {
      const headers = await buildHeaders(opts.headers);

      if (body && (method === "POST" || method === "PATCH")) {
        headers["Content-Type"] = "application/json";
      }

      const url = buildUrl(path, opts.params, opts.baseUrl);

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle non-JSON responses
      const contentType = res.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        if (!res.ok) {
          const text = await res.text();
          if (!opts.silent) {
            toast.error("Request Failed", {
              description: text || `HTTP ${res.status}`,
            });
          }
          throw new ApiError("NETWORK_ERROR", text || `HTTP ${res.status}`, res.status);
        }
        return (await res.text()) as unknown as T;
      }

      // Parse API response envelope
      const json: APIResponse<T> = await res.json();

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

      return json.data as T;
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
      request<T>("GET", path, undefined, opts),
    post: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>("POST", path, body, opts),
    patch: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>("PATCH", path, body, opts),
    del: <T = unknown>(path: string, opts?: RequestOptions) =>
      request<T>("DELETE", path, undefined, opts),
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

// ============================================================================
// Gate E E2E — pure diagnostic classifiers (deterministic, framework-free).
//
// Extracted from the Playwright spec so the fail-closed request-failure policy
// can be unit-tested directly (no browser flakiness). Import-safe from Vitest.
// ============================================================================

/** The Supabase Edge Function path prefix. Requests here are the mocked API
 *  surface and must NEVER be treated as a benign Next.js prefetch cancellation. */
export const EDGE_FUNCTION_PREFIX = "/functions/v1/";

/**
 * True for the Edge Function surface: the EXACT root `/functions/v1` OR anything
 * under `/functions/v1/`. A bare `pathname.includes("/functions/v1/")` misses the
 * exact root (no trailing slash), so `/functions/v1?_rsc=x` would slip through —
 * this predicate closes that hole structurally. The substring clause is retained
 * as defense-in-depth so the prefix appearing anywhere is also treated as Edge.
 */
export function isEdgeFunctionPath(pathname: string): boolean {
  return pathname === "/functions/v1" || pathname.includes(EDGE_FUNCTION_PREFIX);
}

export type RequestFailureClass =
  | "oauth-abort"
  | "rsc-prefetch-abort"
  | "unexpected";

export interface RequestFailureInput {
  url: string;
  method: string;
  /** Playwright `request.failure()?.errorText` (e.g. "net::ERR_ABORTED"). */
  failureText: string;
  /** The local application origin (empty string when not a local run). */
  appOrigin: string;
  /** Exact OAuth provider consent origins the guard route aborts. */
  oauthOrigins: readonly string[];
}

/**
 * Classify a failed request into exactly one bucket. Only TWO deterministic
 * aborts are "expected"; everything else is "unexpected" and must fail the test.
 *
 * expected:
 *  - "oauth-abort": ERR_ABORTED to an exact OAuth provider consent origin
 *    (the deterministic guard route).
 *  - "rsc-prefetch-abort": a same-origin Next.js `<Link>` RSC prefetch
 *    (GET + `_rsc` query) cancelled by a superseding navigation — and NOT an
 *    Edge (`/functions/v1/`) path. A same-origin Edge request that happens to
 *    carry `_rsc` can NEVER be laundered into this bucket.
 *
 * Anything else — a `/functions/v1/` abort, a non-GET, a same-origin GET
 * without `_rsc`, an external origin, or any non-abort transport error — is
 * "unexpected".
 */
export function classifyRequestFailure(input: RequestFailureInput): RequestFailureClass {
  const { url, method, failureText, appOrigin, oauthOrigins } = input;
  const aborted = failureText.includes("ERR_ABORTED");
  if (!aborted) return "unexpected";

  let origin = "";
  let hasRscParam = false;
  let isEdgePath = false;
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    hasRscParam = parsed.searchParams.has("_rsc");
    isEdgePath = isEdgeFunctionPath(parsed.pathname);
  } catch {
    return "unexpected";
  }

  if (oauthOrigins.includes(origin)) return "oauth-abort";

  if (
    appOrigin !== "" &&
    origin === appOrigin &&
    method === "GET" &&
    hasRscParam &&
    !isEdgePath
  ) {
    return "rsc-prefetch-abort";
  }

  return "unexpected";
}

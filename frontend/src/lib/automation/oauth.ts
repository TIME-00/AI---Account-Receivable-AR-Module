// ============================================================================
// Gate E — OAuth navigation hardening.
//
// The backend already bounds the authorization URL to a fixed provider origin,
// but the frontend NEVER trusts a raw backend string for navigation. Before we
// open any consent window we re-validate the URL here: HTTPS only, an exact
// allowlisted host, and no embedded credentials. Anything else is refused with
// a safe error and no navigation occurs.
// ============================================================================

import type { ProviderType } from "@/lib/automation/contract";

/** Exact hosts permitted per provider. No subdomains, no look-alikes. */
const ALLOWED_HOSTS: Record<ProviderType, string> = {
  gmail: "accounts.google.com",
  microsoft: "login.microsoftonline.com",
};

export interface OAuthUrlValidation {
  ok: boolean;
  /** The validated href, only present when `ok` is true. */
  href?: string;
  reason?: string;
}

/**
 * Validate a provider authorization URL for safe navigation.
 *
 * Rejects: non-HTTPS, wrong/unknown host, embedded username/password, and any
 * value `new URL` cannot parse. Never returns an unvalidated string.
 */
export function validateOAuthAuthorizationUrl(
  provider: ProviderType,
  rawUrl: string,
): OAuthUrlValidation {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "The authorization link is malformed." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "The authorization link must use HTTPS." };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: "The authorization link must not embed credentials.",
    };
  }
  // Reject any explicit non-default port. `new URL` normalizes the default
  // HTTPS port (443) to an empty string, so `url.port === ""` accepts
  // `https://host/` and `https://host:443/` but refuses `:444`, `:8443`, etc.
  // — a port-based bypass of the exact-host allowlist.
  if (url.port !== "") {
    return {
      ok: false,
      reason: "The authorization link uses an unexpected port.",
    };
  }
  const expectedHost = ALLOWED_HOSTS[provider];
  if (!expectedHost || url.hostname !== expectedHost) {
    return {
      ok: false,
      reason: "The authorization link points to an unrecognized provider.",
    };
  }
  return { ok: true, href: url.toString() };
}

/**
 * Open a validated authorization URL in a new tab with `noopener,noreferrer`.
 * Returns the validation result so the caller can surface a safe error when the
 * URL is refused. Navigation happens ONLY when validation passes.
 */
export function openOAuthAuthorizationUrl(
  provider: ProviderType,
  rawUrl: string,
): OAuthUrlValidation {
  const result = validateOAuthAuthorizationUrl(provider, rawUrl);
  if (result.ok && result.href) {
    window.open(result.href, "_blank", "noopener,noreferrer");
  }
  return result;
}

/**
 * Navigate the CURRENT tab to a validated authorization URL.
 *
 * Used by the one-action Delivery onboarding flow: the backend completes the
 * callback server-side and returns the browser to the Mailboxes page, so the
 * consent round-trip must happen in the tab the user is already looking at.
 * Navigation happens ONLY when the same strict validation passes.
 */
export function navigateToOAuthAuthorizationUrl(
  provider: ProviderType,
  rawUrl: string,
): OAuthUrlValidation {
  const result = validateOAuthAuthorizationUrl(provider, rawUrl);
  if (result.ok && result.href) {
    window.location.assign(result.href);
  }
  return result;
}

// ============================================================================
// Post-Gate-E — browser callback return.
//
// After provider consent the backend redirects to the fixed Mailboxes path with
// a bounded query value. That value is PRESENTATION FEEDBACK ONLY: it carries
// no activation authority, it is never used to derive mailbox state, and the
// frontend never PATCHes anything in response to it. The authoritative state is
// re-read from `GET /mailboxes`.
// ============================================================================

/** Bounded, already-sanitized backend error code shape (`safeErrorCode`). */
const SAFE_CALLBACK_CODE = /^[A-Z0-9_]{1,80}$/;

/** Exact message shown when Delivery activation succeeded server-side. */
export const DELIVERY_ENABLED_MESSAGE = "Delivery enabled successfully.";

const CALLBACK_FAILURE_MESSAGE: Record<string, string> = {
  OAUTH_PROVIDER_DENIED:
    "Provider authorization was cancelled. Nothing was changed.",
  VALIDATION_ERROR:
    "Provider authorization did not complete. Nothing was changed.",
  OAUTH_STATE_EXPIRED:
    "The authorization request expired. Start the action again.",
  OAUTH_STATE_ALREADY_USED:
    "The authorization request was already used. Start the action again.",
  OAUTH_STATE_MISMATCH:
    "The authorization request did not match. Start the action again.",
  OAUTH_SCOPE_INSUFFICIENT:
    "Consent did not grant the required send permission. Nothing was enabled.",
  OAUTH_REFRESH_TOKEN_REQUIRED:
    "Consent did not grant renewable access. Nothing was enabled.",
  OAUTH_DELIVERY_FINALIZE_FAILED:
    "Delivery authorization could not be stored securely. Nothing was enabled.",
};

const CALLBACK_FAILURE_FALLBACK =
  "Provider authorization did not complete. Nothing was changed.";

export type OAuthCallbackOutcome =
  | { kind: "none" }
  | { kind: "success"; capability: "ingestion" | "delivery"; message: string }
  | { kind: "error"; message: string };

/**
 * Read the display-only callback outcome from a location query string.
 *
 * Accepts ONLY the exact keys/values the backend emits. Anything else — an
 * unknown value, an injected code, a raw provider payload — is ignored and
 * reported as `none`, so a crafted URL can neither fabricate a success message
 * nor render attacker-controlled text.
 */
export function readOAuthCallbackOutcome(search: string): OAuthCallbackOutcome {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { kind: "none" };
  }
  const delivery = params.get("delivery_oauth");
  const ingestion = params.get("oauth");
  const outcome = delivery ?? ingestion;
  if (outcome === null) return { kind: "none" };
  if (outcome === "success") {
    return delivery !== null
      ? {
          kind: "success",
          capability: "delivery",
          message: DELIVERY_ENABLED_MESSAGE,
        }
      : {
          kind: "success",
          capability: "ingestion",
          message: "Mailbox authorization completed.",
        };
  }
  if (outcome !== "error") return { kind: "none" };
  const code = params.get("code");
  if (code === null || !SAFE_CALLBACK_CODE.test(code)) {
    return { kind: "error", message: CALLBACK_FAILURE_FALLBACK };
  }
  return {
    kind: "error",
    message: `${CALLBACK_FAILURE_MESSAGE[code] ?? CALLBACK_FAILURE_FALLBACK} (${code})`,
  };
}

/** Query keys the callback return adds; stripped once the outcome is shown. */
export const OAUTH_CALLBACK_QUERY_KEYS = [
  "delivery_oauth",
  "oauth",
  "code",
] as const;

/**
 * Remove ONLY the callback keys from a query string, preserving any unrelated
 * parameter. Returned value includes the leading `?`, or `""` when empty — so a
 * refresh after the message is shown cannot repeat it.
 */
export function stripOAuthCallbackQuery(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of OAUTH_CALLBACK_QUERY_KEYS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

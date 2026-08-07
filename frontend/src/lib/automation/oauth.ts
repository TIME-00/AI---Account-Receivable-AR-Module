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

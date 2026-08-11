// ============================================================================
// Gate E — OAuth navigation allowlist tests. Proves the frontend never trusts
// a raw backend URL: only exact HTTPS provider origins are accepted; every
// other shape (http, wrong host, embedded credentials, junk) is refused.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  DELIVERY_ENABLED_MESSAGE,
  readOAuthCallbackOutcome,
  stripOAuthCallbackQuery,
  validateOAuthAuthorizationUrl,
} from "./oauth";

describe("validateOAuthAuthorizationUrl", () => {
  it("accepts the exact Google authorization origin", () => {
    const r = validateOAuthAuthorizationUrl(
      "gmail",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=y",
    );
    expect(r.ok).toBe(true);
    expect(r.href).toContain("accounts.google.com");
  });

  it("accepts the exact Microsoft authorization origin", () => {
    const r = validateOAuthAuthorizationUrl(
      "microsoft",
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects http (non-HTTPS)", () => {
    expect(
      validateOAuthAuthorizationUrl("gmail", "http://accounts.google.com/o/oauth2/v2/auth").ok,
    ).toBe(false);
  });

  it("rejects a wrong/look-alike host", () => {
    expect(
      validateOAuthAuthorizationUrl("gmail", "https://accounts.google.com.evil.test/o/oauth2/v2/auth")
        .ok,
    ).toBe(false);
    expect(
      validateOAuthAuthorizationUrl("gmail", "https://evil.test/o/oauth2/v2/auth").ok,
    ).toBe(false);
  });

  it("rejects the wrong provider's host", () => {
    expect(
      validateOAuthAuthorizationUrl("microsoft", "https://accounts.google.com/o/oauth2/v2/auth").ok,
    ).toBe(false);
  });

  it("rejects embedded credentials", () => {
    expect(
      validateOAuthAuthorizationUrl(
        "gmail",
        "https://user:pass@accounts.google.com/o/oauth2/v2/auth",
      ).ok,
    ).toBe(false);
  });

  it("rejects an unparseable URL", () => {
    expect(validateOAuthAuthorizationUrl("gmail", "not a url").ok).toBe(false);
  });

  it("rejects a javascript: or data: scheme", () => {
    expect(
      validateOAuthAuthorizationUrl("gmail", "javascript:alert(1)").ok,
    ).toBe(false);
    expect(validateOAuthAuthorizationUrl("gmail", "data:text/html,x").ok).toBe(false);
  });

  it("rejects an unexpected explicit port on the correct host", () => {
    expect(
      validateOAuthAuthorizationUrl("gmail", "https://accounts.google.com:444/o/oauth2/v2/auth").ok,
    ).toBe(false);
    expect(
      validateOAuthAuthorizationUrl(
        "microsoft",
        "https://login.microsoftonline.com:8443/common/oauth2/v2.0/authorize",
      ).ok,
    ).toBe(false);
  });

  it("accepts the default HTTPS port (explicit :443 is normalized away)", () => {
    expect(
      validateOAuthAuthorizationUrl("gmail", "https://accounts.google.com:443/o/oauth2/v2/auth").ok,
    ).toBe(true);
  });

  it("preserves a valid Microsoft tenant path", () => {
    const r = validateOAuthAuthorizationUrl(
      "microsoft",
      "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/oauth2/v2.0/authorize?client_id=x",
    );
    expect(r.ok).toBe(true);
    expect(r.href).toContain("/9188040d-6c67-4c5b-b112-36a304b66dad/");
  });
});

// ============================================================================
// Post-Gate-E — provider callback return. The query is PRESENTATION ONLY: it
// must never be able to fabricate a success, render attacker text, or survive
// into a refresh.
// ============================================================================

describe("readOAuthCallbackOutcome", () => {
  it("reports the exact Delivery success message for delivery_oauth=success", () => {
    const outcome = readOAuthCallbackOutcome("?delivery_oauth=success");
    expect(outcome).toEqual({
      kind: "success",
      capability: "delivery",
      message: "Delivery enabled successfully.",
    });
    expect(DELIVERY_ENABLED_MESSAGE).toBe("Delivery enabled successfully.");
  });

  it("keeps the ingestion callback distinct from the Delivery one", () => {
    const outcome = readOAuthCallbackOutcome("?oauth=success");
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.capability).toBe("ingestion");
      expect(outcome.message).not.toBe(DELIVERY_ENABLED_MESSAGE);
    }
  });

  it("maps a known safe failure code to a safe cancel/failure message", () => {
    const outcome = readOAuthCallbackOutcome("?oauth=error&code=OAUTH_PROVIDER_DENIED");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toMatch(/cancelled/i);
      expect(outcome.message).toContain("OAUTH_PROVIDER_DENIED");
    }
  });

  it("falls back to a generic safe message for an unknown or unsafe code", () => {
    for (
      const search of [
        "?oauth=error",
        "?oauth=error&code=SOMETHING_NEW",
        "?oauth=error&code=<script>alert(1)</script>",
        "?oauth=error&code=lowercase",
        `?oauth=error&code=${"A".repeat(81)}`,
      ]
    ) {
      const outcome = readOAuthCallbackOutcome(search);
      expect(outcome.kind).toBe("error");
      if (outcome.kind === "error") {
        expect(outcome.message).not.toContain("<");
        expect(outcome.message).toMatch(/Nothing was changed/);
      }
    }
  });

  it("ignores any value that is not exactly success or error", () => {
    for (
      const search of [
        "",
        "?",
        "?page=2",
        "?delivery_oauth=",
        "?delivery_oauth=enabled",
        "?delivery_oauth=SUCCESS",
        "?oauth=true",
      ]
    ) {
      expect(readOAuthCallbackOutcome(search)).toEqual({ kind: "none" });
    }
  });

  it("never lets a crafted query fabricate a Delivery success", () => {
    // Only the exact backend-emitted pair produces the success message.
    expect(readOAuthCallbackOutcome("?oauth=success&delivery_oauth=error").kind).toBe(
      "error",
    );
    expect(readOAuthCallbackOutcome("?code=OAUTH_PROVIDER_DENIED")).toEqual({
      kind: "none",
    });
  });
});

describe("stripOAuthCallbackQuery", () => {
  it("removes every callback key so a refresh cannot repeat the message", () => {
    expect(stripOAuthCallbackQuery("?delivery_oauth=success")).toBe("");
    expect(stripOAuthCallbackQuery("?oauth=error&code=OAUTH_PROVIDER_DENIED")).toBe("");
  });

  it("preserves unrelated query parameters", () => {
    expect(stripOAuthCallbackQuery("?page=2&delivery_oauth=success")).toBe("?page=2");
  });

  it("returns an empty string for an already-clean location", () => {
    expect(stripOAuthCallbackQuery("")).toBe("");
    expect(stripOAuthCallbackQuery("?")).toBe("");
  });
});

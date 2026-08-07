// ============================================================================
// Gate E — OAuth navigation allowlist tests. Proves the frontend never trusts
// a raw backend URL: only exact HTTPS provider origins are accepted; every
// other shape (http, wrong host, embedded credentials, junk) is refused.
// ============================================================================

import { describe, expect, it } from "vitest";
import { validateOAuthAuthorizationUrl } from "./oauth";

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

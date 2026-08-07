// Executable coverage for the Gate E E2E request-failure classifier (Blocker B).
// Proves a `/functions/v1/` Edge request can NEVER be classified as an expected
// Next.js RSC-prefetch cancellation, while a genuine same-origin RSC prefetch
// still is. Pure/deterministic — no browser required.
import { describe, it, expect } from "vitest";
import { classifyRequestFailure, isEdgeFunctionPath } from "../../e2e/diagnostics";

const APP = "http://127.0.0.1:3100";
const OAUTH = ["https://accounts.google.com", "https://login.microsoftonline.com"] as const;
const ABORT = "net::ERR_ABORTED";

function classify(url: string, method = "GET", failureText = ABORT) {
  return classifyRequestFailure({ url, method, failureText, appOrigin: APP, oauthOrigins: OAUTH });
}

describe("classifyRequestFailure — expected aborts", () => {
  it("allows a same-origin Next.js RSC prefetch GET (`_rsc`) abort", () => {
    expect(classify(`${APP}/invoices/abc?_rsc=x8i0`)).toBe("rsc-prefetch-abort");
  });

  it("allows an OAuth consent-origin abort (Google)", () => {
    expect(classify("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")).toBe("oauth-abort");
  });

  it("allows an OAuth consent-origin abort (Microsoft)", () => {
    expect(classify("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")).toBe(
      "oauth-abort",
    );
  });
});

describe("classifyRequestFailure — MUST be unexpected", () => {
  it("rejects the EXACT Edge root `/functions/v1?_rsc=` GET abort (no trailing slash)", () => {
    // Regression: `pathname.includes("/functions/v1/")` misses the bare root.
    expect(classify(`${APP}/functions/v1?_rsc=x`)).toBe("unexpected");
  });

  it("rejects a same-origin `/functions/v1/**?_rsc=` GET abort (Edge can never be RSC)", () => {
    expect(classify(`${APP}/functions/v1/automation/overview?_rsc=x8i0`)).toBe("unexpected");
  });

  it("rejects a same-origin `/functions/v1/automation?_rsc=` GET abort", () => {
    expect(classify(`${APP}/functions/v1/automation?_rsc=x`)).toBe("unexpected");
  });

  it("rejects a same-origin `/functions/v1/**` GET abort with no _rsc", () => {
    expect(classify(`${APP}/functions/v1/automation/reminders?invoice_id=1`)).toBe("unexpected");
  });

  it("rejects a same-origin POST with `_rsc` abort (non-GET)", () => {
    expect(classify(`${APP}/invoices/abc?_rsc=x8i0`, "POST")).toBe("unexpected");
  });

  it("rejects a same-origin PATCH with `_rsc` abort (non-GET)", () => {
    expect(classify(`${APP}/invoices/abc?_rsc=x8i0`, "PATCH")).toBe("unexpected");
  });

  it("rejects a same-origin GET abort WITHOUT `_rsc`", () => {
    expect(classify(`${APP}/invoices/abc`)).toBe("unexpected");
  });

  it("rejects an external (non-app, non-OAuth) origin abort with `_rsc`", () => {
    expect(classify("https://evil.example.test/x?_rsc=1")).toBe("unexpected");
  });

  it("rejects a NON-abort failure even for a same-origin RSC-shaped URL", () => {
    expect(classify(`${APP}/invoices/abc?_rsc=x8i0`, "GET", "net::ERR_CONNECTION_REFUSED")).toBe(
      "unexpected",
    );
  });

  it("rejects an OAuth-origin failure that is NOT an abort", () => {
    expect(
      classify("https://accounts.google.com/o/oauth2/v2/auth", "GET", "net::ERR_FAILED"),
    ).toBe("unexpected");
  });

  it("treats a `/functions/v1/` substring anywhere in the path as Edge (defensive)", () => {
    expect(classify(`${APP}/app/functions/v1/x?_rsc=1`)).toBe("unexpected");
  });
});

describe("isEdgeFunctionPath", () => {
  it("is true for the EXACT Edge root (no trailing slash)", () => {
    expect(isEdgeFunctionPath("/functions/v1")).toBe(true);
  });
  it("is true for any path under the Edge prefix", () => {
    expect(isEdgeFunctionPath("/functions/v1/automation")).toBe(true);
    expect(isEdgeFunctionPath("/functions/v1/auth/me")).toBe(true);
  });
  it("is false for ordinary same-origin app routes", () => {
    expect(isEdgeFunctionPath("/invoices/123")).toBe(false);
    expect(isEdgeFunctionPath("/functions/v2")).toBe(false);
    expect(isEdgeFunctionPath("/functions")).toBe(false);
  });
});

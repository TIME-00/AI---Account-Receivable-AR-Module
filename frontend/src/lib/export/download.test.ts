import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, EXPORT_MIME } from "./download";

describe("downloadBlob", () => {
  let created: string[];
  let revoked: string[];
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    created = [];
    revoked = [];
    let counter = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => {
        const url = `blob:mock/${counter++}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
    // Anchor clicks must not trigger a real navigation in jsdom.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates one object URL, clicks a detached anchor, and revokes it", () => {
    downloadBlob(new Blob(["hi"], { type: EXPORT_MIME.pdf }), "report.pdf");
    expect(created).toHaveLength(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Anchor is removed synchronously.
    expect(document.querySelector("a[download]")).toBeNull();
    // Revoke is deferred, then fires.
    expect(revoked).toHaveLength(0);
    vi.runAllTimers();
    expect(revoked).toEqual(created);
  });

  it("sets the download filename on the anchor", () => {
    let capturedName = "";
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      capturedName = this.download;
    });
    downloadBlob(new Blob(["x"]), "invoice-summary_2026-07-31.xlsx");
    expect(capturedName).toBe("invoice-summary_2026-07-31.xlsx");
  });

  it("still revokes the URL and removes the anchor if the click throws", () => {
    clickSpy.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => downloadBlob(new Blob(["x"]), "r.pdf")).toThrow("blocked");
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoked).toEqual(created);
  });

  it("does not leak object URLs across repeated exports", () => {
    downloadBlob(new Blob(["a"]), "a.pdf");
    downloadBlob(new Blob(["b"]), "b.pdf");
    downloadBlob(new Blob(["c"]), "c.pdf");
    vi.runAllTimers();
    expect(created).toHaveLength(3);
    expect(revoked.slice().sort()).toEqual(created.slice().sort());
  });
});

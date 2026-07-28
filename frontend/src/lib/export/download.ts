// ============================================================================
// TSH Synergy AR — Gate C report export: safe blob download
//
// Creates exactly one object URL per download and revokes it reliably, even if
// the anchor click throws. Never uses data: URLs (unsuitable for large files).
// ============================================================================

import type { ExportFormat } from "./types";

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Trigger a browser download of `blob` as `filename`. The temporary object URL
 * and anchor are always cleaned up — the revoke runs in a `finally`, and is
 * additionally deferred with a timeout so the navigation started by the click
 * is not cancelled before the browser has consumed the URL.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Downloads are only available in a browser environment.");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    // Defer the revoke so an in-flight download is not interrupted, but never
    // leak the URL if the timer environment is unavailable.
    if (typeof setTimeout === "function") {
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } else {
      URL.revokeObjectURL(url);
    }
  }
}

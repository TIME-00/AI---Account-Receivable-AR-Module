// ============================================================================
// TSH Synergy AR — Gate C report export hook
//
// One-shot: fetch the authoritative dataset → generate the file client-side →
// download. Never sends pagination or identity, never caches the full dataset,
// never logs report rows. Concurrent exports for the same report are blocked,
// and an in-flight request is aborted on unmount.
// ============================================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/hooks/use-api";
import { useAuthContext } from "@/hooks/use-auth-context";
import { useCompanyStore } from "@/stores/company-store";
import {
  buildExportFilename,
  buildExportRequest,
  downloadBlob,
  ExportAuthorizationError,
  ExportError,
  ExportGenerationError,
  ExportNetworkError,
  ExportParseError,
  ExportValidationError,
  type ExportFormat,
  type ExportReportType,
  generateReportPdf,
  generateReportXlsx,
  mapExportResponse,
} from "@/lib/export";

export type ExportStatus = "idle" | "fetching" | "generating" | "success" | "error";

export interface UseReportExportResult {
  status: ExportStatus;
  /** True only after authenticated company and user authority are both known. */
  isReady: boolean;
  /** True while fetching or generating — used to disable/spinner the control. */
  isPending: boolean;
  /** The format currently being produced (for format-specific progress text). */
  activeFormat: ExportFormat | null;
  error: ExportError | null;
  run: (format: ExportFormat, filters: Record<string, string | undefined>) => void;
  reset: () => void;
}

/** Read a fetch Response as JSON, returning `undefined` for a non-JSON body. */
async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function useReportExport(reportType: ExportReportType): UseReportExportResult {
  const { rawFetch } = useApi();
  const companyId = useCompanyStore((state) => state.companyId);
  const { data: auth } = useAuthContext();
  const userId = auth?.user.id ?? "";
  const identityReady = companyId.trim().length > 0 && userId.trim().length > 0;
  const identityKey = `${companyId}\u0000${userId}\u0000${reportType}`;
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [activeFormat, setActiveFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<ExportError | null>(null);

  // Guards a single in-flight export and the abort controller for it.
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const runSequence = useRef(0);
  const identityRef = useRef(identityKey);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runSequence.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      inFlight.current = false;
    };
  }, []);

  // A company, user, or report change invalidates both the response and any
  // generated file from the previous authority context. Late fetch/generation
  // completions cannot download or overwrite state for the new identity.
  useEffect(() => {
    if (identityRef.current === identityKey) return;
    identityRef.current = identityKey;
    runSequence.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlight.current = false;
    if (mounted.current) {
      setStatus("idle");
      setActiveFormat(null);
      setError(null);
    }
  }, [identityKey]);

  const reset = useCallback(() => {
    if (!mounted.current) return;
    runSequence.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlight.current = false;
    setStatus("idle");
    setActiveFormat(null);
    setError(null);
  }, []);

  const run = useCallback(
    (format: ExportFormat, filters: Record<string, string | undefined>) => {
      // Duplicate-submit prevention: ignore while a request is in flight.
      if (inFlight.current) return;
      if (!identityReady) {
        setActiveFormat(format);
        setError(new ExportAuthorizationError("Your authenticated report context is not ready."));
        setStatus("error");
        return;
      }
      inFlight.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      const runId = ++runSequence.current;
      const runIdentity = identityKey;

      const apply = (fn: () => void) => {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          runSequence.current === runId &&
          identityRef.current === runIdentity
        ) fn();
      };
      const isActive = () =>
        mounted.current &&
        !controller.signal.aborted &&
        runSequence.current === runId &&
        identityRef.current === runIdentity;

      (async () => {
        apply(() => {
          setError(null);
          setActiveFormat(format);
          setStatus("fetching");
        });

        const { path, params } = buildExportRequest(reportType, filters);
        const response = await rawFetch(
          path,
          { signal: controller.signal },
          { params },
        );
        const body = await readJson(response);
        if (body === undefined && !response.ok) throw new ExportNetworkError();
        const dataset = mapExportResponse(reportType, response.status, body);

        if (!isActive()) return;
        apply(() => setStatus("generating"));
        const blob = format === "pdf"
          ? await generateReportPdf(dataset)
          : await generateReportXlsx(dataset);

        // Only touch the DOM/download if we are still the active, unaborted run.
        if (!isActive()) return;
        try {
          downloadBlob(blob, buildExportFilename(dataset, format));
        } catch {
          throw new ExportGenerationError("The export file could not be downloaded.");
        }
        apply(() => setStatus("success"));
      })()
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return; // silent on cancel/unmount
          const normalized = caught instanceof ExportError
            ? caught
            : caught instanceof ExportParseError
            ? new ExportValidationError("The export response was malformed and was not downloaded.")
            : new ExportNetworkError();
          apply(() => {
            setError(normalized);
            setStatus("error");
          });
        })
        .finally(() => {
          if (runSequence.current === runId) inFlight.current = false;
          if (abortRef.current === controller) abortRef.current = null;
        });
    },
    [identityKey, identityReady, rawFetch, reportType],
  );

  return {
    status,
    isReady: identityReady,
    isPending: status === "fetching" || status === "generating",
    activeFormat,
    error,
    run,
    reset,
  };
}

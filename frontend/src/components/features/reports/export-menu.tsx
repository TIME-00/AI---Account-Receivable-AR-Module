// ============================================================================
// TSH Synergy AR — Gate C report export menu
//
// Accessible Export control for the four report pages. Offers PDF and XLSX,
// shows format-specific pending / success / error feedback, supports retry, and
// never reports success unless the file was actually generated and downloaded.
// Keyboard: ArrowUp/Down/Home/End navigation, Escape closes with focus restore,
// outside-click closes. Double submission is blocked by the export hook.
// ============================================================================

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReportExport } from "@/hooks/use-report-export";
import type { ExportFormat, ExportReportType } from "@/lib/export";

interface ExportMenuProps {
  reportType: ExportReportType;
  /** The report page's current authoritative filters (already mapped to the route). */
  filters: Record<string, string | undefined>;
  /** Disable the control (e.g. while the report itself is still loading). */
  disabled?: boolean;
}

const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: "PDF", xlsx: "Excel" };

export function ExportMenu({ reportType, filters, disabled = false }: ExportMenuProps) {
  const { status, isReady, isPending, activeFormat, error, run, reset } = useReportExport(reportType);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLButtonElement[]>([]);
  const announcedRef = useRef<ExportStatusKey | null>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Escape + outside-click close.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, close]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (open) itemsRef.current[0]?.focus();
  }, [open]);

  // Announce terminal states via a toast exactly once each.
  useEffect(() => {
    const key: ExportStatusKey | null = status === "success"
      ? `success:${activeFormat}`
      : status === "error"
      ? `error:${error?.kind}`
      : null;
    if (key && announcedRef.current !== key) {
      announcedRef.current = key;
      if (status === "success" && activeFormat) {
        toast.success(`${FORMAT_LABEL[activeFormat]} export downloaded`);
      } else if (status === "error") {
        toast.error(error?.message ?? "The export failed.");
      }
    }
    if (status === "idle" || status === "fetching") announcedRef.current = null;
  }, [status, activeFormat, error]);

  const handleSelect = (format: ExportFormat) => {
    close();
    run(format, filters);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = itemsRef.current;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const pendingLabel = activeFormat
    ? status === "fetching"
      ? `Preparing ${FORMAT_LABEL[activeFormat]}…`
      : `Generating ${FORMAT_LABEL[activeFormat]}…`
    : "Working…";

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || !isReady || isPending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={isPending}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
        {isPending ? pendingLabel : "Export"}
        {!isPending && <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Choose export format"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl shadow-slate-300/40"
        >
          {(["pdf", "xlsx"] as const).map((format, index) => (
            <button
              key={format}
              ref={(el) => {
                if (el) itemsRef.current[index] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(format)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
            >
              {format === "pdf"
                ? <FileText className="h-4 w-4 text-red-500" aria-hidden="true" />
                : <FileSpreadsheet className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
              Export as {FORMAT_LABEL[format]}
            </button>
          ))}
        </div>
      )}

      {/* Live status region — announces pending / success / error to AT. */}
      <div className="min-h-[1.25rem] text-right" aria-live="polite" role="status">
        {isPending && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {pendingLabel}
          </span>
        )}
        {status === "success" && activeFormat && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            {FORMAT_LABEL[activeFormat]} downloaded
          </span>
        )}
        {status === "error" && error && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-red-600">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="max-w-[16rem] text-right">{error.message}</span>
            <button
              type="button"
              onClick={() => {
                reset();
                if (activeFormat) run(activeFormat, filters);
              }}
              className={cn(
                "rounded border border-red-200 px-1.5 py-0.5 font-medium text-red-700",
                "hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40",
              )}
            >
              Retry
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

type ExportStatusKey = `success:${string}` | `error:${string}`;

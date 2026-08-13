"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin, RotateCcw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPOSABLE_FOCUS_RING } from "@/lib/focus-styles";
import { useUserRole } from "@/hooks/use-user-role";
import { useArCopilot } from "@/hooks/use-ar-copilot";
import { useCopilotContext } from "@/hooks/use-copilot-context";
import { copilotSuggestions } from "@/lib/ar-copilot/suggestions";
import {
  COPILOT_READ_ONLY_BADGE,
  COPILOT_READ_ONLY_DETAIL,
} from "@/lib/ar-copilot/disclosure";
import { CopilotChat } from "./copilot-chat";
import { CopilotDisclosure } from "./copilot-disclosure";
import { WorkflowGuide } from "./workflow-guide";

type CopilotTab = "chat" | "guide";

const TABS: ReadonlyArray<{ id: CopilotTab; label: string }> = [
  { id: "chat", label: "Ask Copilot" },
  { id: "guide", label: "Workflow Guide" },
];

/**
 * AR Copilot drawer.
 *
 * Combines the AI assistant with the hand-written Workflow Guide rather than
 * replacing one with the other: a generated answer is right for "why is this
 * invoice still open", a maintained step list is right for "how do I post one".
 *
 * On desktop it is a right-side panel beside the application. Below `lg` it
 * becomes a full-height sheet over a scrim, because squeezing the AR tables
 * into the remaining width would make the application itself unusable.
 */
export function ArCopilotPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<CopilotTab>("chat");
  const titleId = useId();
  const context = useCopilotContext();
  const { roles } = useUserRole();
  const state = useArCopilot(context.hint, context.label);
  const panel = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(
    () => copilotSuggestions(context.hint.page, roles),
    [context.hint.page, roles],
  );

  // Escape closes, matching every other dismissible surface in the product.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <>
      {/* The scrim exists only on the sheet breakpoints; on desktop the panel
          sits alongside the page and must not dim it. */}
      <div
        className="ds-scrim fixed inset-0 z-40 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-ar-copilot-panel
        className={cn(
          "ds-overlay-enter fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-elevated outline-none",
          "sm:w-[420px]",
          "lg:static lg:z-auto lg:w-[400px] lg:shadow-none xl:w-[440px]",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="ds-glow-subtle mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-fill">
              <Sparkles className="h-4 w-4 text-white" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3
                id={titleId}
                className="text-sm font-semibold tracking-tight text-content"
              >
                AR Copilot
              </h3>
              <p className="truncate text-[11px] text-content-muted">
                AI Assistant for Accounts Receivable
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AR Copilot"
            className={`ds-press flex h-7 w-7 items-center justify-center rounded-md text-content-muted hover:bg-surface-muted hover:text-content ${COMPOSABLE_FOCUS_RING}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Status row: the product boundary, plus where the question is asked from */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
          <span
            title={COPILOT_READ_ONLY_DETAIL}
            data-copilot-read-only
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-content-secondary"
          >
            {COPILOT_READ_ONLY_BADGE}
          </span>
          <span
            data-copilot-context
            className="inline-flex min-w-0 items-center gap-1 rounded-md border border-accent/25 bg-accent-muted px-1.5 py-0.5 text-[10px] font-medium text-accent-hover"
          >
            <MapPin className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {context.isEntityContext ? "Context" : "Current page"}:{" "}
              {context.label}
            </span>
          </span>
          {state.turns.length > 0 && (
            <button
              type="button"
              onClick={state.reset}
              className={`ds-press ml-auto inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-medium text-content-secondary hover:border-line-strong hover:text-content ${COMPOSABLE_FOCUS_RING}`}
            >
              <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
              New conversation
            </button>
          )}
        </div>

        <CopilotDisclosure />

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="AR Copilot sections"
          className="flex gap-1 border-b border-line px-3 pt-2"
        >
          {TABS.map((entry) => {
            const isActive = tab === entry.id;
            return (
              <button
                key={entry.id}
                role="tab"
                type="button"
                id={`copilot-tab-${entry.id}`}
                aria-selected={isActive}
                aria-controls={`copilot-panel-${entry.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                    return;
                  }
                  event.preventDefault();
                  const index = TABS.findIndex((item) => item.id === tab);
                  const next = event.key === "ArrowRight"
                    ? (index + 1) % TABS.length
                    : (index - 1 + TABS.length) % TABS.length;
                  setTab(TABS[next].id);
                  document.getElementById(`copilot-tab-${TABS[next].id}`)
                    ?.focus();
                }}
                className={cn(
                  "relative rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors duration-fast ease-standard",
                  COMPOSABLE_FOCUS_RING,
                  isActive
                    ? "text-content"
                    : "text-content-muted hover:text-content-secondary",
                )}
              >
                {entry.label}
                <span
                  aria-hidden="true"
                  data-active={isActive ? "true" : "false"}
                  className="absolute inset-x-2 -bottom-px h-0.5 origin-center scale-x-0 rounded-full bg-accent transition-transform duration-normal ease-emphasized data-[active=true]:scale-x-100"
                />
              </button>
            );
          })}
        </div>

        {/* Panels */}
        <div
          role="tabpanel"
          id="copilot-panel-chat"
          aria-labelledby="copilot-tab-chat"
          hidden={tab !== "chat"}
          className={cn("min-h-0 flex-1", tab === "chat" ? "flex flex-col" : "")}
        >
          {tab === "chat" && (
            <CopilotChat state={state} suggestions={suggestions} />
          )}
        </div>
        <div
          role="tabpanel"
          id="copilot-panel-guide"
          aria-labelledby="copilot-tab-guide"
          hidden={tab !== "guide"}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 py-3",
            tab === "guide" ? "block" : "",
          )}
        >
          {tab === "guide" && <WorkflowGuide onNavigate={onClose} />}
        </div>
      </div>
    </>
  );
}

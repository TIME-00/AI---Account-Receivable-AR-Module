"use client";

import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { CopilotComposer } from "./copilot-composer";
import { CopilotMessage } from "./copilot-message";
import { SuggestionList } from "./suggestion-list";
import type { ArCopilotState } from "@/hooks/use-ar-copilot";
import type { CopilotSuggestion } from "@/lib/ar-copilot/suggestions";

/**
 * The activity line shown while waiting.
 *
 * The backend is non-streaming, so there is no token stream to imitate and no
 * honest way to say which record is being checked — the frontend does not know
 * which tool the model chose. The copy therefore describes the boundary, not a
 * fabricated step.
 */
const PENDING_LABEL = "Checking authorized AR information…";

function EmptyState({
  suggestions,
  onSelect,
  disabled,
}: {
  suggestions: readonly CopilotSuggestion[];
  onSelect: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="animate-fade-in space-y-4 py-2">
      <div>
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-muted">
          <Sparkles className="h-4 w-4 text-accent-hover" aria-hidden="true" />
        </div>
        <h4 className="text-sm font-semibold text-content">
          How can I help with your AR operations?
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-content-secondary">
          Ask about invoices, receipts, allocations, automation, journals, audit
          activity, or how to use this system.
        </p>
      </div>
      <SuggestionList
        suggestions={suggestions}
        onSelect={onSelect}
        disabled={disabled}
      />
    </div>
  );
}

function PendingIndicator() {
  return (
    <li className="flex items-center gap-2" data-copilot-pending>
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-fill">
        <Sparkles className="h-3 w-3 text-white" aria-hidden="true" />
      </span>
      {/* The dots are decorative; the sentence is the accessible content, so a
          screen reader hears one status rather than a stream of changes. */}
      <span className="text-xs text-content-secondary">{PENDING_LABEL}</span>
      <span aria-hidden="true" className="flex gap-1">
        <span className="h-1 w-1 animate-pulse rounded-full bg-accent" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
      </span>
    </li>
  );
}

export function CopilotChat({
  state,
  suggestions,
}: {
  state: ArCopilotState;
  suggestions: readonly CopilotSuggestion[];
}) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // `scrollIntoView` is absent in jsdom and in older embedded webviews;
    // scrolling is a convenience, so its absence must not break the panel.
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [state.turns.length, state.isPending]);

  const isEmpty = state.turns.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {isEmpty ? (
          <EmptyState
            suggestions={suggestions}
            onSelect={state.send}
            disabled={state.isPending}
          />
        ) : (
          <>
            {/* Assistant answers and errors are announced once they land, so a
                keyboard or screen-reader user is not left waiting silently. */}
            <ul className="space-y-4" aria-live="polite" aria-atomic="false">
              {state.turns.map((turn) => (
                <CopilotMessage key={turn.id} turn={turn} />
              ))}
              {state.isPending && <PendingIndicator />}
            </ul>
            {state.isTrimmingHistory && (
              <p className="mt-4 text-[10px] text-content-muted">
                Only the most recent part of this conversation is sent with each
                question. Start a new conversation for an unrelated topic.
              </p>
            )}
          </>
        )}
        <div ref={bottom} />
      </div>

      <CopilotComposer
        onSend={state.send}
        isPending={state.isPending}
        disabled={state.isExhausted}
        disabledReason="Start a new conversation to continue."
      />
    </div>
  );
}

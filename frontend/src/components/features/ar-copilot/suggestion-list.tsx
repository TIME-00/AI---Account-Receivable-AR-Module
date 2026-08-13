"use client";

import { COMPOSABLE_FOCUS_RING } from "@/lib/focus-styles";
import type { CopilotSuggestion } from "@/lib/ar-copilot/suggestions";

/**
 * Suggested questions.
 *
 * Clicking one asks it — it never sends silently in the background, and it is
 * never auto-sent on open. The list itself comes from the central registry, so
 * no question string is authored here.
 */
export function SuggestionList({
  suggestions,
  onSelect,
  disabled,
}: {
  suggestions: readonly CopilotSuggestion[];
  onSelect: (question: string) => void;
  disabled?: boolean;
}) {
  if (suggestions.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {suggestions.map((suggestion) => (
        <li key={suggestion.id}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(suggestion.question)}
            data-copilot-suggestion
            className={`ds-press group flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs font-medium text-content-secondary transition-colors duration-fast ease-standard hover:border-accent/40 hover:bg-accent-muted hover:text-content disabled:cursor-not-allowed disabled:opacity-50 ${COMPOSABLE_FOCUS_RING}`}
          >
            <span>{suggestion.question}</span>
            <span
              aria-hidden="true"
              className="shrink-0 text-content-muted transition-transform duration-fast ease-emphasized group-hover:translate-x-0.5 group-hover:text-accent"
            >
              →
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

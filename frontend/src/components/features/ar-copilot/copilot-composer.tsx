"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, SendHorizontal } from "lucide-react";
import { COMPOSABLE_FOCUS_RING } from "@/lib/focus-styles";
import { COPILOT_MAX_MESSAGE_CHARS } from "@/lib/ar-copilot/contract";

/** Show the counter once the message is close enough for it to matter. */
const COUNTER_THRESHOLD = COPILOT_MAX_MESSAGE_CHARS - 300;

export function CopilotComposer({
  onSend,
  isPending,
  disabled,
  disabledReason,
}: {
  onSend: (question: string) => void;
  isPending: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [value, setValue] = useState("");
  const inputId = useId();
  const counterId = useId();
  // `onCompositionStart/End` is the only reliable signal that an IME candidate
  // window is open. Without it, Enter to accept a Japanese, Chinese, or Korean
  // candidate would submit a half-composed message.
  const composing = useRef(false);

  const trimmed = value.trim();
  const overLimit = value.length > COPILOT_MAX_MESSAGE_CHARS;
  const canSend = trimmed.length > 0 && !overLimit && !isPending && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    // Shift+Enter is a newline. `isComposing` covers browsers that report it on
    // the event; the ref covers those that only fire the composition events.
    if (event.shiftKey || composing.current || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    submit();
  };

  return (
    <div className="border-t border-line bg-surface p-3">
      <label htmlFor={inputId} className="sr-only">
        Ask AR Copilot a question
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={inputId}
          rows={2}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled ? (disabledReason ?? "Unavailable") : "Ask about invoices, receipts, automation…"
          }
          aria-describedby={value.length > COUNTER_THRESHOLD ? counterId : undefined}
          aria-invalid={overLimit || undefined}
          className={`min-h-[56px] flex-1 resize-none rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm text-content placeholder:text-content-muted disabled:cursor-not-allowed disabled:opacity-60 ${COMPOSABLE_FOCUS_RING}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send question"
          className={`ds-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-fill text-white transition-colors duration-fast ease-standard hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:opacity-40 ${COMPOSABLE_FOCUS_RING}`}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] text-content-muted">
          Enter to send · Shift + Enter for a new line
        </p>
        {value.length > COUNTER_THRESHOLD && (
          <p
            id={counterId}
            data-copilot-counter
            className={
              overLimit
                ? "text-[10px] font-medium text-feedback-danger"
                : "text-[10px] text-content-muted"
            }
          >
            {value.length} / {COPILOT_MAX_MESSAGE_CHARS}
          </p>
        )}
      </div>
    </div>
  );
}

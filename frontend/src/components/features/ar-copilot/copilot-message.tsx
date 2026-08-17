"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import { CopilotArtifactList } from "./copilot-artifacts";
import { CopilotEvidenceList } from "./copilot-evidence";
import { CopilotLinkList } from "./copilot-links";
import type {
  CopilotAssistantTurn,
  CopilotErrorTurn,
  CopilotTurn,
  CopilotUserTurn,
} from "@/hooks/use-ar-copilot";

// ============================================================================
// Message rendering.
//
// The answer is rendered as TEXT. `whitespace-pre-wrap` preserves the model's
// paragraph and list breaks while React escapes the content, so assistant
// output cannot become markup. There is no `dangerouslySetInnerHTML` in this
// feature, no Markdown renderer, and no URL auto-linking: the server's `links`
// array is the only navigation authority.
// ============================================================================

function UserMessage({ turn }: { turn: CopilotUserTurn }) {
  return (
    <li className="animate-fade-in flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-lg rounded-br-sm border border-line bg-surface-muted px-3 py-2">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-content">
          {turn.content}
        </p>
      </div>
      {turn.contextLabel && (
        <p className="text-[10px] text-content-muted">
          Asked from {turn.contextLabel}
        </p>
      )}
    </li>
  );
}

function AssistantMessage({ turn }: { turn: CopilotAssistantTurn }) {
  return (
    <li className="animate-fade-in">
      <div className="flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-fill">
          <Sparkles className="h-3 w-3 text-white" aria-hidden="true" />
        </span>
        <span className="text-[11px] font-semibold tracking-wide text-content-secondary">
          AR Copilot
        </span>
      </div>
      <div className="mt-1.5 rounded-lg border border-line bg-surface-elevated p-3 shadow-card">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-content">
          {turn.answer}
        </p>
        {/* Narrative answer first, then the structured Gate 1 payloads, then
            sources and navigation — the existing order is unchanged for the
            v2 paths, which carry no artifacts. */}
        <CopilotArtifactList artifacts={turn.artifacts} />
        <CopilotEvidenceList evidence={turn.evidence} />
        <CopilotLinkList links={turn.links} />
      </div>
    </li>
  );
}

function ErrorMessage({ turn }: { turn: CopilotErrorTurn }) {
  return (
    <li className="animate-fade-in">
      <div className="flex items-start gap-2 rounded-lg border border-feedback-danger/30 bg-red-50 p-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-feedback-danger"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm leading-relaxed text-content">{turn.message}</p>
          {turn.exhausted && (
            <p className="mt-1 text-xs text-content-muted">
              Use New conversation to keep going.
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export function CopilotMessage({ turn }: { turn: CopilotTurn }) {
  if (turn.role === "user") return <UserMessage turn={turn} />;
  if (turn.role === "assistant") return <AssistantMessage turn={turn} />;
  return <ErrorMessage turn={turn} />;
}

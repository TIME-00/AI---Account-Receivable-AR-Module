"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, useApi } from "@/hooks/use-api";
import { useAuth } from "@/providers/auth-provider";
import { useCompanyStore } from "@/stores/company-store";
import {
  boundOutboundMessages,
  buildCopilotRequestBody,
  copilotErrorMessage,
  COPILOT_CHAT_PATH,
  COPILOT_MAX_MESSAGES,
  COPILOT_MAX_MESSAGE_CHARS,
  isConversationExhausted,
  parseCopilotChatResponse,
  type CopilotContextHint,
  type CopilotEvidence,
  type CopilotLink,
  type CopilotRequestMessage,
} from "@/lib/ar-copilot/contract";
import { isSafeCopilotLink } from "@/lib/ar-copilot/links";

export interface CopilotUserTurn {
  id: string;
  role: "user";
  content: string;
  /** The context label at the time it was asked; never relabelled later. */
  contextLabel: string;
}

export interface CopilotAssistantTurn {
  id: string;
  role: "assistant";
  answer: string;
  evidence: CopilotEvidence[];
  links: CopilotLink[];
}

export interface CopilotErrorTurn {
  id: string;
  role: "error";
  message: string;
  /** Set when the failure ends this conversation rather than this message. */
  exhausted: boolean;
}

export type CopilotTurn =
  | CopilotUserTurn
  | CopilotAssistantTurn
  | CopilotErrorTurn;

export interface ArCopilotState {
  turns: CopilotTurn[];
  isPending: boolean;
  /** True once the server reported a conversation-level limit. */
  isExhausted: boolean;
  /** True when the oldest turns no longer fit the bounded request window. */
  isTrimmingHistory: boolean;
  /** Remaining exchanges before the request window starts trimming. */
  remainingTurns: number;
  send: (question: string) => void;
  reset: () => void;
}

let turnCounter = 0;
function nextId(prefix: string): string {
  turnCounter += 1;
  return `${prefix}-${turnCounter}`;
}

/** The conversation as the backend vocabulary: user questions and answers. */
function toRequestMessages(
  turns: readonly CopilotTurn[],
): CopilotRequestMessage[] {
  const messages: CopilotRequestMessage[] = [];
  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
    } else if (turn.role === "assistant") {
      messages.push({ role: "assistant", content: turn.answer });
    }
    // An error turn is local UI state. It was never part of the conversation
    // the model saw, so replaying it would invent an exchange.
  }
  return messages;
}

/**
 * AR Copilot conversation state.
 *
 * The conversation lives in memory for the current session and nowhere else —
 * there is no write to `localStorage`, `sessionStorage`, IndexedDB, or the
 * server anywhere in this feature. It is discarded when the authenticated user
 * changes, when the selected company changes, on sign-out, and on reload,
 * because evidence retrieved under one identity or tenant must never appear
 * under another.
 */
export function useArCopilot(
  context: CopilotContextHint,
  contextLabel: string,
): ArCopilotState {
  const api = useApi();
  const { user } = useAuth();
  const companyId = useCompanyStore((state) => state.companyId);

  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [isExhausted, setIsExhausted] = useState(false);

  // Refs mirror the values `send` needs at call time, so the callback stays
  // stable while the user navigates and does not restart in-flight work.
  const turnsRef = useRef<CopilotTurn[]>(turns);
  turnsRef.current = turns;
  const contextRef = useRef(context);
  contextRef.current = context;
  const contextLabelRef = useRef(contextLabel);
  contextLabelRef.current = contextLabel;
  const exhaustedRef = useRef(isExhausted);
  exhaustedRef.current = isExhausted;

  // The in-flight guard is a ref, not state: two rapid submissions land in the
  // same React batch, so a state flag would still let both through.
  const inFlight = useRef(false);
  const mounted = useRef(true);

  /**
   * Generation token for the current conversation.
   *
   * Clearing state is NOT sufficient on its own. A request issued as User A /
   * Company A can still be in flight when the identity changes; if its
   * resolution were allowed to run, it would append A's answer and A's evidence
   * to B's freshly-reset conversation. Every send captures the generation it
   * belongs to and refuses to touch state — turns, pending, exhausted, or the
   * in-flight guard — once the generation has moved on.
   */
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);

  /**
   * Abandon whatever is in flight: cancel the network request AND invalidate
   * its result, so neither a resolution nor a rejection can reach the new
   * conversation. The abort saves the round trip; the token is what makes the
   * isolation correct even if the response already left the server.
   */
  const discardInFlight = useCallback(() => {
    generation.current += 1;
    abort.current?.abort();
    abort.current = null;
    inFlight.current = false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      abort.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    discardInFlight();
    turnsRef.current = [];
    setTurns([]);
    setIsExhausted(false);
    setIsPending(false);
  }, [discardInFlight]);

  // The identity this conversation belongs to. A change discards it.
  const isolationKey = `${user?.id ?? "anonymous"}::${companyId}`;
  const previousKey = useRef(isolationKey);
  useEffect(() => {
    if (previousKey.current === isolationKey) return;
    previousKey.current = isolationKey;
    reset();
  }, [isolationKey, reset]);

  const send = useCallback(
    (question: string) => {
      const content = question.trim();
      // An over-length question is refused, never truncated. Sending the first
      // 2,000 characters would answer a different question from the one the
      // user typed; the composer disables Send and shows the counter instead.
      if (
        !content || content.length > COPILOT_MAX_MESSAGE_CHARS ||
        inFlight.current || exhaustedRef.current
      ) {
        return;
      }
      inFlight.current = true;
      const sentAt = generation.current;
      const controller = new AbortController();
      abort.current = controller;

      const userTurn: CopilotUserTurn = {
        id: nextId("user"),
        role: "user",
        content,
        contextLabel: contextLabelRef.current,
      };
      const conversation = [...turnsRef.current, userTurn];
      turnsRef.current = conversation;
      setTurns(conversation);
      setIsPending(true);

      const body = buildCopilotRequestBody(
        toRequestMessages(conversation),
        contextRef.current,
      );

      void (async () => {
        try {
          const raw = await api.post<unknown>(COPILOT_CHAT_PATH, body, {
            silent: true,
            signal: controller.signal,
          });
          // Strict-parsed before anything reaches the UI; unsafe links are
          // dropped here rather than filtered at render time.
          const parsed = parseCopilotChatResponse(raw, isSafeCopilotLink);
          if (!mounted.current || generation.current !== sentAt) return;
          setTurns((current) => [
            ...current,
            {
              id: nextId("assistant"),
              role: "assistant",
              answer: parsed.answer,
              evidence: parsed.evidence,
              links: parsed.links,
            },
          ]);
        } catch (error) {
          // A superseded request must not surface an error either: an aborted
          // fetch is not a failure the new conversation should hear about.
          if (!mounted.current || generation.current !== sentAt) return;
          // A contract violation is not an ApiError and has no code, so it
          // maps to the same safe "could not verify" message as a server-side
          // unverified response — never to raw error text.
          const code = error instanceof ApiError ? error.code : null;
          const exhausted = isConversationExhausted(code);
          if (exhausted) setIsExhausted(true);
          setTurns((current) => [
            ...current,
            {
              id: nextId("error"),
              role: "error",
              message: copilotErrorMessage(code),
              exhausted,
            },
          ]);
        } finally {
          // Only the request that still owns the conversation may release the
          // guard. Otherwise a slow abandoned request could clear `inFlight`
          // and stop the pending state of the NEW request that superseded it.
          if (generation.current === sentAt) {
            abort.current = null;
            inFlight.current = false;
            if (mounted.current) setIsPending(false);
          }
        }
      })();
    },
    [api],
  );

  const requestMessages = useMemo(() => toRequestMessages(turns), [turns]);
  const windowed = useMemo(
    () =>
      boundOutboundMessages([
        ...requestMessages,
        { role: "user", content: "." },
      ]),
    [requestMessages],
  );

  return {
    turns,
    isPending,
    isExhausted,
    // The placeholder stands in for the next question, so a shortfall means
    // real history is already being dropped from the request.
    isTrimmingHistory: windowed.length < requestMessages.length + 1,
    remainingTurns: Math.max(
      0,
      COPILOT_MAX_MESSAGES - requestMessages.length - 1,
    ),
    send,
    reset,
  };
}

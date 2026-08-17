// ============================================================================
// AR Copilot — frontend contract.
//
// This module mirrors the reviewed backend contract EXACTLY:
//   backend/supabase/functions/ar-copilot/contract.ts
//   backend/supabase/functions/ar-copilot/{service,read-service,knowledge}.ts
//
// Three properties it exists to guarantee:
//
//   1. Nothing is trusted. A Copilot response is strict-parsed before a single
//      character reaches the DOM. There is deliberately no `as CopilotChatResponse`
//      escape hatch anywhere in the feature.
//   2. The request body carries ONLY `messages` and `context`. Company, user,
//      role, model, and prompt authority are server-owned; the backend parser
//      rejects any extra key, so sending one would fail the whole request.
//   3. Bounds are enforced before submission so the user gets immediate UX
//      feedback instead of a server rejection. The backend remains authoritative.
// ============================================================================

import { z } from "zod";
import {
  type CopilotArtifact,
  copilotArtifactsSchema,
} from "./artifacts";

export type { CopilotArtifact } from "./artifacts";

// ─── Bounds (mirrors ar-copilot/contract.ts) ────────────────────────────────

export const COPILOT_MAX_MESSAGES = 12;
export const COPILOT_MAX_MESSAGE_CHARS = 2_000;
export const COPILOT_MAX_TOTAL_MESSAGE_CHARS = 8_000;
export const COPILOT_MAX_ANSWER_CHARS = 4_000;
export const COPILOT_MAX_EVIDENCE = 20;
export const COPILOT_MAX_LINKS = 10;

/** Endpoint on the authenticated Edge Function boundary. */
export const COPILOT_CHAT_PATH = "/ar-copilot/chat";

// ─── Vocabularies ───────────────────────────────────────────────────────────

export const COPILOT_PAGES = [
  "dashboard",
  "customers",
  "customer_detail",
  "invoices",
  "invoice_detail",
  "credit_notes",
  "debit_notes",
  "receipts",
  "receipt_detail",
  "allocations",
  "automation_overview",
  "automation_documents",
  "automation_exceptions",
  "automation_mailboxes",
  "journal_entries",
  "journal_entry_detail",
  "audit_trail",
  "reports",
  "settings",
] as const;

export const COPILOT_ENTITY_TYPES = [
  "customer",
  "invoice",
  "credit_note",
  "debit_note",
  "receipt",
  "automation_document",
  "automation_exception",
  "journal_entry",
  "audit_event",
] as const;

export const COPILOT_EVIDENCE_KINDS = [
  "system_guide",
  "ar_summary",
  "customer",
  "invoice",
  "credit_note",
  "debit_note",
  "receipt",
  "allocation",
  "automation_document",
  "automation_exception",
  "journal_entry",
  "audit_event",
  "reminder",
] as const;

/** Link `entity_type` additionally allows the curated-guide pseudo-entity. */
export const COPILOT_LINK_ENTITY_TYPES = [
  ...COPILOT_ENTITY_TYPES,
  "system_guide",
] as const;

export type CopilotPage = (typeof COPILOT_PAGES)[number];
export type CopilotEntityType = (typeof COPILOT_ENTITY_TYPES)[number];
export type CopilotEvidenceKind = (typeof COPILOT_EVIDENCE_KINDS)[number];
export type CopilotLinkEntityType = (typeof COPILOT_LINK_ENTITY_TYPES)[number];

export interface CopilotContextHint {
  page: CopilotPage;
  entity_type: CopilotEntityType | null;
  entity_id: string | null;
}

export interface CopilotRequestMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CopilotChatRequestBody {
  messages: CopilotRequestMessage[];
  context: CopilotContextHint;
}

export interface CopilotEvidence {
  kind: CopilotEvidenceKind;
  id: string;
  label: string;
  number: string | null;
}

export interface CopilotLink {
  label: string;
  entity_type: CopilotLinkEntityType;
  entity_id: string;
  href: string;
}

export interface CopilotChatResponse {
  answer: string;
  evidence: CopilotEvidence[];
  links: CopilotLink[];
  /**
   * Gate 1 analytical payloads. Absent on every existing Copilot v2 path, so a
   * v2 response parses to an empty array and renders exactly as before.
   */
  artifacts: CopilotArtifact[];
}

// ─── ID shapes ──────────────────────────────────────────────────────────────

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `source_kind:uuid`, exactly as `ar-copilot/contract.ts` validates it. */
const AUDIT_EVENT_ID_PATTERN =
  /^[a-z][a-z0-9_]{1,40}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stable curated-guide IDs (`ar-copilot/knowledge.ts`). */
const GUIDE_ID_PATTERN = /^[a-z][a-z0-9-]{1,60}$/;

/** `ar-summary:<company uuid>` — the only synthetic evidence ID the server emits. */
const AR_SUMMARY_ID_PATTERN = /^ar-summary:[0-9a-f-]{36}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isAuditEventId(value: string): boolean {
  return AUDIT_EVENT_ID_PATTERN.test(value);
}

/**
 * The ID shape a context hint may carry, per entity type. An `audit_event`
 * uses the composite source form; everything else is a UUID. A malformed ID is
 * never sent as an entity — the mapper drops it rather than guessing.
 */
export function isValidContextEntityId(
  type: CopilotEntityType,
  id: string,
): boolean {
  return type === "audit_event" ? isAuditEventId(id) : isUuid(id);
}

// ─── Response schemas ───────────────────────────────────────────────────────

const evidenceIdSchema = z.string().min(1).max(120).refine(
  (value) =>
    isUuid(value) || isAuditEventId(value) || GUIDE_ID_PATTERN.test(value) ||
    AR_SUMMARY_ID_PATTERN.test(value),
  { message: "Evidence id is not a supported identifier." },
);

const evidenceSchema = z.object({
  kind: z.enum(COPILOT_EVIDENCE_KINDS),
  id: evidenceIdSchema,
  label: z.string().min(1).max(200),
  number: z.string().min(1).max(150).nullable(),
}).strict();

const linkSchema = z.object({
  label: z.string().min(1).max(120),
  entity_type: z.enum(COPILOT_LINK_ENTITY_TYPES),
  entity_id: evidenceIdSchema,
  // `href` shape is validated separately by `lib/ar-copilot/links.ts`, which
  // owns the route allow-list. Keeping the two apart means the link parser can
  // be tested against hostile hrefs without weakening this schema.
  href: z.string().min(1).max(300),
}).strict();

/**
 * `status` exists in the wire contract and MUST parse, but it is diagnostic
 * only: request id, provider, model, and tool names never reach the UI. It is
 * deliberately dropped from `CopilotChatResponse` so no component can render it
 * even by accident.
 */
const statusSchema = z.object({
  request_id: z.string().min(1).max(120),
  provider: z.literal("openai"),
  model: z.string().min(1).max(120),
  tool_names: z.array(z.string().min(1).max(80)).max(COPILOT_MAX_EVIDENCE),
  tool_call_count: z.number().int().min(0).max(64),
}).strict();

const chatResponseSchema = z.object({
  answer: z.string().min(1).max(COPILOT_MAX_ANSWER_CHARS),
  evidence: z.array(evidenceSchema).max(COPILOT_MAX_EVIDENCE),
  links: z.array(linkSchema).max(COPILOT_MAX_LINKS),
  // Optional exactly as the backend types it: omitted on the v2 question
  // paths, present only for Gate 1 analytical answers. The union itself is
  // strict and closed — see `lib/ar-copilot/artifacts.ts`.
  artifacts: copilotArtifactsSchema.optional(),
  status: statusSchema,
}).strict();

export class CopilotContractError extends Error {
  constructor() {
    super("The AR Copilot response did not match its expected contract.");
    this.name = "CopilotContractError";
  }
}

/**
 * Strict-parse a Copilot success payload.
 *
 * Fails closed on an unknown field, a malformed evidence entry, an unsupported
 * entity type, a non-conforming identifier, or an oversized answer. Links whose
 * `href` is not a safe internal application route are dropped here — a rejected
 * destination must never reach a component that could render it as clickable.
 *
 * An `artifacts` array is accepted only when EVERY entry matches the closed
 * Gate 1 union. One unknown kind, one unknown nested field, or one malformed
 * value rejects the entire response rather than the single artifact: a
 * partially-understood analytical payload must never be rendered.
 */
export function parseCopilotChatResponse(
  value: unknown,
  isSafeHref: (link: CopilotLink) => boolean,
): CopilotChatResponse {
  const parsed = chatResponseSchema.safeParse(value);
  if (!parsed.success) throw new CopilotContractError();
  const { answer, evidence, links, artifacts } = parsed.data;
  return {
    answer,
    evidence,
    links: links.filter((link) => isSafeHref(link)),
    artifacts: artifacts ?? [],
  };
}

// ─── Error vocabulary ───────────────────────────────────────────────────────

export const COPILOT_ERROR_CODES = [
  "AUTHENTICATION_ERROR",
  "AUTHORIZATION_ERROR",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "COPILOT_LIMIT_EXCEEDED",
  "COPILOT_UNAVAILABLE",
  "COPILOT_RESPONSE_UNVERIFIED",
] as const;

export type CopilotErrorCode = (typeof COPILOT_ERROR_CODES)[number];

/**
 * Safe user-facing text for every documented backend error category.
 *
 * Raw provider, database, and stack text is never surfaced: anything outside
 * this closed vocabulary — including `INTERNAL_ERROR`, a transport failure, or
 * a contract violation — collapses to the unverified message.
 */
const COPILOT_ERROR_MESSAGES: Record<CopilotErrorCode, string> = {
  AUTHENTICATION_ERROR:
    "Your session is no longer available. Please sign in again.",
  AUTHORIZATION_ERROR:
    "You don't have permission to access that information.",
  VALIDATION_ERROR:
    "That question or page context could not be processed.",
  NOT_FOUND:
    "The requested record is not available in your current company or access scope.",
  COPILOT_LIMIT_EXCEEDED:
    "This conversation has reached its current limit. Start a new conversation to continue.",
  COPILOT_UNAVAILABLE:
    "AR Copilot is temporarily unavailable. Your AR data and workflows are unaffected.",
  COPILOT_RESPONSE_UNVERIFIED:
    "The assistant could not verify a safe answer for that request.",
};

export function isCopilotErrorCode(value: unknown): value is CopilotErrorCode {
  return typeof value === "string" &&
    (COPILOT_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Map a backend error code to safe display text.
 *
 * An unrecognised code deliberately does NOT fall through to the server's own
 * message — that message may carry provider or database detail. It becomes the
 * unverified message instead.
 */
export function copilotErrorMessage(code: unknown): string {
  return isCopilotErrorCode(code)
    ? COPILOT_ERROR_MESSAGES[code]
    : COPILOT_ERROR_MESSAGES.COPILOT_RESPONSE_UNVERIFIED;
}

/** Whether the failure means the conversation cannot usefully continue as-is. */
export function isConversationExhausted(code: unknown): boolean {
  return code === "COPILOT_LIMIT_EXCEEDED";
}

// ─── Outbound message bounding ──────────────────────────────────────────────

/**
 * Reduce a session conversation to a request body the backend will accept.
 *
 * The backend applies the 2,000-character bound to EVERY message including
 * assistant turns, while an answer may legitimately be up to 4,000 characters.
 * A long previous answer is therefore trimmed to its leading 2,000 characters
 * for context purposes rather than dropped — the full answer stays on screen.
 *
 * Trimming is oldest-first so the newest exchange always survives, and the
 * result is guaranteed to end with the user's message, which the backend
 * requires.
 */
export function boundOutboundMessages(
  messages: readonly CopilotRequestMessage[],
): CopilotRequestMessage[] {
  const normalized = messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, COPILOT_MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.content.length > 0);

  const lastUser = normalized.map((m) => m.role).lastIndexOf("user");
  if (lastUser < 0) return [];
  // Anything after the final user turn is an answer that has not been asked
  // about yet; the backend requires the user to speak last.
  const upToUser = normalized.slice(0, lastUser + 1);

  const window: CopilotRequestMessage[] = [];
  let total = 0;
  for (let index = upToUser.length - 1; index >= 0; index -= 1) {
    const message = upToUser[index];
    if (window.length >= COPILOT_MAX_MESSAGES) break;
    if (total + message.content.length > COPILOT_MAX_TOTAL_MESSAGE_CHARS) break;
    total += message.content.length;
    window.unshift(message);
  }
  return window;
}

/** Build the exact request body. It has these two keys and no others. */
export function buildCopilotRequestBody(
  messages: readonly CopilotRequestMessage[],
  context: CopilotContextHint,
): CopilotChatRequestBody {
  return {
    messages: boundOutboundMessages(messages),
    context: {
      page: context.page,
      entity_type: context.entity_type,
      entity_id: context.entity_id,
    },
  };
}

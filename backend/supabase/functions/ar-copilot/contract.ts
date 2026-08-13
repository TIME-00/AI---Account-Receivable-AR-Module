import { BusinessError, ValidationError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";

export const COPILOT_MAX_MESSAGES = 12;
export const COPILOT_MAX_MESSAGE_CHARS = 2_000;
export const COPILOT_MAX_TOTAL_MESSAGE_CHARS = 8_000;
export const COPILOT_MAX_REQUEST_BYTES = 24 * 1024;
export const COPILOT_MAX_ANSWER_CHARS = 4_000;
export const COPILOT_MAX_TOOL_ROUNDS = 4;
export const COPILOT_MAX_TOOL_CALLS = 8;

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

export type CopilotPage = typeof COPILOT_PAGES[number];
export type CopilotEntityType = typeof COPILOT_ENTITY_TYPES[number];
export type CopilotMessageRole = "user" | "assistant";

export interface CopilotMessage {
  role: CopilotMessageRole;
  content: string;
}

export interface CopilotContextHint {
  page: CopilotPage;
  entity_type: CopilotEntityType | null;
  entity_id: string | null;
}

export interface CopilotChatRequest {
  messages: CopilotMessage[];
  context: CopilotContextHint;
}

export type CopilotEvidenceKind =
  | "system_guide"
  | "ar_summary"
  | "customer"
  | "invoice"
  | "credit_note"
  | "debit_note"
  | "receipt"
  | "allocation"
  | "automation_document"
  | "automation_exception"
  | "journal_entry"
  | "audit_event"
  | "reminder";

export interface CopilotEvidence {
  kind: CopilotEvidenceKind;
  id: string;
  label: string;
  number: string | null;
}

export interface CopilotLink {
  label: string;
  entity_type: CopilotEntityType | "system_guide";
  entity_id: string;
  href: string;
}

export interface CopilotChatResponse {
  answer: string;
  evidence: CopilotEvidence[];
  links: CopilotLink[];
  status: {
    request_id: string;
    provider: "openai";
    model: string;
    tool_names: string[];
    tool_call_count: number;
  };
}

export interface CopilotToolOutcome {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
  evidence: CopilotEvidence[];
  links: CopilotLink[];
}

const AUDIT_EVENT_ID =
  /^[a-z][a-z0-9_]{1,40}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > COPILOT_MAX_MESSAGE_CHARS) {
    throw new ValidationError(
      `${field} must contain 1 to ${COPILOT_MAX_MESSAGE_CHARS} characters.`,
    );
  }
  return trimmed;
}

export function validateContextEntityId(
  type: CopilotEntityType,
  id: string,
): string {
  if (type === "audit_event") {
    if (!AUDIT_EVENT_ID.test(id)) {
      throw new ValidationError("context.entity_id is invalid.");
    }
    return id;
  }
  validateUUID(id, "context.entity_id");
  return id;
}

export function parseCopilotChatRequest(value: unknown): CopilotChatRequest {
  const input = record(value);
  if (!input || !hasExactKeys(input, ["messages", "context"])) {
    throw new ValidationError(
      "Copilot request must contain only messages and context.",
    );
  }
  if (
    !Array.isArray(input.messages) || input.messages.length === 0 ||
    input.messages.length > COPILOT_MAX_MESSAGES
  ) {
    throw new ValidationError(
      `messages must contain 1 to ${COPILOT_MAX_MESSAGES} entries.`,
    );
  }
  let total = 0;
  const messages = input.messages.map((entry, index): CopilotMessage => {
    const message = record(entry);
    if (!message || !hasExactKeys(message, ["role", "content"])) {
      throw new ValidationError(`messages[${index}] is invalid.`);
    }
    if (message.role !== "user" && message.role !== "assistant") {
      throw new ValidationError(
        "Browser messages may use only user or assistant roles.",
      );
    }
    const content = boundedText(message.content, `messages[${index}].content`);
    total += content.length;
    return { role: message.role, content };
  });
  if (total > COPILOT_MAX_TOTAL_MESSAGE_CHARS) {
    throw new ValidationError(
      `Conversation text exceeds ${COPILOT_MAX_TOTAL_MESSAGE_CHARS} characters.`,
    );
  }
  if (messages.at(-1)?.role !== "user") {
    throw new ValidationError(
      "The final conversation message must be from the user.",
    );
  }

  const context = record(input.context);
  if (
    !context || !hasExactKeys(context, ["page", "entity_type", "entity_id"])
  ) {
    throw new ValidationError(
      "context must contain only page, entity_type, and entity_id.",
    );
  }
  if (!COPILOT_PAGES.includes(context.page as CopilotPage)) {
    throw new ValidationError("context.page is unsupported.");
  }
  if (
    context.entity_type !== null &&
    !COPILOT_ENTITY_TYPES.includes(context.entity_type as CopilotEntityType)
  ) {
    throw new ValidationError("context.entity_type is unsupported.");
  }
  if ((context.entity_type === null) !== (context.entity_id === null)) {
    throw new ValidationError(
      "context.entity_type and context.entity_id must be supplied together.",
    );
  }
  const entityType = context.entity_type as CopilotEntityType | null;
  const entityId = context.entity_id === null
    ? null
    : typeof context.entity_id === "string" && entityType
    ? validateContextEntityId(entityType, context.entity_id)
    : (() => {
      throw new ValidationError("context.entity_id is invalid.");
    })();

  return {
    messages,
    context: {
      page: context.page as CopilotPage,
      entity_type: entityType,
      entity_id: entityId,
    },
  };
}

export async function readBoundedJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > COPILOT_MAX_REQUEST_BYTES) {
    await req.body?.cancel();
    throw new BusinessError(
      "COPILOT_LIMIT_EXCEEDED",
      "The Copilot request is too large.",
      429,
    );
  }
  if (!req.body) throw new ValidationError("A JSON request body is required.");
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > COPILOT_MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new BusinessError(
        "COPILOT_LIMIT_EXCEEDED",
        "The Copilot request is too large.",
        429,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

export function validateCopilotAnswer(value: unknown): string {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > COPILOT_MAX_ANSWER_CHARS ||
    /(?:https?:\/\/|javascript:|data:|\]\s*\()/i.test(value)
  ) {
    throw new BusinessError(
      "COPILOT_RESPONSE_UNVERIFIED",
      "The requested information could not be verified.",
      502,
    );
  }
  return value.trim();
}

import type { AuthContext } from "../_shared/auth.ts";
import { AuthorizationError, ValidationError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import type { CopilotEntityType, CopilotToolOutcome } from "./contract.ts";
import { validateContextEntityId } from "./contract.ts";
import { searchSystemGuide } from "./knowledge.ts";
import type { CopilotReadServiceContract } from "./read-service.ts";
import type { CopilotAnalystServiceContract } from "./analyst-service.ts";
import {
  ANALYST_TOOL_DEFINITIONS,
  ANALYST_TOOL_NAMES,
  AnalystToolExecutor,
  type AnalystToolName,
} from "./analyst-tools.ts";
import { multilingualIntentSignals } from "./language.ts";

const BASE_COPILOT_TOOL_NAMES = [
  "search_system_guide",
  "get_ar_summary",
  "list_overdue_invoices",
  "get_customer_summary",
  "list_customer_outstanding",
  "get_invoice",
  "get_invoice_payment_context",
  "get_invoice_reminder_history",
  "get_receipt",
  "get_receipt_allocation_context",
  "get_automation_document",
  "get_automation_exception",
  "list_open_automation_exceptions",
  "get_journal_entry",
  "get_audit_event",
  "list_entity_audit_events",
] as const;

export const COPILOT_TOOL_NAMES = [
  ...BASE_COPILOT_TOOL_NAMES,
  ...ANALYST_TOOL_NAMES,
] as const;

export type CopilotToolName = typeof COPILOT_TOOL_NAMES[number];

export interface CopilotToolDefinition {
  type: "function";
  name: CopilotToolName;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

const UUID_SCHEMA = { type: "string", format: "uuid" } as const;
const LIMIT_SCHEMA = { type: "integer", minimum: 1, maximum: 20 } as const;

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

const BASE_COPILOT_TOOL_DEFINITIONS: readonly CopilotToolDefinition[] = [
  {
    type: "function",
    name: "search_system_guide",
    description:
      "Search curated, version-controlled help about this AR system. Use for definitions and workflows, never for current company totals.",
    parameters: objectSchema({
      query: { type: "string", minLength: 1, maxLength: 120 },
    }, ["query"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_ar_summary",
    description:
      "Get the current authorized AR summary and aging totals for the caller's scope.",
    parameters: objectSchema({}, []),
    strict: true,
  },
  {
    type: "function",
    name: "list_overdue_invoices",
    description:
      "List current overdue invoices in the caller's authorized customer scope.",
    parameters: objectSchema({ limit: LIMIT_SCHEMA }, ["limit"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_customer_summary",
    description:
      "Get a bounded customer AR/credit summary when the caller may read that customer.",
    parameters: objectSchema({ customer_id: UUID_SCHEMA }, ["customer_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "list_customer_outstanding",
    description:
      "List outstanding Invoice-family documents for one authorized customer.",
    parameters: objectSchema(
      { customer_id: UUID_SCHEMA, limit: LIMIT_SCHEMA },
      ["customer_id", "limit"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "get_invoice",
    description:
      "Get bounded authoritative Invoice, Credit Note, or Debit Note status and amount evidence.",
    parameters: objectSchema({ invoice_id: UUID_SCHEMA }, ["invoice_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_invoice_payment_context",
    description:
      "Get one authorized Invoice-family document and its stored allocation evidence.",
    parameters: objectSchema({ invoice_id: UUID_SCHEMA }, ["invoice_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_invoice_reminder_history",
    description:
      "Get stored reminder stage/status history for one authorized invoice without recipient details.",
    parameters: objectSchema({ invoice_id: UUID_SCHEMA }, ["invoice_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_receipt",
    description:
      "Get bounded authoritative receipt amounts, status, and unapplied balance.",
    parameters: objectSchema({ receipt_id: UUID_SCHEMA }, ["receipt_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_receipt_allocation_context",
    description:
      "Get one authorized receipt and its stored allocation evidence.",
    parameters: objectSchema({ receipt_id: UUID_SCHEMA }, ["receipt_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_automation_document",
    description:
      "Get safe classification/status metadata for an authorized Automation document. Raw email, OCR, extraction payload, and attachments are excluded.",
    parameters: objectSchema({ document_id: UUID_SCHEMA }, ["document_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_automation_exception",
    description:
      "Get a bounded authorized Automation exception status and reason code.",
    parameters: objectSchema({ exception_id: UUID_SCHEMA }, ["exception_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "list_open_automation_exceptions",
    description:
      "List current open/retryable Automation exceptions for authorized supervisory readers.",
    parameters: objectSchema({ limit: LIMIT_SCHEMA }, ["limit"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_journal_entry",
    description:
      "Get a read-only balanced Journal Entry header and ordered GL lines for authorized Journal readers.",
    parameters: objectSchema({ journal_entry_id: UUID_SCHEMA }, [
      "journal_entry_id",
    ]),
    strict: true,
  },
  {
    type: "function",
    name: "get_audit_event",
    description:
      "Get one normalized allow-listed Audit Trail event for authorized Audit readers.",
    parameters: objectSchema({
      event_id: { type: "string", minLength: 1, maxLength: 90 },
    }, ["event_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "list_entity_audit_events",
    description:
      "List stored Audit Trail evidence for one authorized entity. This never fabricates lifecycle history.",
    parameters: objectSchema({
      entity_type: {
        type: "string",
        enum: [
          "customer",
          "invoice",
          "credit_note",
          "debit_note",
          "receipt",
          "journal_entry",
        ],
      },
      entity_id: UUID_SCHEMA,
      limit: LIMIT_SCHEMA,
    }, ["entity_type", "entity_id", "limit"]),
    strict: true,
  },
] as const;

export const COPILOT_TOOL_DEFINITIONS = [
  ...BASE_COPILOT_TOOL_DEFINITIONS,
  ...ANALYST_TOOL_DEFINITIONS,
] as const;

type Args = Record<string, unknown>;

function parseArgsJson(value: string): Args {
  if (value.length > 2_000) {
    throw new ValidationError("Copilot tool arguments are too large.");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as Args;
  } catch {
    throw new ValidationError("Copilot tool arguments are invalid.");
  }
}

function exactArgs(args: Args, keys: readonly string[]): void {
  const actual = Object.keys(args).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ValidationError(
      "Copilot tool arguments contain unsupported fields.",
    );
  }
}

function uuidArg(args: Args, key: string): string {
  if (typeof args[key] !== "string") {
    throw new ValidationError(`${key} is invalid.`);
  }
  validateUUID(args[key] as string, key);
  return args[key] as string;
}

function limitArg(args: Args): number {
  const value = args.limit;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 20) {
    throw new ValidationError("limit must be an integer from 1 to 20.");
  }
  return Number(value);
}

function stringArg(args: Args, key: string, max: number): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ValidationError(`${key} is invalid.`);
  }
  return value.trim();
}

function ensureOperationalRole(auth: AuthContext): void {
  if (
    !auth.roles.some((role) =>
      ["AR Clerk", "AR Supervisor", "Finance Manager", "Auditor"].includes(role)
    )
  ) {
    throw new AuthorizationError(
      "Copilot operational data access is not permitted.",
    );
  }
}

function ensureAnyRole(auth: AuthContext, roles: AuthContext["roles"]): void {
  if (!auth.roles.some((role) => roles.includes(role))) {
    throw new AuthorizationError(
      "Copilot data access is not permitted for this role.",
    );
  }
}

function guideOutcome(query: string): CopilotToolOutcome {
  const results = searchSystemGuide(query);
  return {
    data: results.map((entry) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
    })),
    evidence: results.map((entry) => ({
      kind: "system_guide",
      id: entry.id,
      label: entry.title,
      number: null,
    })),
    links: results.flatMap((entry) =>
      entry.suggested_path
        ? [{
          label: `Open ${entry.title}`,
          entity_type: "system_guide" as const,
          entity_id: entry.id,
          href: entry.suggested_path,
        }]
        : []
    ),
  };
}

const FORBIDDEN_RESULT_KEY =
  /(?:token|secret|oauth|refresh|access_key|api_key|password|email|phone|address|tax_id|bank_account|raw_body|ocr_text|stack|sql|command_payload|recipient)/i;

export function assertToolOutcomeSafe(outcome: CopilotToolOutcome): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (
      const [key, child] of Object.entries(value as Record<string, unknown>)
    ) {
      if (FORBIDDEN_RESULT_KEY.test(key)) {
        throw new Error(
          "Copilot tool result contains a forbidden field.",
        );
      }
      visit(child);
    }
  };
  visit(outcome.data);
  const serialized = JSON.stringify(outcome.data);
  if (new TextEncoder().encode(serialized).byteLength > 32 * 1024) {
    throw new Error("Copilot tool result exceeds the bounded context size.");
  }
}

export class CopilotToolRegistry {
  readonly #analyst: AnalystToolExecutor | null;

  constructor(
    private readonly reads: CopilotReadServiceContract,
    analyst?: CopilotAnalystServiceContract,
  ) {
    this.#analyst = analyst ? new AnalystToolExecutor(analyst) : null;
  }

  async execute(
    auth: AuthContext,
    name: string,
    argumentsJson: string,
  ): Promise<CopilotToolOutcome> {
    if (!COPILOT_TOOL_NAMES.includes(name as CopilotToolName)) {
      throw new ValidationError("Copilot requested an unsupported tool.");
    }
    if (ANALYST_TOOL_NAMES.includes(name as AnalystToolName)) {
      if (!this.#analyst) {
        throw new ValidationError("Copilot analyst tools are unavailable.");
      }
      const outcome = await this.#analyst.execute(
        auth,
        name as AnalystToolName,
        argumentsJson,
      );
      assertToolOutcomeSafe(outcome);
      return outcome;
    }
    const args = parseArgsJson(argumentsJson);
    let result: CopilotToolOutcome | null = null;
    switch (name as CopilotToolName) {
      case "search_system_guide": {
        exactArgs(args, ["query"]);
        result = guideOutcome(stringArg(args, "query", 120));
        break;
      }
      case "get_ar_summary":
        exactArgs(args, []);
        ensureOperationalRole(auth);
        result = await this.reads.getArSummary(auth);
        break;
      case "list_overdue_invoices":
        exactArgs(args, ["limit"]);
        ensureOperationalRole(auth);
        result = await this.reads.listOverdueInvoices(auth, limitArg(args));
        break;
      case "get_customer_summary":
        exactArgs(args, ["customer_id"]);
        ensureOperationalRole(auth);
        result = await this.reads.getCustomerSummary(
          auth,
          uuidArg(args, "customer_id"),
        );
        break;
      case "list_customer_outstanding":
        exactArgs(args, ["customer_id", "limit"]);
        ensureOperationalRole(auth);
        result = await this.reads.listCustomerOutstanding(
          auth,
          uuidArg(args, "customer_id"),
          limitArg(args),
        );
        break;
      case "get_invoice":
        exactArgs(args, ["invoice_id"]);
        ensureOperationalRole(auth);
        result = await this.reads.getInvoice(auth, uuidArg(args, "invoice_id"));
        break;
      case "get_invoice_payment_context":
        exactArgs(args, ["invoice_id"]);
        ensureOperationalRole(auth);
        result = await this.reads.getInvoicePaymentContext(
          auth,
          uuidArg(args, "invoice_id"),
        );
        break;
      case "get_invoice_reminder_history":
        exactArgs(args, ["invoice_id"]);
        ensureOperationalRole(auth);
        result = await this.reads.getInvoiceReminderHistory(
          auth,
          uuidArg(args, "invoice_id"),
        );
        break;
      case "get_receipt":
        exactArgs(args, ["receipt_id"]);
        ensureOperationalRole(auth);
        result = await this.reads.getReceipt(auth, uuidArg(args, "receipt_id"));
        break;
      case "get_receipt_allocation_context":
        exactArgs(args, ["receipt_id"]);
        ensureOperationalRole(auth);
        result = await this.reads.getReceiptAllocationContext(
          auth,
          uuidArg(args, "receipt_id"),
        );
        break;
      case "get_automation_document":
        exactArgs(args, ["document_id"]);
        ensureAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
        result = await this.reads.getAutomationDocument(
          auth,
          uuidArg(args, "document_id"),
        );
        break;
      case "get_automation_exception":
        exactArgs(args, ["exception_id"]);
        ensureAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
        result = await this.reads.getAutomationException(
          auth,
          uuidArg(args, "exception_id"),
        );
        break;
      case "list_open_automation_exceptions":
        exactArgs(args, ["limit"]);
        ensureAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
        result = await this.reads.listOpenAutomationExceptions(
          auth,
          limitArg(args),
        );
        break;
      case "get_journal_entry":
        exactArgs(args, ["journal_entry_id"]);
        ensureAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
        result = await this.reads.getJournalEntry(
          auth,
          uuidArg(args, "journal_entry_id"),
        );
        break;
      case "get_audit_event": {
        exactArgs(args, ["event_id"]);
        ensureAnyRole(auth, ["Finance Manager", "Auditor"]);
        const eventId = stringArg(args, "event_id", 90);
        validateContextEntityId("audit_event", eventId);
        result = await this.reads.getAuditEvent(auth, eventId);
        break;
      }
      case "list_entity_audit_events": {
        exactArgs(args, ["entity_type", "entity_id", "limit"]);
        ensureAnyRole(auth, ["Finance Manager", "Auditor"]);
        const type = stringArg(args, "entity_type", 30) as CopilotEntityType;
        if (
          ![
            "customer",
            "invoice",
            "credit_note",
            "debit_note",
            "receipt",
            "journal_entry",
          ].includes(type)
        ) {
          throw new ValidationError(
            "entity_type is unsupported for audit history.",
          );
        }
        result = await this.reads.listEntityAuditEvents(
          auth,
          type,
          uuidArg(args, "entity_id"),
          limitArg(args),
        );
        break;
      }
    }
    if (!result) throw new ValidationError("Copilot tool is unsupported.");
    assertToolOutcomeSafe(result);
    return result;
  }
}

export function isLiveDataTool(name: string): boolean {
  return name !== "search_system_guide";
}

export type CopilotQuestionIntent =
  | "casual_general"
  | "system_knowledge"
  | "live_data"
  | "write_action";

const ENGLISH_LIVE_CLAIM =
  /\b(current|today|now|right now|latest|balance|outstanding|overdue|unapplied|unallocated|still open|audit activity|daily brief|focus on|need attention|largest (?:ar )?risks?|driving (?:our )?overdue|collections? (?:health|performance|performing|trend|underperforming)|aging movement|increase[ds]?|movement|compared|compare|previous period|last month|this month|which customers|which customer|which invoices|which receipts|which documents|which (?:automation )?exceptions|how much|how many|what happened|why (?:is|was|did)|this customer|this invoice|this receipt|this (?:automation )?document|this journal|this record|my customer|our customer|received any allocation|show (?:me )?(?:a )?report|chart|highest|largest|top\s+\d+)\b/i;

const ENGLISH_DEFINITION_OR_HOW_TO =
  /^(?:how (?:do|can|should) i\b|how (?:does|is)\b|what happens when\b|what does .{1,80}\bmean\b|what is (?:invoice\s+)?post(?:ing)?\b|can you explain(?:\s+how)?\b)/i;

const EXPLICIT_READ_REQUEST =
  /^(?:which|show me|list|find)\b.{0,160}\b(?:customers?|invoices?|receipts?|documents?|exceptions?|allocations?)\b/i;

const ENGLISH_WRITE_REQUEST =
  /^(?:please\s+)?(?:post|cancel|allocate|reverse|send|change|delete|create)\s+(?:(?:this|that|the|my)\s+)?(?:invoice|receipt|allocation|reminder|customer|document|credit note|debit note)\b|^(?:can|could|would|will) you\s+(?:please\s+)?(?:post|cancel|allocate|reverse|send|change|delete|create)\s+(?:(?:this|that|the|my)\s+)?(?:invoice|receipt|allocation|reminder|customer|document|credit note|debit note)\b/i;

export function questionHasLiveClaimSignals(question: string): boolean {
  const multilingual = multilingualIntentSignals(question);
  if (multilingual.definition || multilingual.write) return false;
  return multilingual.live || ENGLISH_LIVE_CLAIM.test(question);
}

export function classifyCopilotQuestion(
  question: string,
): CopilotQuestionIntent {
  const lower = question.trim().toLowerCase();
  const multilingual = multilingualIntentSignals(question);
  if (multilingual.definition || ENGLISH_DEFINITION_OR_HOW_TO.test(lower)) {
    return "system_knowledge";
  }
  if (
    /^(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening))[!.?\s]*$/
      .test(
        lower,
      ) ||
    /^(?:how are you(?: today)?|what can you (?:do|help me with)|can you explain (?:that|it) (?:more )?simply)[?.!\s]*$/
      .test(
        lower,
      )
  ) return "casual_general";
  if (EXPLICIT_READ_REQUEST.test(lower)) return "live_data";
  if (multilingual.write || ENGLISH_WRITE_REQUEST.test(lower)) {
    return "write_action";
  }
  if (multilingual.live) return "live_data";
  if (
    /^\s*what (?:is|does|are)\b/.test(lower) &&
    !/\b(my|our|this|current|today|now)\b/.test(lower)
  ) {
    return "system_knowledge";
  }
  return questionHasLiveClaimSignals(lower) ? "live_data" : "system_knowledge";
}

export function questionRequiresLiveData(question: string): boolean {
  return classifyCopilotQuestion(question) === "live_data";
}

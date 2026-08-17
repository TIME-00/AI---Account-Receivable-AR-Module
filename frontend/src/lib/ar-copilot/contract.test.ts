// ============================================================================
// AR Copilot — response contract and request construction.
//
// The Copilot is the only surface in this application where text produced
// outside the deterministic backend reaches the page, so the parser is treated
// as a security boundary rather than a convenience: every test below asserts
// that a malformed payload is REJECTED, not repaired.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  boundOutboundMessages,
  buildCopilotRequestBody,
  copilotErrorMessage,
  CopilotContractError,
  COPILOT_CHAT_PATH,
  COPILOT_ERROR_CODES,
  COPILOT_MAX_ANSWER_CHARS,
  COPILOT_MAX_MESSAGES,
  COPILOT_MAX_MESSAGE_CHARS,
  COPILOT_MAX_TOTAL_MESSAGE_CHARS,
  isConversationExhausted,
  isCopilotErrorCode,
  isValidContextEntityId,
  parseCopilotChatResponse,
  type CopilotContextHint,
} from "./contract";
import { isSafeCopilotLink } from "./links";

const INVOICE_ID = "11111111-2222-4333-8444-555555555555";
const RECEIPT_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";

function successPayload(overrides: Record<string, unknown> = {}) {
  return {
    answer: "The invoice remains open because MYR 500.00 is still outstanding.",
    evidence: [
      {
        kind: "invoice",
        id: INVOICE_ID,
        label: "INV-202608-00012",
        number: "INV-202608-00012",
      },
    ],
    links: [
      {
        label: "View document",
        entity_type: "invoice",
        entity_id: INVOICE_ID,
        href: `/invoices/${INVOICE_ID}`,
      },
    ],
    status: {
      request_id: "req-1",
      provider: "openai",
      model: "gpt-test",
      tool_names: ["get_invoice"],
      tool_call_count: 1,
    },
    ...overrides,
  };
}

const parse = (value: unknown) =>
  parseCopilotChatResponse(value, isSafeCopilotLink);

describe("strict success parsing", () => {
  it("accepts a well-formed response and returns answer, evidence, and links", () => {
    const result = parse(successPayload());
    expect(result.answer).toContain("still outstanding");
    expect(result.evidence).toHaveLength(1);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].href).toBe(`/invoices/${INVOICE_ID}`);
  });

  it("drops the diagnostic status block instead of exposing it", () => {
    // The wire contract carries request id, provider, model, and tool names.
    // They must parse — a missing block is a contract violation — but they are
    // deliberately absent from the value the UI receives, so no component can
    // render them even by accident.
    const result = parse(successPayload()) as unknown as Record<string, unknown>;
    // `artifacts` joined this shape with the Gate 1 analytical contract; it is
    // an empty array on every v2 path. `status` is still dropped entirely.
    expect(Object.keys(result).sort()).toEqual([
      "answer",
      "artifacts",
      "evidence",
      "links",
    ]);
    expect(result.status).toBeUndefined();
  });

  it("rejects an unknown top-level field rather than ignoring it", () => {
    expect(() => parse(successPayload({ system_prompt: "leaked" }))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects a missing status block", () => {
    const payload = successPayload();
    delete (payload as Record<string, unknown>).status;
    expect(() => parse(payload)).toThrow(CopilotContractError);
  });
});

describe("malformed answers are rejected", () => {
  it("rejects a non-string answer", () => {
    expect(() => parse(successPayload({ answer: { text: "hi" } }))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects an empty answer", () => {
    expect(() => parse(successPayload({ answer: "" }))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects an oversized answer", () => {
    const answer = "a".repeat(COPILOT_MAX_ANSWER_CHARS + 1);
    expect(() => parse(successPayload({ answer }))).toThrow(
      CopilotContractError,
    );
  });

  it("accepts an answer at exactly the documented bound", () => {
    const answer = "a".repeat(COPILOT_MAX_ANSWER_CHARS);
    expect(parse(successPayload({ answer })).answer).toHaveLength(
      COPILOT_MAX_ANSWER_CHARS,
    );
  });
});

describe("malformed evidence is rejected", () => {
  it("rejects an unsupported evidence kind", () => {
    const evidence = [
      { kind: "bank_account", id: INVOICE_ID, label: "x", number: null },
    ];
    expect(() => parse(successPayload({ evidence }))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects an evidence identifier that is not a supported id shape", () => {
    const evidence = [
      { kind: "invoice", id: "'; DROP TABLE invoices;--", label: "x", number: null },
    ];
    expect(() => parse(successPayload({ evidence }))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects an evidence entry carrying an extra field", () => {
    const evidence = [
      {
        kind: "invoice",
        id: INVOICE_ID,
        label: "x",
        number: null,
        customer_email: "a@b.c",
      },
    ];
    expect(() => parse(successPayload({ evidence }))).toThrow(
      CopilotContractError,
    );
  });

  it("accepts the synthetic guide and summary identifiers the server emits", () => {
    const evidence = [
      { kind: "system_guide", id: "invoice-lifecycle", label: "Invoice lifecycle", number: null },
      {
        kind: "ar_summary",
        id: "ar-summary:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        label: "Current AR summary",
        number: null,
      },
    ];
    expect(parse(successPayload({ evidence })).evidence).toHaveLength(2);
  });
});

describe("malformed and unsafe links are removed", () => {
  const link = (overrides: Record<string, unknown>) => ({
    links: [
      {
        label: "Open",
        entity_type: "invoice",
        entity_id: INVOICE_ID,
        href: `/invoices/${INVOICE_ID}`,
        ...overrides,
      },
    ],
  });

  it("rejects a link with an unknown field", () => {
    expect(() => parse(successPayload(link({ target: "_blank" })))).toThrow(
      CopilotContractError,
    );
  });

  it("rejects an unsupported link entity type", () => {
    expect(() => parse(successPayload(link({ entity_type: "gl_account" })))).toThrow(
      CopilotContractError,
    );
  });

  it("drops an external https link without failing the whole answer", () => {
    const result = parse(
      successPayload(link({ href: "https://evil.example.com/invoices" })),
    );
    expect(result.links).toHaveLength(0);
    expect(result.answer).toBeTruthy();
  });

  it("drops javascript: and data: links", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,<script>"]) {
      expect(parse(successPayload(link({ href }))).links).toHaveLength(0);
    }
  });

  it("drops a link whose href does not match its own entity", () => {
    // A path that is individually valid but belongs to a different record must
    // not become clickable just because it looks like a route.
    expect(
      parse(successPayload(link({ href: `/receipts/${RECEIPT_ID}` }))).links,
    ).toHaveLength(0);
  });
});

describe("error categories", () => {
  it("maps every documented backend code to safe user text", () => {
    for (const code of COPILOT_ERROR_CODES) {
      const message = copilotErrorMessage(code);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/openai|postgre|sql|stack|undefined/i);
    }
  });

  it("uses the documented wording for each category", () => {
    expect(copilotErrorMessage("AUTHENTICATION_ERROR")).toContain("sign in again");
    expect(copilotErrorMessage("AUTHORIZATION_ERROR")).toContain("permission");
    expect(copilotErrorMessage("VALIDATION_ERROR")).toContain("could not be processed");
    expect(copilotErrorMessage("NOT_FOUND")).toContain("access scope");
    expect(copilotErrorMessage("COPILOT_LIMIT_EXCEEDED")).toContain("new conversation");
    expect(copilotErrorMessage("COPILOT_UNAVAILABLE")).toContain("temporarily unavailable");
    expect(copilotErrorMessage("COPILOT_RESPONSE_UNVERIFIED")).toContain("verify");
  });

  it("never falls through to a server-supplied message for an unknown code", () => {
    // INTERNAL_ERROR and transport failures may carry provider or database
    // detail, so they collapse to the unverified message rather than passing
    // anything through.
    expect(copilotErrorMessage("INTERNAL_ERROR")).toBe(
      copilotErrorMessage("COPILOT_RESPONSE_UNVERIFIED"),
    );
    expect(copilotErrorMessage(null)).toBe(
      copilotErrorMessage("COPILOT_RESPONSE_UNVERIFIED"),
    );
    expect(isCopilotErrorCode("INTERNAL_ERROR")).toBe(false);
  });

  it("treats only the conversation limit as ending the conversation", () => {
    expect(isConversationExhausted("COPILOT_LIMIT_EXCEEDED")).toBe(true);
    expect(isConversationExhausted("COPILOT_UNAVAILABLE")).toBe(false);
  });
});

describe("request construction", () => {
  const context: CopilotContextHint = {
    page: "invoice_detail",
    entity_type: "invoice",
    entity_id: INVOICE_ID,
  };

  it("sends exactly messages and context and nothing else", () => {
    const body = buildCopilotRequestBody(
      [{ role: "user", content: "Why is this invoice open?" }],
      context,
    );
    expect(Object.keys(body).sort()).toEqual(["context", "messages"]);
    expect(Object.keys(body.context).sort()).toEqual([
      "entity_id",
      "entity_type",
      "page",
    ]);
  });

  it("carries no company, user, role, model, or prompt authority", () => {
    const body = buildCopilotRequestBody(
      [{ role: "user", content: "hi" }, { role: "user", content: "again" }],
      context,
    );

    // Walk every key in the body. `role` inside a message is the conversation
    // role the backend contract itself defines, so it is checked structurally
    // (a message has exactly `role` and `content`) rather than by substring.
    const keys = new Set<string>();
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        visit(child);
      }
    };
    visit(body);

    expect([...keys].sort()).toEqual([
      "content",
      "context",
      "entity_id",
      "entity_type",
      "messages",
      "page",
      "role",
      "messages",
    ].filter((value, index, all) => all.indexOf(value) === index).sort());

    for (
      const forbidden of [
        "company_id",
        "user_id",
        "roles",
        "highest_role",
        "model",
        "system_prompt",
        "developer_prompt",
        "instructions",
        "api_key",
        "authorization",
      ]
    ) {
      expect(keys.has(forbidden)).toBe(false);
    }
    for (const message of body.messages) {
      expect(Object.keys(message).sort()).toEqual(["content", "role"]);
      expect(message.role === "user" || message.role === "assistant").toBe(true);
    }
  });

  it("posts to the documented Edge Function route", () => {
    expect(COPILOT_CHAT_PATH).toBe("/ar-copilot/chat");
  });
});

describe("outbound message bounds", () => {
  it("always ends with the user's message, as the backend requires", () => {
    const bounded = boundOutboundMessages([
      { role: "user", content: "one" },
      { role: "assistant", content: "answer" },
    ]);
    expect(bounded.at(-1)?.role).toBe("user");
    expect(bounded).toHaveLength(1);
  });

  it("returns nothing when there is no user turn to send", () => {
    expect(boundOutboundMessages([{ role: "assistant", content: "hi" }]))
      .toEqual([]);
  });

  it("keeps at most the documented message count, dropping the oldest", () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${index}`,
    }));
    const bounded = boundOutboundMessages([
      ...messages,
      { role: "user", content: "newest" },
    ]);
    expect(bounded.length).toBeLessThanOrEqual(COPILOT_MAX_MESSAGES);
    expect(bounded.at(-1)?.content).toBe("newest");
    expect(bounded.some((m) => m.content === "m0")).toBe(false);
  });

  it("trims a long previous answer to the per-message bound rather than dropping it", () => {
    // An answer may be up to 4,000 characters, but the backend applies the
    // 2,000-character message bound to assistant turns too. Trimming keeps the
    // exchange in context; the full answer stays on screen.
    const bounded = boundOutboundMessages([
      { role: "user", content: "explain" },
      { role: "assistant", content: "x".repeat(COPILOT_MAX_ANSWER_CHARS) },
      { role: "user", content: "and then?" },
    ]);
    expect(bounded).toHaveLength(3);
    expect(bounded[1].content).toHaveLength(COPILOT_MAX_MESSAGE_CHARS);
  });

  it("stays within the total conversation character bound", () => {
    const long = { role: "user" as const, content: "y".repeat(COPILOT_MAX_MESSAGE_CHARS) };
    const bounded = boundOutboundMessages(Array.from({ length: 10 }, () => long));
    const total = bounded.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(COPILOT_MAX_TOTAL_MESSAGE_CHARS);
    expect(bounded.length).toBeGreaterThan(0);
  });
});

describe("context identifier shapes", () => {
  it("requires a UUID for record entities", () => {
    expect(isValidContextEntityId("invoice", INVOICE_ID)).toBe(true);
    expect(isValidContextEntityId("invoice", "not-a-uuid")).toBe(false);
  });

  it("requires the composite source form for an audit event", () => {
    expect(isValidContextEntityId("audit_event", `invoice:${INVOICE_ID}`)).toBe(
      true,
    );
    expect(isValidContextEntityId("audit_event", INVOICE_ID)).toBe(false);
  });
});

// ============================================================================
// AR Copilot — panel behaviour.
//
// These tests drive the REAL panel, chat, composer, message, evidence, and
// link components against a mocked API boundary, so what is asserted is what a
// user would actually see and do.
// ============================================================================

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@/types";

// ─── Mocked boundaries ──────────────────────────────────────────────────────

let currentPath = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let currentRoles: UserRole[] = ["Finance Manager"];
vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({ roles: currentRoles }),
}));

let currentUserId: string | null = "user-a";
vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: currentUserId ? { id: currentUserId } : null }),
}));

let currentCompanyId = "company-a";
vi.mock("@/stores/company-store", () => ({
  useCompanyStore: (selector: (state: { companyId: string }) => unknown) =>
    selector({ companyId: currentCompanyId }),
}));

// The real `ApiError` class, so `instanceof` in the hook behaves as in
// production; only the transport is faked.
class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const post = vi.fn();
vi.mock("@/hooks/use-api", () => ({
  ApiError: class extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  useApi: () => ({ post }),
}));

const { ApiError: MockedApiError } = await import("@/hooks/use-api");
const { ArCopilotPanel } = await import("./copilot-panel");
const { COPILOT_MAX_MESSAGE_CHARS } = await import("@/lib/ar-copilot/contract");
const { STALE_PRIVACY_CLAIMS } = await import("@/lib/ar-copilot/disclosure");

void ApiError;

// ─── Fixtures ───────────────────────────────────────────────────────────────

const INVOICE_ID = "11111111-2222-4333-8444-555555555555";

function answer(overrides: Record<string, unknown> = {}) {
  return {
    answer: "The invoice is open because MYR 500.00 is still outstanding.",
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
      request_id: "req-abc-123",
      provider: "openai",
      model: "gpt-secret-model-name",
      tool_names: ["get_invoice"],
      tool_call_count: 1,
    },
    ...overrides,
  };
}

const failure = (code: string, status = 400) =>
  new (MockedApiError as unknown as typeof ApiError)(code, "raw server text", status);

function renderPanel(onClose = vi.fn()) {
  return { onClose, ...render(<ArCopilotPanel onClose={onClose} />) };
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByLabelText("Ask AR Copilot a question");
  await user.type(input, text);
  await user.click(screen.getByRole("button", { name: "Send question" }));
}

beforeEach(() => {
  currentPath = "/";
  currentRoles = ["Finance Manager"];
  currentUserId = "user-a";
  currentCompanyId = "company-a";
  post.mockReset();
  post.mockResolvedValue(answer());
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Empty state and suggestions ────────────────────────────────────────────

describe("empty state", () => {
  it("opens with a deliberate invitation rather than a blank chat box", () => {
    renderPanel();
    expect(
      screen.getByText("How can I help with your AR operations?"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask about invoices, receipts/)).toBeInTheDocument();
  });

  it("offers questions for the current page", () => {
    renderPanel();
    expect(
      screen.getByRole("button", { name: /Which invoices are overdue/ }),
    ).toBeInTheDocument();
  });

  it("changes the offered questions with the route", () => {
    currentPath = `/invoices/${INVOICE_ID}`;
    renderPanel();
    expect(
      screen.getByRole("button", { name: /Why is this invoice still open/ }),
    ).toBeInTheDocument();
  });

  it("does not send anything until the user acts", () => {
    renderPanel();
    expect(post).not.toHaveBeenCalled();
  });

  it("asks the question when a suggestion is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      screen.getByRole("button", { name: /Which invoices are overdue/ }),
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].messages.at(-1).content).toBe(
      "Which invoices are overdue?",
    );
  });
});

// ─── Request construction ───────────────────────────────────────────────────

describe("request construction", () => {
  it("posts to the Copilot route through the authenticated API client", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "What is unapplied cash?");
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe("/ar-copilot/chat");
    // Silent, because the Copilot renders its own bounded error text rather
    // than letting a global toast surface a server message. The abort signal
    // is what lets a superseded request be cancelled on an identity change.
    const options = post.mock.calls[0][2] as {
      silent?: boolean;
      signal?: AbortSignal;
    };
    expect(Object.keys(options).sort()).toEqual(["signal", "silent"]);
    expect(options.silent).toBe(true);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);
  });

  it("sends only messages and context", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "hello");
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(Object.keys(post.mock.calls[0][1]).sort()).toEqual([
      "context",
      "messages",
    ]);
  });

  it("sends no company, user, role, model, or prompt field", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "hello");
    await waitFor(() => expect(post).toHaveBeenCalled());
    const serialized = JSON.stringify(post.mock.calls[0][1]);
    for (
      const forbidden of [
        "company_id",
        "company-a",
        "user_id",
        "user-a",
        "roles",
        "Finance Manager",
        "model",
        "system_prompt",
        "developer",
        "instructions",
      ]
    ) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("sends the current page and entity as context", async () => {
    currentPath = `/invoices/${INVOICE_ID}`;
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].context).toEqual({
      page: "invoice_detail",
      entity_type: "invoice",
      entity_id: INVOICE_ID,
    });
  });

  it("never sends a malformed route identifier as an entity", async () => {
    currentPath = "/invoices/not-a-uuid";
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].context).toEqual({
      page: "invoices",
      entity_type: null,
      entity_id: null,
    });
  });
});

// ─── Answer rendering ───────────────────────────────────────────────────────

describe("answer rendering", () => {
  it("shows the user's question and then the answer as text", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "Why is this invoice open?");
    expect(screen.getByText("Why is this invoice open?")).toBeInTheDocument();
    expect(
      await screen.findByText(/still outstanding/),
    ).toBeInTheDocument();
  });

  it("renders assistant markup as literal text, never as HTML", async () => {
    post.mockResolvedValue(
      answer({
        answer: '<img src=x onerror="alert(1)"> **bold** [link](/settings)',
        evidence: [],
        links: [],
      }),
    );
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "try it");
    expect(
      await screen.findByText(/<img src=x onerror="alert\(1\)">/),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not turn a URL in the answer text into a link", async () => {
    post.mockResolvedValue(
      answer({ answer: "See https://evil.example.com", evidence: [], links: [] }),
    );
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "where?");
    await screen.findByText(/evil.example.com/);
    expect(
      container.querySelector('a[href*="evil.example.com"]'),
    ).toBeNull();
  });

  it("preserves the answer's line breaks", async () => {
    post.mockResolvedValue(
      answer({ answer: "Line one.\nLine two.", evidence: [], links: [] }),
    );
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "list");
    await screen.findByText(/Line one/);
    const paragraph = [...container.querySelectorAll("p")].find((node) =>
      node.textContent?.includes("Line one")
    );
    expect(paragraph?.className).toContain("whitespace-pre-wrap");
  });

  it("never shows the request id, model, or tool names", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/still outstanding/);
    const text = container.textContent ?? "";
    expect(text).not.toContain("req-abc-123");
    expect(text).not.toContain("gpt-secret-model-name");
    expect(text).not.toContain("get_invoice");
    expect(text).not.toContain("openai");
  });
});

// ─── Evidence and links ─────────────────────────────────────────────────────

describe("evidence and safe links", () => {
  it("renders evidence as a source chip using the document number", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/still outstanding/);
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("INV-202608-00012")).toBeInTheDocument();
    expect(screen.queryByText(INVOICE_ID)).toBeNull();
  });

  it("renders a safe internal link as a navigation control", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/still outstanding/);
    const link = container.querySelector("[data-copilot-link]");
    expect(link).toHaveAttribute("href", `/invoices/${INVOICE_ID}`);
    expect(link?.textContent).toContain("View document");
  });

  it("does not render an unsafe link at all", async () => {
    post.mockResolvedValue(
      answer({
        links: [
          {
            label: "Download report",
            entity_type: "invoice",
            entity_id: INVOICE_ID,
            href: "https://evil.example.com/steal",
          },
          {
            label: "Run script",
            entity_type: "invoice",
            entity_id: INVOICE_ID,
            href: "javascript:alert(1)",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/still outstanding/);
    expect(container.querySelector("[data-copilot-link]")).toBeNull();
    expect(screen.queryByText("Download report")).toBeNull();
    expect(screen.queryByText("Run script")).toBeNull();
  });

  it("offers no control that would perform a financial action", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/still outstanding/);
    for (
      const action of [
        /^Post$/,
        /^Cancel$/,
        /^Allocate$/,
        /Send Reminder/,
        /Change Status/,
        /Enable Automation/,
      ]
    ) {
      expect(screen.queryByRole("button", { name: action })).toBeNull();
    }
  });

  it("fails closed when the response does not match the contract", async () => {
    post.mockResolvedValue({ answer: 42, evidence: "nope" });
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    expect(
      await screen.findByText(/could not verify a safe answer/),
    ).toBeInTheDocument();
  });
});

// ─── Composer behaviour ─────────────────────────────────────────────────────

describe("composer", () => {
  it("shows a professional activity state while waiting", async () => {
    let release: (value: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "why open?");
    expect(
      await screen.findByText("Checking authorized AR information…"),
    ).toBeInTheDocument();
    release(answer());
    await waitFor(() =>
      expect(container.querySelector("[data-copilot-pending]")).toBeNull()
    );
  });

  it("blocks a second submission while one is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "first");
    const send = screen.getByRole("button", { name: "Send question" });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(post).toHaveBeenCalledTimes(1);
    release(answer());
    await screen.findByText(/still outstanding/);
  });

  it("sends on Enter", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(
      screen.getByLabelText("Ask AR Copilot a question"),
      "why open?{Enter}",
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText("Ask AR Copilot a question");
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(post).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("line one\nline two");
  });

  it("does not send while an IME composition is active", async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText("Ask AR Copilot a question");
    await user.type(input, "invoice");
    // Enter accepts an IME candidate; it must not submit a half-composed
    // message for a Japanese, Chinese, or Korean keyboard.
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await user.type(input, "{Enter}");
    expect(post).not.toHaveBeenCalled();
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await user.type(input, "{Enter}");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it("keeps Send disabled for a blank message", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    await user.type(screen.getByLabelText("Ask AR Copilot a question"), "   ");
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });

  it("shows a counter near the limit and refuses an over-length message", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    const input = screen.getByLabelText("Ask AR Copilot a question");
    await user.click(input);
    await user.paste("a".repeat(COPILOT_MAX_MESSAGE_CHARS + 5));
    const counter = container.querySelector("[data-copilot-counter]");
    expect(counter?.textContent).toContain(String(COPILOT_MAX_MESSAGE_CHARS + 5));
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("refuses an over-length message rather than silently truncating it", async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText("Ask AR Copilot a question");
    await user.click(input);
    await user.paste("b".repeat(COPILOT_MAX_MESSAGE_CHARS + 1));
    // Enter is the path that bypasses the disabled button. Nothing may be
    // sent: a truncated body would answer a DIFFERENT question from the one
    // on screen, without ever telling the user which one was asked.
    await user.type(input, "{Enter}");
    expect(post).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toHaveLength(
      COPILOT_MAX_MESSAGE_CHARS + 1,
    );
  });

  it("clears the input after a question is sent", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/still outstanding/);
    expect(
      (screen.getByLabelText("Ask AR Copilot a question") as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });
});

// ─── Conversation lifecycle ─────────────────────────────────────────────────

describe("conversation lifecycle", () => {
  it("carries earlier turns into the next request", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "first question");
    await screen.findByText(/still outstanding/);
    await ask(user, "second question");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const messages = post.mock.calls[1][1].messages;
    expect(messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(messages.at(-1).content).toBe("second question");
  });

  it("sends the new page context after navigation without relabelling old turns", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "on the dashboard");
    await screen.findByText(/still outstanding/);
    expect(screen.getByText("Asked from Dashboard")).toBeInTheDocument();

    currentPath = `/invoices/${INVOICE_ID}`;
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await ask(user, "and now on an invoice");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1].context.page).toBe("invoice_detail");
    // The first question keeps the context it was actually asked under.
    expect(screen.getByText("Asked from Dashboard")).toBeInTheDocument();
  });

  it("clears the conversation with New conversation", async () => {
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/still outstanding/);
    await user.click(screen.getByRole("button", { name: /New conversation/ }));
    expect(screen.queryByText(/still outstanding/)).toBeNull();
    expect(
      screen.getByText("How can I help with your AR operations?"),
    ).toBeInTheDocument();
  });

  it("stops accepting questions once the server reports the conversation limit", async () => {
    post.mockRejectedValueOnce(failure("COPILOT_LIMIT_EXCEEDED", 429));
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    expect(
      await screen.findByText(/reached its current limit/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Ask AR Copilot a question")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /New conversation/ }));
    expect(screen.getByLabelText("Ask AR Copilot a question")).toBeEnabled();
  });
});

// ─── Isolation ──────────────────────────────────────────────────────────────

describe("session isolation", () => {
  it("clears the conversation when the authenticated user changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "user A question");
    await screen.findByText(/still outstanding/);

    currentUserId = "user-b";
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.queryByText("user A question")).toBeNull()
    );
    expect(screen.queryByText(/still outstanding/)).toBeNull();
  });

  it("clears the conversation on sign-out", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "before signing out");
    await screen.findByText(/still outstanding/);

    currentUserId = null;
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.queryByText("before signing out")).toBeNull()
    );
  });

  it("clears the conversation when the selected company changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "company A question");
    await screen.findByText(/still outstanding/);

    // Evidence retrieved for one tenant must never appear under another.
    currentCompanyId = "company-b";
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.queryByText("company A question")).toBeNull()
    );
  });

  it("writes no conversation content to browser storage", async () => {
    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "a distinctive question about invoice INV-202608-00012");
    await screen.findByText(/still outstanding/);

    for (const call of localSpy.mock.calls) {
      expect(String(call[1])).not.toContain("distinctive question");
      expect(String(call[1])).not.toContain("still outstanding");
    }
    expect(JSON.stringify(localStorage)).not.toContain("distinctive question");
    expect(JSON.stringify(sessionStorage)).not.toContain("distinctive question");
    localSpy.mockRestore();
  });
});

// ─── Late in-flight responses ───────────────────────────────────────────────
//
// Clearing state is not enough on its own. A request issued under one identity
// or tenant can still be in flight when that identity changes, and its
// resolution runs LATER — after the new conversation already exists. These
// tests hold a request open across the switch and then release it.

describe("a response that arrives after the identity changed", () => {
  /** Start a question and keep the request pending until `release` is called. */
  function pendingRequest() {
    let release: (value: unknown) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    let signal: AbortSignal | undefined;
    post.mockImplementation(
      (_path: string, _body: unknown, opts?: { signal?: AbortSignal }) => {
        signal = opts?.signal;
        return new Promise((resolve, rejectFn) => {
          release = resolve;
          reject = rejectFn;
        });
      },
    );
    return {
      release: (value: unknown) => release(value),
      reject: (reason: unknown) => reject(reason),
      get signal() {
        return signal;
      },
    };
  }

  it("is not appended after the company changed mid-flight", async () => {
    const inFlight = pendingRequest();
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "company A question");
    await screen.findByText("Checking authorized AR information…");

    currentCompanyId = "company-b";
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.queryByText("company A question")).toBeNull()
    );

    // Company A's answer and evidence now come back. They belong to a
    // conversation that no longer exists and must be dropped entirely.
    inFlight.release(
      answer({ answer: "Company A only: MYR 500.00 is outstanding." }),
    );
    await waitFor(() =>
      expect(screen.getByText("How can I help with your AR operations?"))
        .toBeInTheDocument()
    );
    expect(screen.queryByText(/Company A only/)).toBeNull();
    expect(screen.queryByText("INV-202608-00012")).toBeNull();
    expect(screen.queryByText("company A question")).toBeNull();
  });

  it("is not appended after the authenticated user changed mid-flight", async () => {
    const inFlight = pendingRequest();
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "user A question");
    await screen.findByText("Checking authorized AR information…");

    currentUserId = "user-b";
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("user A question")).toBeNull());

    inFlight.release(answer({ answer: "User A only: assigned customers." }));
    await waitFor(() =>
      expect(screen.getByText("How can I help with your AR operations?"))
        .toBeInTheDocument()
    );
    expect(screen.queryByText(/User A only/)).toBeNull();
  });

  it("is not appended after New conversation was used mid-flight", async () => {
    const inFlight = pendingRequest();
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "abandoned question");
    await screen.findByText("Checking authorized AR information…");

    await user.click(screen.getByRole("button", { name: /New conversation/ }));
    inFlight.release(answer({ answer: "Answer to the abandoned question." }));

    await waitFor(() =>
      expect(screen.getByText("How can I help with your AR operations?"))
        .toBeInTheDocument()
    );
    expect(screen.queryByText(/abandoned question/)).toBeNull();
  });

  it("surfaces no error either when a superseded request fails", async () => {
    const inFlight = pendingRequest();
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "company A question");
    await screen.findByText("Checking authorized AR information…");

    currentCompanyId = "company-b";
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.queryByText("company A question")).toBeNull()
    );

    // An aborted fetch rejects. That is not a failure the NEW conversation
    // should hear about, so no error turn may appear.
    inFlight.reject(failure("COPILOT_UNAVAILABLE", 503));
    await waitFor(() =>
      expect(screen.getByText("How can I help with your AR operations?"))
        .toBeInTheDocument()
    );
    expect(screen.queryByText(/temporarily unavailable/)).toBeNull();
  });

  it("aborts the superseded request instead of leaving it running", async () => {
    const inFlight = pendingRequest();
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "company A question");
    await screen.findByText("Checking authorized AR information…");
    expect(inFlight.signal?.aborted).toBe(false);

    currentCompanyId = "company-b";
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await waitFor(() => expect(inFlight.signal?.aborted).toBe(true));
  });

  it("still accepts a new question after a superseded request settles", async () => {
    const inFlight = pendingRequest();
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await ask(user, "company A question");
    await screen.findByText("Checking authorized AR information…");

    currentCompanyId = "company-b";
    rerender(<ArCopilotPanel onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.queryByText("company A question")).toBeNull()
    );
    // The abandoned request settles late; it must not leave the composer stuck
    // in a pending state or hold the in-flight guard closed.
    inFlight.release(answer());

    post.mockReset();
    post.mockResolvedValue(answer({ answer: "Company B answer." }));
    await ask(user, "company B question");
    expect(await screen.findByText("Company B answer.")).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });
});

// ─── Errors ─────────────────────────────────────────────────────────────────

describe("error states", () => {
  it.each([
    ["AUTHENTICATION_ERROR", 401, /sign in again/],
    ["AUTHORIZATION_ERROR", 403, /don't have permission/],
    ["VALIDATION_ERROR", 400, /could not be processed/],
    ["NOT_FOUND", 404, /not available in your current company/],
    ["COPILOT_LIMIT_EXCEEDED", 429, /reached its current limit/],
    ["COPILOT_UNAVAILABLE", 503, /temporarily unavailable/],
    ["COPILOT_RESPONSE_UNVERIFIED", 502, /could not verify a safe answer/],
  ])("shows safe text for %s", async (code, status, pattern) => {
    post.mockRejectedValueOnce(failure(code, status));
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    expect(await screen.findByText(pattern)).toBeInTheDocument();
  });

  it("never surfaces the raw server message", async () => {
    post.mockRejectedValueOnce(failure("INTERNAL_ERROR", 500));
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/could not verify a safe answer/);
    expect(container.textContent).not.toContain("raw server text");
  });

  it("reassures the user that AR data is unaffected when the provider is down", async () => {
    post.mockRejectedValueOnce(failure("COPILOT_UNAVAILABLE", 503));
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "why open?");
    expect(
      await screen.findByText(/AR data and workflows are unaffected/),
    ).toBeInTheDocument();
  });

  it("lets the user try again after a recoverable failure", async () => {
    post.mockRejectedValueOnce(failure("COPILOT_UNAVAILABLE", 503));
    const user = userEvent.setup();
    renderPanel();
    await ask(user, "first try");
    await screen.findByText(/temporarily unavailable/);
    expect(screen.getByLabelText("Ask AR Copilot a question")).toBeEnabled();
    await ask(user, "second try");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    // The failed exchange is local UI state and is not replayed as if the
    // assistant had said it.
    const messages = post.mock.calls[1][1].messages;
    expect(messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "user",
    ]);
  });
});

// ─── Disclosure ─────────────────────────────────────────────────────────────

describe("privacy and read-only disclosure", () => {
  it("states plainly that OpenAI generates the responses", () => {
    renderPanel();
    expect(screen.getByText(/AR Copilot uses OpenAI/)).toBeInTheDocument();
    expect(
      screen.getByText(/Only the minimum authorized context/),
    ).toBeInTheDocument();
  });

  it("states that the assistant cannot change financial records", () => {
    renderPanel();
    expect(
      screen.getByText(/cannot\s+post, cancel, allocate, or change/),
    ).toBeInTheDocument();
  });

  it("shows the read-only badge with an explanatory title", () => {
    const { container } = renderPanel();
    const badge = container.querySelector("[data-copilot-read-only]");
    expect(badge?.textContent).toBe("Read-only assistant");
    expect(badge).toHaveAttribute(
      "title",
      expect.stringContaining("Financial actions continue through the existing"),
    );
  });

  it("contains no stale claim that no external AI is used", () => {
    const { container } = renderPanel();
    const text = (container.textContent ?? "").toLowerCase();
    for (const claim of STALE_PRIVACY_CLAIMS) {
      expect(text).not.toContain(claim.toLowerCase());
    }
  });

  it("explains what is withheld without overclaiming provider retention", () => {
    const { container } = renderPanel();
    const disclosure = container.querySelector("[data-copilot-disclosure]");
    const text = disclosure?.textContent ?? "";
    expect(text).toContain("Raw Gmail message bodies are not sent");
    expect(text).toContain("Credentials, tokens, and API keys are not sent");
    expect(text).toContain("does not store your conversation");
    // Deliberately absent: any promise about what OpenAI itself retains.
    expect(text).not.toMatch(/OpenAI (?:retains|stores|keeps) nothing/i);
    expect(text).not.toMatch(/never stored by OpenAI/i);
  });
});

// ─── Workflow Guide ─────────────────────────────────────────────────────────

describe("workflow guide", () => {
  it("is still reachable from the Copilot drawer", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("tab", { name: "Workflow Guide" }));
    expect(screen.getByText("Create & post an invoice")).toBeInTheDocument();
    expect(screen.getByText("Record & allocate a receipt")).toBeInTheDocument();
    expect(screen.getByText("Import invoices or receipts")).toBeInTheDocument();
  });

  it("keeps its step links working", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("tab", { name: "Workflow Guide" }));
    const guide = screen.getByRole("tabpanel", { name: "Workflow Guide" });
    expect(
      within(guide).getByRole("link", { name: /New invoice/ }),
    ).toHaveAttribute("href", "/invoices/new");
    expect(
      within(guide).getByRole("link", { name: /Allocation Wizard/ }),
    ).toHaveAttribute("href", "/allocations");
    expect(
      within(guide).getByRole("link", { name: /Invoice import/ }),
    ).toHaveAttribute("href", "/invoices/import");
  });

  it("closes the drawer when a guide link is followed", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.click(screen.getByRole("tab", { name: "Workflow Guide" }));
    await user.click(screen.getByRole("link", { name: /New invoice/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("no longer tells the user the guide reflects the whole feature's privacy", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    await user.click(screen.getByRole("tab", { name: "Workflow Guide" }));
    const text = (container.textContent ?? "").toLowerCase();
    for (const claim of STALE_PRIVACY_CLAIMS) {
      expect(text).not.toContain(claim.toLowerCase());
    }
  });
});

// ─── Context indicator ──────────────────────────────────────────────────────

describe("context indicator", () => {
  it("names the current screen when no record is open", () => {
    const { container } = renderPanel();
    expect(
      container.querySelector("[data-copilot-context]")?.textContent,
    ).toContain("Current page: Dashboard");
  });

  it("names the record's screen without exposing the identifier", () => {
    currentPath = `/invoices/${INVOICE_ID}`;
    const { container } = renderPanel();
    const chip = container.querySelector("[data-copilot-context]");
    expect(chip?.textContent).toContain("Invoice Detail");
    expect(chip?.textContent).not.toContain(INVOICE_ID);
  });
});

// ─── Accessibility ──────────────────────────────────────────────────────────

describe("accessibility", () => {
  it("exposes the drawer as a labelled dialog", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "AR Copilot" });
    expect(dialog).toBeInTheDocument();
  });

  it("labels the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Close AR Copilot" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("labels the composer and the send button", () => {
    renderPanel();
    expect(screen.getByLabelText("Ask AR Copilot a question")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeInTheDocument();
  });

  it("reaches Send with the keyboard alone", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(
      screen.getByLabelText("Ask AR Copilot a question"),
      "why open?",
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Send question" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it("exposes the sections as a proper tab list", async () => {
    const user = userEvent.setup();
    renderPanel();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Ask Copilot",
      "Workflow Guide",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Workflow Guide" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("gives every interactive control a visible focus ring", () => {
    const { container } = renderPanel();
    for (
      const selector of [
        '[data-copilot-suggestion]',
        'button[aria-label="Send question"]',
        'button[aria-label="Close AR Copilot"]',
      ]
    ) {
      const element = container.querySelector(selector);
      expect(element?.className).toContain("focus-visible:ring-2");
    }
  });

  it("announces the answer rather than showing it silently", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "why open?");
    await screen.findByText(/still outstanding/);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("still outstanding");
  });

  it("keeps the loading animation out of the accessible name", async () => {
    let release: (value: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    const user = userEvent.setup();
    const { container } = renderPanel();
    await ask(user, "why open?");
    const pending = container.querySelector("[data-copilot-pending]");
    // One stable sentence, not a stream of changing dots.
    expect(pending?.textContent).toBe("Checking authorized AR information…");
    expect(pending?.querySelector('[aria-hidden="true"]')).toBeTruthy();
    release(answer());
    await screen.findByText(/still outstanding/);
  });

  it("relies on shared motion utilities that honour reduced motion", () => {
    // `ds-overlay-enter` and `ds-press` are neutralised by the global
    // `prefers-reduced-motion` block, so the panel inherits that behaviour
    // instead of defining its own animations.
    const { container } = renderPanel();
    const panel = container.querySelector("[data-ar-copilot-panel]");
    expect(panel?.className).toContain("ds-overlay-enter");
  });
});

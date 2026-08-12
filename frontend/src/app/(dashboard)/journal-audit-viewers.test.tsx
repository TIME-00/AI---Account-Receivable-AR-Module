// ============================================================================
// Post-Gate-E — Journal Entries + Audit Trail READ viewer tests.
//
// These pin the properties that make the two viewers safe to ship:
//   * role policy matches the backend EXACTLY (and differs between the two:
//     AR Supervisor may read journals but NOT the company-wide audit trail);
//   * keyset pagination uses the backend cursor and never fabricates a page
//     count, and a filter change invalidates the cursor chain;
//   * exact decimal strings are rendered verbatim — never through `Number`;
//   * a source link is derived ONLY from the allow-listed `source` object;
//   * "unknown" actors are never relabelled as system automation;
//   * redacted and unrecognised metadata never reaches the page;
//   * neither viewer exposes any mutation control.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  createFakeApi,
  route,
  routePrefix,
  type FakeApi,
} from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";
import { ApiError } from "@/hooks/use-api";
import {
  journalSourceHref,
  JournalAuditContractError,
  parseAuditEvent,
  parseAuditList,
  parseJournalDetail,
  parseJournalList,
  presentAuditActor,
  presentAuditMetadata,
  type AuditEvent,
} from "@/lib/journal-audit/contract";

const CO = "10000000-0000-4000-8000-000000000001";
const JE_ID = "20000000-0000-4000-8000-000000000001";
const INV_ID = "30000000-0000-4000-8000-000000000001";

let fakeApi: FakeApi;
vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

let roles: string[] = ["Finance Manager"];
vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({
    data: {
      roles,
      highest_role: roles[0] ?? null,
      capabilities: { is_read_only: false, is_system_admin_only: roles[0] === "System Admin" },
      company: { id: CO, name: "Company One" },
      user: { id: "user-1", email: "fm@example.com" },
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: JE_ID }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/journal-entries",
}));

import JournalEntriesPage from "./journal-entries/page";
import JournalEntryDetailPage from "./journal-entries/[id]/page";
import AuditTrailPage from "./settings/audit-log/page";
import { Sidebar } from "@/components/layout/sidebar";

// ─── Fixtures mirroring the reviewed backend contracts ──────────────────────

function journalRow(over: Record<string, unknown> = {}) {
  return {
    id: JE_ID,
    je_no: "JE-202608-00001",
    je_date: "2026-08-11",
    posting_period: "2026-08",
    source_type: "INV",
    source_doc_no: "INV-202608-00002",
    source_doc_id: INV_ID,
    description: "Invoice posting",
    currency: "MYR",
    base_currency: "MYR",
    total_debit: "1234.56",
    total_credit: "1234.56",
    is_balanced: true,
    is_reversal: false,
    created_at: "2026-08-11T04:00:00Z",
    created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    line_count: 2,
    source: { entity_type: "invoice", entity_id: INV_ID, entity_number: "INV-202608-00002" },
    ...over,
  };
}

function journalDetail(over: Record<string, unknown> = {}) {
  return {
    ...journalRow(),
    exchange_rate: "1.000000",
    original_je_id: null,
    reversal_je_id: null,
    is_reversed: false,
    lines: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        line_no: 1,
        gl_account_id: "50000000-0000-4000-8000-000000000001",
        account_code: "1200",
        account_name: "Accounts Receivable",
        account_type: "Asset",
        description: "AR control",
        debit_amount: "1234.56",
        credit_amount: "0.00",
        base_debit: "1234.56",
        base_credit: "0.00",
        currency: "MYR",
        original_amount: "1234.56",
        created_at: "2026-08-11T04:00:00Z",
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        line_no: 2,
        gl_account_id: "50000000-0000-4000-8000-000000000002",
        account_code: "4000",
        account_name: "Revenue",
        account_type: "Revenue",
        description: "Sales revenue",
        debit_amount: "0.00",
        credit_amount: "1234.56",
        base_debit: "0.00",
        base_credit: "1234.56",
        currency: "MYR",
        original_amount: "1234.56",
        created_at: "2026-08-11T04:00:00Z",
      },
    ],
    ...over,
  };
}

function auditEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    event_id: `invoice_posted:${INV_ID}`,
    occurred_at: "2026-08-11T04:00:00Z",
    actor: {
      type: "user",
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      display_name: null,
      role: null,
    },
    action: "posted",
    entity_type: "invoice",
    entity_id: INV_ID,
    entity_number: "INV-202608-00002",
    result: "Posted",
    summary: "Invoice INV-202608-00002 was posted.",
    metadata: { document_type: "Invoice", status: "Posted" },
    source_kind: "invoice",
    ...over,
  };
}

function journalRoutes(rows: unknown[] = [journalRow()], meta: Record<string, unknown> = {}) {
  return [
    routePrefix("/journal-entries/", () => ({ data: journalDetail() })),
    route("/journal-entries", () => ({
      data: rows,
      meta: { limit: 25, has_more: false, next_cursor: null, ...meta },
    })),
  ];
}

function auditRoutes(rows: AuditEvent[] = [auditEvent()], meta: Record<string, unknown> = {}) {
  return [
    route("/audit-trail", () => ({
      data: rows,
      meta: { limit: 25, has_more: false, next_cursor: null, ...meta },
    })),
  ];
}

beforeEach(() => {
  roles = ["Finance Manager"];
  useCompanyStore.getState().setCompany(CO, "Company One", "MYR");
  fakeApi = createFakeApi([...journalRoutes(), ...auditRoutes()]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1-6: Journal role policy ───────────────────────────────────────────────

describe("Journal viewer role policy", () => {
  it("renders the list for an authorized role", async () => {
    renderWithProviders(<JournalEntriesPage />);
    expect(await screen.findByText("JE-202608-00001")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Journal Entries" })).toBeInTheDocument();
  });

  for (const role of ["AR Supervisor", "Finance Manager", "Auditor"]) {
    it(`allows ${role}`, async () => {
      roles = [role];
      renderWithProviders(<JournalEntriesPage />);
      expect(await screen.findByText("JE-202608-00001")).toBeInTheDocument();
      expect(screen.queryByText(/do not have permission/i)).toBeNull();
    });
  }

  for (const role of ["AR Clerk", "System Admin"]) {
    it(`denies ${role} and never issues the request`, async () => {
      roles = [role];
      renderWithProviders(<JournalEntriesPage />);
      expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
      expect(screen.queryByText("JE-202608-00001")).toBeNull();
      // An unauthorized role must not fire a predictable 403 request.
      expect(fakeApi.calls.filter((c) => c.path === "/journal-entries")).toHaveLength(0);
    });
  }

  it("fails closed with a safe surface when the backend refuses a direct visit", async () => {
    fakeApi = createFakeApi([
      route("/journal-entries", () => {
        throw new ApiError("AUTHORIZATION_ERROR", "denied", 403);
      }),
    ]);
    renderWithProviders(<JournalEntriesPage />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    // No raw backend text is rendered.
    expect(screen.queryByText(/denied/)).toBeNull();
  });
});

// ─── 7-12: Journal filters, cursor, staleness ───────────────────────────────

describe("Journal filters and pagination", () => {
  it("sends a debounced search to the contract's q parameter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalEntriesPage />);
    await screen.findByText("JE-202608-00001");

    await user.type(screen.getByLabelText("Search"), "INV-2026");
    await waitFor(() =>
      expect(
        fakeApi.calls.some((c) => c.path === "/journal-entries" && c.params.q === "INV-2026"),
      ).toBe(true),
    );
  });

  it("sends date, source, currency and account filters using contract parameter names", async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalEntriesPage />);
    await screen.findByText("JE-202608-00001");

    await user.selectOptions(screen.getByLabelText("Source"), "RCT");
    await user.selectOptions(screen.getByLabelText("Currency"), "SGD");
    await user.type(screen.getByLabelText("GL account code"), "1200");

    await waitFor(() => {
      const last = fakeApi.calls.filter((c) => c.path === "/journal-entries").at(-1)!;
      expect(last.params.source_type).toBe("RCT");
      expect(last.params.currency).toBe("SGD");
      expect(last.params.account_code).toBe("1200");
    });
  });

  it("advances with the backend cursor and offers Previous without a fabricated page count", async () => {
    const user = userEvent.setup();
    const second = journalRow({ id: "20000000-0000-4000-8000-000000000002", je_no: "JE-202608-00002" });
    fakeApi = createFakeApi([
      routePrefix("/journal-entries/", () => ({ data: journalDetail() })),
      route("/journal-entries", (params) =>
        params.cursor === "CURSOR-2"
          ? { data: [second], meta: { limit: 25, has_more: false, next_cursor: null } }
          : {
              data: [journalRow()],
              meta: { limit: 25, has_more: true, next_cursor: "CURSOR-2" },
            },
      ),
    ]);
    renderWithProviders(<JournalEntriesPage />);
    await screen.findByText("JE-202608-00001");

    expect(screen.getByText(/^Page 1/)).toBeInTheDocument();
    // No total count is invented for a keyset contract.
    expect(screen.queryByText(/\d+ total/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(await screen.findByText("JE-202608-00002")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fakeApi.calls.some((c) => c.path === "/journal-entries" && c.params.cursor === "CURSOR-2"),
      ).toBe(true),
    );
    expect(screen.getByText(/^Page 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Previous/i }));
    expect(await screen.findByText("JE-202608-00001")).toBeInTheDocument();
    expect(screen.getByText(/^Page 1/)).toBeInTheDocument();
  });

  it("resets the cursor chain when a filter changes", async () => {
    const user = userEvent.setup();
    fakeApi = createFakeApi([
      routePrefix("/journal-entries/", () => ({ data: journalDetail() })),
      route("/journal-entries", () => ({
        data: [journalRow()],
        meta: { limit: 25, has_more: true, next_cursor: "CURSOR-2" },
      })),
    ]);
    renderWithProviders(<JournalEntriesPage />);
    await screen.findByText("JE-202608-00001");

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => expect(screen.getByText(/^Page 2/)).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Source"), "RCT");

    // Back to page 1, and the new filter request carries no stale cursor.
    await waitFor(() => expect(screen.getByText(/^Page 1/)).toBeInTheDocument());
    const filtered = fakeApi.calls
      .filter((c) => c.path === "/journal-entries" && c.params.source_type === "RCT");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((c) => c.params.cursor === undefined)).toBe(true);
  });

  it("does not let a superseded filter response overwrite the newer one", async () => {
    const user = userEvent.setup();
    // The slow response belongs to the OLD filter; it must never replace the new
    // filter's rows, because each filter set is its own cache entry.
    fakeApi = createFakeApi([
      routePrefix("/journal-entries/", () => ({ data: journalDetail() })),
      route("/journal-entries", (params) => {
        if (params.source_type === "RCT") {
          return {
            data: [journalRow({ je_no: "JE-RCT-FRESH", source_type: "RCT" })],
            meta: { limit: 25, has_more: false, next_cursor: null },
          };
        }
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                data: [journalRow({ je_no: "JE-STALE" })],
                meta: { limit: 25, has_more: false, next_cursor: null },
              }),
            80,
          ),
        );
      }),
    ]);
    renderWithProviders(<JournalEntriesPage />);
    await user.selectOptions(screen.getByLabelText("Source"), "RCT");

    expect(await screen.findByText("JE-RCT-FRESH")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByText("JE-RCT-FRESH")).toBeInTheDocument();
    expect(screen.queryByText("JE-STALE")).toBeNull();
  });

  it("clears every filter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalEntriesPage />);
    await screen.findByText("JE-202608-00001");

    await user.selectOptions(screen.getByLabelText("Source"), "RCT");
    await user.click(screen.getByRole("button", { name: /Clear filters/i }));
    expect((screen.getByLabelText("Source") as HTMLSelectElement).value).toBe("");
  });
});

// ─── 13-14: Journal empty and error states ──────────────────────────────────

describe("Journal empty and error states", () => {
  it("shows a valid zero-state that does not imply a failure", async () => {
    fakeApi = createFakeApi(journalRoutes([]));
    renderWithProviders(<JournalEntriesPage />);
    expect(
      await screen.findByText("No journal entries match the current filters."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a safe error state with retry and no raw backend detail", async () => {
    fakeApi = createFakeApi([
      route("/journal-entries", () => {
        throw new ApiError("INTERNAL_ERROR", 'relation "journal_entries" does not exist', 500);
      }),
    ]);
    renderWithProviders(<JournalEntriesPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Journal entries could not be loaded.");
    expect(alert).not.toHaveTextContent(/relation|does not exist|select/i);
    expect(within(alert).getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });
});

// ─── 15-21: Journal detail, decimals, links, no mutation ────────────────────

describe("Journal detail", () => {
  it("opens the detail and lists lines in line_no order", async () => {
    renderWithProviders(<JournalEntryDetailPage />);
    await screen.findByRole("heading", { name: "JE-202608-00001" });

    const rowHeaders = screen.getAllByRole("rowheader").map((cell) => cell.textContent ?? "");
    const accountOrder = rowHeaders.filter((text) => /1200|4000/.test(text));
    expect(accountOrder[0]).toContain("1200");
    expect(accountOrder[0]).toContain("Accounts Receivable");
    expect(accountOrder[1]).toContain("4000");
    expect(accountOrder[1]).toContain("Revenue");
    // Both debit and credit legs are rendered so the double entry is comparable.
    expect(screen.getAllByText("1234.56").length).toBeGreaterThanOrEqual(2);
  });

  it("renders exact decimal strings verbatim, never through Number", async () => {
    fakeApi = createFakeApi([
      routePrefix("/journal-entries/", () => ({
        data: journalDetail({
          total_debit: "1234.50",
          total_credit: "1234.50",
          lines: journalDetail().lines.map((line, index) =>
            index === 0
              ? { ...line, debit_amount: "1234.50", base_debit: "1234.50" }
              : { ...line, credit_amount: "1234.50", base_credit: "1234.50" },
          ),
        }),
      })),
      route("/journal-entries", () => ({ data: [journalRow()], meta: {} })),
    ]);
    renderWithProviders(<JournalEntryDetailPage />);
    await screen.findByRole("heading", { name: "JE-202608-00001" });

    // A trailing-zero decimal survives only if it was never parsed to a number.
    expect(screen.getAllByText("1234.50").length).toBeGreaterThan(0);
    expect(screen.queryByText("1234.5")).toBeNull();
  });

  it("shows the reversal linkage truthfully", async () => {
    fakeApi = createFakeApi([
      routePrefix("/journal-entries/", () => ({
        data: journalDetail({
          is_reversal: true,
          is_reversed: false,
          original_je_id: "20000000-0000-4000-8000-0000000000aa",
        }),
      })),
      route("/journal-entries", () => ({ data: [journalRow()], meta: {} })),
    ]);
    renderWithProviders(<JournalEntryDetailPage />);
    expect(await screen.findByText("Reversal entry")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View original entry/i })).toHaveAttribute(
      "href",
      "/journal-entries/20000000-0000-4000-8000-0000000000aa",
    );
  });

  it("links a linkable source document to a real route", async () => {
    renderWithProviders(<JournalEntriesPage />);
    await screen.findByText("JE-202608-00001");
    expect(screen.getByRole("link", { name: "INV-202608-00002" })).toHaveAttribute(
      "href",
      `/invoices/${INV_ID}`,
    );
  });

  it("never fabricates a link for a non-linkable source", async () => {
    fakeApi = createFakeApi(
      journalRoutes([
        journalRow({
          je_no: "JE-ADJ-0001",
          source_type: "ADJ",
          source_doc_no: "ADJ-REF-1",
          source: null,
        }),
      ]),
    );
    renderWithProviders(<JournalEntriesPage />);
    await screen.findByText("JE-ADJ-0001");
    expect(screen.getByText("ADJ-REF-1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ADJ-REF-1" })).toBeNull();
    expect(journalSourceHref(null)).toBeNull();
  });

  it("exposes no create, edit, delete, post, reverse or manual-JE control", async () => {
    renderWithProviders(<JournalEntriesPage />);
    await screen.findByText("JE-202608-00001");
    for (const label of [/new journal/i, /create/i, /edit/i, /delete/i, /^post$/i, /reverse/i, /save/i]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(fakeApi.post).not.toHaveBeenCalled();
    expect(fakeApi.patch).not.toHaveBeenCalled();
    expect(fakeApi.del).not.toHaveBeenCalled();
  });
});

// ─── 22-26: Audit role policy ───────────────────────────────────────────────

describe("Audit viewer role policy", () => {
  for (const role of ["Finance Manager", "Auditor"]) {
    it(`allows ${role}`, async () => {
      roles = [role];
      renderWithProviders(<AuditTrailPage />);
      expect(await screen.findByText("Invoice INV-202608-00002 was posted.")).toBeInTheDocument();
    });
  }

  for (const role of ["AR Clerk", "AR Supervisor", "System Admin"]) {
    it(`denies ${role} and never issues the request`, async () => {
      roles = [role];
      renderWithProviders(<AuditTrailPage />);
      expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
      expect(fakeApi.calls.filter((c) => c.path === "/audit-trail")).toHaveLength(0);
    });
  }

  it("states that living under Settings does not grant System Admin access", async () => {
    roles = ["System Admin"];
    renderWithProviders(<AuditTrailPage />);
    expect(await screen.findByText(/configuration-only/i)).toBeInTheDocument();
  });
});

// ─── 27-31: Audit rendering, filters, cursor, states ────────────────────────

describe("Audit activity view", () => {
  it("renders activity rows with when, action, entity, document and result", async () => {
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Invoice INV-202608-00002 was posted.");
    expect(screen.getByRole("rowheader", { name: "Posted" })).toBeInTheDocument();
    expect(screen.getAllByText("INV-202608-00002").length).toBeGreaterThan(0);
    expect(screen.getByText("Invoice", { selector: "td" })).toBeInTheDocument();
  });

  it("sends filters using the contract parameter names", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Invoice INV-202608-00002 was posted.");

    await user.selectOptions(screen.getByLabelText("Action"), "posted");
    await user.selectOptions(screen.getByLabelText("Entity"), "receipt");
    await user.selectOptions(screen.getByLabelText("Actor"), "system");

    await waitFor(() => {
      const last = fakeApi.calls.filter((c) => c.path === "/audit-trail").at(-1)!;
      expect(last.params.action).toBe("posted");
      expect(last.params.entity_type).toBe("receipt");
      expect(last.params.actor_type).toBe("system");
    });
  });

  it("navigates with the audit cursor", async () => {
    const user = userEvent.setup();
    fakeApi = createFakeApi([
      route("/audit-trail", (params) =>
        params.cursor === "AUD-2"
          ? {
              data: [
                auditEvent({
                  event_id: "invoice_created:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                  summary: "Second page event.",
                }),
              ],
              meta: { limit: 25, has_more: false, next_cursor: null },
            }
          : {
              data: [auditEvent()],
              meta: { limit: 25, has_more: true, next_cursor: "AUD-2" },
            },
      ),
    ]);
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Invoice INV-202608-00002 was posted.");

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(await screen.findByText("Second page event.")).toBeInTheDocument();
  });

  it("shows a valid empty state", async () => {
    fakeApi = createFakeApi(auditRoutes([]));
    renderWithProviders(<AuditTrailPage />);
    expect(
      await screen.findByText("No audit events match the current filters."),
    ).toBeInTheDocument();
  });

  it("shows a safe error state without backend internals", async () => {
    fakeApi = createFakeApi([
      route("/audit-trail", () => {
        throw new ApiError("INTERNAL_ERROR", "SELECT * FROM automation_audit_events failed", 500);
      }),
    ]);
    renderWithProviders(<AuditTrailPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Audit events could not be loaded.");
    expect(alert).not.toHaveTextContent(/SELECT|automation_audit_events/i);
  });
});

// ─── 32-37: Actor semantics, redaction, metadata bounds ─────────────────────

describe("Audit actor and metadata safety", () => {
  it("renders a bounded user actor without exposing an email", async () => {
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Invoice INV-202608-00002 was posted.");
    expect(screen.getByText("User aaaaaaaa")).toBeInTheDocument();
    expect(screen.queryByText(/fm@example\.com/)).toBeNull();
    expect(document.body.textContent).not.toContain("@example.com");
  });

  it("renders a system actor only when the stored type is system", async () => {
    fakeApi = createFakeApi(
      auditRoutes([
        auditEvent({
          event_id: "automation_event:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          actor: { type: "system", user_id: null, display_name: null, role: null },
          action: "automation_commands_insert",
          entity_type: "automation",
          summary: "Automation command was created.",
          metadata: { status: "pending" },
          source_kind: "automation_audit_event",
        }),
      ]),
    );
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Automation command was created.");
    // Scoped to the results table — the actor filter also offers these labels.
    expect(within(screen.getByRole("table")).getByText("System")).toBeInTheDocument();
  });

  it("keeps an unknown actor Unknown — never relabelled as System Automation", async () => {
    fakeApi = createFakeApi(
      auditRoutes([
        auditEvent({
          event_id: "reminder_created:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          actor: { type: "unknown", user_id: null, display_name: null, role: null },
          summary: "Reminder stage was evaluated for Invoice INV-1.",
        }),
      ]),
    );
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Reminder stage was evaluated for Invoice INV-1.");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByText(/System Automation/i)).toBeNull();
    // The row must not carry a system label anywhere.
    expect(table.queryByText("System")).toBeNull();

    // The pure presenter carries the same guarantee.
    expect(
      presentAuditActor({ type: "unknown", user_id: null, display_name: null, role: null }).label,
    ).toBe("Unknown");
  });

  it("shows a redaction notice instead of a sensitive value, including in title attributes", async () => {
    const user = userEvent.setup();
    fakeApi = createFakeApi(
      auditRoutes([
        auditEvent({
          event_id: "customer_changed:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          action: "field_changed",
          entity_type: "customer",
          entity_number: "C0001",
          result: null,
          summary: "Customer C0001 field contact_email changed.",
          metadata: {
            field_name: "contact_email",
            value_redacted: true,
            change_reason_redacted: true,
          },
          source_kind: "customer_change_log",
        }),
      ]),
    );
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Customer C0001 field contact_email changed.");
    await user.click(screen.getByRole("button", { name: "View" }));

    expect(
      await screen.findByText("Value changed — sensitive value hidden"),
    ).toBeInTheDocument();
    expect(screen.getByText(/change reason was recorded but is not shown/i)).toBeInTheDocument();
    // No value is rendered anywhere, including as a tooltip/title attribute.
    expect(document.querySelectorAll("[title]")).toHaveLength(0);
    expect(screen.queryByText(/Previous Value/)).toBeNull();
    expect(screen.queryByText(/New Value/)).toBeNull();
  });

  it("renders allow-listed metadata", async () => {
    const user = userEvent.setup();
    fakeApi = createFakeApi(
      auditRoutes([
        auditEvent({
          metadata: {
            document_type: "Invoice",
            status: "Posted",
          },
        }),
      ]),
    );
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Invoice INV-202608-00002 was posted.");
    await user.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText("Document Type")).toBeInTheDocument();
  });

  it("never dumps the raw metadata object", () => {
    const presented = presentAuditMetadata(
      auditEvent({
        metadata: { status: "Posted", unexpected_field: "leak" } as never,
        source_kind: "receipt",
      }),
    );
    expect(presented.rows.map((row) => row.key)).toEqual(["status"]);
  });
});

// ─── 38-39: Audit detail + no mutation ──────────────────────────────────────

describe("Audit detail", () => {
  it("opens a labelled detail dialog with the recorded evidence", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Invoice INV-202608-00002 was posted.");
    await user.click(screen.getByRole("button", { name: "View" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Posted · INV-202608-00002/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Close audit event detail/i })).toBeInTheDocument();
  });

  it("exposes no mutation control on the audit viewer", async () => {
    renderWithProviders(<AuditTrailPage />);
    await screen.findByText("Invoice INV-202608-00002 was posted.");
    for (const label of [/create/i, /edit/i, /delete/i, /^post$/i, /approve/i, /save/i]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(fakeApi.post).not.toHaveBeenCalled();
    expect(fakeApi.patch).not.toHaveBeenCalled();
    expect(fakeApi.del).not.toHaveBeenCalled();
  });
});

// ─── 40-43: Navigation regression ───────────────────────────────────────────

describe("role-sensitive navigation", () => {
  function navLabels() {
    return screen
      .getAllByRole("link")
      .map((link) => link.textContent?.trim() ?? "")
      .filter(Boolean);
  }

  it("shows both viewers to Finance Manager", () => {
    roles = ["Finance Manager"];
    renderWithProviders(<Sidebar />);
    expect(navLabels()).toEqual(expect.arrayContaining(["Journal Entries", "Audit Trail"]));
  });

  it("uses any permitted active role instead of only the highest role", () => {
    roles = ["System Admin", "Auditor"];
    renderWithProviders(<Sidebar />);
    expect(navLabels()).toEqual(expect.arrayContaining(["Journal Entries", "Audit Trail"]));
  });

  it("shows Journal Entries but hides Audit Trail for AR Supervisor", () => {
    roles = ["AR Supervisor"];
    renderWithProviders(<Sidebar />);
    const labels = navLabels();
    expect(labels).toContain("Journal Entries");
    expect(labels).not.toContain("Audit Trail");
  });

  it("hides both viewers from AR Clerk and System Admin", () => {
    for (const role of ["AR Clerk", "System Admin"]) {
      roles = [role];
      const { unmount } = renderWithProviders(<Sidebar />);
      const labels = navLabels();
      expect(labels).not.toContain("Journal Entries");
      expect(labels).not.toContain("Audit Trail");
      unmount();
    }
  });

  it("leaves Invoice, Receipt and other Settings navigation unaffected", () => {
    roles = ["AR Clerk"];
    renderWithProviders(<Sidebar />);
    const labels = navLabels();
    for (const expected of [
      "Dashboard",
      "Customers",
      "Invoices",
      "Credit Notes",
      "Receipts",
      "Allocation Wizard",
      "Automation",
      "Report Center",
      "Settings",
      "Roles",
    ]) {
      expect(labels).toContain(expected);
    }
  });
});

describe("strict Journal and Audit response contracts", () => {
  it("rejects monetary numbers and unknown Journal fields", () => {
    expect(() =>
      parseJournalList(
        [{ ...journalRow(), total_debit: 1234.56 }],
        { limit: 25, has_more: false, next_cursor: null },
      )
    ).toThrow(JournalAuditContractError);
    expect(() =>
      parseJournalList(
        [{ ...journalRow(), injected: true }],
        { limit: 25, has_more: false, next_cursor: null },
      )
    ).toThrow(JournalAuditContractError);
  });

  it("rejects inconsistent cursor metadata and incomplete Journal detail", () => {
    expect(() =>
      parseJournalList([journalRow()], {
        limit: 25,
        has_more: true,
        next_cursor: null,
      })
    ).toThrow(JournalAuditContractError);
    expect(() =>
      parseJournalDetail({ ...journalDetail(), lines: [journalDetail().lines[0]] })
    ).toThrow(JournalAuditContractError);
  });

  it("strict-parses list and detail through one normalized Audit event contract", () => {
    const event = auditEvent();
    expect(parseAuditEvent(event)).toEqual(event);
    expect(
      parseAuditList([event], { limit: 25, has_more: false, next_cursor: null }).rows[0],
    ).toEqual(event);
  });

  it("fails the Audit page closed when unexpected metadata arrives", async () => {
    fakeApi = createFakeApi([
      route("/audit-trail", () => ({
        data: [{
          ...auditEvent(),
          metadata: { status: "Posted", access_token: "never-render-this" },
        }],
        meta: { limit: 25, has_more: false, next_cursor: null },
      })),
    ]);
    renderWithProviders(<AuditTrailPage />);
    expect(await screen.findByText("Audit events could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("never-render-this")).toBeNull();
  });
});

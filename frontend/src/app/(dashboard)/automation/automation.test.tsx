// ============================================================================
// Gate E — Automation page/component tests. Exercises real pages + hooks
// against contract-shaped mocked responses through the useApi boundary.
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, fireEvent, renderHook } from "@testing-library/react";
import {
  createFakeApi,
  Providers,
  renderWithProviders,
  route,
  routePrefix,
  type FakeApi,
} from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";
import { useSyncMailbox } from "@/hooks/use-automation";

// ── Mocked boundaries ─────────────────────────────────────────────────────────
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
      capabilities: { is_read_only: false, is_system_admin_only: false },
      company: { id: CO, name: "Company One" },
      user: { id: USER, email: "fm@example.com" },
    },
    isLoading: false,
    isError: false,
  }),
}));

import AutomationOverviewPage from "./page";
import AutomationSettingsPage from "./settings/page";
import SalesRepresentativesPage from "./sales-representatives/page";
import MailboxesPage from "./mailboxes/page";
import ExceptionQueuePage from "./exceptions/page";
import AutomationCommandsPage from "./commands/page";

const CO = "10000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000003";
const REP_ID = "10000000-0000-4000-8000-000000000002";
const MB = "10000000-0000-4000-8000-000000000006";
const CMD = "10000000-0000-4000-8000-000000000011";
const RCPT = "10000000-0000-4000-8000-000000000012";
const IDS = { msg: "10000000-0000-4000-8000-000000000013", att: "10000000-0000-4000-8000-000000000009", ext: "10000000-0000-4000-8000-000000000010" };
const SHA = "a".repeat(64);

const SETTINGS = {
  company_id: CO,
  automation_actor_user_id: null,
  operating_mode: "disabled",
  mailbox_sync_enabled: false,
  document_intelligence_enabled: false,
  invoice_automation_enabled: false,
  receipt_automation_enabled: false,
  auto_allocation_enabled: false,
  reminder_evaluation_enabled: false,
  reminder_delivery_enabled: false,
  reminder_stage_offsets: [-3, 0],
  reminder_timezone: "UTC",
  extraction_schema_version: 1,
  minimum_overall_confidence: 0.95,
  minimum_critical_confidence: 0.99,
  created_at: null,
  updated_at: null,
  created_by: null,
  updated_by: null,
};

const OVERVIEW = {
  settings: SETTINGS,
  ingestion_ready: false,
  delivery_ready: false,
  document_intelligence_ready: false,
  connected_mailbox_count: 0,
  reconnect_required_mailbox_count: 0,
  last_successful_sync_at: null,
  last_failed_sync_at: null,
  processing_runs: 0,
  documents_processed: 0,
  accepted_documents: 0,
  rejected_documents: 0,
  invoices_created: 0,
  receipts_created: 0,
  allocations_completed: 0,
  reminders_evaluated: 0,
  reminders_sent: 0,
  open_exceptions: 0,
  retryable_exceptions: 0,
};

function repRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REP_ID,
    company_id: CO,
    name: "陈凯文 François",
    email: "rep@example.com",
    phone: "+60123456789",
    is_active: true,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    created_by: USER,
    updated_by: USER,
    ...overrides,
  };
}

function commandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CMD,
    command_type: "create_receipt",
    status: "completed",
    resulting_invoice_id: null,
    resulting_receipt_id: RCPT,
    failure_code: null,
    company_id: CO,
    mailbox_id: MB,
    message_id: IDS.msg,
    attachment_id: IDS.att,
    extraction_id: IDS.ext,
    operating_mode: "straight_through",
    schema_version: 1,
    idempotency_key: SHA,
    created_by: USER,
    created_at: "2026-07-31T00:00:00Z",
    completed_at: "2026-07-31T00:00:01Z",
    failed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  roles = ["Finance Manager"];
  useCompanyStore.getState().setCompany(CO, "Company One", "MYR");
});

describe("Automation Overview", () => {
  it("shows disabled mode and provider-not-configured truthfully", async () => {
    fakeApi = createFakeApi([route("/automation/overview", () => ({ data: OVERVIEW }))]);
    renderWithProviders(<AutomationOverviewPage />);
    expect((await screen.findAllByText("Disabled")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Provider Configuration Required/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/fail-closed/i)).toBeInTheDocument();
  });

  it("renders an error + retry when the overview fails to parse", async () => {
    fakeApi = createFakeApi([route("/automation/overview", () => ({ data: { bad: true } }))]);
    renderWithProviders(<AutomationOverviewPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});

describe("Automation Settings", () => {
  it("requires confirmation and sends the straight-through token", async () => {
    fakeApi = createFakeApi([route("/automation/settings", () => ({ data: SETTINGS }))]);
    fakeApi.patch.mockResolvedValue({ ...SETTINGS, operating_mode: "straight_through" });
    renderWithProviders(<AutomationSettingsPage />);
    await screen.findByRole("heading", { name: "Operating Mode" });
    fireEvent.click(screen.getByLabelText(/Straight-Through/i, { selector: "input" }));
    // A confirmation dialog appears; nothing is sent yet.
    expect(fakeApi.patch).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalled());
    const [, body] = fakeApi.patch.mock.calls[0];
    expect(body).toMatchObject({
      operating_mode: "straight_through",
      activation_confirmation: "ENABLE_STRAIGHT_THROUGH",
    });
  });

  it("is read-only for a non-editing role (Auditor)", async () => {
    roles = ["Auditor"];
    fakeApi = createFakeApi([route("/automation/settings", () => ({ data: SETTINGS }))]);
    renderWithProviders(<AutomationSettingsPage />);
    expect(await screen.findByText(/Read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enable|Disable/ })).toBeNull();
  });

  it("System Admin may configure but cannot arm a non-disabled mode", async () => {
    roles = ["System Admin"];
    fakeApi = createFakeApi([route("/automation/settings", () => ({ data: SETTINGS }))]);
    renderWithProviders(<AutomationSettingsPage />);
    await screen.findByRole("heading", { name: "Operating Mode" });
    // Non-disabled mode radios are disabled for System Admin…
    for (const label of [/Observe Only/i, /Draft Only/i, /Straight-Through/i]) {
      expect(screen.getByLabelText(label, { selector: "input" })).toBeDisabled();
    }
    // …clicking one opens no confirmation and sends nothing…
    fireEvent.click(screen.getByLabelText(/Draft Only/i, { selector: "input" }));
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(fakeApi.patch).not.toHaveBeenCalled();
    // …and the restriction is explained.
    expect(screen.getByText(/only a Finance Manager can arm/i)).toBeInTheDocument();
    // Kill switches remain editable for System Admin (configuration access).
    expect(screen.getAllByRole("button", { name: /Enable|Disable/ }).length).toBeGreaterThan(0);
  });
});

describe("Sales Representatives", () => {
  const listRoute = route("/automation/sales-representatives", () => ({
    data: [repRow()],
    meta: { page: 1, page_size: 25, total: 1, has_more: false },
  }));

  it("renders Unicode names and no login/password/role fields", async () => {
    fakeApi = createFakeApi([listRoute]);
    renderWithProviders(<SalesRepresentativesPage />);
    expect(await screen.findByText("陈凯文 François")).toBeInTheDocument();
    expect(screen.queryByText(/password/i)).toBeNull();
    expect(screen.queryByText(/\bRole\b/)).toBeNull();
  });

  it("rejects an active representative without an email before calling the API", async () => {
    fakeApi = createFakeApi([listRoute]);
    renderWithProviders(<SalesRepresentativesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Add Representative/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Rep" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/active representative must have an email/i)).toBeInTheDocument();
    expect(fakeApi.post).not.toHaveBeenCalled();
  });

  it("edits an existing representative (prefilled form → PATCH)", async () => {
    fakeApi = createFakeApi([listRoute]);
    fakeApi.patch.mockResolvedValue(repRow({ name: "陈凯文 Renamed" }));
    renderWithProviders(<SalesRepresentativesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i }));
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toContain("François"); // prefilled
    fireEvent.change(nameInput, { target: { value: "陈凯文 Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalled());
    const [path, body] = fakeApi.patch.mock.calls[0];
    expect(path).toContain(`/sales-representatives/${REP_ID}`);
    expect(body).toMatchObject({ name: "陈凯文 Renamed" });
  });
});

describe("Mailboxes", () => {
  it("renders both providers, shows configured state, and never shows secret names/tokens", async () => {
    fakeApi = createFakeApi([
      route("/automation/mailboxes", () => ({
        data: [
          {
            id: MB,
            company_id: CO,
            provider_type: "gmail",
            mailbox_address: "ar@example.com",
            default_bank_account_id: null,
            connection_status: "disabled",
            ingestion_secret_configured: true,
            delivery_secret_configured: false,
            ingestion_token_expires_at: null,
            delivery_token_expires_at: null,
            cursor_kind: null,
            cursor_present: false,
            last_successful_sync_at: null,
            last_failed_sync_at: null,
            reconnect_required: false,
            is_enabled: false,
            ingestion_enabled: false,
            delivery_enabled: false,
            redacted_error_code: null,
            created_at: "2026-07-31T00:00:00Z",
            updated_at: "2026-07-31T00:00:00Z",
          },
        ],
        meta: { page: 1, page_size: 50, total: 1, has_more: false },
      })),
    ]);
    renderWithProviders(<MailboxesPage />);
    expect(await screen.findByText("ar@example.com")).toBeInTheDocument();
    expect(screen.getAllByText(/Gmail \/ Google Workspace/).length).toBeGreaterThan(0);
    // Configured booleans are shown; secret NAMES and tokens are never rendered.
    expect(screen.getAllByText(/Configured/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/AR_ING|AR_MAILBOX/)).toBeNull();
    expect(screen.queryByText(/ya29|refresh/i)).toBeNull();
  });
});

describe("Exception Queue", () => {
  it("requires a note before resolving", async () => {
    fakeApi = createFakeApi([
      routePrefix("/automation/exceptions", () => ({
        data: [
          {
            id: "10000000-0000-4000-8000-000000000014",
            company_id: CO,
            mailbox_id: null,
            sync_run_id: null,
            message_id: null,
            attachment_id: null,
            command_id: null,
            invoice_id: null,
            receipt_id: null,
            reason_code: "low_confidence",
            idempotency_key: null,
            lifecycle_status: "open",
            safe_details: { error_code: "LOW_CONFIDENCE" },
            retry_count: 0,
            max_retries: 3,
            actor_user_id: null,
            resolution_note: null,
            opened_at: "2026-07-31T00:00:00Z",
            resolved_at: null,
            dismissed_at: null,
            created_at: "2026-07-31T00:00:00Z",
            updated_at: "2026-07-31T00:00:00Z",
          },
        ],
        meta: { page: 1, page_size: 15, total: 1, has_more: false },
      })),
    ]);
    renderWithProviders(<ExceptionQueuePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    // No note → the resolve mutation is never called.
    await waitFor(() => expect(fakeApi.post).not.toHaveBeenCalled());
  });
});

describe("mutation response parsing", () => {
  const SYNC_RUN = {
    id: "10000000-0000-4000-8000-000000000020",
    company_id: CO,
    mailbox_id: MB,
    provider_type: "gmail",
    status: "completed",
    cursor_before: "[redacted]",
    cursor_after: "[redacted]",
    started_at: "2026-07-31T00:00:00Z",
    completed_at: "2026-07-31T00:00:05Z",
    failed_at: null,
    messages_discovered: 1,
    messages_persisted: 1,
    attachments_discovered: 1,
    attachments_persisted: 1,
    duplicate_messages: 0,
    duplicate_attachments: 0,
    attachments_processed: 1,
    commands_processed: 0,
    allocations_completed: 0,
    failures: 0,
    attempt_count: 1,
    max_attempts: 3,
    redacted_error_code: null,
    created_at: "2026-07-31T00:00:00Z",
  };

  it("parses the manual mailbox-sync run (no longer an opaque unknown)", async () => {
    fakeApi = createFakeApi([]);
    fakeApi.post.mockResolvedValue(SYNC_RUN);
    const { result } = renderHook(() => useSyncMailbox(), { wrapper: Providers });
    const run = await result.current.mutateAsync(MB);
    expect(run.status).toBe("completed");
    expect(run.attachments_persisted).toBe(1);
  });

  it("rejects a malformed manual-sync response (fails closed)", async () => {
    fakeApi = createFakeApi([]);
    fakeApi.post.mockResolvedValue({ not: "a-run" });
    const { result } = renderHook(() => useSyncMailbox(), { wrapper: Providers });
    await expect(result.current.mutateAsync(MB)).rejects.toBeTruthy();
  });
});

describe("Automation Commands — allocation eligibility", () => {
  it("offers allocation for an eligible completed create_receipt and posts exactly {}", async () => {
    fakeApi = createFakeApi([
      route("/automation/commands", () => ({
        data: [commandRow()],
        meta: { page: 1, page_size: 15, total: 1, has_more: false },
      })),
    ]);
    fakeApi.post.mockResolvedValue({
      command_id: CMD,
      receipt_id: RCPT,
      allocated_count: 1,
      total_allocated: "100.00",
      receipt_status: "Fully Allocated",
    });
    renderWithProviders(<AutomationCommandsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Run allocation/i }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalled());
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toContain("/allocate");
    expect(body).toEqual({});
  });

  it("does NOT offer allocation for an ineligible command (allocate_receipt / proposed)", async () => {
    fakeApi = createFakeApi([
      route("/automation/commands", () => ({
        data: [
          commandRow({
            command_type: "allocate_receipt",
            status: "proposed",
            resulting_receipt_id: null,
            completed_at: null,
          }),
        ],
        meta: { page: 1, page_size: 15, total: 1, has_more: false },
      })),
    ]);
    renderWithProviders(<AutomationCommandsPage />);
    await screen.findByText(/Allocate Receipt/i);
    expect(screen.queryByRole("button", { name: /Run allocation/i })).toBeNull();
  });
});

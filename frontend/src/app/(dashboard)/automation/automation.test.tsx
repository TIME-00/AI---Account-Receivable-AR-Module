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
      route("/bank-accounts", () => ({ data: [] })),
    ]);
    renderWithProviders(<MailboxesPage />);
    expect(await screen.findByText("ar@example.com")).toBeInTheDocument();
    expect(screen.getAllByText(/Gmail \/ Google Workspace/).length).toBeGreaterThan(0);
    // Configured booleans are shown; secret NAMES and tokens are never rendered.
    expect(screen.getAllByText(/Configured/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/AR_ING|AR_MAILBOX/)).toBeNull();
    expect(screen.queryByText(/ya29|refresh/i)).toBeNull();
  });

  // ── Atomic ingestion activation ────────────────────────────────────────────
  // Backend v14 supports refresh-on-enable behind ONE mailbox PATCH. The
  // frontend must therefore drive ingestion activation as a single atomic
  // mutation that always sets is_enabled and ingestion_enabled together, never a
  // separate generic mailbox master switch and never a half-enabled state.
  function connectedMailbox(overrides: Record<string, unknown> = {}) {
    return {
      id: MB,
      company_id: CO,
      provider_type: "gmail",
      mailbox_address: "ar@example.com",
      default_bank_account_id: null,
      connection_status: "connected",
      ingestion_secret_configured: true,
      delivery_secret_configured: false,
      ingestion_token_expires_at: "2026-08-01T00:00:00Z",
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
      ...overrides,
    };
  }

  const BANK_ACTIVE_1 = "10000000-0000-4000-8000-000000000301";
  const BANK_ACTIVE_2 = "10000000-0000-4000-8000-000000000302";
  const BANK_INACTIVE = "10000000-0000-4000-8000-000000000303";

  function bankAccount(overrides: Record<string, unknown> = {}) {
    return {
      id: BANK_ACTIVE_1,
      company_id: CO,
      bank_name: "Maybank",
      account_no: "1234567890",
      account_name: "TSH Synergy Operating",
      swift_code: null,
      currency: "MYR",
      gl_account_id: null,
      is_active: true,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      ...overrides,
    };
  }

  const BANK_ACCOUNTS = [
    bankAccount(),
    bankAccount({ id: BANK_ACTIVE_2, bank_name: "CIMB", account_name: "TSH Synergy Collections", account_no: "9876543210", currency: "MYR" }),
    bankAccount({ id: BANK_INACTIVE, bank_name: "Legacy Bank", account_name: "Closed Account", account_no: "5555000011", is_active: false }),
  ];

  function mountMailboxes(
    row: Record<string, unknown>,
    banks: Record<string, unknown>[] = BANK_ACCOUNTS,
  ) {
    fakeApi = createFakeApi([
      route("/automation/mailboxes", () => ({
        data: [row],
        meta: { page: 1, page_size: 50, total: 1, has_more: false },
      })),
      route("/bank-accounts", () => ({ data: banks })),
    ]);
    renderWithProviders(<MailboxesPage />);
  }

  it("connected+disabled mailbox shows a single 'Enable ingestion' control, not a generic Enable", async () => {
    mountMailboxes(connectedMailbox());
    // The one ingestion activation control.
    expect(await screen.findByRole("button", { name: "Enable ingestion" })).toBeInTheDocument();
    // The removed generic mailbox master switch must not exist (exact Enable/Disable).
    expect(screen.queryByRole("button", { name: /^(Enable|Disable)$/ })).toBeNull();
    // OAuth connect controls and the independent delivery control remain.
    expect(screen.getByRole("button", { name: "Connect ingestion" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect delivery" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable delivery" })).toBeInTheDocument();
  });

  it("enabling ingestion sends exactly one atomic PATCH { is_enabled, ingestion_enabled }", async () => {
    mountMailboxes(connectedMailbox());
    fakeApi.patch.mockResolvedValue(
      connectedMailbox({ is_enabled: true, ingestion_enabled: true }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Enable ingestion" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalledTimes(1));
    const [path, body] = fakeApi.patch.mock.calls[0];
    expect(path).toBe(`/automation/mailboxes/${MB}`);
    // Exact atomic enable payload — both fields, nothing else (no delivery, no
    // secret refs, no operating mode).
    expect(body).toEqual({ is_enabled: true, ingestion_enabled: true });
    expect(fakeApi.patch).toHaveBeenCalledTimes(1);
  });

  it("enabled ingestion shows 'Disable ingestion' and disabling sends one atomic PATCH of both false", async () => {
    mountMailboxes(connectedMailbox({ is_enabled: true, ingestion_enabled: true }));
    fakeApi.patch.mockResolvedValue(
      connectedMailbox({ is_enabled: false, ingestion_enabled: false }),
    );
    const disable = await screen.findByRole("button", { name: "Disable ingestion" });
    expect(screen.queryByRole("button", { name: /^(Enable|Disable)$/ })).toBeNull();
    fireEvent.click(disable);
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalledTimes(1));
    const [path, body] = fakeApi.patch.mock.calls[0];
    expect(path).toBe(`/automation/mailboxes/${MB}`);
    expect(body).toEqual({ is_enabled: false, ingestion_enabled: false });
  });

  it("prevents duplicate activation submissions while the ingestion PATCH is pending", async () => {
    mountMailboxes(connectedMailbox());
    // Never resolves: the mutation stays pending, so the control stays disabled.
    fakeApi.patch.mockReturnValue(new Promise(() => {}));
    const enable = await screen.findByRole("button", { name: "Enable ingestion" });
    fireEvent.click(enable);
    await waitFor(() => expect(enable).toBeDisabled());
    // Further clicks on the disabled control must not queue more mutations.
    fireEvent.click(enable);
    fireEvent.click(enable);
    expect(fakeApi.patch).toHaveBeenCalledTimes(1);
  });

  it("keeps delivery activation independent — it never mutates the ingestion fields", async () => {
    mountMailboxes(connectedMailbox({ delivery_secret_configured: true }));
    fakeApi.patch.mockResolvedValue(
      connectedMailbox({ delivery_secret_configured: true, delivery_enabled: true }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Enable delivery" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalledTimes(1));
    const [, body] = fakeApi.patch.mock.calls[0];
    expect(body).toEqual({ delivery_enabled: true });
    expect(body).not.toHaveProperty("is_enabled");
    expect(body).not.toHaveProperty("ingestion_enabled");
  });

  // ── Default receiving bank account mapping (Draft Receipt prerequisite) ──────
  it("offers only ACTIVE company bank accounts in the default-receiving-bank selector", async () => {
    mountMailboxes(connectedMailbox());
    const select = await screen.findByLabelText("Default receiving bank account");
    // Active accounts appear (masked, never the full number).
    expect(screen.getByRole("option", { name: /Maybank.*ending 7890.*MYR/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /CIMB.*ending 3210/ })).toBeInTheDocument();
    // Inactive account is not offered.
    expect(screen.queryByRole("option", { name: /Legacy Bank|Closed Account/ })).toBeNull();
    // Full account numbers are never rendered.
    expect(screen.queryByText(/1234567890|9876543210/)).toBeNull();
    expect(select).toHaveValue("");
  });

  it("reflects the mailbox's existing default account as the current selection", async () => {
    mountMailboxes(connectedMailbox({ default_bank_account_id: BANK_ACTIVE_2 }));
    const select = await screen.findByLabelText("Default receiving bank account");
    expect(select).toHaveValue(BANK_ACTIVE_2);
  });

  it("saves with exactly one PATCH carrying only default_bank_account_id", async () => {
    mountMailboxes(connectedMailbox());
    fakeApi.patch.mockResolvedValue(
      connectedMailbox({ default_bank_account_id: BANK_ACTIVE_1 }),
    );
    const select = await screen.findByLabelText("Default receiving bank account");
    fireEvent.change(select, { target: { value: BANK_ACTIVE_1 } });
    fireEvent.click(screen.getByRole("button", { name: "Save bank account" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalledTimes(1));
    const [path, body] = fakeApi.patch.mock.calls[0];
    expect(path).toBe(`/automation/mailboxes/${MB}`);
    expect(body).toEqual({ default_bank_account_id: BANK_ACTIVE_1 });
    // No ingestion/delivery/settings/OAuth state is coupled to the bank save.
    for (
      const forbidden of [
        "is_enabled",
        "ingestion_enabled",
        "delivery_enabled",
        "ingestion_secret_ref",
        "delivery_secret_ref",
        "operating_mode",
      ]
    ) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("clears the mapping with an exact { default_bank_account_id: null } PATCH", async () => {
    mountMailboxes(connectedMailbox({ default_bank_account_id: BANK_ACTIVE_1 }));
    fakeApi.patch.mockResolvedValue(connectedMailbox({ default_bank_account_id: null }));
    const select = await screen.findByLabelText("Default receiving bank account");
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bank account" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalledTimes(1));
    const [, body] = fakeApi.patch.mock.calls[0];
    expect(body).toEqual({ default_bank_account_id: null });
  });

  it("prevents duplicate bank-account save while pending and disables save when unchanged", async () => {
    mountMailboxes(connectedMailbox());
    const save = await screen.findByRole("button", { name: "Save bank account" });
    // No change yet → save is disabled.
    expect(save).toBeDisabled();
    fakeApi.patch.mockReturnValue(new Promise(() => {}));
    const select = screen.getByLabelText("Default receiving bank account");
    fireEvent.change(select, { target: { value: BANK_ACTIVE_1 } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    fireEvent.click(save);
    fireEvent.click(save);
    expect(fakeApi.patch).toHaveBeenCalledTimes(1);
  });

  it("does not render the bank-account control for an unauthorized read-only role", async () => {
    roles = ["Auditor"];
    mountMailboxes(connectedMailbox());
    expect(await screen.findByText("ar@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("Default receiving bank account")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save bank account" })).toBeNull();
  });
});

describe("Production PostgreSQL UUID identifiers render through page + hook paths", () => {
  // The real Production company identifier is a canonical PostgreSQL uuid whose
  // version/variant nibbles are 0. It is a valid uuid but was rejected by the
  // previous RFC-version-specific mirror, which blanked the Overview, Settings,
  // and Mailboxes pages with the fail-closed parse-error alert. These tests
  // drive the actual pages + hooks so a regression re-blanks them immediately.
  const PROD_CO = "00000000-0000-0000-0000-000000000001";
  const PROD_MB = "00000000-0000-0000-0000-000000000006";
  const prodSettings = { ...SETTINGS, company_id: PROD_CO };

  beforeEach(() => {
    useCompanyStore.getState().setCompany(PROD_CO, "Production Company", "MYR");
  });

  it("Overview page parses and renders a Production-UUID-scoped overview", async () => {
    fakeApi = createFakeApi([
      route("/automation/overview", () => ({
        data: { ...OVERVIEW, settings: prodSettings },
      })),
    ]);
    renderWithProviders(<AutomationOverviewPage />);
    expect((await screen.findAllByText("Disabled")).length).toBeGreaterThan(0);
    // Fail-closed proof: the parse-error alert must NOT appear for a valid uuid.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Settings page parses and renders Production-UUID-scoped settings", async () => {
    fakeApi = createFakeApi([route("/automation/settings", () => ({ data: prodSettings }))]);
    renderWithProviders(<AutomationSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Operating Mode" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Mailboxes page parses and renders a Production-UUID-scoped mailbox", async () => {
    fakeApi = createFakeApi([
      route("/automation/mailboxes", () => ({
        data: [
          {
            id: PROD_MB,
            company_id: PROD_CO,
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
      route("/bank-accounts", () => ({ data: [] })),
    ]);
    renderWithProviders(<MailboxesPage />);
    expect(await screen.findByText("ar@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
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
            document: null,
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

// ── Automation v15 Exceptions monitoring + Retry (retained Observe-Only rows) ──
describe("Exceptions v15 monitoring + Retry", () => {
  const EXC_INV = "10000000-0000-4000-8000-000000000201";
  const EXC_RCPT = "10000000-0000-4000-8000-000000000202";
  const EXC_UNSUP = "10000000-0000-4000-8000-000000000203";

  function exceptionRow(overrides: Record<string, unknown> = {}) {
    return {
      id: EXC_INV,
      company_id: CO,
      mailbox_id: MB,
      sync_run_id: null,
      message_id: null,
      attachment_id: "10000000-0000-4000-8000-000000000091",
      command_id: null,
      invoice_id: null,
      receipt_id: null,
      reason_code: "internal_processing_failure",
      idempotency_key: null,
      lifecycle_status: "retryable",
      safe_details: { error_code: "INTERNAL_PROCESSING_FAILURE" },
      retry_count: 0,
      max_retries: 3,
      actor_user_id: null,
      resolution_note: null,
      document: null,
      opened_at: "2026-08-09T00:00:00Z",
      resolved_at: null,
      dismissed_at: null,
      created_at: "2026-08-09T00:00:00Z",
      updated_at: "2026-08-09T00:00:00Z",
      ...overrides,
    };
  }

  const retainedInvoice = exceptionRow({
    id: EXC_INV,
    document: {
      file_name: "gate-e-observe-invoice-20260809.png",
      document_type: "invoice",
      processing_status: "processed",
      classification_status: "accepted",
      manual_review_required: true,
    },
  });
  const retainedReceipt = exceptionRow({
    id: EXC_RCPT,
    document: {
      file_name: "gate-e-observe-receipt-20260809.png",
      document_type: "receipt",
      processing_status: "processed",
      classification_status: "accepted",
      manual_review_required: true,
    },
  });
  const unsupported = exceptionRow({
    id: EXC_UNSUP,
    reason_code: "unsupported_document",
    lifecycle_status: "open",
    document: {
      file_name: "gate-e-observe-unsupported-20260809.png",
      document_type: "unsupported",
      processing_status: "processed",
      classification_status: "rejected",
      manual_review_required: true,
    },
  });

  function mountExceptions(rows: Record<string, unknown>[]) {
    fakeApi = createFakeApi([
      routePrefix("/automation/exceptions", () => ({
        data: rows,
        meta: { page: 1, page_size: 15, total: rows.length, has_more: false },
      })),
    ]);
    renderWithProviders(<ExceptionQueuePage />);
  }

  it("renders v15 document identity, type, status, reason, and review for each retained row", async () => {
    mountExceptions([retainedInvoice, retainedReceipt, unsupported]);
    // File identity is visible for each problem document.
    expect(await screen.findByText("gate-e-observe-invoice-20260809.png")).toBeInTheDocument();
    expect(screen.getByText("gate-e-observe-receipt-20260809.png")).toBeInTheDocument();
    expect(screen.getByText("gate-e-observe-unsupported-20260809.png")).toBeInTheDocument();
    // Type badges.
    expect(screen.getAllByText("Invoice").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Receipt").length).toBeGreaterThan(0);
    expect(screen.getByText("Unsupported")).toBeInTheDocument();
    // Status (processing + classification) visible.
    expect(screen.getAllByText("Processed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Accepted").length).toBeGreaterThan(0);
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    // Humanized reason (not the raw code).
    expect(screen.getAllByText(/Internal processing failure/i).length).toBeGreaterThan(0);
    // Review requirement visible.
    expect(screen.getAllByText("Manual review required").length).toBe(3);
  });

  it("shows 'No linked document' when document is null and never leaks raw payloads", async () => {
    mountExceptions([exceptionRow({ document: null })]);
    expect(await screen.findByText("No linked document")).toBeInTheDocument();
    // No raw extraction/provider JSON leaks into the DOM.
    expect(screen.queryByText(/extracted_fields|access_token|ya29|provider_body/i)).toBeNull();
  });

  it("sends exactly one Retry POST for a retryable retained row and prevents duplicates while pending", async () => {
    mountExceptions([retainedInvoice]);
    // Never resolves so the pending state persists.
    fakeApi.post.mockReturnValue(new Promise(() => {}));
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toBeDisabled());
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(fakeApi.post).toHaveBeenCalledTimes(1);
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toBe(`/automation/exceptions/${EXC_INV}/retry`);
    // Retry carries no financial/OpenAI authority from the frontend.
    expect(body).toBeUndefined();
  });

  it("does not offer Retry for a resolved row and never marks it review-required", async () => {
    mountExceptions([
      exceptionRow({
        lifecycle_status: "resolved",
        resolved_at: "2026-08-09T01:00:00Z",
        resolution_note: "Handled.",
        document: {
          file_name: "gate-e-observe-invoice-20260809.png",
          document_type: "invoice",
          processing_status: "processed",
          classification_status: "accepted",
          manual_review_required: false,
        },
      }),
    ]);
    expect(await screen.findByText("gate-e-observe-invoice-20260809.png")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("No manual review required")).toBeInTheDocument();
    expect(screen.queryByText("Manual review required")).toBeNull();
  });

  it("does not auto-retry on load", async () => {
    mountExceptions([retainedInvoice, retainedReceipt]);
    await screen.findByText("gate-e-observe-invoice-20260809.png");
    expect(fakeApi.post).not.toHaveBeenCalled();
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

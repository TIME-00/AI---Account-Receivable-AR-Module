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
import { ApiError } from "@/hooks/use-api";

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
  reminder_mode: "off",
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
    expect(screen.getByText(/Automation operating mode is/i)).toHaveTextContent(
      /Mailbox ingestion is not ready; document intelligence is not ready; and reminder-email delivery is not ready/i,
    );
  });

  it("reports live Draft-only readiness without the stale inactive-provider warning", async () => {
    const draftOverview = {
      ...OVERVIEW,
      settings: {
        ...SETTINGS,
        operating_mode: "draft_only",
        mailbox_sync_enabled: true,
        document_intelligence_enabled: true,
        invoice_automation_enabled: true,
        receipt_automation_enabled: true,
      },
      ingestion_ready: true,
      document_intelligence_ready: true,
      delivery_ready: false,
      connected_mailbox_count: 1,
      last_successful_sync_at: "2026-08-10T10:40:00Z",
    };
    fakeApi = createFakeApi([
      route("/automation/overview", () => ({ data: draftOverview })),
    ]);
    renderWithProviders(<AutomationOverviewPage />);

    const status = await screen.findByText(/Automation operating mode is/i);
    expect(status).toHaveTextContent(/Draft Only/i);
    expect(status).toHaveTextContent(
      /Mailbox ingestion is ready; document intelligence is ready; and reminder-email delivery is not ready/i,
    );
    expect(status).toHaveTextContent(/Straight-Through is not active/i);
    expect(status).not.toHaveTextContent(/No real document-intelligence provider/i);
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
    expect(screen.getAllByText(/only a Finance Manager can arm/i).length)
      .toBeGreaterThan(0);
    // Capabilities are read-only for everyone now: no Enable/Disable controls.
    expect(screen.queryByRole("button", { name: /^(Enable|Disable)$/ })).toBeNull();
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
            delivery_reconnect_required: false,
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
      delivery_reconnect_required: false,
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
    // Ingestion OAuth connect remains; Delivery is now a single governed action
    // and no longer exposes a separate "Connect delivery" control.
    expect(screen.getByRole("button", { name: "Connect ingestion" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect delivery" })).toBeNull();
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

  it("keeps delivery activation independent — it never PATCHes the ingestion fields", async () => {
    mountMailboxes(connectedMailbox({ delivery_secret_configured: true }));
    fakeApi.post.mockResolvedValue({
      outcome: "enabled",
      mailbox: connectedMailbox({
        delivery_secret_configured: true,
        delivery_enabled: true,
        delivery_token_expires_at: "2026-09-01T00:00:00Z",
      }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Enable delivery" }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalledTimes(1));
    // Delivery is a governed POST — never a mailbox PATCH, so no ingestion or
    // master-switch field can ride along with it.
    expect(fakeApi.patch).not.toHaveBeenCalled();
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toBe(`/automation/mailboxes/${MB}/delivery/enable`);
    expect(body).toEqual({});
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

// ============================================================================
// Post-Gate-E — governed one-action mailbox Delivery onboarding.
//
// Delivery activation authority lives ENTIRELY on the server. The page offers
// exactly one Delivery control derived from authoritative mailbox state, calls
// one governed endpoint with an exact `{}` body, navigates only to a
// re-validated provider URL, and never PATCHes `delivery_enabled` or infers
// activation from a callback query parameter.
// ============================================================================

describe("Mailboxes — governed Delivery onboarding", () => {
  const DELIVERY_MB = MB;
  const AUTH_URL =
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=gmail.send";

  function deliveryMailbox(overrides: Record<string, unknown> = {}) {
    return {
      id: DELIVERY_MB,
      company_id: CO,
      provider_type: "gmail",
      mailbox_address: "ar@example.com",
      default_bank_account_id: null,
      connection_status: "connected",
      ingestion_secret_configured: true,
      delivery_secret_configured: false,
      ingestion_token_expires_at: "2026-09-01T00:00:00Z",
      delivery_token_expires_at: null,
      cursor_kind: null,
      cursor_present: false,
      last_successful_sync_at: null,
      last_failed_sync_at: null,
      reconnect_required: false,
      delivery_reconnect_required: false,
      is_enabled: true,
      ingestion_enabled: true,
      delivery_enabled: false,
      redacted_error_code: null,
      created_at: "2026-07-31T00:00:00Z",
      updated_at: "2026-07-31T00:00:00Z",
      ...overrides,
    };
  }

  /** Delivery configured, healthy and enabled — the steady operating state. */
  const ENABLED = deliveryMailbox({
    delivery_secret_configured: true,
    delivery_token_expires_at: "2026-09-01T00:00:00Z",
    delivery_enabled: true,
  });
  /** Disabled, but the stored credential is retained and still current. */
  const DISABLED_WITH_CREDENTIAL = deliveryMailbox({
    delivery_secret_configured: true,
    delivery_token_expires_at: "2026-09-01T00:00:00Z",
    delivery_enabled: false,
  });
  /** Never authorized: no credential was ever provisioned for delivery. */
  const NEVER_AUTHORIZED = deliveryMailbox();
  /** Credential revoked/expired server-side — send authority must be redone. */
  const RECONNECT_REQUIRED = deliveryMailbox({
    delivery_secret_configured: true,
    delivery_token_expires_at: "2026-09-01T00:00:00Z",
    delivery_enabled: false,
    delivery_reconnect_required: true,
  });

  let mailboxGets = 0;

  function mount(row: Record<string, unknown>) {
    mailboxGets = 0;
    fakeApi = createFakeApi([
      route("/automation/mailboxes", () => {
        mailboxGets += 1;
        return {
          data: [row],
          meta: { page: 1, page_size: 50, total: 1, has_more: false },
        };
      }),
      route("/bank-accounts", () => ({ data: [] })),
    ]);
    renderWithProviders(<MailboxesPage />);
  }

  const assignSpy = vi.fn();

  beforeEach(() => {
    assignSpy.mockClear();
    // jsdom's `location.assign` is not implemented; replace it so a same-tab
    // OAuth navigation is observable instead of throwing.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        assign: assignSpy,
        search: "",
        pathname: "/automation/mailboxes",
        hash: "",
      },
    });
  });

  // ── Control derivation from authoritative state ────────────────────────────

  it("configured + enabled delivery shows only 'Disable delivery' and never a Connect delivery control", async () => {
    mount(ENABLED);
    expect(
      await screen.findByRole("button", { name: "Disable delivery" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect delivery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enable delivery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect delivery" })).toBeNull();
  });

  it("disabled delivery with a current credential offers 'Enable delivery' (the server decides if consent is needed)", async () => {
    mount(DISABLED_WITH_CREDENTIAL);
    expect(
      await screen.findByRole("button", { name: "Enable delivery" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable delivery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect delivery" })).toBeNull();
  });

  it("a never-authorized mailbox still offers 'Enable delivery', not a separate connect step", async () => {
    mount(NEVER_AUTHORIZED);
    expect(
      await screen.findByRole("button", { name: "Enable delivery" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect delivery" })).toBeNull();
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("delivery_reconnect_required shows 'Reconnect delivery' and nothing else", async () => {
    mount(RECONNECT_REQUIRED);
    expect(
      await screen.findByRole("button", { name: "Reconnect delivery" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable delivery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disable delivery" })).toBeNull();
    // Delivery reconnect health is reported separately from ingestion health.
    expect(screen.getByText("Delivery reconnect")).toBeInTheDocument();
    expect(screen.getByText("Ingestion reconnect")).toBeInTheDocument();
  });

  // ── Governed endpoints and exact payloads ──────────────────────────────────

  it("Enable delivery calls the governed enable endpoint with an exact {} payload", async () => {
    mount(DISABLED_WITH_CREDENTIAL);
    fakeApi.post.mockResolvedValue({ outcome: "enabled", mailbox: ENABLED });
    fireEvent.click(await screen.findByRole("button", { name: "Enable delivery" }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalledTimes(1));
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toBe(`/automation/mailboxes/${DELIVERY_MB}/delivery/enable`);
    expect(body).toEqual({});
    expect(Object.keys(body as object)).toHaveLength(0);
    expect(fakeApi.patch).not.toHaveBeenCalled();
  });

  it("Reconnect delivery calls the governed reconnect endpoint with an exact {} payload", async () => {
    mount(RECONNECT_REQUIRED);
    fakeApi.post.mockResolvedValue({
      outcome: "oauth_required",
      provider: "gmail",
      authorization_url: AUTH_URL,
      expires_at: "2026-08-11T00:10:00Z",
      capability: "delivery",
      intent: "reconnect_delivery",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect delivery" }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalledTimes(1));
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toBe(`/automation/mailboxes/${DELIVERY_MB}/delivery/reconnect`);
    expect(body).toEqual({});
    expect(fakeApi.patch).not.toHaveBeenCalled();
  });

  it("Disable delivery calls the governed disable endpoint with an exact {} payload", async () => {
    mount(ENABLED);
    fakeApi.post.mockResolvedValue(DISABLED_WITH_CREDENTIAL);
    fireEvent.click(await screen.findByRole("button", { name: "Disable delivery" }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalledTimes(1));
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toBe(`/automation/mailboxes/${DELIVERY_MB}/delivery/disable`);
    expect(body).toEqual({});
    expect(fakeApi.patch).not.toHaveBeenCalled();
  });

  // ── Result handling ────────────────────────────────────────────────────────

  it("an 'enabled' result reports success and re-reads authoritative mailbox state", async () => {
    mount(DISABLED_WITH_CREDENTIAL);
    fakeApi.post.mockResolvedValue({ outcome: "enabled", mailbox: ENABLED });
    const before = mailboxGets;
    fireEvent.click(await screen.findByRole("button", { name: "Enable delivery" }));
    await waitFor(() => expect(mailboxGets).toBeGreaterThan(before));
    // No provider navigation happens when the server enabled directly.
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("an 'oauth_required' result navigates to the strictly validated provider URL only", async () => {
    mount(NEVER_AUTHORIZED);
    fakeApi.post.mockResolvedValue({
      outcome: "oauth_required",
      provider: "gmail",
      authorization_url: AUTH_URL,
      expires_at: "2026-08-11T00:10:00Z",
      capability: "delivery",
      intent: "enable_delivery",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Enable delivery" }));
    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1));
    expect(assignSpy).toHaveBeenCalledWith(AUTH_URL);
  });

  it("refuses to navigate to a non-allowlisted authorization URL", async () => {
    mount(NEVER_AUTHORIZED);
    fakeApi.post.mockResolvedValue({
      outcome: "oauth_required",
      provider: "gmail",
      authorization_url: "https://evil.example.test/o/oauth2/v2/auth?client_id=x",
      expires_at: "2026-08-11T00:10:00Z",
      capability: "delivery",
      intent: "enable_delivery",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Enable delivery" }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(assignSpy).not.toHaveBeenCalled());
  });

  it("fails closed when the delivery result drifts from the strict union", async () => {
    mount(DISABLED_WITH_CREDENTIAL);
    // A plausible-looking but contract-violating shape must not be treated as
    // an activation.
    fakeApi.post.mockResolvedValue({ outcome: "enabled", delivery_enabled: true });
    fireEvent.click(await screen.findByRole("button", { name: "Enable delivery" }));
    await waitFor(() =>
      expect(
        screen.getByText(/last delivery action did not complete/i),
      ).toBeInTheDocument(),
    );
    expect(assignSpy).not.toHaveBeenCalled();
  });

  // ── Duplicate-click protection and honest pending state ────────────────────

  it("prevents duplicate Enable submissions while the governed call is pending", async () => {
    mount(DISABLED_WITH_CREDENTIAL);
    fakeApi.post.mockReturnValue(new Promise(() => {}));
    const enable = await screen.findByRole("button", { name: "Enable delivery" });
    fireEvent.click(enable);
    await waitFor(() => expect(enable).toBeDisabled());
    expect(enable).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/in progress/i);
    fireEvent.click(enable);
    fireEvent.click(enable);
    expect(fakeApi.post).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate Reconnect and Disable submissions while pending", async () => {
    mount(RECONNECT_REQUIRED);
    fakeApi.post.mockReturnValue(new Promise(() => {}));
    const reconnect = await screen.findByRole("button", {
      name: "Reconnect delivery",
    });
    fireEvent.click(reconnect);
    await waitFor(() => expect(reconnect).toBeDisabled());
    fireEvent.click(reconnect);
    expect(fakeApi.post).toHaveBeenCalledTimes(1);
  });

  it("reports an honest failure state when the governed call is rejected", async () => {
    mount(DISABLED_WITH_CREDENTIAL);
    fakeApi.post.mockRejectedValue(
      new ApiError("OAUTH_NOT_CONFIGURED", "Provider is not provisioned.", 503),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Enable delivery" }));
    await waitFor(() =>
      expect(
        screen.getByText(/last delivery action did not complete/i),
      ).toBeInTheDocument(),
    );
    // The control stays offered — nothing was optimistically flipped.
    expect(screen.getByRole("button", { name: "Enable delivery" })).toBeEnabled();
  });

  // ── Callback return is display-only ────────────────────────────────────────

  /** Point the page's callback reader at a specific return query. */
  function withCallbackQuery(search: string) {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        assign: assignSpy,
        search,
        pathname: "/automation/mailboxes",
        hash: "",
      },
    });
    return vi.spyOn(window.history, "replaceState");
  }

  it("delivery_oauth=success shows the safe success message, refreshes, and strips the query", async () => {
    const replaceState = withCallbackQuery("?delivery_oauth=success");
    mount(ENABLED);
    // Authoritative state is re-read rather than inferred from the query.
    await waitFor(() => expect(mailboxGets).toBeGreaterThan(1));
    // The callback NEVER triggers a manual enable — no activation call at all.
    expect(fakeApi.post).not.toHaveBeenCalled();
    expect(fakeApi.patch).not.toHaveBeenCalled();
    // The query is removed, so a refresh cannot repeat the message.
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(replaceState.mock.calls.at(-1)?.[2]).toBe("/automation/mailboxes");
    // No raw callback payload is ever rendered in the normal browser flow.
    expect(screen.queryByText(/"outcome"|"mailbox_id"|access_token/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Disable delivery" }),
    ).toBeInTheDocument();
    replaceState.mockRestore();
  });

  it("oauth=error with a safe code strips the query and never enables anything", async () => {
    const replaceState = withCallbackQuery("?oauth=error&code=OAUTH_PROVIDER_DENIED");
    mount(RECONNECT_REQUIRED);
    await waitFor(() => expect(mailboxGets).toBeGreaterThan(1));
    expect(fakeApi.post).not.toHaveBeenCalled();
    expect(fakeApi.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(replaceState.mock.calls.at(-1)?.[2]).toBe("/automation/mailboxes");
    // The reconnect action is still offered; the query changed nothing.
    expect(
      screen.getByRole("button", { name: "Reconnect delivery" }),
    ).toBeInTheDocument();
    replaceState.mockRestore();
  });

  it("ignores a crafted callback query and performs no refresh or mutation", async () => {
    const replaceState = withCallbackQuery("?delivery_oauth=enabled&code=%3Cscript%3E");
    mount(DISABLED_WITH_CREDENTIAL);
    expect(await screen.findByText("ar@example.com")).toBeInTheDocument();
    // An unrecognized value is not an outcome: nothing is announced, refreshed
    // or written, and the mailbox still offers the normal Enable action.
    await waitFor(() => expect(mailboxGets).toBe(1));
    expect(replaceState).not.toHaveBeenCalled();
    expect(fakeApi.post).not.toHaveBeenCalled();
    expect(fakeApi.patch).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Enable delivery" }),
    ).toBeInTheDocument();
    replaceState.mockRestore();
  });

  // ── Independence, redaction and roles ──────────────────────────────────────

  it("never renders a token value, secret name or Vault path for delivery", async () => {
    mount(ENABLED);
    expect(await screen.findByText("ar@example.com")).toBeInTheDocument();
    expect(screen.queryByText(/AR_DELIVERY|AR_MAILBOX|vault|secrets\//i)).toBeNull();
    expect(screen.queryByText(/ya29|refresh_token|access_token/i)).toBeNull();
    // Only the safe configured/expiry facts are shown.
    expect(screen.getAllByText(/Configured/).length).toBeGreaterThan(0);
  });

  it("keeps ingestion, Sync now and the bank-account control untouched by delivery state", async () => {
    roles = ["Finance Manager", "AR Supervisor"];
    mount(RECONNECT_REQUIRED);
    // A delivery reconnect must not remove or degrade any ingestion affordance.
    expect(
      await screen.findByRole("button", { name: "Connect ingestion" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Disable ingestion" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeInTheDocument();
    expect(
      screen.getByLabelText("Default receiving bank account"),
    ).toBeInTheDocument();
  });

  it("hides every delivery control from a role without mailbox configuration rights", async () => {
    roles = ["Auditor"];
    mount(RECONNECT_REQUIRED);
    expect(await screen.findByText("ar@example.com")).toBeInTheDocument();
    for (const name of ["Enable delivery", "Disable delivery", "Reconnect delivery"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    // Safe read-only status remains visible.
    expect(screen.getByText("Delivery reconnect")).toBeInTheDocument();
  });

  it("exposes delivery controls to System Admin, matching existing mailbox configuration roles", async () => {
    roles = ["System Admin"];
    mount(DISABLED_WITH_CREDENTIAL);
    expect(
      await screen.findByRole("button", { name: "Enable delivery" }),
    ).toBeInTheDocument();
  });

  it("keeps the delivery status region announced politely for assistive technology", async () => {
    mount(ENABLED);
    expect(await screen.findByText("ar@example.com")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    // The action control is a real, keyboard-reachable button.
    const disable = screen.getByRole("button", { name: "Disable delivery" });
    expect(disable.tagName).toBe("BUTTON");
    expect(disable).not.toHaveAttribute("tabindex", "-1");
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
            delivery_reconnect_required: false,
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

// ── Reminder Automation + read-only Capabilities (macro-gate) ──────────────────
describe("Automation Settings — reminder automation & capabilities", () => {
  function mountSettings(
    settings: Record<string, unknown> = SETTINGS,
    patchResult?: unknown,
  ) {
    fakeApi = createFakeApi([route("/automation/settings", () => ({ data: settings }))]);
    if (patchResult !== undefined) fakeApi.patch.mockResolvedValue(patchResult);
    renderWithProviders(<AutomationSettingsPage />);
  }

  it("keeps the Operating Mode card, replaces Kill Switches with read-only Capabilities", async () => {
    mountSettings();
    await screen.findByRole("heading", { name: "Operating Mode" });
    expect(screen.getByRole("heading", { name: "Capabilities" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reminder Automation" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kill Switches" })).toBeNull();
    // No per-capability Enable/Disable controls remain anywhere.
    expect(screen.queryByRole("button", { name: /^(Enable|Disable)$/ })).toBeNull();
    // Capability names render as read-only status.
    expect(screen.getByText("Auto-Allocation")).toBeInTheDocument();
    expect(screen.getByText("Mailbox Synchronization")).toBeInTheDocument();
  });

  it("turns reminders Off immediately and sends only reminder_mode (no raw booleans)", async () => {
    const evaluating = {
      ...SETTINGS,
      reminder_mode: "evaluate_only",
      reminder_evaluation_enabled: true,
    };
    mountSettings(evaluating, { ...evaluating, reminder_mode: "off", reminder_evaluation_enabled: false });
    fireEvent.click(
      await screen.findByRole("radio", { name: /No reminder evaluation or email delivery/i }),
    );
    // Off requires no confirmation and applies immediately.
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalled());
    const [path, body] = fakeApi.patch.mock.calls[0];
    expect(path).toBe("/automation/settings");
    expect(body).toEqual({ reminder_mode: "off" });
  });

  it("arms Evaluate Only after confirmation and posts reminder_mode=evaluate_only", async () => {
    mountSettings(SETTINGS, { ...SETTINGS, reminder_mode: "evaluate_only" });
    fireEvent.click(
      await screen.findByRole("radio", {
        name: /determines which invoices require reminders but does not send email/i,
      }),
    );
    expect(fakeApi.patch).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalled());
    expect(fakeApi.patch.mock.calls[0][1]).toEqual({ reminder_mode: "evaluate_only" });
  });

  it("arms Automatic Delivery after confirmation and posts reminder_mode=automatic_delivery", async () => {
    mountSettings(SETTINGS, { ...SETTINGS, reminder_mode: "automatic_delivery" });
    fireEvent.click(
      await screen.findByRole("radio", { name: /sends approved automated reminder emails/i }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalled());
    expect(fakeApi.patch.mock.calls[0][1]).toEqual({ reminder_mode: "automatic_delivery" });
  });

  it("shows a safe unavailable state when Automatic Delivery readiness is rejected", async () => {
    mountSettings(SETTINGS);
    fakeApi.patch.mockRejectedValue(
      new ApiError("REMINDER_DELIVERY_NOT_READY", "Reminder delivery requires a connected delivery provider.", 409),
    );
    fireEvent.click(
      await screen.findByRole("radio", { name: /sends approved automated reminder emails/i }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    // The UI never pretends activation succeeded.
    expect(await screen.findByText(/Automatic Delivery is unavailable/i)).toBeInTheDocument();
  });

  it("changing operating mode sends ONLY the high-level mode, never raw capability fields", async () => {
    mountSettings(SETTINGS, { ...SETTINGS, operating_mode: "draft_only" });
    fireEvent.click(await screen.findByLabelText(/Draft Only/i, { selector: "input" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(fakeApi.patch).toHaveBeenCalled());
    const [, body] = fakeApi.patch.mock.calls[0];
    expect(body).toEqual({ operating_mode: "draft_only" });
    for (
      const raw of [
        "mailbox_sync_enabled",
        "invoice_automation_enabled",
        "auto_allocation_enabled",
        "reminder_evaluation_enabled",
        "reminder_delivery_enabled",
      ]
    ) {
      expect(body).not.toHaveProperty(raw);
    }
  });

  it("prevents duplicate reminder submits while a mutation is pending", async () => {
    mountSettings(SETTINGS);
    fakeApi.patch.mockReturnValue(new Promise(() => {})); // never resolves
    fireEvent.click(
      await screen.findByRole("radio", { name: /sends approved automated reminder emails/i }),
    );
    const confirm = await screen.findByRole("button", { name: "Confirm" });
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(fakeApi.patch).toHaveBeenCalledTimes(1);
  });

  it("does not let System Admin arm a non-off reminder mode", async () => {
    roles = ["System Admin"];
    mountSettings(SETTINGS);
    await screen.findByRole("heading", { name: "Reminder Automation" });
    expect(
      screen.getByRole("radio", { name: /determines which invoices require reminders/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("radio", { name: /sends approved automated reminder emails/i }),
    ).toBeDisabled();
    // Off remains available to System Admin as a safe path.
    expect(
      screen.getByRole("radio", { name: /No reminder evaluation or email delivery/i }),
    ).toBeEnabled();
  });
});

// ── Critical-reference exception recovery ─────────────────────────────────────
describe("Critical-reference recovery", () => {
  const REC_EXC = "10000000-0000-4000-8000-000000000214";
  const INV_A = "10000000-0000-4000-8000-000000000215";
  const RCPT_ID = "10000000-0000-4000-8000-000000000216";
  const REC_ID = "10000000-0000-4000-8000-000000000218";
  const CANDIDATE = "GATEE-INV-DRAFT-20260810-001";

  function criticalException(overrides: Record<string, unknown> = {}) {
    return {
      id: REC_EXC,
      company_id: CO,
      mailbox_id: MB,
      sync_run_id: null,
      message_id: null,
      attachment_id: "10000000-0000-4000-8000-000000000217",
      command_id: "10000000-0000-4000-8000-000000000219",
      invoice_id: null,
      receipt_id: RCPT_ID,
      reason_code: "critical_identifier_unverified",
      idempotency_key: null,
      lifecycle_status: "open",
      safe_details: { error_code: "INVOICE_REFERENCE_NOT_FOUND" },
      retry_count: 0,
      max_retries: 3,
      actor_user_id: null,
      resolution_note: null,
      document: null,
      opened_at: "2026-08-10T00:00:00Z",
      resolved_at: null,
      dismissed_at: null,
      created_at: "2026-08-10T00:00:00Z",
      updated_at: "2026-08-10T00:00:00Z",
      ...overrides,
    };
  }

  function recoveryContext(overrides: Record<string, unknown> = {}) {
    return {
      exception_id: REC_EXC,
      lifecycle_status: "open",
      reason_code: "critical_identifier_unverified",
      receipt: {
        id: RCPT_ID,
        receipt_no: "RCT-202608-00001",
        status: "Posted",
        currency: "MYR",
        unallocated_amount: "100.00",
        attachment_id: "10000000-0000-4000-8000-000000000217",
      },
      original_invoice_references: [CANDIDATE],
      eligible_invoices: [
        {
          invoice_id: INV_A,
          invoice_no: "INV-202608-00001",
          reference_no: "SUPPLIER-INV-123",
          status: "Open",
          currency: "MYR",
          outstanding: "100.00",
        },
      ],
      latest_recovery: null,
      ...overrides,
    };
  }

  const ALLOCATION_RESULT = {
    command_id: "10000000-0000-4000-8000-000000000219",
    receipt_id: RCPT_ID,
    allocated_count: 1,
    total_allocated: "100.00",
    receipt_status: "Fully Allocated",
  };

  function mountRecovery(context = recoveryContext(), exc = criticalException()) {
    fakeApi = createFakeApi([
      route(`/automation/exceptions/${REC_EXC}/recovery`, () => ({ data: context })),
      routePrefix("/automation/exceptions", () => ({
        data: [exc],
        meta: { page: 1, page_size: 15, total: 1, has_more: false },
      })),
    ]);
    renderWithProviders(<ExceptionQueuePage />);
  }

  beforeEach(() => {
    // jsdom lacks object-URL support; provide safe spies for the source viewer.
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-source");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  async function openPanel() {
    fireEvent.click(await screen.findByRole("button", { name: "Recover" }));
    // The restricted candidate reference appears only inside the recovery panel.
    await screen.findByText(CANDIDATE);
  }

  it("offers a Recover entry for a Finance Manager and keeps the candidate out of the table", async () => {
    mountRecovery();
    expect(await screen.findByRole("button", { name: "Recover" })).toBeInTheDocument();
    // Generic exception row stays redacted — no candidate reference before opening.
    expect(screen.queryByText(CANDIDATE)).toBeNull();
  });

  it("hides recovery actions from a read-only role (Auditor)", async () => {
    roles = ["Auditor"];
    mountRecovery();
    await screen.findByText(/Critical Identifier Unverified/i);
    expect(screen.queryByRole("button", { name: "Recover" })).toBeNull();
  });

  it("posts a bounded external-reference correction payload", async () => {
    mountRecovery();
    fakeApi.post.mockResolvedValue(
      recoveryContext({ latest_recovery: {
        id: REC_ID,
        action_type: "correct_invoice_external_reference",
        invoice_id: INV_A,
        created_at: "2026-08-11T00:00:00Z",
      } }),
    );
    await openPanel();
    fireEvent.click(screen.getByRole("radio", { name: /Correct Invoice External Reference/i }));
    fireEvent.click(screen.getByRole("radio", { name: /INV-202608-00001/i }));
    fireEvent.change(screen.getByPlaceholderText(/SUPPLIER-INV-123/i), {
      target: { value: CANDIDATE },
    });
    fireEvent.change(screen.getByLabelText(/Resolution note/i), {
      target: { value: "Supplier reference typo corrected after review." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Record recovery/i }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalled());
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toBe(`/automation/exceptions/${REC_EXC}/correct-invoice-reference`);
    expect(body).toEqual({
      invoice_id: INV_A,
      reference_no: CANDIDATE,
      resolution_note: "Supplier reference typo corrected after review.",
    });
  });

  it("posts a bounded human match-confirmation payload", async () => {
    mountRecovery();
    fakeApi.post.mockResolvedValue(
      recoveryContext({ latest_recovery: {
        id: REC_ID,
        action_type: "confirm_receipt_invoice_match",
        invoice_id: INV_A,
        created_at: "2026-08-11T00:00:00Z",
      } }),
    );
    await openPanel();
    // Confirm is the default action.
    fireEvent.click(screen.getByRole("radio", { name: /INV-202608-00001/i }));
    fireEvent.change(screen.getByLabelText(/Resolution note/i), {
      target: { value: "Confirmed intended Invoice after reviewing both documents." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Record recovery/i }));
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalled());
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toBe(`/automation/exceptions/${REC_EXC}/confirm-match`);
    expect(body).toEqual({
      invoice_id: INV_A,
      resolution_note: "Confirmed intended Invoice after reviewing both documents.",
    });
  });

  it("Retry Matching sends an empty body (no OpenAI/financial payload) and refreshes state", async () => {
    let lifecycle = "open";
    const exc = criticalException();
    fakeApi = createFakeApi([
      route(`/automation/exceptions/${REC_EXC}/recovery`, () => ({
        data: recoveryContext({
          lifecycle_status: lifecycle,
          latest_recovery: {
            id: REC_ID,
            action_type: "confirm_receipt_invoice_match",
            invoice_id: INV_A,
            created_at: "2026-08-11T00:00:00Z",
          },
        }),
      })),
      routePrefix("/automation/exceptions", () => ({
        data: [exc],
        meta: { page: 1, page_size: 15, total: 1, has_more: false },
      })),
    ]);
    renderWithProviders(<ExceptionQueuePage />);
    fakeApi.post.mockImplementation(async () => {
      lifecycle = "resolved"; // the governed retry resolves the exception
      return ALLOCATION_RESULT;
    });
    await openPanel();
    const retryButton = await screen.findByRole("button", { name: /Retry Matching/i });
    fireEvent.click(retryButton);
    await waitFor(() => expect(fakeApi.post).toHaveBeenCalled());
    const [path, body] = fakeApi.post.mock.calls[0];
    expect(path).toBe(`/automation/exceptions/${REC_EXC}/retry-matching`);
    expect(body).toEqual({});
    // Refreshed context now shows the resolved state.
    expect(await screen.findByText(/has been resolved/i)).toBeInTheDocument();
  });

  it("disables recovery mutation once the exception is resolved", async () => {
    mountRecovery(
      recoveryContext({
        lifecycle_status: "resolved",
        latest_recovery: {
          id: REC_ID,
          action_type: "confirm_receipt_invoice_match",
          invoice_id: INV_A,
          created_at: "2026-08-11T00:00:00Z",
        },
      }),
      criticalException({ lifecycle_status: "retryable" }),
    );
    await openPanel();
    expect(screen.getByText(/has been resolved/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record recovery/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry Matching/i })).toBeNull();
  });

  it("renders a candidate reference as inert text and fetches source only via the authenticated hook", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    mountRecovery(recoveryContext({ original_invoice_references: [evil] }));
    fakeApi.rawFetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }),
    } as unknown as Response);
    fireEvent.click(await screen.findByRole("button", { name: "Recover" }));
    // The string is shown literally; no <img> is injected into the DOM.
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    // Source viewing goes through the header-injecting rawFetch, not a raw URL.
    fireEvent.click(screen.getByRole("button", { name: /View Receipt source/i }));
    await waitFor(() => expect(fakeApi.rawFetch).toHaveBeenCalled());
    expect(fakeApi.rawFetch.mock.calls[0][0]).toBe(
      `/automation/exceptions/${REC_EXC}/source`,
    );
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
  });

  it("prevents duplicate recovery submits while a mutation is pending", async () => {
    mountRecovery();
    fakeApi.post.mockReturnValue(new Promise(() => {})); // never resolves
    await openPanel();
    fireEvent.click(screen.getByRole("radio", { name: /INV-202608-00001/i }));
    fireEvent.change(screen.getByLabelText(/Resolution note/i), {
      target: { value: "Confirmed after review." },
    });
    const record = screen.getByRole("button", { name: /Record recovery/i });
    fireEvent.click(record);
    await waitFor(() => expect(record).toBeDisabled());
    fireEvent.click(record);
    fireEvent.click(record);
    expect(fakeApi.post).toHaveBeenCalledTimes(1);
  });
});

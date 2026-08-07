// Gate E — customer assignment + invoice reminder integration + audit timeline.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  createFakeApi,
  renderWithProviders,
  route,
  type FakeApi,
} from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";

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
      company: { id: "co-1", name: "Company One" },
      user: { id: "user-1", email: "fm@example.com" },
    },
    isLoading: false,
    isError: false,
  }),
}));

import { CustomerSalesRepPanel } from "./customer-sales-rep-panel";
import { InvoiceReminderPanel } from "./invoice-reminder-panel";
import { AuditTimeline } from "./audit-timeline";
import type { AuditEvent } from "@/lib/automation/contract";

const CO = "10000000-0000-4000-8000-000000000001";
const CUST = "10000000-0000-4000-8000-000000000005";
const REP_ID = "10000000-0000-4000-8000-000000000002";
const ASG = "10000000-0000-4000-8000-000000000004";
const USER = "10000000-0000-4000-8000-000000000003";
const INV = "10000000-0000-4000-8000-000000000016";
const REM = "10000000-0000-4000-8000-000000000015";

const REP = {
  id: REP_ID,
  company_id: CO,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+60123456789",
  is_active: true,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  created_by: USER,
  updated_by: USER,
};

const CURRENT = {
  assignment: {
    id: ASG,
    company_id: CO,
    customer_id: CUST,
    sales_representative_id: REP_ID,
    assignment_source: "manual_assignment",
    assigned_by: USER,
    assigned_at: "2026-07-01T00:00:00Z",
    assignment_reason: "Initial onboarding",
    superseded_at: null,
    superseded_by: null,
    created_at: "2026-07-01T00:00:00Z",
  },
  sales_representative: REP,
};

beforeEach(() => {
  roles = ["Finance Manager"];
  useCompanyStore.getState().setCompany(CO, "Company One", "MYR");
});

describe("CustomerSalesRepPanel", () => {
  function mount() {
    fakeApi = createFakeApi([
      route(`/automation/customers/${CUST}/sales-representative`, () => ({ data: CURRENT })),
      route(`/automation/customers/${CUST}/sales-representative/history`, () => ({
        data: [CURRENT],
        meta: { page: 1, page_size: 10, total: 1, has_more: false },
      })),
      route("/automation/sales-representatives", () => ({
        data: [REP],
        meta: { page: 1, page_size: 100, total: 1, has_more: false },
      })),
      route("/automation/audit", () => ({
        data: [],
        meta: { page: 1, page_size: 10, total: 0, has_more: false },
      })),
    ]);
  }

  it("shows the current representative and the single-current invariant", async () => {
    mount();
    renderWithProviders(<CustomerSalesRepPanel customerId={CUST} />);
    expect((await screen.findAllByText("Ada Lovelace")).length).toBeGreaterThan(0);
    expect(screen.getByText(/exactly one current representative/i)).toBeInTheDocument();
  });

  it("shows the historical representative identity in history", async () => {
    mount();
    renderWithProviders(<CustomerSalesRepPanel customerId={CUST} />);
    fireEvent.click(await screen.findByText(/Assignment history/i));
    // The history row carries the representative snapshot, not just dates.
    expect(await screen.findAllByText(/Ada Lovelace/)).not.toHaveLength(0);
  });

  it("blocks reassignment without a reason (no API call)", async () => {
    mount();
    renderWithProviders(<CustomerSalesRepPanel customerId={CUST} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reassign" }));
    fireEvent.change(await screen.findByLabelText(/Active representative/i), {
      target: { value: REP_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    await waitFor(() => expect(fakeApi.post).not.toHaveBeenCalled());
  });

  it("hides assignment controls for AR Clerk", async () => {
    roles = ["AR Clerk"];
    mount();
    renderWithProviders(<CustomerSalesRepPanel customerId={CUST} />);
    await screen.findAllByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: /Assign|Reassign/ })).toBeNull();
  });

  it("never issues an audit query for AR Clerk (audit is excluded)", async () => {
    roles = ["AR Clerk"];
    mount();
    renderWithProviders(<CustomerSalesRepPanel customerId={CUST} />);
    await screen.findAllByText("Ada Lovelace");
    await waitFor(() =>
      expect(fakeApi.calls.some((c) => c.path === "/automation/audit")).toBe(false),
    );
  });

  it("does NOT issue an audit query before an assignment id exists", async () => {
    // No current owner → no entity id → the audit timeline must stay disabled
    // rather than falling through to an unfiltered tenant audit request.
    fakeApi = createFakeApi([
      route(`/automation/customers/${CUST}/sales-representative`, () => ({ data: null })),
      route(`/automation/customers/${CUST}/sales-representative/history`, () => ({
        data: [],
        meta: { page: 1, page_size: 10, total: 0, has_more: false },
      })),
      route("/automation/sales-representatives", () => ({
        data: [],
        meta: { page: 1, page_size: 100, total: 0, has_more: false },
      })),
      // NOTE: intentionally no "/automation/audit" route — a call would throw.
    ]);
    renderWithProviders(<CustomerSalesRepPanel customerId={CUST} />);
    expect(await screen.findByText(/No responsible representative assigned/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(fakeApi.calls.some((c) => c.path === "/automation/audit")).toBe(false),
    );
  });

  it("shows a safe unavailable notice for System Admin and issues no customer-scoped or audit calls", async () => {
    roles = ["System Admin"];
    // System Admin is authorized for the sales-rep DIRECTORY but excluded from
    // customer ownership + audit — those customer-scoped reads must never fire.
    fakeApi = createFakeApi([
      route("/automation/sales-representatives", () => ({
        data: [],
        meta: { page: 1, page_size: 100, total: 0, has_more: false },
      })),
    ]);
    renderWithProviders(<CustomerSalesRepPanel customerId={CUST} />);
    expect(
      await screen.findByText(/not available for your role/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fakeApi.calls.some(
          (c) =>
            c.path.includes(`/customers/${CUST}/sales-representative`) ||
            c.path === "/automation/audit",
        ),
      ).toBe(false),
    );
  });
});

describe("InvoiceReminderPanel", () => {
  function mountReminders() {
    fakeApi = createFakeApi([
      route("/automation/settings", () => ({
        data: settingsFixture({ reminder_delivery_enabled: false }),
      })),
      route("/automation/overview", () => ({ data: overviewFixture() })),
      route("/automation/reminders", () => ({
        data: [
          {
            id: REM,
            company_id: CO,
            invoice_id: INV,
            customer_id: CUST,
            sales_representative_id: REP_ID,
            stage_offset_days: -3,
            scheduled_for: "2026-07-28",
            status: "pending",
            recipient_name_snapshot: "Ada Lovelace",
            recipient_email_snapshot: "ada@example.com",
            recipient_phone_snapshot: "+60123456789",
            customer_name_snapshot: "Acme",
            invoice_no_snapshot: "INV-1",
            due_date_snapshot: "2026-07-31",
            outstanding_snapshot: "100.00",
            currency_snapshot: "MYR",
            created_at: "2026-07-25T00:00:00Z",
            delivered_at: null,
          },
        ],
        meta: { page: 1, page_size: 25, total: 1, has_more: false },
      })),
    ]);
  }

  it("shows Invoice-only policy, derived delivery state, and reminder status", async () => {
    mountReminders();
    renderWithProviders(<InvoiceReminderPanel invoiceId={INV} />);
    expect(await screen.findByText(/3 day\(s\) before due/i)).toBeInTheDocument();
    expect(screen.getByText(/3 days before and on the due date/i)).toBeInTheDocument();
    // Delivery state is DERIVED (kill switch off) — not a hard-coded string.
    expect(await screen.findByText("Delivery disabled")).toBeInTheDocument();
    // No "send email" action is offered on the panel.
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
  });

  it("shows a permission notice for AR Clerk and issues no reminder/overview query", async () => {
    roles = ["AR Clerk"]; // reminders are operational-read only (excludes AR Clerk)
    // Settings is readable by AR Clerk (authorized); reminders/overview are not
    // and must never be requested.
    fakeApi = createFakeApi([
      route("/automation/settings", () => ({ data: settingsFixture({}) })),
    ]);
    renderWithProviders(<InvoiceReminderPanel invoiceId={INV} />);
    expect(
      await screen.findByText(/available to AR Supervisor, Finance Manager, and Auditor/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fakeApi.calls.some(
          (c) => c.path === "/automation/reminders" || c.path === "/automation/overview",
        ),
      ).toBe(false),
    );
  });
});

describe("AuditTimeline", () => {
  it("renders allowlisted scalar metadata and suppresses secret/unknown keys", () => {
    const events: AuditEvent[] = [
      {
        id: "10000000-0000-4000-8000-000000000018",
        company_id: CO,
        event_type: "automation_settings_update",
        entity_type: "automation_settings",
        entity_id: CO,
        actor_type: "user",
        actor_user_id: USER,
        trace_id: "trace-1",
        safe_metadata: {
          operating_mode: "draft_only",
          access_token: "ya29.SECRET",
        },
        created_at: "2026-07-31T00:00:00Z",
      },
    ];
    renderWithProviders(<AuditTimeline events={events} />);
    expect(screen.getByText(/Automation Settings Update/i)).toBeInTheDocument();
    expect(screen.getByText(/Operating Mode: draft_only/i)).toBeInTheDocument();
    // A sensitive scalar is never rendered, even though it is a primitive.
    expect(screen.queryByText(/ya29/i)).toBeNull();
  });
});

function settingsFixture(overrides: Record<string, unknown>) {
  return {
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
    ...overrides,
  };
}

function overviewFixture() {
  return {
    settings: settingsFixture({}),
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
}

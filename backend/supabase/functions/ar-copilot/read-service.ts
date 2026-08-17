import type { SupabaseClient } from "supabase";
import type { AuthContext } from "../_shared/auth.ts";
import {
  requireAnyRole,
  requireCustomerAccess,
  requireOperationalReadRole,
} from "../_shared/auth.ts";
import { NotFoundError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import { CustomerService } from "../customers/service.ts";
import { InvoiceService } from "../invoices/service.ts";
import { ReceiptService } from "../receipts/service.ts";
import { ReportService } from "../reports/service.ts";
import { JournalReadService } from "../journal-entries/read-service.ts";
import { AuditReadService } from "../audit-trail/service.ts";
import type {
  CopilotEntityType,
  CopilotEvidence,
  CopilotLink,
  CopilotToolOutcome,
} from "./contract.ts";

type Row = Record<string, unknown>;

const ACTIVE_INVOICE_STATUSES = ["Open", "Overdue", "Partially Paid"];

function decimal(value: unknown, field: string): string {
  if (
    (typeof value === "string" || typeof value === "number") &&
    /^-?\d+(?:\.\d+)?$/.test(String(value))
  ) return String(value);
  throw new Error(`Invalid authoritative decimal: ${field}`);
}

function date(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

function text(value: unknown, maximum = 200): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, maximum);
}

function evidence(
  kind: CopilotEvidence["kind"],
  id: string,
  label: string,
  number: string | null = null,
): CopilotEvidence {
  return { kind, id, label: label.slice(0, 160), number };
}

const LINK_PATHS: Partial<Record<CopilotEntityType, string>> = {
  customer: "/customers/",
  invoice: "/invoices/",
  credit_note: "/invoices/",
  debit_note: "/invoices/",
  receipt: "/receipts/",
  journal_entry: "/journal-entries/",
};

export function trustedEntityLink(
  type: CopilotEntityType,
  id: string,
  label: string,
): CopilotLink | null {
  const prefix = LINK_PATHS[type];
  if (prefix) {
    return { label, entity_type: type, entity_id: id, href: `${prefix}${id}` };
  }
  const fixed = type === "automation_document"
    ? "/automation/documents"
    : type === "automation_exception"
    ? "/automation/exceptions"
    : type === "audit_event"
    ? "/settings/audit-log"
    : null;
  return fixed
    ? { label, entity_type: type, entity_id: id, href: fixed }
    : null;
}

function withLink(
  data: CopilotToolOutcome["data"],
  item: CopilotEvidence,
  type: CopilotEntityType,
  label: string,
): CopilotToolOutcome {
  const link = trustedEntityLink(type, item.id, label);
  return { data, evidence: [item], links: link ? [link] : [] };
}

export interface CopilotReadServiceContract {
  getArSummary(auth: AuthContext): Promise<CopilotToolOutcome>;
  listOverdueInvoices(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome>;
  getCustomerSummary(
    auth: AuthContext,
    customerId: string,
  ): Promise<CopilotToolOutcome>;
  listCustomerOutstanding(
    auth: AuthContext,
    customerId: string,
    limit: number,
  ): Promise<CopilotToolOutcome>;
  getInvoice(auth: AuthContext, invoiceId: string): Promise<CopilotToolOutcome>;
  getInvoicePaymentContext(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<CopilotToolOutcome>;
  getInvoiceReminderHistory(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<CopilotToolOutcome>;
  getReceipt(auth: AuthContext, receiptId: string): Promise<CopilotToolOutcome>;
  getReceiptAllocationContext(
    auth: AuthContext,
    receiptId: string,
  ): Promise<CopilotToolOutcome>;
  getAutomationDocument(
    auth: AuthContext,
    documentId: string,
  ): Promise<CopilotToolOutcome>;
  getAutomationException(
    auth: AuthContext,
    exceptionId: string,
  ): Promise<CopilotToolOutcome>;
  listOpenAutomationExceptions(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome>;
  getJournalEntry(
    auth: AuthContext,
    journalEntryId: string,
  ): Promise<CopilotToolOutcome>;
  getAuditEvent(
    auth: AuthContext,
    eventId: string,
  ): Promise<CopilotToolOutcome>;
  listEntityAuditEvents(
    auth: AuthContext,
    entityType: CopilotEntityType,
    entityId: string,
    limit: number,
  ): Promise<CopilotToolOutcome>;
  validateContext(
    auth: AuthContext,
    entityType: CopilotEntityType,
    entityId: string,
  ): Promise<CopilotToolOutcome>;
}

export class CopilotReadService implements CopilotReadServiceContract {
  readonly #admin: SupabaseClient;
  readonly #user: SupabaseClient;
  readonly #customers: CustomerService;
  readonly #invoices: InvoiceService;
  readonly #receipts: ReceiptService;
  readonly #reports: ReportService;
  readonly #journals: JournalReadService;
  readonly #audit: AuditReadService;
  readonly #businessDate: string;

  constructor(
    adminClient: SupabaseClient,
    userClient: SupabaseClient,
    businessDate: string,
  ) {
    this.#admin = adminClient;
    this.#user = userClient;
    this.#customers = new CustomerService(adminClient);
    this.#invoices = new InvoiceService(adminClient, userClient);
    this.#receipts = new ReceiptService(adminClient, userClient);
    this.#reports = new ReportService(adminClient, userClient);
    this.#journals = new JournalReadService(adminClient);
    this.#audit = new AuditReadService(adminClient);
    this.#businessDate = businessDate;
  }

  async getArSummary(auth: AuthContext): Promise<CopilotToolOutcome> {
    const summary = await this.#reports.getAgingSummary(auth);
    return {
      data: {
        as_of_date: this.#businessDate,
        base_currency: summary.base_currency,
        total_customers: summary.total_customers,
        total_outstanding_base: decimal(
          summary.total_outstanding,
          "total_outstanding",
        ),
        total_overdue_base: decimal(summary.total_overdue, "total_overdue"),
        base_total: decimal(summary.base_total, "base_total"),
        by_currency: summary.by_currency.map((row) => ({
          currency: row.currency,
          amount: decimal(row.amount, "by_currency.amount"),
        })),
      },
      evidence: [
        evidence(
          "ar_summary",
          `ar-summary:${auth.companyId}`,
          "Current AR summary",
        ),
      ],
      links: [],
    };
  }

  async listOverdueInvoices(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome> {
    const result = await this.#invoices.listInvoices(
      auth,
      { status: "Overdue" },
      { page: 1, page_size: limit },
    );
    const rows = result.invoices.map((invoice) => ({
      id: invoice.id,
      invoice_no: invoice.invoice_no,
      customer_name: invoice.customer_name.slice(0, 200),
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      currency: invoice.currency,
      total_amount: decimal(invoice.total_amount, "invoice.total_amount"),
      outstanding: decimal(invoice.outstanding, "invoice.outstanding"),
      status: invoice.status,
    }));
    const items = rows.map((row) =>
      evidence("invoice", row.id, row.invoice_no, row.invoice_no)
    );
    return {
      data: {
        rows,
        total_count: result.total,
        coverage: {
          status: result.total <= rows.length
            ? "complete"
            : "bounded_incomplete",
          source_total: result.total,
          returned_rows: rows.length,
          top_n_complete: null,
        },
      },
      evidence: items,
      links: items.map((item) =>
        trustedEntityLink("invoice", item.id, "View invoice")
      ).filter((item): item is CopilotLink => item !== null),
    };
  }

  async getCustomerSummary(
    auth: AuthContext,
    customerId: string,
  ): Promise<CopilotToolOutcome> {
    const customer = await this.#customers.getCustomerById(auth, customerId);
    const data = {
      id: customer.id,
      customer_code: customer.customer_id,
      customer_name: customer.customer_name.slice(0, 200),
      status: customer.status,
      default_currency: customer.default_currency,
      credit_rating: customer.credit_rating,
      credit_limit: decimal(customer.credit_limit, "customer.credit_limit"),
      total_outstanding: customer._credit
        ? decimal(
          customer._credit.total_outstanding,
          "customer.total_outstanding",
        )
        : null,
      unallocated_receipts: customer._credit
        ? decimal(
          customer._credit.total_unallocated_receipts,
          "customer.unallocated_receipts",
        )
        : null,
      available_credit: customer._credit
        ? decimal(
          customer._credit.available_credit,
          "customer.available_credit",
        )
        : null,
    };
    return withLink(
      data,
      evidence(
        "customer",
        customer.id,
        customer.customer_name,
        customer.customer_id,
      ),
      "customer",
      "View customer",
    );
  }

  async listCustomerOutstanding(
    auth: AuthContext,
    customerId: string,
    limit: number,
  ): Promise<CopilotToolOutcome> {
    await requireCustomerAccess(auth, customerId);
    const { data, error } = await this.#user.from("invoices")
      .select(
        "id,invoice_no,doc_type,invoice_date,due_date,currency,total_amount,outstanding,status",
      )
      .eq("company_id", auth.companyId)
      .eq("customer_id", customerId)
      .in("status", ACTIVE_INVOICE_STATUSES)
      .gt("outstanding", 0)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(limit);
    if (error) {
      throw new Error("Failed to load customer outstanding documents.");
    }
    const rows = ((data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      invoice_no: String(row.invoice_no),
      document_type: String(row.doc_type),
      invoice_date: date(row.invoice_date),
      due_date: date(row.due_date),
      currency: String(row.currency),
      total_amount: decimal(row.total_amount, "invoice.total_amount"),
      outstanding: decimal(row.outstanding, "invoice.outstanding"),
      status: String(row.status),
    }));
    const items = rows.map((row) =>
      evidence(
        row.document_type === "Credit Note"
          ? "credit_note"
          : row.document_type === "Debit Note"
          ? "debit_note"
          : "invoice",
        row.id,
        row.invoice_no,
        row.invoice_no,
      )
    );
    return {
      data: rows,
      evidence: items,
      links: items.map((item) =>
        trustedEntityLink(
          item.kind as CopilotEntityType,
          item.id,
          "View document",
        )
      ).filter((item): item is CopilotLink => item !== null),
    };
  }

  async getInvoice(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<CopilotToolOutcome> {
    const invoice = await this.#invoices.getInvoiceById(auth, invoiceId);
    const type: CopilotEntityType = invoice.doc_type === "Credit Note"
      ? "credit_note"
      : invoice.doc_type === "Debit Note"
      ? "debit_note"
      : "invoice";
    const kind = type as CopilotEvidence["kind"];
    return withLink(
      {
        id: invoice.id,
        invoice_no: invoice.invoice_no,
        document_type: invoice.doc_type,
        customer_name: invoice.customer_name.slice(0, 200),
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        currency: invoice.currency,
        total_amount: decimal(invoice.total_amount, "invoice.total_amount"),
        outstanding: decimal(invoice.outstanding, "invoice.outstanding"),
        status: invoice.status,
        posting_period: invoice.posting_period,
        posted_at: invoice.posted_at,
        cancelled_at: invoice.cancelled_at,
        base_currency: invoice.base_currency,
        base_amount_available: invoice.base_available ?? null,
        line_count: invoice.lines.length,
      },
      evidence(kind, invoice.id, invoice.invoice_no, invoice.invoice_no),
      type,
      "View document",
    );
  }

  async getInvoicePaymentContext(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<CopilotToolOutcome> {
    const invoiceOutcome = await this.getInvoice(auth, invoiceId);
    const { data, error } = await this.#admin.from("allocation_details")
      .select(
        "id,receipt_id,allocated_amount,base_allocated,allocation_date,allocation_method,status,reversed_at",
      )
      .eq("invoice_id", invoiceId)
      .order("allocation_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (error) throw new Error("Failed to load invoice allocation evidence.");
    const allocations = ((data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      receipt_id: String(row.receipt_id),
      allocated_amount: decimal(
        row.allocated_amount,
        "allocation.allocated_amount",
      ),
      base_allocated: decimal(row.base_allocated, "allocation.base_allocated"),
      allocation_date: String(row.allocation_date),
      method: String(row.allocation_method),
      status: String(row.status),
      reversed_at: text(row.reversed_at),
    }));
    const receiptIds = allocations.map((row) => row.receipt_id);
    const visibleReceiptIds = new Set<string>();
    if (receiptIds.length > 0) {
      const { data: receipts, error: receiptError } = await this.#user
        .from("receipts").select("id").eq("company_id", auth.companyId)
        .in("id", receiptIds);
      if (receiptError) {
        throw new Error("Failed to verify allocation receipt scope.");
      }
      for (const row of (receipts ?? []) as Row[]) {
        visibleReceiptIds.add(String(row.id));
      }
    }
    const scopedAllocations = allocations.filter((row) =>
      visibleReceiptIds.has(row.receipt_id)
    );
    return {
      data: { invoice: invoiceOutcome.data, allocations: scopedAllocations },
      evidence: [
        ...invoiceOutcome.evidence,
        ...scopedAllocations.map((row) =>
          evidence("allocation", row.id, `Allocation ${row.id.slice(0, 8)}`)
        ),
      ],
      links: invoiceOutcome.links,
    };
  }

  async getInvoiceReminderHistory(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<CopilotToolOutcome> {
    const invoiceOutcome = await this.getInvoice(auth, invoiceId);
    const { data: reminders, error } = await this.#admin.from(
      "invoice_reminders",
    )
      .select(
        "id,stage_offset_days,scheduled_for,status,created_at,delivered_at,cancelled_at,currency_snapshot,outstanding_snapshot",
      )
      .eq("company_id", auth.companyId)
      .eq("invoice_id", invoiceId)
      .order("scheduled_for", { ascending: false })
      .order("id", { ascending: false })
      .limit(20);
    if (error) throw new Error("Failed to load reminder history.");
    const rows = ((reminders ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      stage_offset_days: row.stage_offset_days,
      scheduled_for: date(row.scheduled_for),
      status: String(row.status),
      currency: String(row.currency_snapshot),
      outstanding_snapshot: decimal(
        row.outstanding_snapshot,
        "reminder.outstanding_snapshot",
      ),
      created_at: text(row.created_at),
      delivered_at: text(row.delivered_at),
      cancelled_at: text(row.cancelled_at),
    }));
    return {
      data: { invoice: invoiceOutcome.data, reminders: rows },
      evidence: [
        ...invoiceOutcome.evidence,
        ...rows.map((row) =>
          evidence(
            "reminder",
            row.id,
            `Reminder ${row.scheduled_for ?? row.id}`,
          )
        ),
      ],
      links: invoiceOutcome.links,
    };
  }

  async getReceipt(
    auth: AuthContext,
    receiptId: string,
  ): Promise<CopilotToolOutcome> {
    const receipt = await this.#receipts.getReceiptById(auth, receiptId);
    return withLink(
      {
        id: receipt.id,
        receipt_no: receipt.receipt_no,
        customer_name: receipt.customer_name.slice(0, 200),
        receipt_date: receipt.receipt_date,
        value_date: receipt.value_date,
        payment_method: receipt.payment_method,
        currency: receipt.currency,
        receipt_amount: decimal(
          receipt.receipt_amount,
          "receipt.receipt_amount",
        ),
        allocated_amount: decimal(
          receipt.allocated_amount,
          "receipt.allocated_amount",
        ),
        unallocated_amount: decimal(
          receipt.unallocated_amount,
          "receipt.unallocated_amount",
        ),
        status: receipt.status,
        posting_period: receipt.posting_period,
        posted_at: receipt.posted_at,
        base_currency: receipt.base_currency,
        base_amount_available: receipt.base_available ?? null,
      },
      evidence("receipt", receipt.id, receipt.receipt_no, receipt.receipt_no),
      "receipt",
      "View receipt",
    );
  }

  async getReceiptAllocationContext(
    auth: AuthContext,
    receiptId: string,
  ): Promise<CopilotToolOutcome> {
    const receiptOutcome = await this.getReceipt(auth, receiptId);
    const { data, error } = await this.#admin.from("allocation_details")
      .select(
        "id,invoice_id,allocated_amount,base_allocated,allocation_date,allocation_method,status,reversed_at",
      )
      .eq("receipt_id", receiptId)
      .order("allocation_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (error) throw new Error("Failed to load receipt allocation evidence.");
    const allocations = ((data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      invoice_id: String(row.invoice_id),
      allocated_amount: decimal(
        row.allocated_amount,
        "allocation.allocated_amount",
      ),
      base_allocated: decimal(row.base_allocated, "allocation.base_allocated"),
      allocation_date: String(row.allocation_date),
      method: String(row.allocation_method),
      status: String(row.status),
      reversed_at: text(row.reversed_at),
    }));
    const invoiceIds = allocations.map((row) => row.invoice_id);
    const visibleInvoiceIds = new Set<string>();
    if (invoiceIds.length > 0) {
      const { data: invoices, error: invoiceError } = await this.#user
        .from("invoices").select("id").eq("company_id", auth.companyId)
        .in("id", invoiceIds);
      if (invoiceError) {
        throw new Error("Failed to verify allocation invoice scope.");
      }
      for (const row of (invoices ?? []) as Row[]) {
        visibleInvoiceIds.add(String(row.id));
      }
    }
    const scopedAllocations = allocations.filter((row) =>
      visibleInvoiceIds.has(row.invoice_id)
    );
    return {
      data: { receipt: receiptOutcome.data, allocations: scopedAllocations },
      evidence: [
        ...receiptOutcome.evidence,
        ...scopedAllocations.map((row) =>
          evidence("allocation", row.id, `Allocation ${row.id.slice(0, 8)}`)
        ),
      ],
      links: receiptOutcome.links,
    };
  }

  async getAutomationDocument(
    auth: AuthContext,
    documentId: string,
  ): Promise<CopilotToolOutcome> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    validateUUID(documentId, "document_id");
    const { data, error } = await this.#admin.from(
      "automation_document_classifications",
    )
      .select(
        "id,attachment_id,document_type,confidence,critical_confidence,status,provider_name,provider_model,created_at",
      )
      .eq("id", documentId).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw new Error("Failed to load automation document.");
    if (!data) throw new NotFoundError("Automation document", documentId);
    const row = data as Row;
    return withLink(
      {
        id: String(row.id),
        document_type: String(row.document_type),
        status: String(row.status),
        confidence: decimal(row.confidence, "document.confidence"),
        critical_confidence: decimal(
          row.critical_confidence,
          "document.critical_confidence",
        ),
        provider: String(row.provider_name),
        model: String(row.provider_model),
        created_at: String(row.created_at),
      },
      evidence(
        "automation_document",
        documentId,
        `Automation document ${documentId.slice(0, 8)}`,
      ),
      "automation_document",
      "View automation documents",
    );
  }

  async getAutomationException(
    auth: AuthContext,
    exceptionId: string,
  ): Promise<CopilotToolOutcome> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    validateUUID(exceptionId, "exception_id");
    const { data, error } = await this.#admin.from("automation_exceptions")
      .select(
        "id,reason_code,lifecycle_status,retry_count,max_retries,opened_at,resolved_at,dismissed_at,invoice_id,receipt_id",
      )
      .eq("id", exceptionId).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw new Error("Failed to load automation exception.");
    if (!data) throw new NotFoundError("Automation exception", exceptionId);
    const row = data as Row;
    return withLink(
      {
        id: String(row.id),
        reason_code: String(row.reason_code),
        lifecycle_status: String(row.lifecycle_status),
        retry_count: row.retry_count,
        max_retries: row.max_retries,
        opened_at: String(row.opened_at),
        resolved_at: text(row.resolved_at),
        dismissed_at: text(row.dismissed_at),
        invoice_id: text(row.invoice_id),
        receipt_id: text(row.receipt_id),
      },
      evidence(
        "automation_exception",
        exceptionId,
        `Automation exception: ${String(row.reason_code)}`,
      ),
      "automation_exception",
      "View exception",
    );
  }

  async listOpenAutomationExceptions(
    auth: AuthContext,
    limit: number,
  ): Promise<CopilotToolOutcome> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    const { data, error } = await this.#admin.from("automation_exceptions")
      .select(
        "id,reason_code,lifecycle_status,retry_count,max_retries,opened_at,invoice_id,receipt_id",
      )
      .eq("company_id", auth.companyId).in("lifecycle_status", [
        "open",
        "retryable",
      ])
      .order("opened_at", { ascending: false }).order("id", {
        ascending: false,
      }).limit(limit);
    if (error) throw new Error("Failed to load open automation exceptions.");
    const rows = ((data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      reason_code: String(row.reason_code),
      lifecycle_status: String(row.lifecycle_status),
      retry_count: row.retry_count,
      max_retries: row.max_retries,
      opened_at: String(row.opened_at),
      invoice_id: text(row.invoice_id),
      receipt_id: text(row.receipt_id),
    }));
    const items = rows.map((row) =>
      evidence(
        "automation_exception",
        row.id,
        `Automation exception: ${row.reason_code}`,
      )
    );
    return {
      data: rows,
      evidence: items,
      links: items.map((item) =>
        trustedEntityLink("automation_exception", item.id, "View exception")
      ).filter((item): item is CopilotLink => item !== null),
    };
  }

  async getJournalEntry(
    auth: AuthContext,
    journalEntryId: string,
  ): Promise<CopilotToolOutcome> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    const journal = await this.#journals.detail(auth, journalEntryId);
    return withLink(
      {
        id: journal.id,
        je_no: journal.je_no,
        je_date: journal.je_date,
        posting_period: journal.posting_period,
        source_type: journal.source_type,
        source_doc_no: journal.source_doc_no,
        description: journal.description,
        currency: journal.currency,
        base_currency: journal.base_currency,
        exchange_rate: journal.exchange_rate,
        total_debit: journal.total_debit,
        total_credit: journal.total_credit,
        is_balanced: journal.is_balanced,
        is_reversal: journal.is_reversal,
        is_reversed: journal.is_reversed,
        original_je_id: journal.original_je_id,
        reversal_je_id: journal.reversal_je_id,
        created_at: journal.created_at,
        lines: journal.lines.map((line) => ({
          line_no: line.line_no,
          account_code: line.account_code,
          account_name: line.account_name,
          account_type: line.account_type,
          description: line.description,
          debit_amount: line.debit_amount,
          credit_amount: line.credit_amount,
          base_debit: line.base_debit,
          base_credit: line.base_credit,
          currency: line.currency,
          original_amount: line.original_amount,
        })),
      },
      evidence("journal_entry", journal.id, journal.je_no, journal.je_no),
      "journal_entry",
      "View Journal Entry",
    );
  }

  async getAuditEvent(
    auth: AuthContext,
    eventId: string,
  ): Promise<CopilotToolOutcome> {
    requireAnyRole(auth, ["Finance Manager", "Auditor"]);
    const event = await this.#audit.detail(auth, eventId);
    return withLink(
      {
        event_id: event.event_id,
        occurred_at: event.occurred_at,
        actor_type: event.actor.type,
        actor_role: event.actor.role,
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        entity_number: event.entity_number,
        result: event.result,
        summary: event.summary,
        metadata: event.metadata,
        source_kind: event.source_kind,
      },
      evidence(
        "audit_event",
        event.event_id,
        event.summary,
        event.entity_number,
      ),
      "audit_event",
      "Open Audit Trail",
    );
  }

  async listEntityAuditEvents(
    auth: AuthContext,
    entityType: CopilotEntityType,
    entityId: string,
    limit: number,
  ): Promise<CopilotToolOutcome> {
    requireAnyRole(auth, ["Finance Manager", "Auditor"]);
    const entity = await this.validateContext(auth, entityType, entityId);
    const primary = entity.evidence[0];
    if (!primary?.number) throw new NotFoundError("Auditable entity", entityId);
    const auditType =
      entityType === "credit_note" || entityType === "debit_note"
        ? entityType
        : entityType === "journal_entry"
        ? "journal_entry"
        : entityType;
    const result = await this.#audit.list(auth, {
      limit,
      cursor: null,
      dateFrom: null,
      dateTo: null,
      action: null,
      entityType: auditType as never,
      actorType: null,
      actorUserId: null,
      result: null,
      q: primary.number,
    });
    const items = result.data.map((event) =>
      evidence(
        "audit_event",
        event.event_id,
        event.summary,
        event.entity_number,
      )
    );
    return {
      data: result.data.map((event) => ({
        event_id: event.event_id,
        occurred_at: event.occurred_at,
        actor_type: event.actor.type,
        action: event.action,
        result: event.result,
        summary: event.summary,
        metadata: event.metadata,
      })),
      evidence: items,
      links: items.map((item) =>
        trustedEntityLink("audit_event", item.id, "Open Audit Trail")
      ).filter((item): item is CopilotLink => item !== null),
    };
  }

  async validateContext(
    auth: AuthContext,
    entityType: CopilotEntityType,
    entityId: string,
  ): Promise<CopilotToolOutcome> {
    switch (entityType) {
      case "customer":
        return await this.getCustomerSummary(auth, entityId);
      case "invoice":
      case "credit_note":
      case "debit_note": {
        const result = await this.getInvoice(auth, entityId);
        if (result.evidence[0]?.kind !== entityType) {
          throw new NotFoundError("Document", entityId);
        }
        return result;
      }
      case "receipt":
        return await this.getReceipt(auth, entityId);
      case "automation_document":
        return await this.getAutomationDocument(auth, entityId);
      case "automation_exception":
        return await this.getAutomationException(auth, entityId);
      case "journal_entry":
        return await this.getJournalEntry(auth, entityId);
      case "audit_event":
        return await this.getAuditEvent(auth, entityId);
      default: {
        requireOperationalReadRole(auth);
        throw new NotFoundError("Context", entityId);
      }
    }
  }
}

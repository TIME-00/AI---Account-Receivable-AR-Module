import { callRpc } from "../_shared/db.ts";
import type { AuthContext } from "../_shared/auth.ts";
import {
  requireAnyRole,
  requireCustomerAccess,
  requireOperationalReadRole,
} from "../_shared/auth.ts";
import { ConflictError, ValidationError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import {
  assertExactKeys,
  normalizeEmail,
  normalizePhone,
  type PageRequest,
  requireBoundedText,
} from "./contract.ts";
import {
  assignmentHistoryDto,
  currentAssignmentDto,
  documentDecisionDto,
  mapAutomationCollectionRow,
  salesRepresentativeDto,
} from "./dto.ts";
import {
  documentDecisionExtraction,
  type PagedRows,
  pageRange,
  requiredId,
  type Row,
} from "./service-base.ts";
import { AutomationSettingsService } from "./settings-service.ts";
export abstract class AutomationDirectoryService
  extends AutomationSettingsService {
  async listSalesRepresentatives(
    auth: AuthContext,
    page: PageRequest,
    active?: boolean,
  ): Promise<PagedRows> {
    requireAnyRole(auth, [
      "AR Clerk",
      "AR Supervisor",
      "Finance Manager",
      "Auditor",
      "System Admin",
    ]);
    const [from, to] = pageRange(page);
    let query = this.client.from("sales_representatives").select("*", {
      count: "exact",
    })
      .eq("company_id", auth.companyId);
    if (active !== undefined) query = query.eq("is_active", active);
    const { data, count, error } = await query
      .order("name", { ascending: true }).order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const total = count ?? 0;
    return {
      rows: ((data ?? []) as Row[]).map(salesRepresentativeDto),
      meta: { ...page, total, has_more: from + (data?.length ?? 0) < total },
    };
  }

  async createSalesRepresentative(auth: AuthContext, input: Row): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    assertExactKeys(input, ["name", "email", "phone", "is_active"], [
      "name",
      "email",
    ]);
    if (
      input.is_active !== undefined && typeof input.is_active !== "boolean"
    ) {
      throw new ValidationError("is_active must be a boolean.");
    }
    const record = {
      company_id: auth.companyId,
      name: requireBoundedText(input.name, "name", 200),
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      is_active: input.is_active !== false,
      created_by: auth.userId,
      updated_by: auth.userId,
    };
    const { data, error } = await this.client.from("sales_representatives")
      .insert(record).select("*").single();
    if (error) {
      if (error.code === "23505") {
        throw new ConflictError("Sales representative email already exists.");
      }
      throw error;
    }
    return salesRepresentativeDto(data as Row);
  }

  async updateSalesRepresentative(
    auth: AuthContext,
    id: string,
    input: Row,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(id, "id");
    assertExactKeys(input, ["name", "email", "phone", "is_active"]);
    if (Object.keys(input).length === 0) {
      throw new ValidationError("At least one field must be supplied.");
    }
    const patch: Row = {
      updated_by: auth.userId,
      updated_at: this.now().toISOString(),
    };
    if (input.name !== undefined) {
      patch.name = requireBoundedText(input.name, "name", 200);
    }
    if (input.email !== undefined) patch.email = normalizeEmail(input.email);
    if (input.phone !== undefined) patch.phone = normalizePhone(input.phone);
    if (input.is_active !== undefined) {
      if (typeof input.is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean.");
      }
      patch.is_active = input.is_active;
    }
    const { data, error } = await this.client.from("sales_representatives")
      .update(patch).eq("id", id).eq("company_id", auth.companyId).select("*")
      .maybeSingle();
    if (error) throw error;
    return salesRepresentativeDto(
      requiredId(data as Row | null, "SalesRepresentative", id),
    );
  }

  async assignSalesRepresentative(
    auth: AuthContext,
    customerId: string,
    input: Row,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(customerId, "customer_id");
    assertExactKeys(input, [
      "sales_representative_id",
      "assignment_source",
      "reason",
    ], ["sales_representative_id", "assignment_source", "reason"]);
    validateUUID(
      String(input.sales_representative_id),
      "sales_representative_id",
    );
    if (
      ![
        "customer_acquisition",
        "customer_onboarding",
        "manual_assignment",
        "import",
      ].includes(String(input.assignment_source))
    ) {
      throw new ValidationError("Unsupported assignment_source.");
    }
    const reason = requireBoundedText(input.reason, "reason", 500);
    const result = await callRpc<Row>(
      this.client,
      "automation_assign_sales_representative",
      {
        p_company_id: auth.companyId,
        p_actor_user_id: auth.userId,
        p_customer_id: customerId,
        p_sales_representative_id: input.sales_representative_id,
        p_assignment_source: input.assignment_source,
        p_reason: reason,
      },
    );
    return {
      changed: result.changed === true,
      current: await this.getCustomerSalesRepresentative(auth, customerId),
    };
  }

  async getCustomerSalesRepresentative(
    auth: AuthContext,
    customerId: string,
  ): Promise<Row | null> {
    requireOperationalReadRole(auth);
    validateUUID(customerId, "customer_id");
    await requireCustomerAccess(auth, customerId);
    const { data, error } = await this.client
      .from("customer_sales_representative_assignments")
      .select("*, sales_representative:sales_representatives(*)")
      .eq("company_id", auth.companyId).eq("customer_id", customerId)
      .is("superseded_at", null).maybeSingle();
    if (error) throw error;
    return currentAssignmentDto(data as Row | null);
  }

  async listAssignmentHistory(
    auth: AuthContext,
    customerId: string,
    page: PageRequest,
  ): Promise<PagedRows> {
    requireOperationalReadRole(auth);
    validateUUID(customerId, "customer_id");
    await requireCustomerAccess(auth, customerId);
    const [from, to] = pageRange(page);
    const { data, count, error } = await this.client
      .from("customer_sales_representative_assignments")
      .select("*, sales_representative:sales_representatives(*)", {
        count: "exact",
      })
      .eq("company_id", auth.companyId).eq("customer_id", customerId)
      .order("assigned_at", { ascending: false }).order("id", {
        ascending: false,
      })
      .range(from, to);
    if (error) throw error;
    const total = count ?? 0;
    const rows = ((data ?? []) as Row[]).map(assignmentHistoryDto);
    return {
      rows,
      meta: { ...page, total, has_more: from + rows.length < total },
    };
  }

  async listDocumentDecisions(
    auth: AuthContext,
    page: PageRequest,
    filters: Readonly<Record<string, string | undefined>>,
  ): Promise<PagedRows> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    const [from, to] = pageRange(page);
    let query = this.client.from("automation_document_classifications")
      .select(
        "*, extraction:automation_extraction_results(*), attachment:automation_source_attachments(id,message_id,original_file_name,detected_mime_type,size_bytes,page_count,scan_status,safety_status,processing_status,content_purged_at)",
        { count: "exact" },
      )
      .eq("company_id", auth.companyId);
    for (const field of ["document_type", "status"] as const) {
      if (filters[field] !== undefined) {
        query = query.eq(field, filters[field]);
      }
    }
    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const sourceRows = ((data ?? []) as Row[]).map((row): Row => ({
      ...row,
      extraction: documentDecisionExtraction(row),
    }));
    const extractionIds = sourceRows.flatMap((row) => {
      const extraction = row.extraction as Row | null;
      return extraction?.id ? [String(extraction.id)] : [];
    });
    const attachmentIds = sourceRows.map((row) => String(row.attachment_id));
    const commandsByExtraction = new Map<string, Row>();
    if (extractionIds.length > 0) {
      const { data: commands, error: commandError } = await this.client
        .from("automation_commands")
        .select(
          "id,extraction_id,command_type,status,resulting_invoice_id,resulting_receipt_id,failure_code",
        )
        .eq("company_id", auth.companyId)
        .in("extraction_id", extractionIds)
        .order("created_at", { ascending: false })
        .limit(extractionIds.length);
      if (commandError) throw commandError;
      for (const command of (commands ?? []) as Row[]) {
        const id = String(command.extraction_id);
        if (!commandsByExtraction.has(id)) {
          commandsByExtraction.set(id, command);
        }
      }
    }
    const exceptionsByAttachment = new Map<string, string[]>();
    if (attachmentIds.length > 0) {
      const { data: exceptions, error: exceptionError } = await this.client
        .from("automation_exceptions")
        .select("id,attachment_id")
        .eq("company_id", auth.companyId)
        .in("attachment_id", attachmentIds)
        .order("opened_at", { ascending: true })
        .limit(1000);
      if (exceptionError) throw exceptionError;
      for (const exception of (exceptions ?? []) as Row[]) {
        const id = String(exception.attachment_id);
        exceptionsByAttachment.set(id, [
          ...(exceptionsByAttachment.get(id) ?? []),
          String(exception.id),
        ]);
      }
    }
    const rows = sourceRows.map((row) => {
      const extraction = row.extraction as Row | null;
      return documentDecisionDto({
        ...row,
        command: extraction?.id
          ? commandsByExtraction.get(String(extraction.id)) ?? null
          : null,
        linked_exception_ids: exceptionsByAttachment.get(
          String(row.attachment_id),
        ) ?? [],
      });
    });
    const total = count ?? 0;
    return {
      rows,
      meta: { ...page, total, has_more: from + rows.length < total },
    };
  }

  async listTable(
    auth: AuthContext,
    table: string,
    page: PageRequest,
    filters: Readonly<Record<string, string | boolean | undefined>> = {},
  ): Promise<PagedRows> {
    requireAnyRole(
      auth,
      table === "automation_mailboxes"
        ? ["Finance Manager", "Auditor", "System Admin"]
        : ["AR Supervisor", "Finance Manager", "Auditor"],
    );
    const allowedTables = new Set([
      "automation_mailboxes",
      "mailbox_sync_runs",
      "automation_document_classifications",
      "automation_exceptions",
      "invoice_reminders",
      "reminder_delivery_attempts",
      "automation_audit_events",
      "automation_commands",
    ]);
    if (!allowedTables.has(table)) {
      throw new ValidationError("Unsupported automation collection.");
    }
    if (table === "invoice_reminders" && filters.invoice_id !== undefined) {
      validateUUID(String(filters.invoice_id), "invoice_id");
      const { data: invoice, error: invoiceError } = await this.client
        .from("invoices").select("id,customer_id")
        .eq("id", filters.invoice_id).eq("company_id", auth.companyId)
        .maybeSingle();
      if (invoiceError) throw invoiceError;
      const visibleInvoice = requiredId(
        invoice as Row | null,
        "Invoice",
        String(filters.invoice_id),
      );
      await requireCustomerAccess(auth, String(visibleInvoice.customer_id));
    }
    if (
      table === "reminder_delivery_attempts" &&
      filters.reminder_id !== undefined
    ) {
      validateUUID(String(filters.reminder_id), "reminder_id");
      const { data: reminder, error: reminderError } = await this.client
        .from("invoice_reminders").select("id,customer_id")
        .eq("id", filters.reminder_id).eq("company_id", auth.companyId)
        .maybeSingle();
      if (reminderError) throw reminderError;
      const visibleReminder = requiredId(
        reminder as Row | null,
        "InvoiceReminder",
        String(filters.reminder_id),
      );
      await requireCustomerAccess(auth, String(visibleReminder.customer_id));
    }
    const [from, to] = pageRange(page);
    let query = this.client.from(table).select("*", { count: "exact" })
      .eq("company_id", auth.companyId);
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) {
        const normalized = table === "automation_audit_events" &&
            key === "actor_type"
          ? value === "system"
            ? "system_worker"
            : value === "provider"
            ? "provider_fixture"
            : value
          : value;
        query = query.eq(key, normalized);
      }
    }
    const orderField = table === "invoice_reminders"
      ? "scheduled_for"
      : table === "reminder_delivery_attempts"
      ? "attempt_number"
      : table === "automation_exceptions"
      ? "opened_at"
      : "created_at";
    const { data, count, error } = await query
      .order(orderField, {
        ascending: false,
      })
      .order("id", { ascending: false }).range(from, to);
    if (error) throw error;
    let sourceRows = (data ?? []) as Row[];
    if (table === "automation_exceptions") {
      const attachmentIds = [
        ...new Set(
          sourceRows.flatMap((row) =>
            typeof row.attachment_id === "string" ? [row.attachment_id] : []
          ),
        ),
      ];
      if (attachmentIds.length > 0) {
        const [attachmentsResult, classificationsResult] = await Promise.all([
          this.client.from("automation_source_attachments")
            .select("id,original_file_name,processing_status")
            .eq("company_id", auth.companyId).in("id", attachmentIds)
            .limit(attachmentIds.length),
          this.client.from("automation_document_classifications")
            .select("id,attachment_id,document_type,status,created_at")
            .eq("company_id", auth.companyId).in("attachment_id", attachmentIds)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(Math.min(attachmentIds.length * 10, 1000)),
        ]);
        if (attachmentsResult.error) throw attachmentsResult.error;
        if (classificationsResult.error) throw classificationsResult.error;
        const attachmentById = new Map(
          ((attachmentsResult.data ?? []) as Row[]).map((row) => [
            String(row.id),
            row,
          ]),
        );
        const classificationByAttachment = new Map<string, Row>();
        for (const row of (classificationsResult.data ?? []) as Row[]) {
          const attachmentId = String(row.attachment_id);
          if (!classificationByAttachment.has(attachmentId)) {
            classificationByAttachment.set(attachmentId, row);
          }
        }
        sourceRows = sourceRows.map((row) => {
          const attachmentId = typeof row.attachment_id === "string"
            ? row.attachment_id
            : null;
          const attachment = attachmentId
            ? attachmentById.get(attachmentId)
            : undefined;
          const classification = attachmentId
            ? classificationByAttachment.get(attachmentId)
            : undefined;
          return {
            ...row,
            document_context: attachment
              ? {
                file_name: attachment.original_file_name,
                processing_status: attachment.processing_status,
                document_type: classification?.document_type ?? null,
                classification_status: classification?.status ?? null,
              }
              : null,
          };
        });
      } else {
        sourceRows = sourceRows.map((row) => ({
          ...row,
          document_context: null,
        }));
      }
    }
    const total = count ?? 0;
    const rows = sourceRows.map((row) =>
      mapAutomationCollectionRow(table, row)
    );
    return {
      rows,
      meta: { ...page, total, has_more: from + rows.length < total },
    };
  }
}

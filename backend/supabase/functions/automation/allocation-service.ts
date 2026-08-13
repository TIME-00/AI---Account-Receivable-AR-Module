import { callRpc } from "../_shared/db.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { requireAnyRole } from "../_shared/auth.ts";
import {
  BusinessError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import {
  assertExactKeys,
  type FinancialExtraction,
  requireBoundedText,
} from "./contract.ts";
import {
  allocationResultDto,
  exceptionDto,
  exceptionRecoveryContextDto,
} from "./dto.ts";
import {
  assertAutomaticAllocationCommandEligible,
  buildAutomaticAllocationPlan,
  minorUnitsDecimal,
  monetaryMinorUnits,
  resolveReceiptInvoiceReferenceAuthority,
} from "./authority.ts";
import {
  type AutomationSourceDocument,
  canonicalJson,
  containsControlCharacter,
  requiredId,
  type Row,
  sha256,
  STORAGE_BUCKET,
} from "./service-base.ts";
import { AutomationReminderService } from "./reminder-service.ts";
export abstract class AutomationAllocationService
  extends AutomationReminderService {
  protected async proposeAndAllocateReceipt(
    auth: AuthContext,
    command: Row,
    extraction: FinancialExtraction,
  ): Promise<Row | null> {
    if (
      extraction.document_type !== "receipt" ||
      !command.id ||
      !(command.resulting_receipt_id ?? command.resulting_record_id)
    ) {
      return null;
    }
    const receiptId = String(
      command.resulting_receipt_id ?? command.resulting_record_id,
    );
    const { data: receiptRaw, error: receiptError } = await this.client
      .from("receipts")
      .select("id,customer_id,currency,status,unallocated_amount")
      .eq("id", receiptId)
      .eq("company_id", auth.companyId)
      .maybeSingle();
    if (receiptError) throw receiptError;
    const receipt = requiredId(receiptRaw as Row | null, "Receipt", receiptId);
    const references = [
      ...new Set(
        extraction.invoice_references.map((value) => value.trim()).filter(
          Boolean,
        ),
      ),
    ].slice(0, 100);
    let invoices: Row[];
    if (references.length > 0) {
      const eligibleInvoiceQuery = (field: "invoice_no" | "reference_no") =>
        this.client.from("invoices")
          .select(
            "id,company_id,invoice_no,reference_no,customer_id,currency,status,outstanding",
            { count: "exact" },
          )
          .eq("company_id", auth.companyId)
          .eq("customer_id", receipt.customer_id)
          .eq("currency", receipt.currency)
          .in("status", ["Open", "Overdue", "Partially Paid"])
          .gt("outstanding", 0)
          .in(field, references)
          .order("invoice_no", { ascending: true })
          .order("id", { ascending: true })
          .limit(201);
      const {
        data: internalMatches,
        error: internalError,
        count: internalCount,
      } = await eligibleInvoiceQuery("invoice_no");
      if (internalError) throw internalError;
      const {
        data: externalMatches,
        error: externalError,
        count: externalCount,
      } = await eligibleInvoiceQuery("reference_no");
      if (externalError) throw externalError;
      if (
        (internalCount ?? internalMatches?.length ?? 0) >
          (internalMatches?.length ?? 0) ||
        (externalCount ?? externalMatches?.length ?? 0) >
          (externalMatches?.length ?? 0)
      ) {
        await this.createAllocationException(
          auth,
          command,
          receiptId,
          "critical_identifier_unverified",
          "INVOICE_REFERENCE_CANDIDATE_LIMIT_EXCEEDED",
        );
        return null;
      }
      const resolution = resolveReceiptInvoiceReferenceAuthority(
        references,
        [
          ...((internalMatches ?? []) as Row[]),
          ...((externalMatches ?? []) as Row[]),
        ],
        {
          company_id: auth.companyId,
          customer_id: String(receipt.customer_id),
          currency: String(receipt.currency),
        },
      );
      if (!resolution.ok) {
        await this.createAllocationException(
          auth,
          command,
          receiptId,
          "critical_identifier_unverified",
          resolution.error_code,
        );
        return null;
      }
      invoices = resolution.invoices;
    } else {
      const available = monetaryMinorUnits(receipt.unallocated_amount);
      if (available <= 0n) return null;
      const { data, error } = await this.client.from("invoices")
        .select(
          "id,company_id,invoice_no,reference_no,customer_id,currency,status,outstanding",
        )
        .eq("company_id", auth.companyId)
        .eq("customer_id", receipt.customer_id)
        .eq("currency", receipt.currency)
        .in("status", ["Open", "Overdue", "Partially Paid"])
        .eq("outstanding", minorUnitsDecimal(available))
        .order("invoice_no", { ascending: true })
        .order("id", { ascending: true })
        .limit(2);
      if (error) throw error;
      invoices = (data ?? []) as Row[];
    }
    const plan = buildAutomaticAllocationPlan({
      receipt_unallocated: receipt.unallocated_amount,
      invoice_references: references,
      payment_reference: extraction.reference_no,
      invoices,
    });
    if (!plan.ok) {
      await this.createAllocationException(
        auth,
        command,
        receiptId,
        "allocation_evidence_insufficient",
        plan.error_code,
      );
      return null;
    }
    return await this.persistAutomaticAllocation(auth, String(command.id), {
      receipt_id: receiptId,
      evidence_type: plan.evidence_type,
      evidence: plan.evidence,
      allocations: plan.allocations,
    });
  }

  protected async createAllocationException(
    auth: AuthContext,
    command: Row,
    receiptId: string,
    reasonCode:
      | "allocation_evidence_insufficient"
      | "allocation_currency_mismatch"
      | "allocation_conflict"
      | "concurrency_conflict"
      | "critical_identifier_unverified",
    errorCode: string,
  ): Promise<void> {
    await this.createException(auth.companyId, {
      mailbox_id: command.mailbox_id,
      message_id: command.message_id,
      attachment_id: command.attachment_id,
      command_id: command.id,
      receipt_id: receiptId,
      reason_code: reasonCode,
      lifecycle_status: "open",
      safe_details: { error_code: errorCode },
      idempotency_key: await sha256(
        `allocation_exception:${auth.companyId}:${command.id}:${receiptId}:${reasonCode}:${errorCode}`,
      ),
      actor_user_id: auth.userId,
    });
  }

  async allocateCommand(
    auth: AuthContext,
    commandId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Clerk", "AR Supervisor", "Finance Manager"]);
    validateUUID(commandId, "command_id");
    const { data: commandRaw, error } = await this.client
      .from("automation_commands")
      .select("*, extraction:automation_extraction_results(extracted_fields)")
      .eq("id", commandId)
      .eq("company_id", auth.companyId)
      .maybeSingle();
    if (error) throw error;
    const command = requiredId(
      commandRaw as Row | null,
      "AutomationCommand",
      commandId,
    );
    assertAutomaticAllocationCommandEligible(command);
    const extraction = command.extraction as Row | null;
    const extractedFields = extraction?.extracted_fields;
    if (
      !extractedFields || typeof extractedFields !== "object" ||
      Array.isArray(extractedFields)
    ) {
      throw new BusinessError(
        "ALLOCATION_EVIDENCE_INSUFFICIENT",
        "Stored document evidence is unavailable for automatic allocation.",
        409,
      );
    }
    const result = await this.proposeAndAllocateReceipt(
      auth,
      command,
      extractedFields as FinancialExtraction,
    );
    if (!result) {
      throw new BusinessError(
        "ALLOCATION_EVIDENCE_INSUFFICIENT",
        "Stored document evidence is insufficient for automatic allocation.",
        409,
      );
    }
    return allocationResultDto(commandId, result);
  }

  protected async persistAutomaticAllocation(
    auth: AuthContext,
    commandId: string,
    input: Row,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Clerk", "AR Supervisor", "Finance Manager"]);
    validateUUID(commandId, "command_id");
    assertExactKeys(input, [
      "receipt_id",
      "evidence_type",
      "evidence",
      "allocations",
    ], ["receipt_id", "evidence_type", "evidence", "allocations"]);
    const receiptId = String(input.receipt_id);
    validateUUID(receiptId, "receipt_id");
    const evidenceTypes = [
      "exact_invoice_reference",
      "exact_amount_single_invoice",
      "explicit_partial_reference",
      "explicit_multi_invoice_references",
    ] as const;
    if (
      !evidenceTypes.includes(
        input.evidence_type as typeof evidenceTypes[number],
      )
    ) {
      throw new ValidationError("Unsupported allocation evidence_type.");
    }
    if (
      !input.evidence || typeof input.evidence !== "object" ||
      Array.isArray(input.evidence)
    ) {
      throw new ValidationError("evidence must be an object.");
    }
    const evidence = input.evidence as Row;
    assertExactKeys(evidence, [
      "invoice_references",
      "payment_reference",
      "source",
    ]);
    if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
      throw new ValidationError("allocations must be a non-empty array.");
    }
    if (input.allocations.length > 100) {
      throw new ValidationError("allocations must not exceed 100 entries.");
    }
    const allocations = input.allocations.map((candidate) => {
      if (
        !candidate || typeof candidate !== "object" || Array.isArray(candidate)
      ) {
        throw new ValidationError("Each allocation must be an object.");
      }
      const allocation = candidate as Row;
      assertExactKeys(allocation, [
        "invoice_id",
        "amount",
        "discount_amount",
      ], ["invoice_id", "amount"]);
      validateUUID(String(allocation.invoice_id), "invoice_id");
      for (const field of ["amount", "discount_amount"] as const) {
        if (allocation[field] === undefined) continue;
        if (
          typeof allocation[field] !== "string" ||
          !/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(
            allocation[field] as string,
          )
        ) {
          throw new ValidationError(
            `${field} must be a non-negative decimal string with at most two decimals.`,
          );
        }
      }
      if (/^0(?:\.0{1,2})?$/.test(String(allocation.amount))) {
        throw new ValidationError("amount must be greater than zero.");
      }
      return {
        invoice_id: allocation.invoice_id,
        amount: allocation.amount,
        discount_amount: allocation.discount_amount ?? "0.00",
      };
    }).sort((left, right) =>
      String(left.invoice_id).localeCompare(String(right.invoice_id))
    );
    const idempotencyKey = await sha256(canonicalJson({
      company_id: auth.companyId,
      command_id: commandId,
      receipt_id: receiptId,
      evidence_type: input.evidence_type,
      evidence,
      allocations,
      schema_version: 1,
    }));
    try {
      return await callRpc<Row>(
        this.client,
        "automation_allocate_receipt",
        {
          p_company_id: auth.companyId,
          p_actor_user_id: auth.userId,
          p_command_id: commandId,
          p_receipt_id: receiptId,
          p_evidence_type: input.evidence_type,
          p_evidence: evidence,
          p_allocations: allocations,
          p_idempotency_key: idempotencyKey,
        },
      );
    } catch (error) {
      const code =
        error instanceof BusinessError || error instanceof ConflictError
          ? error.code
          : "INTERNAL_PROCESSING_FAILURE";
      const reasonCode = code === "BR-AUTO-ALLOC-MISMATCH"
        ? "allocation_currency_mismatch"
        : code === "CONFLICT"
        ? "allocation_conflict"
        : code === "BR-AUTO-ALLOC-EVIDENCE" ||
            code === "BR-AUTO-FX-UNAVAILABLE"
        ? "allocation_evidence_insufficient"
        : "internal_processing_failure";
      await this.createException(auth.companyId, {
        command_id: commandId,
        receipt_id: receiptId,
        reason_code: reasonCode,
        lifecycle_status: "open",
        safe_details: { error_code: code },
        actor_user_id: auth.userId,
      });
      throw error;
    }
  }

  async retryException(auth: AuthContext, id: string): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(id, "id");
    const { data: exceptionRaw, error } = await this.client.from(
      "automation_exceptions",
    )
      .select("*").eq("id", id).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    const exception = requiredId(
      exceptionRaw as Row | null,
      "AutomationException",
      id,
    );
    if (
      exception.lifecycle_status !== "retryable" ||
      Number(exception.retry_count) >= Number(exception.max_retries)
    ) {
      throw new BusinessError(
        "EXCEPTION_NOT_RETRYABLE",
        "Automation exception is not retryable.",
        409,
      );
    }
    try {
      if (
        exception.command_id &&
        ["invoice_conflict", "receipt_conflict"].includes(
          String(exception.reason_code),
        )
      ) {
        const { data: command, error: commandError } = await this.client
          .from("automation_commands").select("extraction_id")
          .eq("id", exception.command_id).eq("company_id", auth.companyId)
          .maybeSingle();
        if (commandError) throw commandError;
        if (!command) {
          throw new NotFoundError(
            "AutomationCommand",
            String(exception.command_id),
          );
        }
        await this.executeCommand(auth, String(command.extraction_id));
      } else if (exception.attachment_id) {
        await this.processAttachment(auth, String(exception.attachment_id));
      } else if (
        exception.mailbox_id &&
        [
          "mailbox_reconnect_required",
          "provider_unavailable",
          "internal_processing_failure",
        ].includes(String(exception.reason_code))
      ) {
        await this.syncMailbox(auth, String(exception.mailbox_id));
      } else if (
        exception.invoice_id &&
        ["missing_salesman", "invalid_salesman_email"].includes(
          String(exception.reason_code),
        )
      ) {
        const { data: invoice, error: invoiceError } = await this.client
          .from("invoices").select("due_date")
          .eq("id", exception.invoice_id).eq("company_id", auth.companyId)
          .maybeSingle();
        if (invoiceError) throw invoiceError;
        if (!invoice) {
          throw new NotFoundError("Invoice", String(exception.invoice_id));
        }
        const details = exception.safe_details as Row;
        const offset = Number(details.stage_offset_days);
        if (!Number.isInteger(offset) || offset < -90 || offset > 0) {
          throw new BusinessError(
            "EXCEPTION_RETRY_CONTEXT_INVALID",
            "Reminder retry context is invalid.",
            409,
          );
        }
        const evaluation = new Date(`${invoice.due_date}T00:00:00.000Z`);
        evaluation.setUTCDate(evaluation.getUTCDate() + offset);
        await this.evaluateReminders(
          auth,
          evaluation.toISOString().slice(0, 10),
        );
      } else if (
        exception.reason_code === "provider_delivery_failed"
      ) {
        const details = exception.safe_details as Row;
        validateUUID(String(details.reminder_id), "reminder_id");
        validateUUID(String(details.mailbox_id), "mailbox_id");
        await this.deliverReminder(
          auth,
          String(details.reminder_id),
          String(details.mailbox_id),
        );
      } else {
        throw new BusinessError(
          "EXCEPTION_NOT_RETRYABLE",
          "Automation exception has no safe retry path.",
          409,
        );
      }
      const completedAt = this.now().toISOString();
      const { data, error: updateError } = await this.client.from(
        "automation_exceptions",
      ).update({
        lifecycle_status: "resolved",
        retry_count: Number(exception.retry_count) + 1,
        actor_user_id: auth.userId,
        resolution_note: "Authoritative retry completed successfully.",
        resolved_at: completedAt,
        updated_at: completedAt,
      }).eq("id", id).eq("company_id", auth.companyId).select("*").single();
      if (updateError) throw updateError;
      return exceptionDto(data as Row);
    } catch (retryError) {
      const { error: retryUpdateError } = await this.client.from(
        "automation_exceptions",
      ).update({
        lifecycle_status: "retryable",
        retry_count: Number(exception.retry_count) + 1,
        actor_user_id: auth.userId,
        updated_at: this.now().toISOString(),
      }).eq("id", id).eq("company_id", auth.companyId);
      if (retryUpdateError) throw retryUpdateError;
      throw retryError;
    }
  }

  async getExceptionRecoveryContext(
    auth: AuthContext,
    exceptionId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(exceptionId, "exception_id");
    return exceptionRecoveryContextDto(
      await callRpc<Row>(
        this.client,
        "automation_recovery_context",
        {
          p_company_id: auth.companyId,
          p_actor_user_id: auth.userId,
          p_exception_id: exceptionId,
        },
      ),
    );
  }

  async recordExceptionRecovery(
    auth: AuthContext,
    exceptionId: string,
    input: Row,
  ): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager"]);
    validateUUID(exceptionId, "exception_id");
    assertExactKeys(
      input,
      ["action_type", "invoice_id", "corrected_reference", "resolution_note"],
      ["action_type", "invoice_id", "resolution_note"],
    );
    if (
      input.action_type !== "correct_invoice_external_reference" &&
      input.action_type !== "confirm_receipt_invoice_match"
    ) {
      throw new ValidationError("action_type is invalid.");
    }
    validateUUID(String(input.invoice_id), "invoice_id");
    const note = requireBoundedText(
      input.resolution_note,
      "resolution_note",
      500,
    );
    const correctedReference = input.action_type ===
        "correct_invoice_external_reference"
      ? requireBoundedText(
        input.corrected_reference,
        "corrected_reference",
        50,
      )
      : null;
    if (correctedReference && containsControlCharacter(correctedReference)) {
      throw new ValidationError(
        "corrected_reference must not contain control characters.",
      );
    }
    if (
      input.action_type === "confirm_receipt_invoice_match" &&
      input.corrected_reference !== undefined
    ) {
      throw new ValidationError(
        "corrected_reference is accepted only for Invoice reference correction.",
      );
    }
    const idempotencyKey = await sha256(canonicalJson({
      company_id: auth.companyId,
      exception_id: exceptionId,
      invoice_id: input.invoice_id,
      action_type: input.action_type,
      corrected_reference: correctedReference,
      resolution_note: note,
      actor_user_id: auth.userId,
      schema_version: 1,
    }));
    await callRpc<Row>(this.client, "automation_record_exception_recovery", {
      p_company_id: auth.companyId,
      p_actor_user_id: auth.userId,
      p_exception_id: exceptionId,
      p_invoice_id: input.invoice_id,
      p_action_type: input.action_type,
      p_corrected_reference: correctedReference,
      p_resolution_note: note,
      p_idempotency_key: idempotencyKey,
    });
    return await this.getExceptionRecoveryContext(auth, exceptionId);
  }

  async retryExceptionMatching(
    auth: AuthContext,
    exceptionId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager"]);
    validateUUID(exceptionId, "exception_id");
    const result = await callRpc<Row>(
      this.client,
      "automation_retry_exception_matching",
      {
        p_company_id: auth.companyId,
        p_actor_user_id: auth.userId,
        p_exception_id: exceptionId,
      },
    );
    return allocationResultDto(String(result.command_id), result);
  }

  async getExceptionSourceDocument(
    auth: AuthContext,
    exceptionId: string,
    invoiceId?: string,
  ): Promise<AutomationSourceDocument> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(exceptionId, "exception_id");
    if (invoiceId) validateUUID(invoiceId, "invoice_id");
    const { data: exception, error } = await this.client
      .from("automation_exceptions")
      .select("id,attachment_id,receipt_id,reason_code")
      .eq("id", exceptionId).eq("company_id", auth.companyId)
      .eq("reason_code", "critical_identifier_unverified")
      .maybeSingle();
    if (error) throw error;
    const recoverable = requiredId(
      exception as Row | null,
      "AutomationException",
      exceptionId,
    );
    let attachmentId = String(recoverable.attachment_id ?? "");
    if (invoiceId) {
      const context = await this.getExceptionRecoveryContext(auth, exceptionId);
      const eligible = context.eligible_invoices as Row[];
      if (!eligible.some((row) => row.invoice_id === invoiceId)) {
        throw new NotFoundError("EligibleInvoice", invoiceId);
      }
      const { data: command, error: commandError } = await this.client
        .from("automation_commands")
        .select("attachment_id")
        .eq("company_id", auth.companyId)
        .eq("resulting_invoice_id", invoiceId)
        .eq("command_type", "create_invoice")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1).maybeSingle();
      if (commandError) throw commandError;
      attachmentId = String(command?.attachment_id ?? "");
    }
    if (!attachmentId) {
      throw new NotFoundError("AutomationSourceDocument", exceptionId);
    }
    const { data: attachment, error: attachmentError } = await this.client
      .from("automation_source_attachments")
      .select(
        "id,original_file_name,detected_mime_type,safe_storage_path,content_purged_at",
      )
      .eq("id", attachmentId).eq("company_id", auth.companyId)
      .maybeSingle();
    if (attachmentError) throw attachmentError;
    const source = requiredId(
      attachment as Row | null,
      "AutomationSourceAttachment",
      attachmentId,
    );
    if (source.content_purged_at !== null || !source.safe_storage_path) {
      throw new BusinessError(
        "ATTACHMENT_UNAVAILABLE",
        "The source document is no longer available.",
        409,
      );
    }
    const { data: body, error: storageError } = await this.client.storage
      .from(STORAGE_BUCKET).download(String(source.safe_storage_path));
    if (storageError) throw storageError;
    return {
      body,
      fileName: String(source.original_file_name).replace(/[\r\n"\\]/g, "_")
        .slice(0, 255),
      mimeType: String(source.detected_mime_type),
    };
  }

  async closeException(
    auth: AuthContext,
    id: string,
    lifecycle: "resolved" | "dismissed",
    note: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(id, "id");
    if (!note.trim()) throw new ValidationError("resolution_note is required.");
    const timestamp = this.now().toISOString();
    const { data, error } = await this.client.from("automation_exceptions")
      .update({
        lifecycle_status: lifecycle,
        resolution_note: note.trim().slice(0, 1000),
        actor_user_id: auth.userId,
        updated_at: timestamp,
        ...(lifecycle === "resolved"
          ? { resolved_at: timestamp }
          : { dismissed_at: timestamp }),
      }).eq("id", id).eq("company_id", auth.companyId).select("*")
      .maybeSingle();
    if (error) throw error;
    return exceptionDto(
      requiredId(data as Row | null, "AutomationException", id),
    );
  }
}

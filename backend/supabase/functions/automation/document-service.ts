import type { AuthContext } from "../_shared/auth.ts";
import { requireAnyRole, requireRole } from "../_shared/auth.ts";
import {
  BusinessError,
  ConflictError,
  ValidationError,
} from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import { InvoiceService } from "../invoices/service.ts";
import { ReceiptService } from "../receipts/service.ts";
import type {
  CreateInvoiceInput,
  CreateInvoiceLineInput,
} from "../invoices/validators.ts";
import type { CreateReceiptInput } from "../receipts/validators.ts";
import {
  type AutomationOperatingMode,
  type FinancialExtraction,
  normalizeEmail,
} from "./contract.ts";
import {
  assertProviderTextIsDataOnly,
  type DocumentIntelligenceResult,
  validateDocumentResult,
} from "./document.ts";
import { commandDto, documentProcessingResultDto } from "./dto.ts";
import {
  customerResolutionFailureMayRecover,
  exactAutomationDecimalNumber,
  isAutomationExceptionIdempotencyConflict,
} from "./authority.ts";
import {
  AUTOMATION_CUSTOMER_CODE_DATABASE_COLUMN,
  AUTOMATION_CUSTOMER_RESOLUTION_SELECT,
  documentExceptionReason,
  requiredId,
  type Row,
  sha256,
  STORAGE_BUCKET,
} from "./service-base.ts";
import { AutomationMailboxService } from "./mailbox-service.ts";
export abstract class AutomationDocumentService
  extends AutomationMailboxService {
  protected async createException(
    companyId: string,
    input: Row,
  ): Promise<void> {
    const row = {
      company_id: companyId,
      lifecycle_status: "open",
      ...input,
    };
    const { error } = await this.client.from("automation_exceptions").insert(
      row,
    );
    if (
      error &&
      !(input.idempotency_key &&
        isAutomationExceptionIdempotencyConflict(error))
    ) {
      throw error;
    }
  }

  async processAttachment(
    auth: AuthContext,
    attachmentId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(attachmentId, "attachment_id");
    try {
      const result = await this.processAttachmentDecision(auth, attachmentId);
      await this.setAttachmentProcessingStatus(
        auth.companyId,
        attachmentId,
        "processed",
      );
      return documentProcessingResultDto(result);
    } catch (error) {
      const code = error instanceof BusinessError
        ? error.code
        : "INTERNAL_PROCESSING_FAILURE";
      await this.setAttachmentProcessingStatus(
        auth.companyId,
        attachmentId,
        [
            "DOCUMENT_INTELLIGENCE_DISABLED",
            "PROVIDER_UNAVAILABLE",
            "INTERNAL_PROCESSING_FAILURE",
          ].includes(code)
          ? "retryable"
          : "processed",
      );
      throw error;
    }
  }

  protected async setAttachmentProcessingStatus(
    companyId: string,
    attachmentId: string,
    processingStatus: "retryable" | "processed",
  ): Promise<void> {
    const { error } = await this.client.from("automation_source_attachments")
      .update({ processing_status: processingStatus })
      .eq("id", attachmentId)
      .eq("company_id", companyId)
      .neq("processing_status", "processed");
    if (error) throw error;
  }

  protected async processAttachmentDecision(
    auth: AuthContext,
    attachmentId: string,
  ): Promise<Row> {
    const settings = await this.getSettings(auth);
    if (
      settings.operating_mode === "disabled" ||
      settings.document_intelligence_enabled !== true ||
      !this.documentProvider.enabled
    ) {
      throw new BusinessError(
        "DOCUMENT_INTELLIGENCE_DISABLED",
        "Document intelligence is disabled.",
        409,
      );
    }
    const { data: attachmentRaw, error } = await this.client
      .from("automation_source_attachments").select("*")
      .eq("id", attachmentId).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    const attachment = requiredId(
      attachmentRaw as Row | null,
      "Attachment",
      attachmentId,
    );
    if (
      attachment.safety_status !== "accepted" ||
      attachment.content_purged_at !== null
    ) {
      throw new BusinessError(
        "ATTACHMENT_UNAVAILABLE",
        "The attachment is not eligible for document processing.",
        409,
      );
    }
    const { data: existingClassification, error: existingClassError } =
      await this.client.from("automation_document_classifications").select("*")
        .eq("attachment_id", attachmentId).eq("schema_version", 1)
        .eq("company_id", auth.companyId).maybeSingle();
    if (existingClassError) throw existingClassError;
    if (existingClassification) {
      const { data: existingExtraction, error: existingExtractionError } =
        await this.client.from("automation_extraction_results").select("*")
          .eq("classification_id", existingClassification.id)
          .eq("schema_version", 1).eq("company_id", auth.companyId)
          .maybeSingle();
      if (existingExtractionError) throw existingExtractionError;
      if (!existingExtraction) return existingClassification as Row;
      if (existingExtraction.validation_status === "valid") {
        return {
          classification: existingClassification,
          extraction: existingExtraction,
        };
      }
      if (
        ["invalid", "ambiguous"].includes(
          String(existingExtraction.validation_status),
        )
      ) {
        const validationCodes = Array.isArray(
            existingExtraction.validation_codes,
          )
          ? existingExtraction.validation_codes.map(String)
          : [];
        if (!customerResolutionFailureMayRecover(validationCodes)) {
          return {
            classification: existingClassification,
            extraction: existingExtraction,
          };
        }
        const fields = existingExtraction
          .extracted_fields as FinancialExtraction;
        const resolved = await this.resolveCustomer(
          auth,
          fields.customer,
          fields.document_type === "receipt" ? fields.invoice_references : [],
        );
        await this.assertNoFinancialIdentifierConflict(
          auth,
          fields,
          resolved.customer_id,
        );
        const { data: recovered, error: recoveryError } = await this.client
          .from("automation_extraction_results").update({
            validation_status: "valid",
            validation_codes: [],
            customer_id: resolved.customer_id,
            customer_resolution_method: resolved.method,
            validated_at: this.now().toISOString(),
          }).eq("id", existingExtraction.id).eq("company_id", auth.companyId)
          .select("*").single();
        if (recoveryError) throw recoveryError;
        return {
          classification: existingClassification,
          extraction: recovered,
        };
      }
      return {
        classification: existingClassification,
        extraction: existingExtraction,
      };
    }
    const { data: file, error: downloadError } = await this.client.storage
      .from(STORAGE_BUCKET).download(String(attachment.safe_storage_path));
    if (downloadError) throw downloadError;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const input = {
      file_name: String(attachment.original_file_name),
      detected_mime_type: String(attachment.detected_mime_type),
      sha256: String(attachment.sha256),
      bytes,
    };
    assertProviderTextIsDataOnly(input);
    let result: DocumentIntelligenceResult;
    try {
      result = validateDocumentResult(
        await this.documentProvider.analyze(input),
        {
          overall: Number(settings.minimum_overall_confidence),
          critical: Number(settings.minimum_critical_confidence),
        },
      );
    } catch (providerError) {
      const reasonCode = documentExceptionReason(providerError);
      await this.createException(auth.companyId, {
        mailbox_id: attachment.mailbox_id,
        message_id: attachment.message_id,
        attachment_id: attachmentId,
        reason_code: reasonCode,
        lifecycle_status: reasonCode === "provider_unavailable"
          ? "retryable"
          : "open",
        safe_details: {
          error_code: providerError instanceof BusinessError ||
              providerError instanceof ValidationError
            ? providerError.code
            : "INTERNAL_PROCESSING_FAILURE",
        },
        actor_user_id: auth.userId,
      });
      throw providerError;
    }
    const classificationRecord = {
      company_id: auth.companyId,
      attachment_id: attachmentId,
      schema_version: result.classification.schema_version,
      provider_name: result.classification.provider,
      provider_model: result.classification.model,
      provider_version: result.classification.provider_version,
      document_type: result.classification.document_type,
      confidence: result.classification.confidence,
      critical_confidence: result.classification.critical_field_confidence,
      status:
        ["invoice", "receipt"].includes(result.classification.document_type)
          ? "accepted"
          : "rejected",
      trace_id: result.classification.trace_id,
    };
    const { data: classificationInserted, error: classError } = await this
      .client.from("automation_document_classifications").upsert(
        classificationRecord,
        {
          onConflict: "attachment_id,schema_version",
          ignoreDuplicates: true,
        },
      ).select("*").maybeSingle();
    if (classError) throw classError;
    let classification = classificationInserted as Row | null;
    if (!classification) {
      const { data: existing, error: existingError } = await this.client
        .from("automation_document_classifications").select("*")
        .eq("attachment_id", attachmentId).eq("schema_version", 1)
        .eq("company_id", auth.companyId).maybeSingle();
      if (existingError) throw existingError;
      classification = requiredId(
        existing as Row | null,
        "DocumentClassification",
        attachmentId,
      );
    }
    if (!result.extraction) {
      await this.createException(auth.companyId, {
        mailbox_id: attachment.mailbox_id,
        message_id: attachment.message_id,
        attachment_id: attachmentId,
        reason_code: result.classification.document_type === "ambiguous"
          ? "ambiguous_classification"
          : "unsupported_document",
        safe_details: {
          classification_id: classification.id,
          document_type: result.classification.document_type,
        },
        actor_user_id: auth.userId,
      });
      return classification as Row;
    }

    let customerId: { customer_id: string; method: string };
    try {
      customerId = await this.resolveCustomer(
        auth,
        result.extraction.customer,
        result.extraction.document_type === "receipt"
          ? result.extraction.invoice_references
          : [],
      );
    } catch (resolutionError) {
      const reasonCode = documentExceptionReason(resolutionError);
      const { data: rejectedExtraction, error: rejectedError } = await this
        .client.from("automation_extraction_results").upsert({
          company_id: auth.companyId,
          classification_id: classification.id,
          schema_version: 1,
          provider_name: result.classification.provider,
          provider_model: result.classification.model,
          provider_version: result.classification.provider_version,
          extracted_fields: result.extraction,
          field_confidence: result.field_confidence,
          validation_status: reasonCode === "customer_ambiguous"
            ? "ambiguous"
            : "invalid",
          validation_codes: [reasonCode],
          customer_id: null,
          customer_resolution_method: null,
          trace_id: result.classification.trace_id,
          validated_at: this.now().toISOString(),
        }, { onConflict: "classification_id,schema_version" }).select("*")
        .single();
      if (rejectedError) throw rejectedError;
      await this.createException(auth.companyId, {
        mailbox_id: attachment.mailbox_id,
        message_id: attachment.message_id,
        attachment_id: attachmentId,
        reason_code: reasonCode,
        lifecycle_status: "retryable",
        safe_details: {
          classification_id: classification.id,
          extraction_id: rejectedExtraction.id,
        },
        actor_user_id: auth.userId,
      });
      return {
        classification,
        extraction: rejectedExtraction,
      };
    }
    try {
      await this.assertNoFinancialIdentifierConflict(
        auth,
        result.extraction,
        customerId.customer_id,
      );
    } catch (conflictError) {
      const reasonCode = result.extraction.document_type === "invoice"
        ? "invoice_conflict"
        : "receipt_conflict";
      const { data: rejectedExtraction, error: rejectedError } = await this
        .client.from("automation_extraction_results").upsert({
          company_id: auth.companyId,
          classification_id: classification.id,
          schema_version: 1,
          provider_name: result.classification.provider,
          provider_model: result.classification.model,
          provider_version: result.classification.provider_version,
          extracted_fields: result.extraction,
          field_confidence: result.field_confidence,
          validation_status: "invalid",
          validation_codes: [reasonCode],
          customer_id: customerId.customer_id,
          customer_resolution_method: customerId.method,
          trace_id: result.classification.trace_id,
          validated_at: this.now().toISOString(),
        }, { onConflict: "classification_id,schema_version" }).select("*")
        .single();
      if (rejectedError) throw rejectedError;
      await this.createException(auth.companyId, {
        mailbox_id: attachment.mailbox_id,
        message_id: attachment.message_id,
        attachment_id: attachmentId,
        reason_code: reasonCode,
        lifecycle_status: "open",
        safe_details: {
          classification_id: classification.id,
          extraction_id: rejectedExtraction.id,
          error_code: conflictError instanceof BusinessError
            ? conflictError.code
            : "FINANCIAL_IDENTIFIER_CONFLICT",
        },
        actor_user_id: auth.userId,
      });
      return {
        classification,
        extraction: rejectedExtraction,
      };
    }
    const { data: extraction, error: extractionError } = await this.client
      .from("automation_extraction_results").upsert({
        company_id: auth.companyId,
        classification_id: classification.id,
        schema_version: 1,
        provider_name: result.classification.provider,
        provider_model: result.classification.model,
        provider_version: result.classification.provider_version,
        extracted_fields: result.extraction,
        field_confidence: result.field_confidence,
        validation_status: "valid",
        validation_codes: [],
        customer_id: customerId.customer_id,
        customer_resolution_method: customerId.method,
        trace_id: result.classification.trace_id,
        validated_at: this.now().toISOString(),
      }, { onConflict: "classification_id,schema_version" }).select("*")
      .single();
    if (extractionError) throw extractionError;
    return { classification, extraction };
  }

  protected async assertNoFinancialIdentifierConflict(
    auth: AuthContext,
    extraction: FinancialExtraction,
    customerId: string,
  ): Promise<void> {
    const reference = extraction.reference_no?.trim();
    if (!reference) return;
    const table = extraction.document_type === "invoice"
      ? "invoices"
      : "receipts";
    const { count, error } = await this.client.from(table).select("id", {
      count: "exact",
      head: true,
    })
      .eq("company_id", auth.companyId)
      .eq("customer_id", customerId)
      .eq("reference_no", reference);
    if (error) throw error;
    if ((count ?? 0) > 0) {
      throw new BusinessError(
        extraction.document_type === "invoice"
          ? "INVOICE_CONFLICT"
          : "RECEIPT_CONFLICT",
        "A financial record with this source reference already exists.",
        409,
      );
    }
  }

  protected async resolveCustomer(
    auth: AuthContext,
    extracted: {
      customer_code?: string;
      registration_identifier?: string;
      email?: string;
      company_name?: string;
      invoice_reference?: string;
    },
    invoiceReferences: readonly string[],
  ): Promise<{ customer_id: string; method: string }> {
    const columns = AUTOMATION_CUSTOMER_RESOLUTION_SELECT;
    const resolve = (
      rows: readonly Row[],
      method: string,
    ): { customer_id: string; method: string } | null => {
      const unique = [...new Map(
        rows.map((row) => [String(row.id), row]),
      ).values()];
      if (unique.length > 1) {
        throw new BusinessError(
          "CUSTOMER_AMBIGUOUS",
          "Customer resolution is ambiguous.",
        );
      }
      return unique.length === 1
        ? { customer_id: String(unique[0].id), method }
        : null;
    };
    const base = () =>
      this.client.from("customers").select(columns)
        .eq("company_id", auth.companyId)
        .eq("is_deleted", false).eq("is_hidden", false);

    if (extracted.customer_code?.trim()) {
      const { data, error } = await base().eq(
        AUTOMATION_CUSTOMER_CODE_DATABASE_COLUMN,
        extracted.customer_code.trim(),
      ).limit(2);
      if (error) throw error;
      const match = resolve((data ?? []) as Row[], "customer_code");
      if (match) return match;
    }
    if (extracted.registration_identifier?.trim()) {
      const identifier = extracted.registration_identifier.trim();
      const [registration, tax] = await Promise.all([
        base().eq("registration_no", identifier).limit(2),
        base().eq("tax_id", identifier).limit(2),
      ]);
      if (registration.error) throw registration.error;
      if (tax.error) throw tax.error;
      const match = resolve(
        [...(registration.data ?? []), ...(tax.data ?? [])] as Row[],
        "registration_identifier",
      );
      if (match) return match;
    }
    if (extracted.email?.trim()) {
      const { data, error } = await base().eq(
        "contact_email",
        normalizeEmail(extracted.email, "customer.email"),
      ).limit(2);
      if (error) throw error;
      const match = resolve((data ?? []) as Row[], "known_email");
      if (match) return match;
    }
    const exactInvoiceReferences = [
      ...(extracted.invoice_reference?.trim()
        ? [extracted.invoice_reference.trim()]
        : []),
      ...invoiceReferences.map((reference) => reference.trim()).filter(Boolean),
    ];
    if (exactInvoiceReferences.length > 0) {
      const { data: invoices, error: invoiceError } = await this.client
        .from("invoices").select("customer_id")
        .eq("company_id", auth.companyId)
        .in("invoice_no", [...new Set(exactInvoiceReferences)])
        .limit(101);
      if (invoiceError) throw invoiceError;
      const customerIds = [
        ...new Set(
          (invoices ?? []).map((invoice: Row) => String(invoice.customer_id)),
        ),
      ];
      if (customerIds.length > 1) {
        throw new BusinessError(
          "CUSTOMER_AMBIGUOUS",
          "Invoice references resolve to different customers.",
        );
      }
      if (customerIds.length === 1) {
        const { data, error } = await base().eq("id", customerIds[0]).limit(1);
        if (error) throw error;
        const match = resolve((data ?? []) as Row[], "invoice_reference");
        if (match) return match;
      }
    }
    if (extracted.company_name?.trim()) {
      const normalized = extracted.company_name.trim().toLocaleLowerCase("en");
      const pattern = extracted.company_name.trim()
        .replaceAll("\\", "\\\\").replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
      const { data, error } = await base().ilike("customer_name", pattern)
        .limit(3);
      if (error) throw error;
      const exact = ((data ?? []) as Row[]).filter((row) =>
        String(row.customer_name).trim().toLocaleLowerCase("en") === normalized
      );
      const match = resolve(exact, "unique_normalized_name");
      if (match) return match;
    }
    throw new BusinessError(
      "CUSTOMER_UNRESOLVED",
      "Customer could not be resolved.",
    );
  }

  async executeCommand(auth: AuthContext, extractionId: string): Promise<Row> {
    requireRole(auth, "AR Clerk");
    validateUUID(extractionId, "extraction_id");
    const settings = await this.getSettings(auth);
    const mode = settings.operating_mode as AutomationOperatingMode;
    if (mode === "disabled") {
      throw new BusinessError(
        "AUTOMATION_DISABLED",
        "Financial automation is disabled.",
        409,
      );
    }
    const { data: extractionRaw, error } = await this.client
      .from("automation_extraction_results")
      .select(
        "*, classification:automation_document_classifications(*, attachment:automation_source_attachments(*, message:automation_source_messages(*)))",
      )
      .eq("id", extractionId).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    const extraction = requiredId(
      extractionRaw as Row | null,
      "Extraction",
      extractionId,
    );
    if (extraction.validation_status !== "valid") {
      throw new BusinessError(
        "EXTRACTION_NOT_VALID",
        "Only validated extraction results can create commands.",
      );
    }
    const classification = extraction.classification as Row;
    const attachment = classification.attachment as Row;
    const message = attachment.message as Row;
    const type = classification.document_type;
    const commandType = type === "invoice"
      ? "create_invoice"
      : type === "receipt"
      ? "create_receipt"
      : null;
    if (!commandType) {
      throw new BusinessError(
        "UNSUPPORTED_DOCUMENT",
        "Document cannot create a financial command.",
      );
    }
    if (
      (commandType === "create_invoice" &&
        settings.invoice_automation_enabled !== true) ||
      (commandType === "create_receipt" &&
        settings.receipt_automation_enabled !== true)
    ) {
      throw new BusinessError(
        "AUTOMATION_DISABLED",
        "Document automation kill switch is disabled.",
        409,
      );
    }
    const key = await sha256([
      auth.companyId,
      attachment.mailbox_id,
      message.provider_message_id,
      attachment.sha256,
      commandType,
      extraction.schema_version,
    ].join(":"));
    const { data: commandRaw, error: commandError } = await this.client
      .from("automation_commands").upsert({
        company_id: auth.companyId,
        mailbox_id: attachment.mailbox_id,
        message_id: message.id,
        attachment_id: attachment.id,
        extraction_id: extractionId,
        command_type: commandType,
        schema_version: extraction.schema_version,
        operating_mode: mode,
        idempotency_key: key,
        command_payload: extraction.extracted_fields,
        status: mode === "observe_only" ? "proposed" : "pending",
        created_by: auth.userId,
      }, { onConflict: "company_id,idempotency_key", ignoreDuplicates: true })
      .select("*").maybeSingle();
    if (commandError) throw commandError;
    let command: Row;
    let reclaimStaleRunning = false;
    if (!commandRaw) {
      const { data: existing, error: existingError } = await this.client
        .from("automation_commands").select("*")
        .eq("company_id", auth.companyId).eq("idempotency_key", key).single();
      if (existingError) throw existingError;
      command = existing as Row;
      if (["completed", "proposed"].includes(String(command.status))) {
        return commandDto(command);
      }
      if (command.status === "running") {
        const startedAt = Date.parse(String(command.started_at ?? ""));
        const staleBefore = this.now().getTime() - 15 * 60 * 1000;
        if (!Number.isFinite(startedAt) || startedAt > staleBefore) {
          return commandDto(command);
        }
        reclaimStaleRunning = true;
      }
      if (command.status !== "failed") {
        if (!reclaimStaleRunning) {
          throw new BusinessError(
            "COMMAND_NOT_RETRYABLE",
            "Automation command cannot be retried.",
            409,
          );
        }
      }
    } else {
      command = commandRaw as Row;
    }
    if (mode === "observe_only") return commandDto(command);

    try {
      let claim = this.client
        .from("automation_commands").update({
          status: "running",
          started_at: this.now().toISOString(),
          failed_at: null,
          failure_code: null,
        }).eq("id", command.id);
      claim = reclaimStaleRunning
        ? claim.eq("status", "running").lt(
          "started_at",
          new Date(this.now().getTime() - 15 * 60 * 1000).toISOString(),
        )
        : claim.in("status", ["pending", "failed"]);
      const { data: claimed, error: claimError } = await claim.select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) {
        throw new BusinessError(
          "CONCURRENCY_CONFLICT",
          "Automation command is already being processed.",
          409,
        );
      }
      let resultId: string;
      if (commandType === "create_invoice") {
        const payload = extraction.extracted_fields as {
          invoice_date: string;
          currency: string;
          reference_no?: string;
          tax_total: string;
          lines: Array<{
            description: string;
            quantity: string;
            unit_price: string;
          }>;
        };
        if (payload.tax_total !== "0" && payload.tax_total !== "0.00") {
          throw new BusinessError(
            "TAX_MAPPING_REQUIRED",
            "Automated invoice tax requires an exact configured tax-code mapping.",
          );
        }
        const invoice = new InvoiceService(this.client);
        const created = await invoice.createInvoice(
          auth,
          {
            doc_type: "Invoice",
            invoice_date: payload.invoice_date,
            customer_id: String(extraction.customer_id),
            currency: payload.currency,
            reference_no: payload.reference_no,
            internal_remarks: "Created by Gate E automation.",
          } satisfies CreateInvoiceInput,
          payload.lines.map((line) => ({
            description: line.description,
            quantity: exactAutomationDecimalNumber(
              line.quantity,
              3,
              "quantity",
            ),
            unit_price: exactAutomationDecimalNumber(
              line.unit_price,
              4,
              "unit_price",
            ),
          } satisfies CreateInvoiceLineInput)),
          {
            automationCommandId: String(command.id),
            importOrigin: {
              source: "gate_e_automation",
              automation_command_id: String(command.id),
              provider_message_id: String(message.provider_message_id),
              attachment_sha256: String(attachment.sha256),
            },
            postAtomically: mode === "straight_through",
          },
        );
        resultId = created.id;
      } else {
        const payload = extraction.extracted_fields as {
          receipt_date: string;
          currency: string;
          amount: string;
          payment_method: CreateReceiptInput["payment_method"];
          reference_no?: string;
        };
        const mailbox = attachment.mailbox_id;
        const { data: mailboxConfig, error: mailboxError } = await this.client
          .from("automation_mailboxes").select("default_bank_account_id")
          .eq("id", mailbox).eq("company_id", auth.companyId).maybeSingle();
        if (mailboxError) throw mailboxError;
        if (!mailboxConfig?.default_bank_account_id) {
          throw new BusinessError(
            "BANK_ACCOUNT_MAPPING_REQUIRED",
            "Automated receipt creation requires a configured tenant bank account.",
          );
        }
        const receipt = new ReceiptService(this.client);
        const created = await receipt.createReceipt(
          auth,
          {
            receipt_date: payload.receipt_date,
            customer_id: String(extraction.customer_id),
            payment_method: payload.payment_method,
            currency: payload.currency,
            receipt_amount: exactAutomationDecimalNumber(
              payload.amount,
              2,
              "receipt_amount",
            ),
            bank_account_id: String(mailboxConfig.default_bank_account_id),
            reference_no: payload.reference_no,
            remarks: "Created by Gate E automation.",
          },
          {
            automationCommandId: String(command.id),
            importOrigin: {
              source: "gate_e_automation",
              automation_command_id: String(command.id),
              provider_message_id: String(message.provider_message_id),
              attachment_sha256: String(attachment.sha256),
            },
            postAtomically: mode === "straight_through",
          },
        );
        resultId = created.id;
      }
      return commandDto({
        ...command,
        status: "completed",
        completed_at: this.now().toISOString(),
        resulting_invoice_id: commandType === "create_invoice"
          ? resultId
          : null,
        resulting_receipt_id: commandType === "create_receipt"
          ? resultId
          : null,
      });
    } catch (commandFailure) {
      const failureCode = commandFailure instanceof BusinessError ||
          commandFailure instanceof ConflictError
        ? commandFailure.code
        : "INTERNAL_PROCESSING_FAILURE";
      const { error: commandFailureUpdateError } = await this.client.from(
        "automation_commands",
      ).update({
        status: "failed",
        failure_code: failureCode,
        failed_at: this.now().toISOString(),
      }).eq("id", command.id);
      if (commandFailureUpdateError) throw commandFailureUpdateError;
      await this.createException(auth.companyId, {
        mailbox_id: command.mailbox_id,
        message_id: command.message_id,
        attachment_id: command.attachment_id,
        command_id: command.id,
        reason_code: commandType === "create_invoice"
          ? "invoice_conflict"
          : "receipt_conflict",
        lifecycle_status: "retryable",
        safe_details: { error_code: failureCode },
        actor_user_id: auth.userId,
      });
      throw commandFailure;
    }
  }
}

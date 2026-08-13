import { callRpc } from "../_shared/db.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { BusinessError } from "../_shared/errors.ts";
import {
  type FinancialExtraction,
  isSemanticIsoTimestamp,
} from "./contract.ts";
import {
  dateInTimeZone,
  emptyScheduledCycleResult,
  type Row,
  sha256,
} from "./service-base.ts";
import { AutomationAllocationService } from "./allocation-service.ts";
export abstract class AutomationSchedulerService
  extends AutomationAllocationService {
  async runScheduledCycle(): Promise<Row> {
    const leaseToken = crypto.randomUUID();
    const acquired = await callRpc<boolean>(
      this.client,
      "automation_worker_lease_acquire",
      { p_lease_token: leaseToken },
    );
    if (!acquired) return emptyScheduledCycleResult();

    let cycleResult: Row | undefined;
    let cycleFailed = false;
    let cycleFailure: unknown;
    try {
      cycleResult = await this.runScheduledCycleWithLease();
    } catch (error) {
      cycleFailed = true;
      cycleFailure = error;
    }

    try {
      await callRpc<void>(this.client, "automation_worker_lease_release", {
        p_lease_token: leaseToken,
        p_succeeded: !cycleFailed,
      });
    } catch (releaseError) {
      if (!cycleFailed) throw releaseError;
    }

    if (cycleFailed) throw cycleFailure;
    return cycleResult as Row;
  }

  protected async runScheduledCycleWithLease(): Promise<Row> {
    const retention = await this.purgeExpiredAttachmentContent();
    const { data: settingRows, error: settingsError } = await this.client
      .from("automation_settings").select("*")
      .not("automation_actor_user_id", "is", null)
      .order("company_id", { ascending: true }).limit(100);
    if (settingsError) throw settingsError;
    const settings = ((settingRows ?? []) as Row[]).filter((setting) =>
      setting.operating_mode !== "disabled" ||
      String(setting.reminder_mode ?? "off") !== "off"
    );
    if (settings.length === 0) {
      return {
        companies_considered: 0,
        mailboxes_synced: 0,
        attachments_processed: 0,
        commands_processed: 0,
        allocations_completed: 0,
        reminders_evaluated: 0,
        reminders_delivered: 0,
        attachment_content_purged: retention.purged,
        failures: retention.failures,
      };
    }
    const companyIds = settings.map((setting) => String(setting.company_id));
    const actorIds = settings.map((setting) =>
      String(setting.automation_actor_user_id)
    );
    const { data: roleRows, error: roleError } = await this.client
      .from("user_roles").select("company_id,user_id,role")
      .in("company_id", companyIds).in("user_id", actorIds)
      .eq("is_active", true);
    if (roleError) throw roleError;
    const rolesByBinding = new Map<string, string[]>();
    for (const role of (roleRows ?? []) as Row[]) {
      const key = `${role.company_id}:${role.user_id}`;
      rolesByBinding.set(key, [
        ...(rolesByBinding.get(key) ?? []),
        String(role.role),
      ]);
    }
    const authByCompany = new Map<string, AuthContext>();
    let failures = retention.failures;
    for (const setting of settings) {
      const companyId = String(setting.company_id);
      const userId = String(setting.automation_actor_user_id);
      const roles = rolesByBinding.get(`${companyId}:${userId}`) ?? [];
      const highestRole = roles.includes("Finance Manager")
        ? "Finance Manager"
        : roles.includes("AR Supervisor")
        ? "AR Supervisor"
        : null;
      if (!highestRole) {
        failures++;
        await this.createException(companyId, {
          reason_code: "internal_processing_failure",
          lifecycle_status: "open",
          safe_details: { error_code: "AUTOMATION_ACTOR_UNAVAILABLE" },
        });
        continue;
      }
      authByCompany.set(companyId, {
        companyId,
        userId,
        roles: roles as AuthContext["roles"],
        highestRole,
        email: null,
      });
    }

    let mailboxesSynced = 0;
    let attachmentsProcessed = 0;
    let commandsProcessed = 0;
    let allocationsCompleted = 0;
    let remindersEvaluated = 0;
    let remindersDelivered = 0;
    let remainingAttachments = 200;
    let remainingReminderDeliveries = 200;
    const settingsByCompany = new Map(
      settings.map((setting) => [String(setting.company_id), setting]),
    );
    if (authByCompany.size === 0) {
      return {
        companies_considered: settings.length,
        mailboxes_synced: 0,
        attachments_processed: 0,
        commands_processed: 0,
        allocations_completed: 0,
        reminders_evaluated: 0,
        reminders_delivered: 0,
        attachment_content_purged: retention.purged,
        failures,
      };
    }
    const { data: mailboxRows, error: mailboxError } = await this.client
      .from("automation_mailboxes").select("id,company_id")
      .in("company_id", [...authByCompany.keys()])
      .eq("is_enabled", true).eq("ingestion_enabled", true)
      .eq("reconnect_required", false)
      .order("company_id", { ascending: true }).order("id", {
        ascending: true,
      }).limit(100);
    if (mailboxError) throw mailboxError;
    const ingestionMailboxCompanies = new Set(
      ((mailboxRows ?? []) as Row[]).map((mailbox) =>
        String(mailbox.company_id)
      ),
    );
    for (const [companyId, auth] of authByCompany) {
      if (
        settingsByCompany.get(companyId)?.mailbox_sync_enabled === true &&
        !ingestionMailboxCompanies.has(companyId)
      ) {
        failures++;
        await this.createException(companyId, {
          reason_code: "mailbox_not_configured",
          lifecycle_status: "open",
          idempotency_key: await sha256(
            `mailbox_not_configured:${companyId}:ingestion`,
          ),
          safe_details: { capability: "ingestion" },
          actor_user_id: auth.userId,
        });
      }
    }

    for (const mailbox of (mailboxRows ?? []) as Row[]) {
      const auth = authByCompany.get(String(mailbox.company_id));
      const setting = settingsByCompany.get(String(mailbox.company_id));
      if (!auth || setting?.mailbox_sync_enabled !== true) continue;
      try {
        await this.syncMailbox(auth, String(mailbox.id));
        mailboxesSynced++;
      } catch (syncError) {
        failures++;
        await this.createException(auth.companyId, {
          mailbox_id: mailbox.id,
          reason_code: syncError instanceof BusinessError &&
              syncError.code === "MAILBOX_RECONNECT_REQUIRED"
            ? "mailbox_reconnect_required"
            : "provider_unavailable",
          lifecycle_status: syncError instanceof BusinessError &&
              syncError.code === "MAILBOX_RECONNECT_REQUIRED"
            ? "open"
            : "retryable",
          safe_details: {
            error_code: syncError instanceof BusinessError
              ? syncError.code
              : "INTERNAL_PROCESSING_FAILURE",
          },
        });
      }
    }

    // Document work is a durable backlog, not a projection of only the latest
    // provider sync. This lets a later bounded cycle resume attachments that
    // were persisted before a crash or beyond an earlier cycle's work cap.
    for (const [companyId, auth] of authByCompany) {
      if (remainingAttachments === 0) break;
      const setting = settingsByCompany.get(companyId);
      if (
        setting?.document_intelligence_enabled !== true
      ) continue;
      const { data: attachments, error: attachmentError } = await this.client
        .from("automation_source_attachments").select("id,mailbox_id")
        .eq("company_id", companyId)
        .eq("safety_status", "accepted")
        .in("processing_status", ["pending", "retryable"])
        .is("content_purged_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(remainingAttachments);
      if (attachmentError) throw attachmentError;
      for (const attachment of (attachments ?? []) as Row[]) {
        remainingAttachments--;
        try {
          await this.processAttachment(
            auth,
            String(attachment.id),
          );
          attachmentsProcessed++;
        } catch (processingError) {
          failures++;
          const errorCode = processingError instanceof BusinessError
            ? processingError.code
            : "INTERNAL_PROCESSING_FAILURE";
          const retryable = [
            "DOCUMENT_INTELLIGENCE_DISABLED",
            "PROVIDER_UNAVAILABLE",
            "INTERNAL_PROCESSING_FAILURE",
          ].includes(errorCode);
          const { error: retryStateError } = await this.client
            .from("automation_source_attachments")
            .update({
              processing_status: retryable ? "retryable" : "processed",
            })
            .eq("id", attachment.id)
            .eq("company_id", auth.companyId)
            .neq("processing_status", "processed");
          if (retryStateError) throw retryStateError;
          if (errorCode === "DOCUMENT_INTELLIGENCE_DISABLED") {
            await this.createException(auth.companyId, {
              mailbox_id: attachment.mailbox_id,
              attachment_id: attachment.id,
              reason_code: "provider_unavailable",
              lifecycle_status: "retryable",
              idempotency_key: await sha256(
                `document_provider_unavailable:${auth.companyId}:${attachment.id}`,
              ),
              safe_details: { error_code: errorCode },
            });
          }
        }
      }
    }

    // Financial commands are a durable backlog separate from document
    // processing. This closes the crash window between a valid persisted
    // extraction and command creation without exposing raw extraction fields
    // through the public document-processing DTO. The most recent audit event
    // from a different operating mode is the lower activation boundary, so a
    // later Draft/Straight-Through mode never retroactively commands documents
    // accepted under Observe Only.
    let remainingCommands = 200;
    for (const [companyId, auth] of authByCompany) {
      if (remainingCommands === 0) break;
      const setting = settingsByCompany.get(companyId);
      const mode = String(setting?.operating_mode ?? "disabled");
      if (!setting || mode === "disabled") continue;
      const { data: priorModeEvent, error: priorModeError } = await this.client
        .from("automation_audit_events").select("created_at")
        .eq("company_id", companyId)
        .eq("entity_type", "automation_settings")
        .not("safe_metadata->>operating_mode", "is", null)
        .neq("safe_metadata->>operating_mode", mode)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (priorModeError) throw priorModeError;
      const activationBoundary = String(priorModeEvent?.created_at ?? "");
      if (!isSemanticIsoTimestamp(activationBoundary)) {
        failures++;
        continue;
      }
      const { data: extractionRows, error: extractionError } = await this.client
        .from("automation_extraction_results")
        .select(
          "id,extracted_fields,classification:automation_document_classifications!inner(document_type),commands:automation_commands()",
        )
        .eq("company_id", companyId)
        .eq("validation_status", "valid")
        .gt("created_at", activationBoundary)
        .is("commands", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(remainingCommands);
      if (extractionError) throw extractionError;
      for (const extraction of (extractionRows ?? []) as Row[]) {
        if (remainingCommands === 0) break;
        const classification = extraction.classification as Row | null;
        const documentType = String(classification?.document_type ?? "");
        if (
          (documentType === "invoice" &&
            setting.invoice_automation_enabled !== true) ||
          (documentType === "receipt" &&
            setting.receipt_automation_enabled !== true) ||
          !["invoice", "receipt"].includes(documentType)
        ) continue;
        remainingCommands--;
        try {
          const command = await this.executeCommand(
            auth,
            String(extraction.id),
          );
          commandsProcessed++;
          if (
            setting.auto_allocation_enabled === true &&
            mode === "straight_through"
          ) {
            const extractedFields = extraction.extracted_fields;
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
            const allocation = await this.proposeAndAllocateReceipt(
              auth,
              command,
              extractedFields as FinancialExtraction,
            );
            if (allocation) allocationsCompleted++;
          }
        } catch {
          failures++;
        }
      }
    }

    for (const [companyId, auth] of authByCompany) {
      const setting = settingsByCompany.get(companyId);
      const date = dateInTimeZone(
        this.now(),
        String(setting?.reminder_timezone ?? "UTC"),
      );
      if (setting?.reminder_evaluation_enabled === true) {
        try {
          await this.evaluateReminders(auth, date);
          remindersEvaluated++;
        } catch {
          failures++;
        }
      }
      if (setting?.reminder_delivery_enabled !== true) continue;
      if (remainingReminderDeliveries === 0) continue;
      const { data: deliveryMailbox, error: deliveryMailboxError } = await this
        .client.from("automation_mailboxes").select("id")
        .eq("company_id", companyId).eq("delivery_enabled", true)
        .eq("delivery_reconnect_required", false)
        .order("id", { ascending: true })
        .limit(1).maybeSingle();
      if (deliveryMailboxError) throw deliveryMailboxError;
      if (!deliveryMailbox) {
        failures++;
        await this.createException(companyId, {
          reason_code: "mailbox_not_configured",
          lifecycle_status: "open",
          idempotency_key: await sha256(
            `mailbox_not_configured:${companyId}:delivery`,
          ),
          safe_details: { capability: "delivery" },
          actor_user_id: auth.userId,
        });
        continue;
      }
      const { data: reminders, error: remindersError } = await this.client
        .from("invoice_reminders").select("id")
        .eq("company_id", companyId).in("status", ["pending", "failed"])
        .lte("scheduled_for", date).order("scheduled_for", {
          ascending: true,
        }).order("id", { ascending: true }).limit(100);
      if (remindersError) throw remindersError;
      for (const reminder of (reminders ?? []) as Row[]) {
        if (remainingReminderDeliveries === 0) break;
        remainingReminderDeliveries--;
        try {
          await this.deliverReminder(
            auth,
            String(reminder.id),
            String(deliveryMailbox.id),
          );
          remindersDelivered++;
        } catch {
          failures++;
        }
      }
    }
    return {
      companies_considered: settings.length,
      mailboxes_synced: mailboxesSynced,
      attachments_processed: attachmentsProcessed,
      commands_processed: commandsProcessed,
      allocations_completed: allocationsCompleted,
      reminders_evaluated: remindersEvaluated,
      reminders_delivered: remindersDelivered,
      attachment_content_purged: retention.purged,
      failures,
    };
  }
}

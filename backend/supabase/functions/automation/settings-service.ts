import type { AuthContext } from "../_shared/auth.ts";
import { requireAnyRole } from "../_shared/auth.ts";
import { BusinessError, ValidationError } from "../_shared/errors.ts";
import {
  type AutomationOperatingMode,
  type AutomationReminderMode,
  documentCapabilityProfile,
  type MailboxProviderType,
  reminderCapabilityProfile,
  requireBoundedText,
  requireOperatingMode,
  requireReminderMode,
} from "./contract.ts";
import { automationSettingsDto } from "./dto.ts";
import { mailboxCapabilityIsReady } from "./authority.ts";
import { dateInTimeZone, type Row } from "./service-base.ts";
import { AutomationServiceBase } from "./service-base.ts";
export abstract class AutomationSettingsService extends AutomationServiceBase {
  async overview(auth: AuthContext): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    const count = async (
      table: string,
      filters: Readonly<Record<string, string>> = {},
      requiredField?: string,
    ): Promise<number> => {
      let query = this.client.from(table).select("id", {
        count: "exact",
        head: true,
      }).eq("company_id", auth.companyId);
      for (const [field, value] of Object.entries(filters)) {
        query = query.eq(field, value);
      }
      if (requiredField) query = query.not(requiredField, "is", null);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    };
    const { data: mailboxes, error: mailboxError } = await this.client
      .from("automation_mailboxes")
      .select(
        "id,company_id,provider_type,connection_status,reconnect_required,delivery_reconnect_required,is_enabled,ingestion_enabled,delivery_enabled,ingestion_secret_ref,delivery_secret_ref,ingestion_token_expires_at,delivery_token_expires_at,last_successful_sync_at,last_failed_sync_at",
      )
      .eq("company_id", auth.companyId)
      .order("id", { ascending: true })
      .limit(100);
    if (mailboxError) throw mailboxError;
    const mailboxRows = (mailboxes ?? []) as Row[];
    const connected = mailboxRows.filter((row) =>
      row.connection_status === "connected" &&
      row.reconnect_required !== true
    );
    const adapterReady = (
      row: Row,
      capability: "ingestion" | "delivery",
    ): boolean => {
      try {
        const providerType = row.provider_type as MailboxProviderType;
        return capability === "ingestion"
          ? this.mailboxProviders[providerType]?.readiness().ready === true
          : this.deliveryProviders[providerType]?.readiness().ready === true;
      } catch {
        return false;
      }
    };
    const now = this.now();
    const capabilityReady = async (
      capability: "ingestion" | "delivery",
    ): Promise<boolean> => {
      for (const row of mailboxRows) {
        if (
          !mailboxCapabilityIsReady(
            row,
            capability,
            now,
            adapterReady(row, capability),
          )
        ) continue;
        try {
          const token = await this.oauthSecretStore.resolveTokenSet(
            this.oauthSecretContext(row, capability),
          );
          if (
            this.oauthTokenSupportsCapability(
              token,
              row.provider_type as MailboxProviderType,
              capability,
              now,
            )
          ) return true;
        } catch {
          // Readiness is a bounded boolean. Secret-provider details remain
          // private and an unavailable opaque token fails closed.
        }
      }
      return false;
    };
    const [ingestionReady, deliveryReady] = await Promise.all([
      capabilityReady("ingestion"),
      capabilityReady("delivery"),
    ]);
    const latest = (field: "last_successful_sync_at" | "last_failed_sync_at") =>
      mailboxRows.map((row) => row[field]).filter((value): value is string =>
        typeof value === "string"
      ).sort().at(-1) ?? null;
    const [
      processingRuns,
      documentsProcessed,
      acceptedDocuments,
      rejectedDocuments,
      invoicesCreated,
      receiptsCreated,
      allocationsCompleted,
      remindersEvaluated,
      remindersSent,
      openExceptions,
      retryableExceptions,
    ] = await Promise.all([
      count("mailbox_sync_runs"),
      count("automation_document_classifications"),
      count("automation_document_classifications", { status: "accepted" }),
      count("automation_document_classifications", { status: "rejected" }),
      count(
        "automation_commands",
        { command_type: "create_invoice", status: "completed" },
        "resulting_invoice_id",
      ),
      count(
        "automation_commands",
        { command_type: "create_receipt", status: "completed" },
        "resulting_receipt_id",
      ),
      count("automation_allocation_decisions", { status: "completed" }),
      count("invoice_reminders"),
      count("invoice_reminders", { status: "delivered" }),
      count("automation_exceptions", { lifecycle_status: "open" }),
      count("automation_exceptions", { lifecycle_status: "retryable" }),
    ]);
    return {
      settings: await this.getSettings(auth),
      ingestion_ready: ingestionReady,
      delivery_ready: deliveryReady,
      document_intelligence_ready: this.documentProvider.enabled,
      connected_mailbox_count: connected.length,
      reconnect_required_mailbox_count:
        mailboxRows.filter((row) =>
          row.reconnect_required === true ||
          row.delivery_reconnect_required === true ||
          row.connection_status === "reconnect_required"
        ).length,
      last_successful_sync_at: latest("last_successful_sync_at"),
      last_failed_sync_at: latest("last_failed_sync_at"),
      processing_runs: processingRuns,
      documents_processed: documentsProcessed,
      accepted_documents: acceptedDocuments,
      rejected_documents: rejectedDocuments,
      invoices_created: invoicesCreated,
      receipts_created: receiptsCreated,
      allocations_completed: allocationsCompleted,
      reminders_evaluated: remindersEvaluated,
      reminders_sent: remindersSent,
      open_exceptions: openExceptions,
      retryable_exceptions: retryableExceptions,
    };
  }

  async getSettings(auth: AuthContext): Promise<Row> {
    requireAnyRole(auth, [
      "AR Clerk",
      "AR Supervisor",
      "Finance Manager",
      "Auditor",
      "System Admin",
    ]);
    const { data, error } = await this.client.from("automation_settings")
      .select("*").eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    return automationSettingsDto(data as Row | null, auth.companyId);
  }

  async updateSettings(auth: AuthContext, patch: Row): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    if (
      patch.operating_mode !== undefined &&
      patch.operating_mode !== "disabled"
    ) {
      requireAnyRole(auth, ["Finance Manager"]);
    }
    if (patch.operating_mode === "straight_through") {
      if (
        patch.activation_confirmation !== "ENABLE_STRAIGHT_THROUGH"
      ) {
        throw new BusinessError(
          "STRAIGHT_THROUGH_CONFIRMATION_REQUIRED",
          "Straight-through mode requires the exact activation confirmation.",
          409,
        );
      }
    } else if (patch.activation_confirmation !== undefined) {
      throw new ValidationError(
        "activation_confirmation is accepted only for straight-through activation.",
      );
    }
    if (
      patch.reminder_mode !== undefined && patch.reminder_mode !== "off"
    ) {
      requireAnyRole(auth, ["Finance Manager"]);
    }
    const allowed = new Set([
      "operating_mode",
      "reminder_mode",
      "reminder_stage_offsets",
      "reminder_timezone",
      "minimum_overall_confidence",
      "minimum_critical_confidence",
      "activation_confirmation",
    ]);
    const unexpected = Object.keys(patch).filter((key) => !allowed.has(key));
    if (unexpected.length) {
      throw new ValidationError("Unsupported automation setting.", {
        unexpected_fields: unexpected.sort(),
      });
    }
    delete patch.activation_confirmation;
    const current = await this.getSettings(auth);
    if (patch.operating_mode !== undefined) {
      const operatingMode = requireOperatingMode(patch.operating_mode);
      if (operatingMode !== "disabled") {
        await this.assertDocumentModeReady(auth, operatingMode);
      }
      patch.operating_mode = operatingMode;
      Object.assign(patch, documentCapabilityProfile(operatingMode));
    }
    if (patch.reminder_mode !== undefined) {
      const reminderMode = requireReminderMode(patch.reminder_mode);
      if (reminderMode === "automatic_delivery") {
        await this.assertReminderDeliveryReady(auth);
      }
      patch.reminder_mode = reminderMode;
      Object.assign(patch, reminderCapabilityProfile(reminderMode));
    }
    if (
      patch.reminder_mode === undefined &&
      current.reminder_mode === "automatic_delivery"
    ) {
      await this.assertReminderDeliveryReady(auth);
    }
    if (
      patch.operating_mode !== undefined || patch.reminder_mode !== undefined
    ) {
      const desiredOperating = String(
        patch.operating_mode ?? current.operating_mode,
      ) as AutomationOperatingMode;
      const desiredReminder = String(
        patch.reminder_mode ?? current.reminder_mode,
      ) as AutomationReminderMode;
      const callerArmed = (patch.operating_mode !== undefined &&
        desiredOperating !== "disabled") ||
        (patch.reminder_mode !== undefined && desiredReminder !== "off");
      patch.automation_actor_user_id =
        desiredOperating === "disabled" && desiredReminder === "off"
          ? null
          : callerArmed
          ? auth.userId
          : current.automation_actor_user_id;
      if (
        (desiredOperating !== "disabled" || desiredReminder !== "off") &&
        !patch.automation_actor_user_id
      ) {
        throw new BusinessError(
          "AUTOMATION_ACTOR_UNAVAILABLE",
          "Active automation requires an authorized Finance Manager.",
          409,
        );
      }
    }
    if (patch.reminder_stage_offsets !== undefined) {
      if (
        !Array.isArray(patch.reminder_stage_offsets) ||
        patch.reminder_stage_offsets.length === 0 ||
        patch.reminder_stage_offsets.length > 10 ||
        patch.reminder_stage_offsets.some((offset) =>
          !Number.isInteger(offset) || Number(offset) < -90 ||
          Number(offset) > 0
        ) ||
        new Set(patch.reminder_stage_offsets).size !==
          patch.reminder_stage_offsets.length
      ) {
        throw new ValidationError(
          "reminder_stage_offsets must contain 1 to 10 unique calendar-day offsets from -90 through 0.",
        );
      }
    }
    if (patch.reminder_timezone !== undefined) {
      patch.reminder_timezone = requireBoundedText(
        patch.reminder_timezone,
        "reminder_timezone",
        100,
      );
      dateInTimeZone(this.now(), String(patch.reminder_timezone));
    }
    for (
      const field of [
        "minimum_overall_confidence",
        "minimum_critical_confidence",
      ] as const
    ) {
      if (patch[field] === undefined) continue;
      const confidence = Number(patch[field]);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new ValidationError(`${field} must be between 0 and 1.`);
      }
      patch[field] = confidence.toFixed(4);
    }
    const safe = {
      ...patch,
      company_id: auth.companyId,
      updated_by: auth.userId,
      updated_at: this.now().toISOString(),
    };
    const { data, error } = await this.client.from("automation_settings")
      .upsert(safe, { onConflict: "company_id" }).select("*").single();
    if (error) throw error;
    return automationSettingsDto(data as Row, auth.companyId);
  }

  protected async assertReminderDeliveryReady(
    auth: AuthContext,
  ): Promise<void> {
    const { data, error } = await this.client.from("automation_mailboxes")
      .select("*")
      .eq("company_id", auth.companyId)
      .eq("delivery_enabled", true)
      .eq("delivery_reconnect_required", false)
      .order("id", { ascending: true })
      .limit(100);
    if (error) throw error;
    for (const mailbox of (data ?? []) as Row[]) {
      const provider = mailbox.provider_type as MailboxProviderType;
      if (this.deliveryProviders[provider]?.readiness().ready !== true) {
        continue;
      }
      try {
        await this.resolveOAuthAccessTokenForRuntime(mailbox, "delivery");
        return;
      } catch (cause) {
        if (
          cause instanceof BusinessError &&
          ["OAUTH_RECONNECT_REQUIRED", "OAUTH_NOT_CONFIGURED"].includes(
            cause.code,
          )
        ) continue;
        throw cause;
      }
    }
    throw new BusinessError(
      "REMINDER_DELIVERY_NOT_READY",
      "Reminder delivery requires a connected delivery provider.",
      409,
    );
  }

  protected async assertDocumentModeReady(
    auth: AuthContext,
    mode: Exclude<AutomationOperatingMode, "disabled">,
  ): Promise<void> {
    if (!this.documentProvider.enabled) {
      throw new BusinessError(
        "DOCUMENT_INTELLIGENCE_DISABLED",
        "Document intelligence is not ready.",
        409,
      );
    }
    const { data, error } = await this.client.from("automation_mailboxes")
      .select("*")
      .eq("company_id", auth.companyId)
      .eq("is_enabled", true)
      .eq("ingestion_enabled", true)
      .eq("connection_status", "connected")
      .eq("reconnect_required", false)
      .order("id", { ascending: true })
      .limit(100);
    if (error) throw error;
    for (const mailbox of (data ?? []) as Row[]) {
      const provider = mailbox.provider_type as MailboxProviderType;
      if (
        this.mailboxProviders[provider]?.readiness().ready !== true ||
        typeof mailbox.ingestion_secret_ref !== "string" ||
        (mode !== "observe_only" && !mailbox.default_bank_account_id)
      ) continue;
      try {
        await this.resolveOAuthAccessTokenForRuntime(mailbox, "ingestion");
        return;
      } catch (cause) {
        if (
          cause instanceof BusinessError &&
          ["OAUTH_RECONNECT_REQUIRED", "OAUTH_NOT_CONFIGURED"].includes(
            cause.code,
          )
        ) continue;
        throw cause;
      }
    }
    throw new BusinessError(
      "AUTOMATION_MODE_NOT_READY",
      mode === "observe_only"
        ? "Automation requires a ready ingestion mailbox."
        : "Financial automation requires ready ingestion and a receiving bank account.",
      409,
    );
  }
}

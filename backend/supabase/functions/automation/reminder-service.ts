import { callRpc } from "../_shared/db.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { requireAnyRole } from "../_shared/auth.ts";
import { BusinessError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import { type MailboxProviderType, requireIsoDate } from "./contract.ts";
import { type ReminderDeliveryProvider } from "./providers.ts";
import {
  reminderAttemptDto,
  reminderDto,
  reminderEvaluationDto,
} from "./dto.ts";
import { requiredId, type Row, sha256 } from "./service-base.ts";
import { AutomationMailboxSyncService } from "./mailbox-sync-service.ts";
export abstract class AutomationReminderService
  extends AutomationMailboxSyncService {
  async evaluateReminders(
    auth: AuthContext,
    evaluationDate: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    requireIsoDate(evaluationDate, "evaluation_date");
    return reminderEvaluationDto(
      await callRpc<Row>(
        this.client,
        "automation_evaluate_invoice_reminders",
        {
          p_company_id: auth.companyId,
          p_evaluation_date: evaluationDate,
          p_actor_user_id: auth.userId,
        },
      ),
    );
  }

  async deliverReminder(
    auth: AuthContext,
    reminderId: string,
    mailboxId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(reminderId, "reminder_id");
    validateUUID(mailboxId, "mailbox_id");
    const settings = await this.getSettings(auth);
    if (
      settings.reminder_delivery_enabled !== true
    ) {
      throw new BusinessError(
        "REMINDER_DELIVERY_DISABLED",
        "Reminder delivery is disabled.",
        409,
      );
    }
    const { data: reminderRaw, error: reminderError } = await this.client
      .from("invoice_reminders").select("*")
      .eq("id", reminderId).eq("company_id", auth.companyId).maybeSingle();
    if (reminderError) throw reminderError;
    const reminder = requiredId(
      reminderRaw as Row | null,
      "InvoiceReminder",
      reminderId,
    );
    if (reminder.status === "delivered") return reminderDto(reminder);
    if (!["pending", "failed"].includes(String(reminder.status))) {
      throw new BusinessError(
        "REMINDER_NOT_DELIVERABLE",
        "Reminder is not eligible for delivery.",
        409,
      );
    }
    const { data: mailboxRaw, error: mailboxError } = await this.client
      .from("automation_mailboxes").select("*")
      .eq("id", mailboxId).eq("company_id", auth.companyId).maybeSingle();
    if (mailboxError) throw mailboxError;
    const mailbox = requiredId(
      mailboxRaw as Row | null,
      "Mailbox",
      mailboxId,
    );
    if (
      mailbox.delivery_enabled !== true ||
      mailbox.delivery_reconnect_required === true ||
      !mailbox.delivery_secret_ref
    ) {
      throw new BusinessError(
        "REMINDER_DELIVERY_DISABLED",
        "Reminder delivery mailbox is not ready.",
        409,
      );
    }
    const { data: latestAttemptRaw, error: latestAttemptError } = await this
      .client.from("reminder_delivery_attempts").select("*")
      .eq("company_id", auth.companyId).eq("reminder_id", reminderId)
      .order("attempt_number", { ascending: false }).limit(1).maybeSingle();
    if (latestAttemptError) throw latestAttemptError;
    const latestAttempt = latestAttemptRaw as Row | null;
    if (latestAttempt?.status === "sent") {
      return reminderAttemptDto(latestAttempt);
    }
    if (latestAttempt?.status === "sending") {
      throw new BusinessError(
        "REMINDER_DELIVERY_OUTCOME_UNCONFIRMED",
        "The previous delivery outcome is not confirmed; automatic retry is blocked.",
        409,
      );
    }
    if (latestAttempt?.status === "permanent_failure") {
      throw new BusinessError(
        "REMINDER_NOT_DELIVERABLE",
        "The previous delivery failure is not retryable.",
        409,
      );
    }
    const { count, error: countError } = await this.client.from(
      "reminder_delivery_attempts",
    ).select("id", { count: "exact", head: true })
      .eq("company_id", auth.companyId).eq("reminder_id", reminderId);
    if (countError) throw countError;
    const attemptNumber = (count ?? 0) + 1;
    if (attemptNumber > 10) {
      throw new BusinessError(
        "REMINDER_RETRY_LIMIT",
        "Reminder retry limit has been reached.",
        409,
      );
    }
    const idempotencyKey = await sha256(
      `${auth.companyId}:${reminderId}:${attemptNumber}`,
    );
    const { data: attemptRaw, error: attemptError } = await this.client
      .from("reminder_delivery_attempts").insert({
        company_id: auth.companyId,
        reminder_id: reminderId,
        mailbox_id: mailboxId,
        provider_type: mailbox.provider_type,
        attempt_number: attemptNumber,
        idempotency_key: idempotencyKey,
        status: "sending",
        started_at: this.now().toISOString(),
      }).select("*").single();
    if (attemptError) throw attemptError;
    const attempt = attemptRaw as Row;
    const { error: sendingError } = await this.client.from("invoice_reminders")
      .update({ status: "sending" })
      .eq("id", reminderId).eq("company_id", auth.companyId)
      .in("status", ["pending", "failed"]);
    if (sendingError) throw sendingError;
    const reminderBody = [
      `Customer: ${reminder.customer_name_snapshot}`,
      `Invoice: ${reminder.invoice_no_snapshot}`,
      `Due date: ${reminder.due_date_snapshot}`,
      `Outstanding amount: ${reminder.outstanding_snapshot} ${reminder.currency_snapshot}`,
      "Please contact the customer.",
    ].join("\n");
    let delivered: Awaited<ReturnType<ReminderDeliveryProvider["send"]>>;
    try {
      const provider = this.deliveryProviders[
        mailbox.provider_type as MailboxProviderType
      ];
      delivered = await provider.send({
        accessToken: await this.resolveOAuthAccessTokenForRuntime(
          mailbox,
          "delivery",
        ),
        fromAddress: String(mailbox.mailbox_address),
        toAddress: String(reminder.recipient_email_snapshot),
        subject: `Invoice due reminder: ${reminder.invoice_no_snapshot}`,
        textBody: reminderBody,
        idempotencyKey,
      });
    } catch (deliveryError) {
      if (
        deliveryError instanceof BusinessError &&
        deliveryError.code === "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED"
      ) {
        // Keep the attempt in `sending`. A later invocation sees that state
        // and refuses to send again until an operator resolves the outcome.
        await this.createException(auth.companyId, {
          mailbox_id: mailboxId,
          invoice_id: reminder.invoice_id,
          reason_code: "provider_delivery_failed",
          lifecycle_status: "open",
          safe_details: {
            reminder_id: reminderId,
            mailbox_id: mailboxId,
            error_code: deliveryError.code,
            retry_blocked: true,
          },
          actor_user_id: auth.userId,
        });
        throw deliveryError;
      }
      const retryable = deliveryError instanceof BusinessError &&
        ["PROVIDER_UNAVAILABLE", "PROVIDER_DELIVERY_RETRYABLE"].includes(
          deliveryError.code,
        );
      const { error: attemptFailureError } = await this.client.from(
        "reminder_delivery_attempts",
      ).update({
        status: retryable ? "retryable_failure" : "permanent_failure",
        error_class: retryable ? "retryable" : "non_retryable",
        redacted_error_code: deliveryError instanceof BusinessError
          ? deliveryError.code
          : "INTERNAL_PROCESSING_FAILURE",
        completed_at: this.now().toISOString(),
      }).eq("id", attempt.id);
      if (attemptFailureError) throw attemptFailureError;
      const { error: reminderFailureError } = await this.client.from(
        "invoice_reminders",
      ).update({ status: "failed" })
        .eq("id", reminderId).eq("company_id", auth.companyId);
      if (reminderFailureError) throw reminderFailureError;
      await this.createException(auth.companyId, {
        mailbox_id: mailboxId,
        invoice_id: reminder.invoice_id,
        reason_code: "provider_delivery_failed",
        lifecycle_status: retryable ? "retryable" : "open",
        safe_details: {
          reminder_id: reminderId,
          mailbox_id: mailboxId,
          error_code: deliveryError instanceof BusinessError
            ? deliveryError.code
            : "INTERNAL_PROCESSING_FAILURE",
        },
        actor_user_id: auth.userId,
      });
      throw deliveryError;
    }
    const completedAt = this.now().toISOString();
    const { error: attemptCompleteError } = await this.client.from(
      "reminder_delivery_attempts",
    ).update({
      status: "sent",
      provider_message_id: delivered.provider_message_id,
      completed_at: completedAt,
    }).eq("id", attempt.id);
    if (attemptCompleteError) {
      throw new BusinessError(
        "REMINDER_DELIVERY_OUTCOME_UNCONFIRMED",
        "Reminder delivery succeeded but its delivery ledger could not be finalized. Automatic retry is blocked.",
        409,
      );
    }
    const { error: reminderCompleteError } = await this.client.from(
      "invoice_reminders",
    ).update({
      status: "delivered",
      delivered_at: completedAt,
    }).eq("id", reminderId).eq("company_id", auth.companyId);
    if (reminderCompleteError) {
      throw new BusinessError(
        "REMINDER_DELIVERY_OUTCOME_UNCONFIRMED",
        "Reminder delivery succeeded but its reminder status could not be finalized. Automatic retry is blocked.",
        409,
      );
    }
    return reminderAttemptDto({
      ...attempt,
      status: "sent",
      provider_message_id: delivered.provider_message_id,
      completed_at: completedAt,
    });
  }
}

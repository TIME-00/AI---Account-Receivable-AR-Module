import type { AuthContext } from "../_shared/auth.ts";
import { requireAnyRole } from "../_shared/auth.ts";
import { BusinessError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import { validateOcrIntakeFile } from "../imports/file_validation.ts";
import { type MailboxProviderType } from "./contract.ts";
import { syncRunDto } from "./dto.ts";
import { assertProviderMessageBounded } from "./authority.ts";
import {
  attachmentExceptionReason,
  extension,
  MAX_MESSAGES_PER_RUN,
  MAX_SYNC_PAGES,
  requiredId,
  type Row,
  sha256,
  STORAGE_BUCKET,
} from "./service-base.ts";
import { AutomationDocumentService } from "./document-service.ts";
export abstract class AutomationMailboxSyncService
  extends AutomationDocumentService {
  async syncMailbox(auth: AuthContext, mailboxId: string): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(mailboxId, "mailbox_id");
    const { data: mailboxRaw, error: mailboxError } = await this.client
      .from("automation_mailboxes").select("*")
      .eq("id", mailboxId).eq("company_id", auth.companyId).maybeSingle();
    if (mailboxError) throw mailboxError;
    const mailbox = requiredId(mailboxRaw as Row | null, "Mailbox", mailboxId);
    const settings = await this.getSettings(auth);
    if (
      settings.operating_mode === "disabled" ||
      settings.mailbox_sync_enabled !== true ||
      mailbox.is_enabled !== true ||
      mailbox.ingestion_enabled !== true ||
      mailbox.reconnect_required === true ||
      !mailbox.ingestion_secret_ref
    ) {
      throw new BusinessError(
        "MAILBOX_SYNC_DISABLED",
        "Mailbox synchronization is disabled.",
        409,
      );
    }
    const accessToken = await this.resolveOAuthAccessTokenForRuntime(
      mailbox,
      "ingestion",
    );
    const provider =
      this.mailboxProviders[mailbox.provider_type as MailboxProviderType];
    if (!provider) {
      throw new BusinessError(
        "PROVIDER_UNAVAILABLE",
        "Mailbox provider is unavailable.",
        503,
      );
    }

    const { data: runRaw, error: runError } = await this.client.from(
      "mailbox_sync_runs",
    )
      .insert({
        company_id: auth.companyId,
        mailbox_id: mailboxId,
        provider_type: mailbox.provider_type,
        status: "running",
        cursor_before: mailbox.incremental_cursor,
        started_at: this.now().toISOString(),
        attempt_count: 1,
      }).select("*").single();
    if (runError) throw runError;
    const run = runRaw as Row;
    let pageToken: string | null = null;
    let completedCursor: string | null = null;
    let pages = 0;
    let messagesSeen = 0;
    let messagesPersisted = 0;
    let attachmentsPersisted = 0;
    let duplicateMessages = 0;
    let duplicateAttachments = 0;

    try {
      do {
        if (++pages > MAX_SYNC_PAGES) {
          throw new BusinessError(
            "MAILBOX_RESYNC_LIMIT_EXCEEDED",
            "Mailbox synchronization exceeded the bounded cycle.",
            422,
          );
        }
        const page = await provider.syncPage({
          accessToken,
          cursor: mailbox.incremental_cursor as string | null,
          pageToken,
        });
        if (page.cursor_invalid) {
          const { error: reconnectError } = await this.client.from(
            "automation_mailboxes",
          ).update({
            reconnect_required: true,
            connection_status: "reconnect_required",
            last_failed_sync_at: this.now().toISOString(),
            redacted_error_code: "INCREMENTAL_CURSOR_INVALID",
          }).eq("id", mailboxId).eq("company_id", auth.companyId);
          if (reconnectError) throw reconnectError;
          throw new BusinessError(
            "MAILBOX_RECONNECT_REQUIRED",
            "Mailbox incremental state expired. A bounded operator-approved resynchronization is required.",
            409,
          );
        }
        page.messages.forEach(assertProviderMessageBounded);
        if (page.messages.length > 100) {
          throw new BusinessError(
            "PROVIDER_RESPONSE_INVALID",
            "Mailbox provider page exceeded the supported size.",
            502,
          );
        }
        if (messagesSeen + page.messages.length > MAX_MESSAGES_PER_RUN) {
          throw new BusinessError(
            "MAILBOX_RESYNC_LIMIT_EXCEEDED",
            "Mailbox synchronization exceeded the bounded cycle.",
            422,
          );
        }
        messagesSeen += page.messages.length;
        for (const message of page.messages) {
          const { data: persisted, error: persistError } = await this.client
            .from("automation_source_messages")
            .upsert({
              company_id: auth.companyId,
              mailbox_id: mailboxId,
              sync_run_id: run.id,
              provider_type: mailbox.provider_type,
              provider_message_id: message.provider_message_id,
              provider_thread_id: message.provider_thread_id,
              internet_message_id: message.internet_message_id,
              received_at: message.received_at,
              sender_address: message.sender_address?.toLowerCase() ?? null,
              subject_redacted: message.subject ? "[present]" : null,
              mime_type: message.mime_type,
              provider_revision: message.revision,
            }, {
              onConflict: "mailbox_id,provider_message_id",
              ignoreDuplicates: true,
            })
            .select("id").maybeSingle();
          if (persistError) throw persistError;
          let persistedMessage = persisted as Row | null;
          if (!persistedMessage) {
            duplicateMessages++;
            const { data: existingMessage, error: existingMessageError } =
              await this.client.from("automation_source_messages").select("id")
                .eq("company_id", auth.companyId)
                .eq("mailbox_id", mailboxId)
                .eq("provider_message_id", message.provider_message_id)
                .maybeSingle();
            if (existingMessageError) throw existingMessageError;
            persistedMessage = requiredId(
              existingMessage as Row | null,
              "SourceMessage",
              message.provider_message_id,
            );
            await this.createException(auth.companyId, {
              mailbox_id: mailboxId,
              sync_run_id: run.id,
              message_id: persistedMessage.id,
              reason_code: "message_duplicate",
              lifecycle_status: "resolved",
              idempotency_key: await sha256(
                `message_duplicate:${auth.companyId}:${mailboxId}:${message.provider_message_id}`,
              ),
              safe_details: { duplicate_no_op: true },
              resolved_at: this.now().toISOString(),
              resolution_note:
                "Duplicate provider message was retained as an idempotent no-op.",
              actor_user_id: auth.userId,
            });
          } else {
            messagesPersisted++;
          }
          for (const attachment of message.attachments) {
            const bytes = attachment.bytes ?? await provider.getAttachment({
              accessToken,
              messageId: message.provider_message_id,
              attachmentId: attachment.provider_attachment_id,
            });
            const byteBuffer = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
            const file = new File([byteBuffer], attachment.file_name, {
              type: attachment.content_type,
            });
            let validation;
            try {
              validation = await validateOcrIntakeFile(
                file,
                attachment.content_type === "application/pdf" ? "pdf" : "image",
              );
            } catch (error) {
              await this.createException(auth.companyId, {
                mailbox_id: mailboxId,
                message_id: persistedMessage.id,
                reason_code: attachmentExceptionReason(error),
                safe_details: { provider_attachment_present: true },
              });
              continue;
            }
            const path =
              `${auth.companyId}/automation/${mailboxId}/${validation.sha256}.${
                extension(attachment.file_name)
              }`;
            const { data: knownAttachment, error: knownAttachmentError } =
              await this.client.from("automation_source_attachments")
                .select("id")
                .eq("company_id", auth.companyId)
                .eq("sha256", validation.sha256)
                .maybeSingle();
            if (knownAttachmentError) throw knownAttachmentError;
            if (knownAttachment) {
              duplicateAttachments++;
              await this.createException(auth.companyId, {
                mailbox_id: mailboxId,
                sync_run_id: run.id,
                message_id: persistedMessage.id,
                reason_code: "attachment_duplicate",
                lifecycle_status: "resolved",
                idempotency_key: await sha256(
                  `attachment_duplicate:${auth.companyId}:${validation.sha256}`,
                ),
                safe_details: { duplicate_no_op: true },
                resolved_at: this.now().toISOString(),
                resolution_note:
                  "Duplicate attachment was retained as an idempotent no-op.",
                actor_user_id: auth.userId,
              });
              continue;
            }
            const { error: uploadError } = await this.client.storage.from(
              STORAGE_BUCKET,
            )
              .upload(path, file, {
                upsert: false,
                contentType: validation.detectedMime,
              });
            if (uploadError && uploadError.statusCode !== "409") {
              throw uploadError;
            }
            const { data: attachmentRow, error: attachmentError } = await this
              .client
              .from("automation_source_attachments")
              .upsert({
                company_id: auth.companyId,
                mailbox_id: mailboxId,
                message_id: persistedMessage.id,
                provider_attachment_id: attachment.provider_attachment_id,
                original_file_name: attachment.file_name.slice(0, 255),
                safe_storage_path: path,
                declared_mime_type: attachment.content_type,
                detected_mime_type: validation.detectedMime,
                extension: validation.extension,
                sha256: validation.sha256,
                size_bytes: bytes.byteLength,
                page_count: validation.pageCount,
                scan_status: validation.scanStatus,
                safety_status: "accepted",
                retention_expires_at: validation.retentionExpiresAt,
              }, {
                onConflict: "company_id,sha256",
                ignoreDuplicates: true,
              }).select("id").maybeSingle();
            if (attachmentError) {
              if (!uploadError) {
                const { error: cleanupError } = await this.client.storage
                  .from(STORAGE_BUCKET).remove([path]);
                if (cleanupError) throw cleanupError;
              }
              throw attachmentError;
            }
            if (attachmentRow) attachmentsPersisted++;
            else {
              if (!uploadError) {
                const { data: canonicalAttachment, error: canonicalError } =
                  await this.client.from("automation_source_attachments")
                    .select("safe_storage_path")
                    .eq("company_id", auth.companyId)
                    .eq("sha256", validation.sha256)
                    .maybeSingle();
                if (canonicalError) throw canonicalError;
                if (canonicalAttachment?.safe_storage_path !== path) {
                  const { error: cleanupError } = await this.client.storage
                    .from(STORAGE_BUCKET).remove([path]);
                  if (cleanupError) throw cleanupError;
                }
              }
              duplicateAttachments++;
              await this.createException(auth.companyId, {
                mailbox_id: mailboxId,
                sync_run_id: run.id,
                message_id: persistedMessage.id,
                reason_code: "attachment_duplicate",
                lifecycle_status: "resolved",
                idempotency_key: await sha256(
                  `attachment_duplicate:${auth.companyId}:${validation.sha256}`,
                ),
                safe_details: { duplicate_no_op: true },
                resolved_at: this.now().toISOString(),
                resolution_note:
                  "Duplicate attachment was retained as an idempotent no-op.",
                actor_user_id: auth.userId,
              });
            }
          }
          const { error: messageStatusError } = await this.client
            .from("automation_source_messages")
            .update({ processing_status: "attachments_persisted" })
            .eq("id", persistedMessage.id)
            .eq("company_id", auth.companyId)
            .in("processing_status", ["received", "attachments_persisted"]);
          if (messageStatusError) throw messageStatusError;
        }
        pageToken = page.next_page_token;
        if (!pageToken) completedCursor = page.completed_cursor;
      } while (pageToken);
      if (!completedCursor) {
        throw new BusinessError(
          "PROVIDER_RESPONSE_INVALID",
          "Provider cursor was not completed.",
          502,
        );
      }
      // Cursor advances only after every required message/attachment persistence succeeded.
      const { error: cursorError } = await this.client.from(
        "automation_mailboxes",
      ).update({
        incremental_cursor: completedCursor,
        cursor_kind: mailbox.provider_type === "gmail"
          ? "history_id"
          : "delta_link",
        last_successful_sync_at: this.now().toISOString(),
        redacted_error_code: null,
      }).eq("id", mailboxId).eq("company_id", auth.companyId);
      if (cursorError) throw cursorError;
      const completed = {
        status: "completed",
        cursor_after: completedCursor,
        completed_at: this.now().toISOString(),
        messages_seen: messagesSeen,
        messages_persisted: messagesPersisted,
        attachments_persisted: attachmentsPersisted,
        duplicate_messages: duplicateMessages,
        duplicate_attachments: duplicateAttachments,
      };
      const { error: completeRunError } = await this.client.from(
        "mailbox_sync_runs",
      ).update(completed).eq(
        "id",
        run.id,
      );
      if (completeRunError) throw completeRunError;
      return syncRunDto({ ...run, ...completed });
    } catch (error) {
      const { error: failureRunError } = await this.client.from(
        "mailbox_sync_runs",
      ).update({
        status: error instanceof BusinessError &&
            error.code === "MAILBOX_RECONNECT_REQUIRED"
          ? "reconnect_required"
          : "failed",
        failed_at: this.now().toISOString(),
        redacted_error_code: error instanceof BusinessError
          ? error.code
          : "INTERNAL_PROCESSING_FAILURE",
      }).eq("id", run.id);
      if (failureRunError) throw failureRunError;
      throw error;
    }
  }
}

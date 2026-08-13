import { AUTOMATION_POSTGRES_UUID_PATTERN } from "../contract.ts";
import {
  type AutomationRow,
  CURRENCY,
  DECIMAL,
  EMAIL,
  invalid,
  ISO_DATE,
  ISO_TIMESTAMP,
  PHONE,
  SHA256,
} from "./common.ts";
import { mailboxDto, syncRunDto } from "./directory.ts";
import { commandDto, exceptionDto } from "./documents.ts";
import { auditEventDto, reminderAttemptDto, reminderDto } from "./reminders.ts";

export function mapAutomationCollectionRow(
  table: string,
  row: AutomationRow,
): AutomationRow {
  if (table === "automation_mailboxes") return mailboxDto(row);
  if (table === "mailbox_sync_runs") return syncRunDto(row);
  if (table === "automation_commands") return commandDto(row);
  if (table === "automation_exceptions") return exceptionDto(row);
  if (table === "invoice_reminders") return reminderDto(row);
  if (table === "reminder_delivery_attempts") return reminderAttemptDto(row);
  if (table === "automation_audit_events") return auditEventDto(row);
  return invalid("collection");
}

export const automationPrimitivePatterns = Object.freeze({
  uuid: AUTOMATION_POSTGRES_UUID_PATTERN.source,
  iso_date: ISO_DATE.source,
  iso_timestamp: ISO_TIMESTAMP.source,
  decimal_string: DECIMAL.source,
  currency: CURRENCY.source,
  email: EMAIL.source,
  phone: PHONE.source,
  sha256: SHA256.source,
});

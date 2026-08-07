"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import {
  useAutomationOverview,
  useAutomationSettings,
  useInvoiceReminders,
  useReminderAttempts,
} from "@/hooks/use-automation";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import {
  AuditTimeline,
  AuditTimelineHeading,
} from "@/components/features/automation/audit-timeline";
import { useAuditEvents } from "@/hooks/use-automation";
import type { InvoiceReminder } from "@/lib/automation/contract";
import { useUserRole } from "@/hooks/use-user-role";
import { hasAutomationReadCapability } from "@/lib/automation/navigation";
import {
  REMINDER_ATTEMPT_STATUS_LABEL,
  REMINDER_ATTEMPT_STATUS_TONE,
  REMINDER_STATUS_LABEL,
  REMINDER_STATUS_TONE,
} from "@/lib/automation/labels";
import { formatDate, formatDateTime } from "@/lib/automation/format";

function stageLabel(offset: number): string {
  if (offset === 0) return "On due date";
  if (offset < 0) return `${Math.abs(offset)} day(s) before due`;
  return `${offset} day(s) after due`;
}

/** One reminder row with an on-demand attempt history + entity-scoped audit. */
function ReminderRow({ reminder }: { reminder: InvoiceReminder }) {
  const [open, setOpen] = useState(false);
  const attempts = useReminderAttempts(open ? reminder.id : undefined, {
    page: 1,
    page_size: 20,
  });
  const audit = useAuditEvents(
    open
      ? {
          page: 1,
          page_size: 10,
          entity_type: "invoice_reminders",
          entity_id: reminder.id,
        }
      : undefined,
  );

  const missingRecipientEmail = !reminder.recipient_email_snapshot;

  return (
    <li className="rounded-lg border border-slate-100 bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-slate-800">{stageLabel(reminder.stage_offset_days)}</p>
          <p className="text-slate-500">
            Recipient: {reminder.recipient_name_snapshot ?? "—"}
            {reminder.recipient_email_snapshot
              ? ` · ${reminder.recipient_email_snapshot}`
              : ""}
          </p>
          <p className="text-slate-400">
            Scheduled {formatDate(reminder.scheduled_for)} · Outstanding{" "}
            {reminder.outstanding_snapshot ?? "—"} {reminder.currency_snapshot ?? ""}
            {reminder.delivered_at ? ` · Delivered ${formatDateTime(reminder.delivered_at)}` : ""}
          </p>
          {missingRecipientEmail && (
            <p className="text-amber-700">
              No recipient email on record — this reminder cannot be delivered.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AutomationBadge
            label={REMINDER_STATUS_LABEL[reminder.status]}
            tone={REMINDER_STATUS_TONE[reminder.status]}
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="rounded-lg border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
          >
            {open ? "Hide" : "Attempts"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {/* Delivery attempt history */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Delivery attempts
            </p>
            {attempts.isLoading ? (
              <p className="mt-1 text-slate-400">Loading attempts…</p>
            ) : attempts.isError ? (
              <p className="mt-1 text-red-600">Attempts could not be loaded.</p>
            ) : !attempts.data || attempts.data.rows.length === 0 ? (
              <p className="mt-1 text-slate-400">No delivery attempts recorded.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {attempts.data.rows.map((attempt) => (
                  <li key={attempt.id} className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">
                      #{attempt.attempt_number} ·{" "}
                      {formatDateTime(attempt.completed_at ?? attempt.started_at)}
                      {attempt.provider_message_id
                        ? ` · msg ${attempt.provider_message_id}`
                        : ""}
                      {attempt.redacted_error_code ? ` · ${attempt.redacted_error_code}` : ""}
                    </span>
                    <AutomationBadge
                      label={REMINDER_ATTEMPT_STATUS_LABEL[attempt.status]}
                      tone={REMINDER_ATTEMPT_STATUS_TONE[attempt.status]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Entity-scoped audit for this reminder. */}
          {audit.data && audit.data.rows.length > 0 && (
            <div className="space-y-1">
              <AuditTimelineHeading />
              <AuditTimeline events={audit.data.rows} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Invoice-only reminder status. Scope is deliberately limited to Invoices; no
 * Debit Note reminders and no "send real email" action are offered. The
 * delivery state is DERIVED from the tenant settings + readiness — it is never
 * hard-coded as "disabled".
 */
export function InvoiceReminderPanel({ invoiceId }: { invoiceId: string }) {
  // Reminder status is an operational read (AR Supervisor / Finance Manager /
  // Auditor). For any other role we render a safe unavailable notice and never
  // issue the reminder/overview queries (the hooks are role-gated too).
  const { roles, isResolved } = useUserRole();
  const canRead = isResolved && hasAutomationReadCapability(roles, "reminders");

  const { data, isLoading, isError } = useInvoiceReminders(invoiceId);
  const settings = useAutomationSettings();
  const overview = useAutomationOverview();

  if (!canRead) {
    return (
      <section className="glass-card space-y-2 p-6" aria-labelledby="reminder-heading">
        <h2
          id="reminder-heading"
          className="flex items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <BellRing className="h-4 w-4" aria-hidden="true" /> Invoice Due Reminders
        </h2>
        <p className="text-xs text-slate-500">
          Reminder status is available to AR Supervisor, Finance Manager, and
          Auditor roles.
        </p>
      </section>
    );
  }

  // Derive the authoritative delivery state from Settings + readiness.
  let deliveryState: { label: string; tone: "success" | "warning" | "muted"; detail: string };
  if (settings.data && !settings.data.reminder_delivery_enabled) {
    deliveryState = {
      label: "Delivery disabled",
      tone: "muted",
      detail: "The reminder delivery kill switch is off. No reminder is sent.",
    };
  } else if (overview.data && !overview.data.delivery_ready) {
    deliveryState = {
      label: "Provider not configured",
      tone: "warning",
      detail: "A delivery mailbox is not connected. Reminders cannot be sent yet.",
    };
  } else if (settings.data?.reminder_delivery_enabled && overview.data?.delivery_ready) {
    deliveryState = {
      label: "Delivery enabled",
      tone: "success",
      detail: "Delivery is enabled and a provider is connected.",
    };
  } else {
    deliveryState = {
      label: "Delivery status pending",
      tone: "muted",
      detail: "Delivery readiness is being determined.",
    };
  }

  return (
    <section className="glass-card space-y-3 p-6" aria-labelledby="reminder-heading">
      <h2
        id="reminder-heading"
        className="flex items-center gap-2 text-sm font-semibold text-slate-700"
      >
        <BellRing className="h-4 w-4" aria-hidden="true" /> Invoice Due Reminders
      </h2>
      <p className="text-xs text-slate-500">
        Policy: reminders are evaluated 3 days before and on the due date for
        Invoices with an outstanding balance and a current active sales
        representative. Debit Notes never generate reminders.
      </p>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400">Delivery:</span>
        <AutomationBadge label={deliveryState.label} tone={deliveryState.tone} />
        <span className="text-slate-400">{deliveryState.detail}</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">Loading reminders…</p>
      ) : isError ? (
        <p className="text-xs text-red-600">Reminder status could not be loaded.</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          No reminders have been evaluated for this invoice yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.rows.map((reminder) => (
            <ReminderRow key={reminder.id} reminder={reminder} />
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import {
  type SettingsPatch,
  useAutomationSettings,
  useUpdateAutomationSettings,
} from "@/hooks/use-automation";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import { AutomationDialog } from "@/components/features/automation/dialog";
import {
  AutomationError,
  AutomationLoading,
} from "@/components/features/automation/states";
import {
  CAPABILITY_LABEL,
  OPERATING_MODE_DESCRIPTION,
  OPERATING_MODE_FINANCIAL_IMPACT,
  OPERATING_MODE_LABEL,
  OPERATING_MODE_TONE,
  REMINDER_MODE_DESCRIPTION,
  REMINDER_MODE_LABEL,
  REMINDER_MODE_TONE,
  switchStatusLabel,
} from "@/lib/automation/labels";
import {
  CAPABILITY_KEYS,
  type CapabilityKey,
  OPERATING_MODES,
  type OperatingMode,
  REMINDER_MODES,
  type ReminderMode,
} from "@/lib/automation/contract";
import { ApiError } from "@/hooks/use-api";

const STRAIGHT_THROUGH_TOKEN = "ENABLE_STRAIGHT_THROUGH";
/** Roles allowed to PATCH configuration (the disabled/off states + policy). */
const CONFIG_ROLES = ["Finance Manager", "System Admin"];

export default function AutomationSettingsPage() {
  const { roles } = useUserRole();
  // Per the frozen contract: Finance Manager OR System Admin may edit
  // configuration, but ONLY Finance Manager may ARM a non-disabled operating
  // mode or a non-off reminder mode. System Admin is configuration-only and can
  // never arm financial document automation or reminder delivery. The backend
  // enforces this regardless of what the UI renders.
  const canEdit = roles.some((r) => CONFIG_ROLES.includes(r));
  const canArm = roles.includes("Finance Manager");

  const { data: settings, isLoading, isError, refetch } = useAutomationSettings();
  const update = useUpdateAutomationSettings();

  const [confirmMode, setConfirmMode] = useState<OperatingMode | null>(null);
  const [confirmReminder, setConfirmReminder] = useState<ReminderMode | null>(
    null,
  );
  // Sticky notice when the backend fails a delivery-readiness precondition, so
  // the UI never pretends Automatic Delivery activated.
  const [deliveryUnavailable, setDeliveryUnavailable] = useState(false);

  if (isLoading) return <AutomationLoading label="Loading settings" />;
  if (isError || !settings) {
    return <AutomationError onRetry={() => refetch()} />;
  }

  function applyPatch(
    patch: SettingsPatch,
    successMessage: string,
    onDone?: (ok: boolean) => void,
  ) {
    update.mutate(patch, {
      onSuccess: () => {
        toast.success(successMessage);
        onDone?.(true);
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError ? error.message : "Update was rejected.",
        );
        onDone?.(false);
      },
    });
  }

  function requestModeChange(mode: OperatingMode) {
    if (mode === settings!.operating_mode) return;
    if (mode !== "disabled" && !canArm) return;
    setConfirmMode(mode);
  }

  function confirmModeChange() {
    if (!confirmMode) return;
    const patch: SettingsPatch = { operating_mode: confirmMode };
    if (confirmMode === "straight_through") {
      patch.activation_confirmation = STRAIGHT_THROUGH_TOKEN;
    }
    applyPatch(patch, `Operating mode set to ${OPERATING_MODE_LABEL[confirmMode]}.`);
    setConfirmMode(null);
  }

  function requestReminderChange(mode: ReminderMode) {
    if (mode === settings!.reminder_mode) return;
    // Only a Finance Manager may arm a non-off reminder mode.
    if (mode !== "off" && !canArm) return;
    // Turning reminders OFF is always a safe, immediate path (no readiness
    // precondition) — never gated behind a confirmation dialog.
    if (mode === "off") {
      applyReminderMode("off");
      return;
    }
    setConfirmReminder(mode);
  }

  function applyReminderMode(mode: ReminderMode) {
    applyPatch(
      { reminder_mode: mode },
      `Reminder automation set to ${REMINDER_MODE_LABEL[mode]}.`,
      (ok) => {
        // Surface a truthful "configuration required" state when the backend
        // rejects Automatic Delivery for lack of a ready delivery provider.
        setDeliveryUnavailable(!ok && mode === "automatic_delivery");
      },
    );
  }

  function confirmReminderChange() {
    if (!confirmReminder) return;
    applyReminderMode(confirmReminder);
    setConfirmReminder(null);
  }

  return (
    <div className="space-y-6">
      {/* Operating mode — visual structure preserved. */}
      <section className="rounded-xl border border-slate-200 bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Operating Mode</h2>
          <AutomationBadge
            label={OPERATING_MODE_LABEL[settings.operating_mode]}
            tone={OPERATING_MODE_TONE[settings.operating_mode]}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {OPERATING_MODE_DESCRIPTION[settings.operating_mode]}
        </p>

        <fieldset className="mt-4 grid gap-2 sm:grid-cols-2" disabled={!canEdit}>
          <legend className="sr-only">Select operating mode</legend>
          {OPERATING_MODES.map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <input
                type="radio"
                name="operating_mode"
                className="mt-0.5"
                checked={settings.operating_mode === mode}
                disabled={mode !== "disabled" && !canArm}
                onChange={() => requestModeChange(mode)}
              />
              <span>
                <span className="font-semibold text-slate-800">
                  {OPERATING_MODE_LABEL[mode]}
                </span>
                <span className="mt-0.5 block text-slate-500">
                  {OPERATING_MODE_FINANCIAL_IMPACT[mode]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {!canEdit && (
          <p className="mt-2 text-xs text-slate-400">
            Read-only. Only Finance Manager or System Admin can change automation
            settings.
          </p>
        )}
        {canEdit && !canArm && (
          <p className="mt-2 text-xs text-slate-400">
            As System Admin you may configure automation and turn it{" "}
            <strong>off (Disabled)</strong>, but only a Finance Manager can arm
            Observe&nbsp;Only, Draft&nbsp;Only, or Straight-Through.
          </p>
        )}
      </section>

      {/* Reminder automation — high-level control, same visual language. */}
      <section className="rounded-xl border border-slate-200 bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">
            Reminder Automation
          </h2>
          <AutomationBadge
            label={REMINDER_MODE_LABEL[settings.reminder_mode]}
            tone={REMINDER_MODE_TONE[settings.reminder_mode]}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {REMINDER_MODE_DESCRIPTION[settings.reminder_mode]}
        </p>

        <fieldset className="mt-4 grid gap-2 sm:grid-cols-3" disabled={!canEdit}>
          <legend className="sr-only">Select reminder automation</legend>
          {REMINDER_MODES.map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <input
                type="radio"
                name="reminder_mode"
                className="mt-0.5"
                checked={settings.reminder_mode === mode}
                disabled={mode !== "off" && !canArm}
                onChange={() => requestReminderChange(mode)}
              />
              <span>
                <span className="font-semibold text-slate-800">
                  {REMINDER_MODE_LABEL[mode]}
                </span>
                <span className="mt-0.5 block text-slate-500">
                  {REMINDER_MODE_DESCRIPTION[mode]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {deliveryUnavailable && settings.reminder_mode !== "automatic_delivery" && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
          >
            <strong>Automatic Delivery is unavailable.</strong> A connected
            reminder delivery provider is required before automated emails can be
            sent. Reminder automation was not changed. Connect a delivery-enabled
            mailbox, then try again.
          </p>
        )}
        {canEdit && !canArm && (
          <p className="mt-2 text-xs text-slate-400">
            As System Admin you may turn reminders <strong>Off</strong>, but only
            a Finance Manager can arm Evaluate&nbsp;Only or Automatic&nbsp;Delivery.
          </p>
        )}
      </section>

      {/* Capabilities — read-only, backend-derived (replaces Kill Switches). */}
      <section className="rounded-xl border border-slate-200 bg-surface p-5">
        <h2 className="text-sm font-semibold text-slate-800">Capabilities</h2>
        <p className="mt-1 text-xs text-slate-500">
          Capabilities are managed automatically based on the selected automation
          modes. They are shown here for transparency and cannot be toggled
          individually.
        </p>
        <ul className="mt-3 space-y-2">
          {CAPABILITY_KEYS.map((key: CapabilityKey) => {
            const status = switchStatusLabel(settings[key]);
            return (
              <li
                key={key}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
              >
                <span className="text-xs font-medium text-slate-700">
                  {CAPABILITY_LABEL[key]}
                </span>
                <AutomationBadge label={status.label} tone={status.tone} />
              </li>
            );
          })}
        </ul>
      </section>

      {/* Operating-mode confirmation dialog. */}
      <AutomationDialog
        open={confirmMode !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmMode(null);
        }}
        title="Confirm mode change"
        description={
          confirmMode
            ? `Change the tenant automation operating mode to ${OPERATING_MODE_LABEL[confirmMode]}. Review the financial impact below before confirming; the backend re-enforces readiness and capability derivation at runtime.`
            : "Confirm the automation operating-mode change."
        }
        visuallyHiddenDescription
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmMode(null)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmModeChange}
              disabled={update.isPending}
              className="rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Confirm
            </button>
          </>
        }
      >
        {confirmMode && (
          <>
            <p className="flex items-center gap-2 text-xs text-slate-600">
              <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Change operating mode to{" "}
              <strong>{OPERATING_MODE_LABEL[confirmMode]}</strong>.
            </p>
            <p className="text-xs text-slate-600">
              {OPERATING_MODE_FINANCIAL_IMPACT[confirmMode]}
            </p>
            {confirmMode === "straight_through" && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                Straight-through creates and posts financial records without a
                person. Confirming here changes <strong>only</strong> the tenant
                operating-mode setting — it does <strong>not</strong> prove
                ingestion, delivery, or document-intelligence readiness. Each
                capability worker independently rechecks its own readiness at
                runtime and fails closed if anything is not ready.
              </p>
            )}
          </>
        )}
      </AutomationDialog>

      {/* Reminder-automation confirmation dialog. */}
      <AutomationDialog
        open={confirmReminder !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmReminder(null);
        }}
        title="Confirm reminder automation"
        description={
          confirmReminder
            ? `Change reminder automation to ${REMINDER_MODE_LABEL[confirmReminder]}. The backend re-enforces delivery-provider readiness before any automated email is enabled.`
            : "Confirm the reminder automation change."
        }
        visuallyHiddenDescription
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmReminder(null)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReminderChange}
              disabled={update.isPending}
              className="rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Confirm
            </button>
          </>
        }
      >
        {confirmReminder && (
          <>
            <p className="flex items-center gap-2 text-xs text-slate-600">
              <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Change reminder automation to{" "}
              <strong>{REMINDER_MODE_LABEL[confirmReminder]}</strong>.
            </p>
            <p className="text-xs text-slate-600">
              {REMINDER_MODE_DESCRIPTION[confirmReminder]}
            </p>
            {confirmReminder === "automatic_delivery" && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                Automatic Delivery sends approved reminder emails without a
                person. The backend requires a connected, delivery-enabled
                mailbox and will refuse activation if delivery is not ready — the
                setting will not change in that case.
              </p>
            )}
          </>
        )}
      </AutomationDialog>
    </div>
  );
}

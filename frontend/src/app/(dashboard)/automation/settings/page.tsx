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
  KILL_SWITCH_LABEL,
  OPERATING_MODE_DESCRIPTION,
  OPERATING_MODE_FINANCIAL_IMPACT,
  OPERATING_MODE_LABEL,
  OPERATING_MODE_TONE,
  switchStatusLabel,
} from "@/lib/automation/labels";
import {
  KILL_SWITCH_KEYS,
  type KillSwitchKey,
  OPERATING_MODES,
  type OperatingMode,
} from "@/lib/automation/contract";
import { ApiError } from "@/hooks/use-api";

const STRAIGHT_THROUGH_TOKEN = "ENABLE_STRAIGHT_THROUGH";
/** Roles allowed to PATCH configuration (kill switches + the disabled mode). */
const CONFIG_ROLES = ["Finance Manager", "System Admin"];

export default function AutomationSettingsPage() {
  const { roles } = useUserRole();
  // Per the frozen contract: Finance Manager OR System Admin may edit
  // configuration, but ONLY Finance Manager may select a non-disabled operating
  // mode. System Admin is configuration-only and can never arm observe_only,
  // draft_only, or straight_through. The backend enforces this regardless.
  const canEdit = roles.some((r) => CONFIG_ROLES.includes(r));
  const canSetNonDisabledMode = roles.includes("Finance Manager");

  const { data: settings, isLoading, isError, refetch } = useAutomationSettings();
  const update = useUpdateAutomationSettings();

  const [confirmMode, setConfirmMode] = useState<OperatingMode | null>(null);

  if (isLoading) return <AutomationLoading label="Loading settings" />;
  if (isError || !settings) {
    return <AutomationError onRetry={() => refetch()} />;
  }

  function applyPatch(patch: SettingsPatch, successMessage: string) {
    update.mutate(patch, {
      onSuccess: () => toast.success(successMessage),
      onError: (error) =>
        toast.error(
          error instanceof ApiError ? error.message : "Update was rejected.",
        ),
    });
  }

  function requestModeChange(mode: OperatingMode) {
    if (mode === settings!.operating_mode) return;
    // System Admin (configuration-only) can never arm a non-disabled mode.
    if (mode !== "disabled" && !canSetNonDisabledMode) return;
    // Higher-risk changes are confirmed first; never auto-enabled on load.
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

  return (
    <div className="space-y-6">
      {/* Operating mode */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
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
                disabled={mode !== "disabled" && !canSetNonDisabledMode}
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
        {canEdit && !canSetNonDisabledMode && (
          <p className="mt-2 text-xs text-slate-400">
            As System Admin you may configure automation and turn it{" "}
            <strong>off (Disabled)</strong>, but only a Finance Manager can arm
            Observe&nbsp;Only, Draft&nbsp;Only, or Straight-Through.
          </p>
        )}
      </section>

      {/* Kill switches */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-800">Kill Switches</h2>
        <p className="mt-1 text-xs text-slate-500">
          Each capability is independently controlled and defaults to disabled.
          The backend remains authoritative and may reject an unsafe combination.
        </p>
        <ul className="mt-3 space-y-2">
          {KILL_SWITCH_KEYS.map((key: KillSwitchKey) => {
            const enabled = settings[key];
            const status = switchStatusLabel(enabled);
            return (
              <li
                key={key}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
              >
                <span className="text-xs font-medium text-slate-700">
                  {KILL_SWITCH_LABEL[key]}
                </span>
                <span className="flex items-center gap-2">
                  <AutomationBadge label={status.label} tone={status.tone} />
                  {canEdit && (
                    <button
                      type="button"
                      disabled={update.isPending}
                      onClick={() =>
                        applyPatch(
                          { [key]: !enabled } as SettingsPatch,
                          `${KILL_SWITCH_LABEL[key]} ${enabled ? "disabled" : "enabled"}.`,
                        )
                      }
                      className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                    >
                      {enabled ? "Disable" : "Enable"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Confirmation dialog — accessible Radix dialog (focus trap, Escape,
          focus restoration, aria-modal, labelled title). */}
      <AutomationDialog
        open={confirmMode !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmMode(null);
        }}
        title="Confirm mode change"
        description={
          confirmMode
            ? `Change the tenant automation operating mode to ${OPERATING_MODE_LABEL[confirmMode]}. Review the financial impact below before confirming; the backend re-enforces readiness and kill switches at runtime.`
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
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
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
                ingestion, delivery, or document-intelligence readiness and does
                not bypass any kill switch. Each capability worker independently
                rechecks its own readiness and kill switch at runtime and fails
                closed if anything is not ready.
              </p>
            )}
          </>
        )}
      </AutomationDialog>
    </div>
  );
}

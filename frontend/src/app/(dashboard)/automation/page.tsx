"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Inbox,
  Link2,
  Mail,
  Receipt,
} from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import {
  AutomationError,
  AutomationLoading,
} from "@/components/features/automation/states";
import { useAutomationOverview } from "@/hooks/use-automation";
import {
  CAPABILITY_LABEL,
  OPERATING_MODE_DESCRIPTION,
  OPERATING_MODE_LABEL,
  OPERATING_MODE_TONE,
  switchStatusLabel,
} from "@/lib/automation/labels";
import { CAPABILITY_KEYS } from "@/lib/automation/contract";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readinessLabel(ready: boolean | null | undefined): {
  label: string;
  tone: "success" | "warning";
} {
  return ready
    ? { label: "Ready", tone: "success" }
    : { label: "Provider Configuration Required", tone: "warning" };
}

/** Grid changes from 4→5 cards once ingestion and delivery are shown separately. */

export default function AutomationOverviewPage() {
  const { data, isLoading, isError, refetch } = useAutomationOverview();

  if (isLoading) return <AutomationLoading label="Loading automation overview" />;
  if (isError || !data) {
    return (
      <AutomationError
        message="The automation overview could not be loaded."
        onRetry={() => refetch()}
      />
    );
  }

  const { settings } = data;
  const ingestion = readinessLabel(data.ingestion_ready);
  const delivery = readinessLabel(data.delivery_ready);
  const docIntel = readinessLabel(data.document_intelligence_ready);

  return (
    <div className="space-y-6">
      {/* Truthful activation banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Automation operating mode is{" "}
          <strong>{OPERATING_MODE_LABEL[settings.operating_mode]}</strong>.
          Mailbox ingestion is {data.ingestion_ready ? "ready" : "not ready"};
          document intelligence is{" "}
          {data.document_intelligence_ready ? "ready" : "not ready"}; and
          reminder-email delivery is {data.delivery_ready ? "ready" : "not ready"}.{" "}
          {settings.operating_mode === "straight_through"
            ? "Straight-Through is active under the configured capability switches."
            : "Straight-Through is not active."}{" "}
          Counters reflect only what has actually run.
        </p>
      </div>

      {/* Operating mode + readiness */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Operating Mode
          </p>
          <div className="mt-2">
            <AutomationBadge
              label={OPERATING_MODE_LABEL[settings.operating_mode]}
              tone={OPERATING_MODE_TONE[settings.operating_mode]}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {OPERATING_MODE_DESCRIPTION[settings.operating_mode]}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Document Intelligence
          </p>
          <div className="mt-2">
            <AutomationBadge label={docIntel.label} tone={docIntel.tone} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Bounded classification/extraction provider status.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Ingestion Readiness
          </p>
          <div className="mt-2">
            <AutomationBadge label={ingestion.label} tone={ingestion.tone} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Mailbox document ingestion. {data.connected_mailbox_count} connected ·{" "}
            {data.reconnect_required_mailbox_count} need reconnect
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Delivery Readiness
          </p>
          <div className="mt-2">
            <AutomationBadge label={delivery.label} tone={delivery.tone} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Reminder-email delivery only — independent of ingestion.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Synchronization
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Last success: {formatDateTime(data.last_successful_sync_at)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Last failure: {formatDateTime(data.last_failed_sync_at)}
          </p>
        </div>
      </section>

      {/* Capabilities — read-only, backend-derived from the automation modes. */}
      <section className="rounded-xl border border-slate-200 bg-surface p-5">
        <h2 className="text-sm font-semibold text-slate-800">Capabilities</h2>
        <p className="mt-1 text-xs text-slate-500">
          Capabilities are managed automatically based on the selected automation
          modes. All default to disabled.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITY_KEYS.map((key) => {
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

      {/* Activity counters */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Processing Runs" value={String(data.processing_runs)} icon={Activity} variant="info" />
        <KpiCard title="Documents Processed" value={String(data.documents_processed)} subtitle={`${data.accepted_documents} accepted · ${data.rejected_documents} rejected`} icon={Inbox} />
        <KpiCard title="Invoices Created" value={String(data.invoices_created)} icon={FileText} variant="success" />
        <KpiCard title="Receipts Created" value={String(data.receipts_created)} icon={Receipt} variant="success" />
        <KpiCard title="Allocations Completed" value={String(data.allocations_completed)} icon={Link2} />
        <KpiCard title="Reminders Evaluated" value={String(data.reminders_evaluated)} subtitle={`${data.reminders_sent} recorded as sent`} icon={Mail} />
        <KpiCard title="Open Exceptions" value={String(data.open_exceptions)} icon={AlertTriangle} variant={data.open_exceptions > 0 ? "warning" : "default"} />
        <KpiCard title="Retryable Exceptions" value={String(data.retryable_exceptions)} icon={CheckCircle2} variant={data.retryable_exceptions > 0 ? "warning" : "default"} />
      </section>
    </div>
  );
}

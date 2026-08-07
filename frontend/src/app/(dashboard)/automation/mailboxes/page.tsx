"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail, Plus, RefreshCw } from "lucide-react";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import {
  AutomationEmpty,
  AutomationError,
  AutomationLoading,
} from "@/components/features/automation/states";
import {
  useBeginMailboxOAuth,
  useCreateMailbox,
  useMailboxes,
  useSyncMailbox,
  useUpdateMailbox,
} from "@/hooks/use-automation";
import { useUserRole } from "@/hooks/use-user-role";
import { ApiError } from "@/hooks/use-api";
import {
  PROVIDER_TYPES,
  type Mailbox,
  type ProviderType,
} from "@/lib/automation/contract";
import {
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
  PROVIDER_LABEL,
  switchStatusLabel,
} from "@/lib/automation/labels";
import { formatDateTime } from "@/lib/automation/format";
import { openOAuthAuthorizationUrl } from "@/lib/automation/oauth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECRET_REF_RE = /^[A-Z][A-Z0-9_]{2,127}$/;
const CONFIG_ROLES = ["Finance Manager", "System Admin"];
const SYNC_ROLES = ["AR Supervisor", "Finance Manager"];

function MailboxCard({
  mailbox,
  canConfig,
  canSync,
}: {
  mailbox: Mailbox;
  canConfig: boolean;
  canSync: boolean;
}) {
  const oauth = useBeginMailboxOAuth();
  const update = useUpdateMailbox();
  const sync = useSyncMailbox();
  const status = CONNECTION_STATUS_LABEL[mailbox.connection_status];

  function beginOAuth(capability: "ingestion" | "delivery") {
    oauth.mutate(
      { id: mailbox.id, capability },
      {
        onSuccess: (result) => {
          // NEVER trust the raw backend URL for navigation. Re-validate the
          // origin against the provider allowlist (HTTPS, exact host, no
          // embedded credentials) before opening with noopener,noreferrer.
          // Provider authorization is completed by the user in the provider's
          // own window; the frontend never parses returned tokens.
          const validation = openOAuthAuthorizationUrl(
            mailbox.provider_type,
            result.authorization_url,
          );
          if (validation.ok) {
            toast.success("Opened provider consent in a new tab.");
          } else {
            toast.error(validation.reason ?? "The authorization link was refused.");
          }
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : "OAuth start is unavailable.",
          ),
      },
    );
  }

  function toggle(field: "is_enabled" | "ingestion_enabled" | "delivery_enabled") {
    update.mutate(
      { id: mailbox.id, patch: { [field]: !mailbox[field] } },
      {
        onSuccess: () => toast.success("Mailbox updated."),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "Update was rejected."),
      },
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
            {mailbox.mailbox_address}
          </p>
          <p className="text-xs text-slate-500">{PROVIDER_LABEL[mailbox.provider_type]}</p>
        </div>
        <AutomationBadge label={status} tone={CONNECTION_STATUS_TONE[mailbox.connection_status]} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-600 sm:grid-cols-3">
        <div>
          <dt className="text-slate-400">Enabled</dt>
          <dd>{switchStatusLabel(mailbox.is_enabled).label}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Ingestion</dt>
          <dd>{switchStatusLabel(mailbox.ingestion_enabled).label}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Delivery</dt>
          <dd>{switchStatusLabel(mailbox.delivery_enabled).label}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Ingestion secret</dt>
          <dd>{mailbox.ingestion_secret_configured ? "Configured" : "Not set"}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Delivery secret</dt>
          <dd>{mailbox.delivery_secret_configured ? "Configured" : "Not set"}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Ingestion token</dt>
          <dd>
            {mailbox.ingestion_token_expires_at
              ? `Expires ${formatDateTime(mailbox.ingestion_token_expires_at)}`
              : "Not connected"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Delivery token</dt>
          <dd>
            {mailbox.delivery_token_expires_at
              ? `Expires ${formatDateTime(mailbox.delivery_token_expires_at)}`
              : "Not connected"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Cursor</dt>
          <dd>{mailbox.cursor_present ? (mailbox.cursor_kind ?? "Present") : "None"}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Reconnect</dt>
          <dd>{mailbox.reconnect_required ? "Required" : "No"}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Last success</dt>
          <dd>{formatDateTime(mailbox.last_successful_sync_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Last failure</dt>
          <dd>{formatDateTime(mailbox.last_failed_sync_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Error</dt>
          <dd>{mailbox.redacted_error_code ?? "—"}</dd>
        </div>
      </dl>

      {(canConfig || canSync) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {canConfig && (
            <>
              <button
                type="button"
                onClick={() => beginOAuth("ingestion")}
                disabled={oauth.isPending}
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
              >
                Connect ingestion
              </button>
              <button
                type="button"
                onClick={() => beginOAuth("delivery")}
                disabled={oauth.isPending}
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
              >
                Connect delivery
              </button>
              <button
                type="button"
                onClick={() => toggle("is_enabled")}
                disabled={update.isPending}
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
              >
                {mailbox.is_enabled ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                onClick={() => toggle("ingestion_enabled")}
                disabled={update.isPending}
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
              >
                {mailbox.ingestion_enabled ? "Disable ingestion" : "Enable ingestion"}
              </button>
              <button
                type="button"
                onClick={() => toggle("delivery_enabled")}
                disabled={update.isPending}
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
              >
                {mailbox.delivery_enabled ? "Disable delivery" : "Enable delivery"}
              </button>
            </>
          )}
          {canSync && (
            <button
              type="button"
              onClick={() =>
                sync.mutate(mailbox.id, {
                  onSuccess: () => toast.success("Manual sync requested."),
                  onError: (error) =>
                    toast.error(
                      error instanceof ApiError ? error.message : "Sync is disabled.",
                    ),
                })
              }
              disabled={sync.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" /> Sync now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MailboxesPage() {
  const { roles } = useUserRole();
  const canConfig = roles.some((r) => CONFIG_ROLES.includes(r));
  const canSync = roles.some((r) => SYNC_ROLES.includes(r));

  const { data, isLoading, isError, refetch } = useMailboxes({ page: 1, page_size: 50 });
  const create = useCreateMailbox();

  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<ProviderType>("gmail");
  const [address, setAddress] = useState("");
  const [ingestionRef, setIngestionRef] = useState("");
  const [deliveryRef, setDeliveryRef] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit() {
    const next: Record<string, string> = {};
    const addr = address.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) next.address = "Enter a valid mailbox address.";
    if (ingestionRef && !SECRET_REF_RE.test(ingestionRef))
      next.ingestion = "Use an uppercase reference name (e.g. AR_MAILBOX_INGESTION_1).";
    if (deliveryRef && !SECRET_REF_RE.test(deliveryRef))
      next.delivery = "Use an uppercase reference name.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate(
      {
        provider_type: provider,
        mailbox_address: addr,
        ingestion_secret_ref: ingestionRef || null,
        delivery_secret_ref: deliveryRef || null,
      },
      {
        onSuccess: () => {
          toast.success("Mailbox configuration created (disabled).");
          setShowForm(false);
          setAddress("");
          setIngestionRef("");
          setDeliveryRef("");
        },
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "Could not create mailbox."),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Mailbox Connections</h2>
          <p className="text-xs text-slate-500">
            Configure Gmail / Google Workspace and Microsoft Outlook / 365 mailboxes.
            Tokens are never shown; only opaque secret references and expiry are stored.
          </p>
        </div>
        {canConfig && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add Mailbox
          </button>
        )}
      </div>

      {showForm && canConfig && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2"
          aria-label="Create mailbox"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderType)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              {PROVIDER_TYPES.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700">Mailbox address</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              inputMode="email"
              aria-invalid={Boolean(errors.address)}
            />
            {errors.address && <span className="text-red-600">{errors.address}</span>}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700">Ingestion secret reference (optional)</span>
            <input
              value={ingestionRef}
              onChange={(e) => setIngestionRef(e.target.value)}
              placeholder="AR_MAILBOX_INGESTION_1"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              aria-invalid={Boolean(errors.ingestion)}
            />
            {errors.ingestion && <span className="text-red-600">{errors.ingestion}</span>}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700">Delivery secret reference (optional)</span>
            <input
              value={deliveryRef}
              onChange={(e) => setDeliveryRef(e.target.value)}
              placeholder="AR_MAILBOX_DELIVERY_1"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              aria-invalid={Boolean(errors.delivery)}
            />
            {errors.delivery && <span className="text-red-600">{errors.delivery}</span>}
          </label>
          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {create.isPending ? "Saving…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <AutomationLoading label="Loading mailboxes" />
      ) : isError || !data ? (
        <AutomationError onRetry={() => refetch()} />
      ) : data.rows.length === 0 ? (
        <AutomationEmpty
          title="No mailboxes configured"
          description="Add a Gmail or Microsoft mailbox to begin. New mailboxes are created disabled and require provider consent before use."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.rows.map((mailbox) => (
            <MailboxCard
              key={mailbox.id}
              mailbox={mailbox}
              canConfig={canConfig}
              canSync={canSync}
            />
          ))}
        </div>
      )}
    </div>
  );
}

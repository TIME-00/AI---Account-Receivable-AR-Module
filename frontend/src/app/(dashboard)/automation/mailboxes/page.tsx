"use client";

import { useEffect, useRef, useState } from "react";
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
  useDisableMailboxDelivery,
  useEnableMailboxDelivery,
  useMailboxes,
  useReconnectMailboxDelivery,
  useSyncMailbox,
  useUpdateMailbox,
} from "@/hooks/use-automation";
import { useUserRole } from "@/hooks/use-user-role";
import { ApiError } from "@/hooks/use-api";
import { useBankAccounts } from "@/hooks/use-receipts";
import type { BankAccount } from "@/types";
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
import {
  DELIVERY_ENABLED_MESSAGE,
  navigateToOAuthAuthorizationUrl,
  openOAuthAuthorizationUrl,
  readOAuthCallbackOutcome,
  stripOAuthCallbackQuery,
} from "@/lib/automation/oauth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECRET_REF_RE = /^[A-Z][A-Z0-9_]{2,127}$/;
const CONFIG_ROLES = ["Finance Manager", "System Admin"];
const SYNC_ROLES = ["AR Supervisor", "Finance Manager"];

/**
 * Mask a bank account number to its last four digits (reuses the same
 * "ending NNNN" convention as the Receipts payment form). The full number is
 * never rendered.
 */
function maskAccountNo(accountNo: string): string {
  const digits = accountNo.replace(/\D/g, "");
  const suffix = digits.slice(-4);
  return suffix ? `ending ${suffix}` : "number unavailable";
}

function bankOptionLabel(account: BankAccount): string {
  const currency = account.currency ? ` · ${account.currency}` : "";
  return `${account.bank_name} · ${account.account_name} · ${maskAccountNo(account.account_no)}${currency}`;
}

function MailboxCard({
  mailbox,
  canConfig,
  canSync,
  bankAccounts,
  bankAccountsLoading,
}: {
  mailbox: Mailbox;
  canConfig: boolean;
  canSync: boolean;
  bankAccounts: BankAccount[];
  bankAccountsLoading: boolean;
}) {
  const oauth = useBeginMailboxOAuth();
  const update = useUpdateMailbox();
  const sync = useSyncMailbox();
  const enableDelivery = useEnableMailboxDelivery();
  const reconnectDelivery = useReconnectMailboxDelivery();
  const disableDelivery = useDisableMailboxDelivery();
  const status = CONNECTION_STATUS_LABEL[mailbox.connection_status];

  // ── Governed Delivery onboarding ───────────────────────────────────────────
  // Exactly ONE Delivery control is offered at a time, derived only from
  // server-authoritative mailbox state:
  //   reconnect required        → Reconnect delivery
  //   enabled and healthy       → Disable delivery   (never "Connect delivery")
  //   disabled (credential or   → Enable delivery    (the server decides whether
  //   not) and healthy                                consent is actually needed)
  const deliveryAction: "reconnect" | "disable" | "enable" =
    mailbox.delivery_reconnect_required
      ? "reconnect"
      : mailbox.delivery_enabled
        ? "disable"
        : "enable";
  // One shared pending gate: no Delivery action can be queued behind another,
  // and a duplicate click on the in-flight control cannot start a second call.
  const deliveryPending =
    enableDelivery.isPending ||
    reconnectDelivery.isPending ||
    disableDelivery.isPending;
  const deliveryFailed =
    enableDelivery.isError || reconnectDelivery.isError || disableDelivery.isError;

  /**
   * Enable/reconnect run against the governed endpoint with an exact `{}` body.
   * The server returns either the enabled mailbox or a consent start; the
   * frontend NEVER PATCHes `delivery_enabled` and never infers activation from
   * any callback query parameter.
   */
  function startDelivery(kind: "enable" | "reconnect") {
    const mutation = kind === "enable" ? enableDelivery : reconnectDelivery;
    mutation.mutate(mailbox.id, {
      onSuccess: (result) => {
        if (result.outcome === "enabled") {
          // The hook already invalidated the automation root, so the card
          // re-reads authoritative state rather than trusting this response.
          toast.success(DELIVERY_ENABLED_MESSAGE);
          return;
        }
        // Re-validate the backend-supplied URL against the provider allowlist
        // (HTTPS, exact host, no credentials, no odd port) before navigating.
        const validation = navigateToOAuthAuthorizationUrl(
          result.provider,
          result.authorization_url,
        );
        if (!validation.ok) {
          toast.error(validation.reason ?? "The authorization link was refused.");
        }
      },
      onError: (error) =>
        toast.error(
          error instanceof ApiError
            ? error.message
            : "The delivery action was rejected.",
        ),
    });
  }

  function stopDelivery() {
    disableDelivery.mutate(mailbox.id, {
      onSuccess: () => toast.success("Delivery disabled."),
      onError: (error) =>
        toast.error(
          error instanceof ApiError
            ? error.message
            : "The delivery action was rejected.",
        ),
    });
  }

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

  // Ingestion activation is a single atomic mutation: the mailbox master switch
  // (is_enabled) and the ingestion capability (ingestion_enabled) are always set
  // together, so the mailbox is never left in a half-enabled intermediate state.
  // Backend v14 resolves/refreshes the Vault-backed OAuth token as part of this
  // one PATCH; the frontend never touches tokens. Delivery stays independent.
  function toggleIngestion() {
    const enabling = !mailbox.ingestion_enabled;
    update.mutate(
      {
        id: mailbox.id,
        patch: { is_enabled: enabling, ingestion_enabled: enabling },
      },
      {
        onSuccess: () => toast.success("Mailbox updated."),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "Update was rejected."),
      },
    );
  }

  // Default receiving bank account: the company account used for Receipt records
  // auto-created from THIS mailbox. Only active accounts are offered. Saving
  // sends ONE mailbox PATCH carrying exactly `default_bank_account_id` — never
  // any ingestion/delivery/OAuth/sync/settings field. `""` clears the mapping
  // (the backend accepts an explicit null).
  const activeBankAccounts = bankAccounts.filter((account) => account.is_active);
  const currentBankId = mailbox.default_bank_account_id ?? "";
  const [bankSelection, setBankSelection] = useState<string>(currentBankId);
  const bankSelectionDirty = bankSelection !== currentBankId;

  function saveBankAccount() {
    update.mutate(
      {
        id: mailbox.id,
        patch: { default_bank_account_id: bankSelection === "" ? null : bankSelection },
      },
      {
        onSuccess: () => toast.success("Default receiving bank account updated."),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "Update was rejected."),
      },
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-surface p-4">
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
          <dt className="text-slate-400">Ingestion reconnect</dt>
          <dd>{mailbox.reconnect_required ? "Required" : "No"}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Delivery reconnect</dt>
          <dd>{mailbox.delivery_reconnect_required ? "Required" : "No"}</dd>
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
                onClick={toggleIngestion}
                disabled={update.isPending}
                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
              >
                {mailbox.ingestion_enabled ? "Disable ingestion" : "Enable ingestion"}
              </button>
              {deliveryAction === "disable" ? (
                <button
                  type="button"
                  onClick={stopDelivery}
                  disabled={deliveryPending}
                  aria-busy={deliveryPending}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                >
                  Disable delivery
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startDelivery(deliveryAction)}
                  disabled={deliveryPending}
                  aria-busy={deliveryPending}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                >
                  {deliveryAction === "reconnect"
                    ? "Reconnect delivery"
                    : "Enable delivery"}
                </button>
              )}
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

      {canConfig && (
        // Honest, non-blocking status for the governed Delivery action. Never
        // claims success on its own — activation is reported only after the
        // server-authoritative response or the server-completed callback.
        <p
          role="status"
          aria-live="polite"
          className="mt-1.5 text-[11px] text-slate-500"
        >
          {deliveryPending
            ? "Delivery action in progress…"
            : deliveryFailed
              ? "The last delivery action did not complete. Nothing was changed."
              : deliveryAction === "reconnect"
                ? "Delivery authorization must be reconnected before reminders can send."
                : deliveryAction === "disable"
                  ? "Delivery is enabled for reminder sending."
                  : "Delivery is disabled. Enable delivery requests provider consent only if it is required."}
        </p>
      )}

      {canConfig && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <label
            htmlFor={`bank-${mailbox.id}`}
            className="block text-[11px] font-semibold text-slate-700"
          >
            Default receiving bank account
          </label>
          <p className="mt-0.5 text-[11px] text-slate-500">
            The company account used for Receipt records automatically created
            from this mailbox. This is not the customer&apos;s payer bank.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              id={`bank-${mailbox.id}`}
              value={bankSelection}
              onChange={(e) => setBankSelection(e.target.value)}
              disabled={update.isPending || bankAccountsLoading}
              className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-700 disabled:opacity-60"
            >
              <option value="">
                {bankAccountsLoading ? "Loading accounts…" : "None (no default account)"}
              </option>
              {activeBankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {bankOptionLabel(account)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={saveBankAccount}
              disabled={update.isPending || !bankSelectionDirty}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
            >
              Save bank account
            </button>
          </div>
          {!bankAccountsLoading && activeBankAccounts.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-700">
              No active company bank account is available to receive automated receipts.
            </p>
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

  const { data, isLoading, isError, isFetching, refetch } = useMailboxes({
    page: 1,
    page_size: 50,
  });
  const create = useCreateMailbox();

  // ── Provider callback return (display only) ────────────────────────────────
  // The backend completes consent server-side and redirects here with a bounded
  // query value. That value is FEEDBACK ONLY: it grants no authority, no mailbox
  // field is written from it, and Delivery was already enabled (or not) by the
  // server's atomic finalizer. We surface a safe message, re-read authoritative
  // state, then strip the query so a refresh cannot repeat the message.
  const callbackHandled = useRef(false);
  useEffect(() => {
    // Wait for the first read to settle so the follow-up refresh is a real
    // re-read rather than a request de-duplicated into the one already open.
    if (callbackHandled.current || isFetching) return;
    callbackHandled.current = true;
    const search = window.location.search;
    const outcome = readOAuthCallbackOutcome(search);
    if (outcome.kind === "none") return;
    if (outcome.kind === "success") toast.success(outcome.message);
    else toast.error(outcome.message);
    void refetch();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${stripOAuthCallbackQuery(search)}${window.location.hash}`,
    );
  }, [isFetching, refetch]);
  // Reuse the existing company-scoped bank-account query (shared with Receipts /
  // Settings). Only meaningful for config roles, who see the mapping control.
  const bankAccountsQuery = useBankAccounts();

  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<ProviderType>("gmail");
  const [address, setAddress] = useState("");
  const [ingestionRef, setIngestionRef] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit() {
    const next: Record<string, string> = {};
    const addr = address.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) next.address = "Enter a valid mailbox address.";
    if (ingestionRef && !SECRET_REF_RE.test(ingestionRef))
      next.ingestion = "Use an uppercase reference name (e.g. AR_MAILBOX_INGESTION_1).";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    // The browser never supplies a Delivery Vault name: the server provisions a
    // collision-safe opaque reference when Delivery is first enabled.
    create.mutate(
      {
        provider_type: provider,
        mailbox_address: addr,
        ingestion_secret_ref: ingestionRef || null,
        delivery_secret_ref: null,
      },
      {
        onSuccess: () => {
          toast.success("Mailbox configuration created (disabled).");
          setShowForm(false);
          setAddress("");
          setIngestionRef("");
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-fill-hover"
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
          className="grid gap-3 rounded-xl border border-slate-200 bg-surface p-4 sm:grid-cols-2"
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
          <p className="col-span-full text-[11px] text-slate-500">
            Delivery needs no reference here: the server provisions its own
            opaque one the first time you enable delivery on the mailbox.
          </p>
          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
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
              bankAccounts={bankAccountsQuery.data ?? []}
              bankAccountsLoading={bankAccountsQuery.isLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

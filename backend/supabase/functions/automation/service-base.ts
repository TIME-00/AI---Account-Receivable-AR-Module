import type { SupabaseClient } from "supabase";
import { getAdminClient } from "../_shared/db.ts";
import type { AuthContext } from "../_shared/auth.ts";
import {
  BusinessError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import {
  type AutomationOAuthIntent,
  type AutomationOperatingMode,
  type FinancialExtraction,
  type MailboxProviderType,
  type PageMeta,
  type PageRequest,
} from "./contract.ts";
import {
  EnvironmentSecretResolver,
  GmailDeliveryProvider,
  GmailMailboxProvider,
  type MailboxProvider,
  MicrosoftDeliveryProvider,
  MicrosoftMailboxProvider,
  type ReminderDeliveryProvider,
  type SecretResolver,
} from "./providers.ts";
import { type DocumentIntelligenceProvider } from "./document.ts";
import { createOpenAIDocumentProvider } from "./openai-document.ts";
import {
  type OAuthCapability,
  type OAuthSecretContext,
  type OAuthSecretStore,
  type OAuthTokenSet,
  refreshOAuthTokens,
  validateOAuthRedirectUri,
  VaultOAuthSecretStore,
} from "./oauth.ts";
import { tokenExpiryIsCurrent } from "./authority.ts";

export {
  assertAutomaticAllocationCommandEligible,
  assertProviderMessageBounded,
  boundedOAuthAuthorizationUrl,
  buildAutomaticAllocationPlan,
  customerResolutionFailureMayRecover,
  deliverySecretReference,
  exactAutomationDecimalNumber,
  isAutomationExceptionIdempotencyConflict,
  mailboxCapabilityIsReady,
  resolveReceiptInvoiceReferenceAuthority,
  tokenExpiryIsCurrent,
} from "./authority.ts";
export type {
  AutomaticAllocationPlan,
  ReceiptInvoiceReferenceAuthorityResult,
} from "./authority.ts";

export const STORAGE_BUCKET = "ar-imports";
export const MAX_SYNC_PAGES = 100;
export const MAX_MESSAGES_PER_RUN = 5000;

export function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export type Row = Record<string, unknown>;

export interface AutomationSourceDocument {
  body: Blob;
  fileName: string;
  mimeType: string;
}

export const OAUTH_SECRET_REFERENCE_CONFLICT =
  "OAUTH_SECRET_REFERENCE_CONFLICT";

export const AUTOMATION_CUSTOMER_RESOLUTION_SELECT =
  "id,customer_id,registration_no,tax_id,contact_email,customer_name";
export const AUTOMATION_CUSTOMER_CODE_DATABASE_COLUMN = "customer_id";

export function throwMailboxPersistenceError(error: unknown): never {
  const message = error && typeof error === "object" &&
      typeof (error as Record<string, unknown>).message === "string"
    ? String((error as Record<string, unknown>).message)
    : "";
  if (message.startsWith(`${OAUTH_SECRET_REFERENCE_CONFLICT}:`)) {
    throw new BusinessError(
      OAUTH_SECRET_REFERENCE_CONFLICT,
      "This secret reference is already in use. Choose another reference.",
      409,
    );
  }
  throw error;
}

export function documentDecisionExtraction(row: Row): Row | null {
  const embedded = row.extraction;
  if (embedded === null || embedded === undefined) return null;
  const candidates = Array.isArray(embedded) ? embedded : [embedded];
  const schemaVersion = Number(row.schema_version);
  const matching = candidates.filter((candidate) => {
    if (
      !candidate || typeof candidate !== "object" || Array.isArray(candidate)
    ) {
      throw new BusinessError(
        "AUTOMATION_RESPONSE_INVALID",
        "Automation data could not be returned safely.",
        500,
        { field: "decision.extraction" },
      );
    }
    return Number((candidate as Row).schema_version) === schemaVersion;
  }) as Row[];
  if (matching.length > 1) {
    throw new BusinessError(
      "AUTOMATION_RESPONSE_INVALID",
      "Automation data could not be returned safely.",
      500,
      { field: "decision.extraction.cardinality" },
    );
  }
  return matching[0] ?? null;
}

export interface AutomationServiceDependencies {
  client?: SupabaseClient;
  secretResolver?: SecretResolver;
  mailboxProviders?: Readonly<Record<MailboxProviderType, MailboxProvider>>;
  deliveryProviders?: Readonly<
    Record<MailboxProviderType, ReminderDeliveryProvider>
  >;
  documentProvider?: DocumentIntelligenceProvider;
  now?: () => Date;
  oauthSecretStore?: OAuthSecretStore;
  oauthFetcher?: typeof fetch;
}

export interface PagedRows {
  rows: Row[];
  meta: PageMeta;
}

export function pageRange(page: PageRequest): [number, number] {
  const from = (page.page - 1) * page.page_size;
  return [from, from + page.page_size - 1];
}

export function requiredId(row: Row | null, resource: string, id: string): Row {
  if (!row) throw new NotFoundError(resource, id);
  return row;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function extension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length === 2 ? parts[1] : "bin";
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function documentExceptionReason(error: unknown): string {
  if (error instanceof BusinessError) {
    const mapping: Readonly<Record<string, string>> = {
      LOW_CONFIDENCE: "low_confidence",
      EXTRACTION_SCHEMA_INVALID: "extraction_schema_invalid",
      ARITHMETIC_MISMATCH: "arithmetic_mismatch",
      CUSTOMER_UNRESOLVED: "customer_unresolved",
      CUSTOMER_AMBIGUOUS: "customer_ambiguous",
      PROVIDER_UNAVAILABLE: "provider_unavailable",
      FX_REFERENCE_UNAVAILABLE: "fx_reference_unavailable",
      UNSUPPORTED_TRANSACTION_CURRENCY: "currency_unsupported",
    };
    return mapping[error.code] ?? "internal_processing_failure";
  }
  if (
    error instanceof ValidationError &&
    error.message.toLowerCase().includes("currency")
  ) {
    return "currency_unsupported";
  }
  return error instanceof ValidationError
    ? "extraction_schema_invalid"
    : "internal_processing_failure";
}

export function attachmentExceptionReason(error: unknown): string {
  if (!(error instanceof ValidationError)) return "unsafe_file";
  const reason = String(error.details.reason ?? "");
  if (reason === "encrypted_pdf") return "encrypted_document";
  if (
    error.details.max_bytes !== undefined ||
    error.details.max_pages !== undefined
  ) {
    return "oversized_document";
  }
  if (reason === "pdf_active_content") return "unsafe_file";
  return "unsupported_file";
}

export function emptyScheduledCycleResult(): Row {
  return {
    companies_considered: 0,
    mailboxes_synced: 0,
    attachments_processed: 0,
    commands_processed: 0,
    allocations_completed: 0,
    reminders_evaluated: 0,
    reminders_delivered: 0,
    attachment_content_purged: 0,
    failures: 0,
  };
}

export function dateInTimeZone(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [
        part.type,
        part.value,
      ]),
    );
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    throw new BusinessError(
      "AUTOMATION_TIMEZONE_INVALID",
      "Automation reminder timezone is invalid.",
      409,
    );
  }
}
export abstract class AutomationServiceBase {
  protected readonly client: SupabaseClient;
  protected readonly secretResolver: SecretResolver;
  protected readonly mailboxProviders: Readonly<
    Record<MailboxProviderType, MailboxProvider>
  >;
  protected readonly deliveryProviders: Readonly<
    Record<MailboxProviderType, ReminderDeliveryProvider>
  >;
  protected readonly documentProvider: DocumentIntelligenceProvider;
  protected readonly now: () => Date;
  protected readonly oauthSecretStore: OAuthSecretStore;
  protected readonly oauthFetcher: typeof fetch;

  constructor(dependencies: AutomationServiceDependencies = {}) {
    this.client = dependencies.client ?? getAdminClient();
    this.secretResolver = dependencies.secretResolver ??
      new EnvironmentSecretResolver();
    this.mailboxProviders = dependencies.mailboxProviders ?? {
      gmail: new GmailMailboxProvider(),
      microsoft: new MicrosoftMailboxProvider(),
    };
    this.deliveryProviders = dependencies.deliveryProviders ?? {
      gmail: new GmailDeliveryProvider(),
      microsoft: new MicrosoftDeliveryProvider(),
    };
    this.documentProvider = dependencies.documentProvider ??
      createOpenAIDocumentProvider({
        apiKey: Deno.env.get("OPENAI_API_KEY"),
        model: Deno.env.get("OPENAI_DOCUMENT_MODEL"),
      });
    this.now = dependencies.now ?? (() => new Date());
    this.oauthSecretStore = dependencies.oauthSecretStore ??
      new VaultOAuthSecretStore(this.client);
    this.oauthFetcher = dependencies.oauthFetcher ?? fetch;
  }

  protected oauthRedirectUri(provider: MailboxProviderType): string {
    return validateOAuthRedirectUri(
      provider,
      Deno.env.get(
        provider === "gmail"
          ? "GMAIL_OAUTH_REDIRECT_URI"
          : "MICROSOFT_OAUTH_REDIRECT_URI",
      ),
      Deno.env.get("SUPABASE_URL"),
    );
  }

  protected oauthClientId(provider: MailboxProviderType): string {
    const value = Deno.env.get(
      provider === "gmail"
        ? "GMAIL_OAUTH_CLIENT_ID"
        : "MICROSOFT_OAUTH_CLIENT_ID",
    );
    if (!value || value.length > 512) {
      throw new BusinessError(
        "OAUTH_NOT_CONFIGURED",
        "OAuth provider configuration has not been provisioned.",
        503,
      );
    }
    return value;
  }

  protected oauthRequiredScopes(
    provider: MailboxProviderType,
    capability: OAuthCapability,
  ): string[] {
    return provider === "gmail"
      ? capability === "ingestion"
        ? ["https://www.googleapis.com/auth/gmail.readonly"]
        : ["https://www.googleapis.com/auth/gmail.send"]
      : capability === "ingestion"
      ? ["offline_access", "Mail.Read"]
      : ["offline_access", "Mail.Send"];
  }

  protected oauthSecretContext(
    mailbox: Row,
    capability: OAuthCapability,
  ): OAuthSecretContext {
    return {
      company_id: String(mailbox.company_id),
      mailbox_id: String(mailbox.id),
      provider: mailbox.provider_type as MailboxProviderType,
      capability,
      secret_reference: String(
        mailbox[`${capability}_secret_ref`] ?? "",
      ),
    };
  }

  protected oauthTokenSupportsCapability(
    token: OAuthTokenSet,
    provider: MailboxProviderType,
    capability: OAuthCapability,
    now: Date,
  ): boolean {
    return token.access_token.trim().length > 0 &&
      typeof token.refresh_token === "string" &&
      token.refresh_token.trim().length > 0 &&
      tokenExpiryIsCurrent(token.expires_at, now) &&
      this.oauthRequiredScopes(provider, capability).every((required) =>
        token.scope.some((granted) =>
          granted.toLowerCase() === required.toLowerCase()
        )
      );
  }

  protected async markMailboxReconnectRequired(
    mailbox: Row,
    capability: OAuthCapability,
    code: string,
  ): Promise<void> {
    const patch = capability === "delivery"
      ? {
        delivery_enabled: false,
        delivery_reconnect_required: true,
        redacted_error_code: mailbox.reconnect_required === true
          ? mailbox.redacted_error_code
          : code,
        updated_at: this.now().toISOString(),
      }
      : {
        reconnect_required: true,
        connection_status: "reconnect_required",
        redacted_error_code: code,
        updated_at: this.now().toISOString(),
      };
    const { error } = await this.client.from("automation_mailboxes").update(
      patch,
    ).eq("id", mailbox.id).eq("company_id", mailbox.company_id);
    if (error) throw error;
  }

  async resolveOAuthAccessTokenForRuntime(
    mailbox: Row,
    capability: OAuthCapability,
  ): Promise<string> {
    const provider = mailbox.provider_type as MailboxProviderType;
    const context = this.oauthSecretContext(mailbox, capability);
    let current: OAuthTokenSet;
    try {
      current = await this.oauthSecretStore.resolveTokenSet(context);
    } catch (error) {
      if (
        error instanceof BusinessError &&
        ["OAUTH_SECRET_UNAVAILABLE", "OAUTH_SECRET_INVALID"].includes(
          error.code,
        )
      ) {
        await this.markMailboxReconnectRequired(
          mailbox,
          capability,
          "OAUTH_CREDENTIAL_INVALID",
        );
      }
      throw error;
    }
    const requiredScopes = this.oauthRequiredScopes(provider, capability);
    if (
      requiredScopes.some((scope) =>
        !current.scope.some((granted) =>
          granted.toLowerCase() === scope.toLowerCase()
        )
      )
    ) {
      await this.markMailboxReconnectRequired(
        mailbox,
        capability,
        "OAUTH_SCOPE_INSUFFICIENT",
      );
      throw new BusinessError(
        "OAUTH_RECONNECT_REQUIRED",
        "OAuth authorization must be reconnected.",
        409,
      );
    }
    if (!current.refresh_token) {
      await this.markMailboxReconnectRequired(
        mailbox,
        capability,
        "OAUTH_REFRESH_TOKEN_REQUIRED",
      );
      throw new BusinessError(
        "OAUTH_RECONNECT_REQUIRED",
        "OAuth authorization must be reconnected.",
        409,
      );
    }
    const refreshBefore = this.now().getTime() + 5 * 60 * 1000;
    if (Date.parse(current.expires_at) > refreshBefore) {
      return current.access_token;
    }
    try {
      const refreshed = await refreshOAuthTokens({
        configuration: {
          provider,
          client_id: this.oauthClientId(provider),
          client_secret: await this.secretResolver.resolve(
            provider === "gmail"
              ? "GMAIL_OAUTH_CLIENT_SECRET"
              : "MICROSOFT_OAUTH_CLIENT_SECRET",
          ),
          redirect_uri: this.oauthRedirectUri(provider),
          tenant: provider === "microsoft"
            ? Deno.env.get("MICROSOFT_OAUTH_TENANT") ?? "common"
            : undefined,
        },
        current,
        fetcher: this.oauthFetcher,
        now: this.now(),
      });
      if (
        requiredScopes.some((scope) =>
          !refreshed.scope.some((granted) =>
            granted.toLowerCase() === scope.toLowerCase()
          )
        )
      ) {
        throw new BusinessError(
          "OAUTH_RECONNECT_REQUIRED",
          "OAuth authorization must be reconnected.",
          409,
        );
      }
      await this.oauthSecretStore.writeTokenSet(context, refreshed);
      const { error } = await this.client.from("automation_mailboxes").update({
        [`${capability}_token_expires_at`]: refreshed.expires_at,
        ...(capability === "delivery"
          ? { delivery_reconnect_required: false }
          : { reconnect_required: false }),
        redacted_error_code: capability === "delivery" &&
            mailbox.reconnect_required === true
          ? mailbox.redacted_error_code
          : null,
        updated_at: this.now().toISOString(),
      }).eq("id", mailbox.id).eq("company_id", mailbox.company_id);
      if (error) throw error;
      return refreshed.access_token;
    } catch (error) {
      if (
        error instanceof BusinessError &&
        [
          "OAUTH_RECONNECT_REQUIRED",
          "OAUTH_SECRET_INVALID",
          "OAUTH_SECRET_UNAVAILABLE",
        ].includes(error.code)
      ) {
        await this.markMailboxReconnectRequired(
          mailbox,
          capability,
          "OAUTH_TOKEN_REFRESH_REJECTED",
        );
      }
      throw error;
    }
  }

  protected async purgeExpiredAttachmentContent(): Promise<{
    purged: number;
    failures: number;
  }> {
    const { data, error } = await this.client
      .from("automation_source_attachments")
      .select("id,company_id,safe_storage_path")
      .is("content_purged_at", null)
      .lt("retention_expires_at", this.now().toISOString())
      .order("retention_expires_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(100);
    if (error) throw error;
    let purged = 0;
    let failures = 0;
    for (const attachment of (data ?? []) as Row[]) {
      const { error: storageError } = await this.client.storage.from(
        STORAGE_BUCKET,
      ).remove([String(attachment.safe_storage_path)]);
      if (storageError) {
        failures++;
        await this.createException(String(attachment.company_id), {
          attachment_id: attachment.id,
          reason_code: "internal_processing_failure",
          lifecycle_status: "retryable",
          safe_details: { error_code: "RETENTION_PURGE_FAILED" },
        });
        continue;
      }
      const { error: updateError } = await this.client
        .from("automation_source_attachments")
        .update({ content_purged_at: this.now().toISOString() })
        .eq("id", attachment.id)
        .eq("company_id", attachment.company_id)
        .is("content_purged_at", null);
      if (updateError) throw updateError;
      purged++;
    }
    return { purged, failures };
  }

  abstract runScheduledCycle(): Promise<Row>;

  protected abstract runScheduledCycleWithLease(): Promise<Row>;

  abstract overview(auth: AuthContext): Promise<Row>;

  abstract getSettings(auth: AuthContext): Promise<Row>;

  abstract updateSettings(auth: AuthContext, patch: Row): Promise<Row>;

  protected abstract assertReminderDeliveryReady(
    auth: AuthContext,
  ): Promise<void>;

  protected abstract assertDocumentModeReady(
    auth: AuthContext,
    mode: Exclude<AutomationOperatingMode, "disabled">,
  ): Promise<void>;

  abstract listSalesRepresentatives(
    auth: AuthContext,
    page: PageRequest,
    active?: boolean,
  ): Promise<PagedRows>;

  abstract createSalesRepresentative(
    auth: AuthContext,
    input: Row,
  ): Promise<Row>;

  abstract updateSalesRepresentative(
    auth: AuthContext,
    id: string,
    input: Row,
  ): Promise<Row>;

  abstract assignSalesRepresentative(
    auth: AuthContext,
    customerId: string,
    input: Row,
  ): Promise<Row>;

  abstract getCustomerSalesRepresentative(
    auth: AuthContext,
    customerId: string,
  ): Promise<Row | null>;

  abstract listAssignmentHistory(
    auth: AuthContext,
    customerId: string,
    page: PageRequest,
  ): Promise<PagedRows>;

  abstract listDocumentDecisions(
    auth: AuthContext,
    page: PageRequest,
    filters: Readonly<Record<string, string | undefined>>,
  ): Promise<PagedRows>;

  abstract listTable(
    auth: AuthContext,
    table: string,
    page: PageRequest,
    filters?: Readonly<Record<string, string | boolean | undefined>>,
  ): Promise<PagedRows>;

  abstract createMailbox(auth: AuthContext, input: Row): Promise<Row>;

  abstract updateMailbox(
    auth: AuthContext,
    mailboxId: string,
    input: Row,
  ): Promise<Row>;

  abstract disconnectMailboxOAuth(
    auth: AuthContext,
    mailboxId: string,
    capability: OAuthCapability | "all",
  ): Promise<Row>;

  abstract beginOAuth(
    auth: AuthContext,
    mailboxId: string,
    capability: "ingestion" | "delivery",
    requestedIntent?: AutomationOAuthIntent,
  ): Promise<Row>;

  abstract enableMailboxDelivery(
    auth: AuthContext,
    mailboxId: string,
  ): Promise<Row>;

  abstract reconnectMailboxDelivery(
    auth: AuthContext,
    mailboxId: string,
  ): Promise<Row>;

  abstract disableMailboxDelivery(
    auth: AuthContext,
    mailboxId: string,
  ): Promise<Row>;

  abstract completeOAuth(
    provider: MailboxProviderType,
    state: string,
    code: string,
  ): Promise<Row>;

  abstract rejectOAuth(
    provider: MailboxProviderType,
    state: string,
  ): Promise<never>;

  abstract syncMailbox(auth: AuthContext, mailboxId: string): Promise<Row>;

  protected abstract createException(
    companyId: string,
    input: Row,
  ): Promise<void>;

  abstract processAttachment(
    auth: AuthContext,
    attachmentId: string,
  ): Promise<Row>;

  protected abstract setAttachmentProcessingStatus(
    companyId: string,
    attachmentId: string,
    processingStatus: "retryable" | "processed",
  ): Promise<void>;

  protected abstract processAttachmentDecision(
    auth: AuthContext,
    attachmentId: string,
  ): Promise<Row>;

  protected abstract assertNoFinancialIdentifierConflict(
    auth: AuthContext,
    extraction: FinancialExtraction,
    customerId: string,
  ): Promise<void>;

  protected abstract resolveCustomer(
    auth: AuthContext,
    extracted: {
      customer_code?: string;
      registration_identifier?: string;
      email?: string;
      company_name?: string;
      invoice_reference?: string;
    },
    invoiceReferences: readonly string[],
  ): Promise<{ customer_id: string; method: string }>;

  abstract executeCommand(
    auth: AuthContext,
    extractionId: string,
  ): Promise<Row>;

  protected abstract proposeAndAllocateReceipt(
    auth: AuthContext,
    command: Row,
    extraction: FinancialExtraction,
  ): Promise<Row | null>;

  protected abstract createAllocationException(
    auth: AuthContext,
    command: Row,
    receiptId: string,
    reasonCode:
      | "allocation_evidence_insufficient"
      | "allocation_currency_mismatch"
      | "allocation_conflict"
      | "concurrency_conflict"
      | "critical_identifier_unverified",
    errorCode: string,
  ): Promise<void>;

  abstract allocateCommand(
    auth: AuthContext,
    commandId: string,
  ): Promise<Row>;

  protected abstract persistAutomaticAllocation(
    auth: AuthContext,
    commandId: string,
    input: Row,
  ): Promise<Row>;

  abstract retryException(auth: AuthContext, id: string): Promise<Row>;

  abstract getExceptionRecoveryContext(
    auth: AuthContext,
    exceptionId: string,
  ): Promise<Row>;

  abstract recordExceptionRecovery(
    auth: AuthContext,
    exceptionId: string,
    input: Row,
  ): Promise<Row>;

  abstract retryExceptionMatching(
    auth: AuthContext,
    exceptionId: string,
  ): Promise<Row>;

  abstract getExceptionSourceDocument(
    auth: AuthContext,
    exceptionId: string,
    invoiceId?: string,
  ): Promise<AutomationSourceDocument>;

  abstract closeException(
    auth: AuthContext,
    id: string,
    lifecycle: "resolved" | "dismissed",
    note: string,
  ): Promise<Row>;

  abstract evaluateReminders(
    auth: AuthContext,
    evaluationDate: string,
  ): Promise<Row>;

  abstract deliverReminder(
    auth: AuthContext,
    reminderId: string,
    mailboxId: string,
  ): Promise<Row>;
}

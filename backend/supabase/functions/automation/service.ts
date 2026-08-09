import type { SupabaseClient } from "supabase";
import { callRpc, getAdminClient } from "../_shared/db.ts";
import type { AuthContext } from "../_shared/auth.ts";
import {
  requireAnyRole,
  requireCustomerAccess,
  requireOperationalReadRole,
  requireRole,
} from "../_shared/auth.ts";
import {
  BusinessError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import { validateOcrIntakeFile } from "../imports/file_validation.ts";
import { InvoiceService } from "../invoices/service.ts";
import { ReceiptService } from "../receipts/service.ts";
import type {
  CreateInvoiceInput,
  CreateInvoiceLineInput,
} from "../invoices/validators.ts";
import type { CreateReceiptInput } from "../receipts/validators.ts";
import {
  assertExactKeys,
  type AutomationOperatingMode,
  type FinancialExtraction,
  isSemanticIsoTimestamp,
  type MailboxProviderType,
  normalizeEmail,
  normalizePhone,
  type PageMeta,
  type PageRequest,
  parseBoolean,
  requireBoundedText,
  requireIsoDate,
  requireOperatingMode,
} from "./contract.ts";
import {
  EnvironmentSecretResolver,
  GmailDeliveryProvider,
  GmailMailboxProvider,
  type MailboxProvider,
  MicrosoftDeliveryProvider,
  MicrosoftMailboxProvider,
  type ProviderMessage,
  type ReminderDeliveryProvider,
  type SecretResolver,
} from "./providers.ts";
import {
  assertProviderTextIsDataOnly,
  type DocumentIntelligenceProvider,
  type DocumentIntelligenceResult,
  validateDocumentResult,
} from "./document.ts";
import { createOpenAIDocumentProvider } from "./openai-document.ts";
import {
  buildOAuthAuthorizationUrl,
  completeOAuthCallback,
  type OAuthCapability,
  type OAuthSecretContext,
  type OAuthSecretStore,
  type OAuthTokenSet,
  refreshOAuthTokens,
  validateOAuthRedirectUri,
  VaultOAuthSecretStore,
} from "./oauth.ts";
import {
  allocationResultDto,
  assignmentHistoryDto,
  automationSettingsDto,
  commandDto,
  currentAssignmentDto,
  documentDecisionDto,
  documentProcessingResultDto,
  exceptionDto,
  mailboxDto,
  mapAutomationCollectionRow,
  reminderAttemptDto,
  reminderDto,
  reminderEvaluationDto,
  salesRepresentativeDto,
  syncRunDto,
} from "./dto.ts";

const STORAGE_BUCKET = "ar-imports";
const MAX_SYNC_PAGES = 100;
const MAX_MESSAGES_PER_RUN = 5000;
const MAX_ATTACHMENTS_PER_MESSAGE = 100;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type Row = Record<string, unknown>;

const OAUTH_SECRET_REFERENCE_CONFLICT = "OAUTH_SECRET_REFERENCE_CONFLICT";

export const AUTOMATION_CUSTOMER_RESOLUTION_SELECT =
  "id,customer_id,registration_no,tax_id,contact_email,customer_name";
export const AUTOMATION_CUSTOMER_CODE_DATABASE_COLUMN = "customer_id";

export function customerResolutionFailureMayRecover(
  validationCodes: readonly string[],
): boolean {
  return validationCodes.some((code) =>
    code === "customer_unresolved" ||
    code === "customer_ambiguous" ||
    code === "internal_processing_failure"
  );
}

export function isAutomationExceptionIdempotencyConflict(
  error: unknown,
): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.code === "23505" &&
    typeof record.message === "string" &&
    record.message.includes("uq_automation_exception_idempotency");
}

function throwMailboxPersistenceError(error: unknown): never {
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

export function assertProviderMessageBounded(
  message: ProviderMessage,
): void {
  const bounded = (value: string | null, max: number) =>
    value === null || (value.length > 0 && value.length <= max);
  const received = new Date(message.received_at);
  if (
    !bounded(message.provider_message_id, 512) ||
    !bounded(message.provider_thread_id, 512) ||
    !bounded(message.internet_message_id, 998) ||
    !bounded(message.sender_address, 512) ||
    !bounded(message.subject, 998) ||
    !bounded(message.mime_type, 255) ||
    !bounded(message.revision, 512) ||
    Number.isNaN(received.getTime()) ||
    received.toISOString() !== message.received_at ||
    !Array.isArray(message.attachments) ||
    message.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE ||
    message.attachments.some((attachment) =>
      !bounded(attachment.provider_attachment_id, 512) ||
      !bounded(attachment.file_name, 255) ||
      !bounded(attachment.content_type, 255) ||
      !Number.isInteger(attachment.size) ||
      attachment.size < 0 ||
      attachment.size > MAX_ATTACHMENT_BYTES ||
      (attachment.bytes !== undefined &&
        attachment.bytes.byteLength > MAX_ATTACHMENT_BYTES)
    )
  ) {
    throw new BusinessError(
      "PROVIDER_RESPONSE_INVALID",
      "Mailbox provider message metadata was invalid.",
      502,
    );
  }
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

function pageRange(page: PageRequest): [number, number] {
  const from = (page.page - 1) * page.page_size;
  return [from, from + page.page_size - 1];
}

function requiredId(row: Row | null, resource: string, id: string): Row {
  if (!row) throw new NotFoundError(resource, id);
  return row;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length === 2 ? parts[1] : "bin";
}

function canonicalJson(value: unknown): string {
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

function documentExceptionReason(error: unknown): string {
  if (error instanceof BusinessError) {
    const mapping: Readonly<Record<string, string>> = {
      LOW_CONFIDENCE: "low_confidence",
      EXTRACTION_SCHEMA_INVALID: "extraction_schema_invalid",
      ARITHMETIC_MISMATCH: "arithmetic_mismatch",
      CUSTOMER_UNRESOLVED: "customer_unresolved",
      CUSTOMER_AMBIGUOUS: "customer_ambiguous",
      PROVIDER_UNAVAILABLE: "provider_unavailable",
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

export function tokenExpiryIsCurrent(
  value: unknown,
  now: Date,
): boolean {
  if (!isSemanticIsoTimestamp(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function mailboxCapabilityIsReady(
  row: Row,
  capability: "ingestion" | "delivery",
  now: Date,
  adapterReady: boolean,
): boolean {
  return adapterReady && row.is_enabled === true &&
    row.connection_status === "connected" &&
    row.reconnect_required === false &&
    row[`${capability}_enabled`] === true &&
    typeof row[`${capability}_secret_ref`] === "string" &&
    String(row[`${capability}_secret_ref`]).trim().length > 0 &&
    tokenExpiryIsCurrent(row[`${capability}_token_expires_at`], now);
}

function monetaryMinorUnits(value: unknown): bigint {
  const text = String(value);
  if (!/^-?(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(text)) {
    throw new BusinessError(
      "FINANCIAL_AMOUNT_INVALID",
      "Authoritative monetary value was invalid.",
      500,
    );
  }
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -minor : minor;
}

function minorUnitsDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${
    (absolute % 100n).toString().padStart(2, "0")
  }`;
}

function emptyScheduledCycleResult(): Row {
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

export function exactAutomationDecimalNumber(
  value: string,
  scale: number,
  field: string,
): number {
  if (
    !Number.isInteger(scale) || scale < 0 || scale > 6 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
  ) {
    throw new ValidationError(`${field} is not an exact decimal value.`);
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) {
    throw new ValidationError(`${field} exceeds supported precision.`);
  }
  const canonical = scale === 0
    ? BigInt(whole).toString()
    : `${BigInt(whole)}.${fraction.padEnd(scale, "0")}`;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric.toFixed(scale) !== canonical) {
    throw new ValidationError(
      `${field} cannot be represented exactly by the authoritative creation contract.`,
    );
  }
  return numeric;
}

export type AutomaticAllocationPlan =
  | {
    ok: true;
    evidence_type:
      | "exact_invoice_reference"
      | "exact_amount_single_invoice"
      | "explicit_partial_reference"
      | "explicit_multi_invoice_references";
    evidence: {
      invoice_references: string[];
      payment_reference: string | null;
      source: "document_extraction_v1";
    };
    allocations: Array<{
      invoice_id: string;
      amount: string;
      discount_amount: "0.00";
    }>;
  }
  | { ok: false; error_code: string };

export function assertAutomaticAllocationCommandEligible(command: Row): void {
  if (
    command.command_type !== "create_receipt" ||
    command.status !== "completed" ||
    !command.resulting_receipt_id
  ) {
    throw new BusinessError(
      "ALLOCATION_EVIDENCE_INSUFFICIENT",
      "Only a completed automated Receipt command can be allocated.",
      409,
    );
  }
}

export function buildAutomaticAllocationPlan(input: {
  receipt_unallocated: unknown;
  invoice_references: readonly string[];
  payment_reference?: string;
  invoices: readonly Row[];
}): AutomaticAllocationPlan {
  const available = monetaryMinorUnits(input.receipt_unallocated);
  if (available <= 0n) {
    return { ok: false, error_code: "NO_UNALLOCATED_AMOUNT" };
  }
  const references = [
    ...new Set(
      input.invoice_references.map((value) => value.trim()).filter(
        Boolean,
      ),
    ),
  ];
  let evidenceType:
    | "exact_invoice_reference"
    | "exact_amount_single_invoice"
    | "explicit_partial_reference"
    | "explicit_multi_invoice_references";
  if (references.length > 0) {
    const matched = new Set(
      input.invoices.map((invoice) => String(invoice.invoice_no)),
    );
    if (
      input.invoices.length !== references.length ||
      references.some((reference) => !matched.has(reference))
    ) {
      return { ok: false, error_code: "INVOICE_REFERENCE_NOT_EXACT" };
    }
    if (input.invoices.length === 1) {
      const outstanding = monetaryMinorUnits(input.invoices[0].outstanding);
      if (available > outstanding) {
        return {
          ok: false,
          error_code: "RECEIPT_EXCEEDS_REFERENCED_INVOICE",
        };
      }
      evidenceType = available === outstanding
        ? "exact_invoice_reference"
        : "explicit_partial_reference";
    } else {
      const total = input.invoices.reduce(
        (sum, invoice) => sum + monetaryMinorUnits(invoice.outstanding),
        0n,
      );
      if (total !== available) {
        return { ok: false, error_code: "MULTI_REFERENCE_AMOUNT_MISMATCH" };
      }
      evidenceType = "explicit_multi_invoice_references";
    }
  } else {
    if (
      input.invoices.length !== 1 ||
      monetaryMinorUnits(input.invoices[0].outstanding) !== available
    ) {
      return { ok: false, error_code: "EXACT_AMOUNT_NOT_UNAMBIGUOUS" };
    }
    evidenceType = "exact_amount_single_invoice";
  }
  return {
    ok: true,
    evidence_type: evidenceType,
    evidence: {
      invoice_references: references.length > 0
        ? references
        : [String(input.invoices[0].invoice_no)],
      payment_reference: input.payment_reference?.trim() || null,
      source: "document_extraction_v1",
    },
    allocations: input.invoices.map((invoice) => ({
      invoice_id: String(invoice.id),
      amount: references.length === 1
        ? minorUnitsDecimal(available)
        : minorUnitsDecimal(monetaryMinorUnits(invoice.outstanding)),
      discount_amount: "0.00",
    })),
  };
}

function dateInTimeZone(now: Date, timeZone: string): string {
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

export function boundedOAuthAuthorizationUrl(
  provider: MailboxProviderType,
  authorizationUrl: string,
): string {
  let url: URL;
  try {
    url = new URL(authorizationUrl);
  } catch {
    throw new BusinessError(
      "OAUTH_AUTHORIZATION_URL_INVALID",
      "OAuth authorization could not be started safely.",
      500,
    );
  }
  const valid = url.protocol === "https:" &&
    (provider === "gmail"
      ? url.origin === "https://accounts.google.com" &&
        url.pathname === "/o/oauth2/v2/auth"
      : url.origin === "https://login.microsoftonline.com" &&
        /^\/[A-Za-z0-9._~-]+\/oauth2\/v2\.0\/authorize$/.test(url.pathname));
  if (!valid || authorizationUrl.length > 8192) {
    throw new BusinessError(
      "OAUTH_AUTHORIZATION_URL_INVALID",
      "OAuth authorization could not be started safely.",
      500,
    );
  }
  return authorizationUrl;
}

export class AutomationService {
  private readonly client: SupabaseClient;
  private readonly secretResolver: SecretResolver;
  private readonly mailboxProviders: Readonly<
    Record<MailboxProviderType, MailboxProvider>
  >;
  private readonly deliveryProviders: Readonly<
    Record<MailboxProviderType, ReminderDeliveryProvider>
  >;
  private readonly documentProvider: DocumentIntelligenceProvider;
  private readonly now: () => Date;
  private readonly oauthSecretStore: OAuthSecretStore;
  private readonly oauthFetcher: typeof fetch;

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

  private oauthRedirectUri(provider: MailboxProviderType): string {
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

  private oauthClientId(provider: MailboxProviderType): string {
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

  private oauthRequiredScopes(
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

  private oauthSecretContext(
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

  private oauthTokenSupportsCapability(
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

  private async markMailboxReconnectRequired(
    mailbox: Row,
    code: string,
  ): Promise<void> {
    const { error } = await this.client.from("automation_mailboxes").update({
      reconnect_required: true,
      connection_status: "reconnect_required",
      redacted_error_code: code,
      updated_at: this.now().toISOString(),
    }).eq("id", mailbox.id).eq("company_id", mailbox.company_id);
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
        reconnect_required: false,
        redacted_error_code: null,
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
          "OAUTH_TOKEN_REFRESH_REJECTED",
        );
      }
      throw error;
    }
  }

  private async purgeExpiredAttachmentContent(): Promise<{
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

  async runScheduledCycle(): Promise<Row> {
    const leaseToken = crypto.randomUUID();
    const acquired = await callRpc<boolean>(
      this.client,
      "automation_worker_lease_acquire",
      { p_lease_token: leaseToken },
    );
    if (!acquired) return emptyScheduledCycleResult();

    let cycleResult: Row | undefined;
    let cycleFailed = false;
    let cycleFailure: unknown;
    try {
      cycleResult = await this.runScheduledCycleWithLease();
    } catch (error) {
      cycleFailed = true;
      cycleFailure = error;
    }

    try {
      await callRpc<void>(this.client, "automation_worker_lease_release", {
        p_lease_token: leaseToken,
        p_succeeded: !cycleFailed,
      });
    } catch (releaseError) {
      if (!cycleFailed) throw releaseError;
    }

    if (cycleFailed) throw cycleFailure;
    return cycleResult as Row;
  }

  private async runScheduledCycleWithLease(): Promise<Row> {
    const retention = await this.purgeExpiredAttachmentContent();
    const { data: settingRows, error: settingsError } = await this.client
      .from("automation_settings").select("*")
      .neq("operating_mode", "disabled")
      .not("automation_actor_user_id", "is", null)
      .order("company_id", { ascending: true }).limit(100);
    if (settingsError) throw settingsError;
    const settings = (settingRows ?? []) as Row[];
    if (settings.length === 0) {
      return {
        companies_considered: 0,
        mailboxes_synced: 0,
        attachments_processed: 0,
        commands_processed: 0,
        allocations_completed: 0,
        reminders_evaluated: 0,
        reminders_delivered: 0,
        attachment_content_purged: retention.purged,
        failures: retention.failures,
      };
    }
    const companyIds = settings.map((setting) => String(setting.company_id));
    const actorIds = settings.map((setting) =>
      String(setting.automation_actor_user_id)
    );
    const { data: roleRows, error: roleError } = await this.client
      .from("user_roles").select("company_id,user_id,role")
      .in("company_id", companyIds).in("user_id", actorIds)
      .eq("is_active", true);
    if (roleError) throw roleError;
    const rolesByBinding = new Map<string, string[]>();
    for (const role of (roleRows ?? []) as Row[]) {
      const key = `${role.company_id}:${role.user_id}`;
      rolesByBinding.set(key, [
        ...(rolesByBinding.get(key) ?? []),
        String(role.role),
      ]);
    }
    const authByCompany = new Map<string, AuthContext>();
    let failures = retention.failures;
    for (const setting of settings) {
      const companyId = String(setting.company_id);
      const userId = String(setting.automation_actor_user_id);
      const roles = rolesByBinding.get(`${companyId}:${userId}`) ?? [];
      const highestRole = roles.includes("Finance Manager")
        ? "Finance Manager"
        : roles.includes("AR Supervisor")
        ? "AR Supervisor"
        : null;
      if (!highestRole) {
        failures++;
        await this.createException(companyId, {
          reason_code: "internal_processing_failure",
          lifecycle_status: "open",
          safe_details: { error_code: "AUTOMATION_ACTOR_UNAVAILABLE" },
        });
        continue;
      }
      authByCompany.set(companyId, {
        companyId,
        userId,
        roles: roles as AuthContext["roles"],
        highestRole,
        email: null,
      });
    }

    let mailboxesSynced = 0;
    let attachmentsProcessed = 0;
    let commandsProcessed = 0;
    let allocationsCompleted = 0;
    let remindersEvaluated = 0;
    let remindersDelivered = 0;
    let remainingAttachments = 200;
    let remainingReminderDeliveries = 200;
    const settingsByCompany = new Map(
      settings.map((setting) => [String(setting.company_id), setting]),
    );
    if (authByCompany.size === 0) {
      return {
        companies_considered: settings.length,
        mailboxes_synced: 0,
        attachments_processed: 0,
        commands_processed: 0,
        allocations_completed: 0,
        reminders_evaluated: 0,
        reminders_delivered: 0,
        attachment_content_purged: retention.purged,
        failures,
      };
    }
    const { data: mailboxRows, error: mailboxError } = await this.client
      .from("automation_mailboxes").select("id,company_id")
      .in("company_id", [...authByCompany.keys()])
      .eq("is_enabled", true).eq("ingestion_enabled", true)
      .eq("reconnect_required", false)
      .order("company_id", { ascending: true }).order("id", {
        ascending: true,
      }).limit(100);
    if (mailboxError) throw mailboxError;
    const ingestionMailboxCompanies = new Set(
      ((mailboxRows ?? []) as Row[]).map((mailbox) =>
        String(mailbox.company_id)
      ),
    );
    for (const [companyId, auth] of authByCompany) {
      if (
        settingsByCompany.get(companyId)?.mailbox_sync_enabled === true &&
        !ingestionMailboxCompanies.has(companyId)
      ) {
        failures++;
        await this.createException(companyId, {
          reason_code: "mailbox_not_configured",
          lifecycle_status: "open",
          idempotency_key: await sha256(
            `mailbox_not_configured:${companyId}:ingestion`,
          ),
          safe_details: { capability: "ingestion" },
          actor_user_id: auth.userId,
        });
      }
    }

    for (const mailbox of (mailboxRows ?? []) as Row[]) {
      const auth = authByCompany.get(String(mailbox.company_id));
      const setting = settingsByCompany.get(String(mailbox.company_id));
      if (!auth || setting?.mailbox_sync_enabled !== true) continue;
      try {
        await this.syncMailbox(auth, String(mailbox.id));
        mailboxesSynced++;
      } catch (syncError) {
        failures++;
        await this.createException(auth.companyId, {
          mailbox_id: mailbox.id,
          reason_code: syncError instanceof BusinessError &&
              syncError.code === "MAILBOX_RECONNECT_REQUIRED"
            ? "mailbox_reconnect_required"
            : "provider_unavailable",
          lifecycle_status: syncError instanceof BusinessError &&
              syncError.code === "MAILBOX_RECONNECT_REQUIRED"
            ? "open"
            : "retryable",
          safe_details: {
            error_code: syncError instanceof BusinessError
              ? syncError.code
              : "INTERNAL_PROCESSING_FAILURE",
          },
        });
      }
    }

    // Document work is a durable backlog, not a projection of only the latest
    // provider sync. This lets a later bounded cycle resume attachments that
    // were persisted before a crash or beyond an earlier cycle's work cap.
    for (const [companyId, auth] of authByCompany) {
      if (remainingAttachments === 0) break;
      const setting = settingsByCompany.get(companyId);
      if (
        setting?.document_intelligence_enabled !== true
      ) continue;
      const { data: attachments, error: attachmentError } = await this.client
        .from("automation_source_attachments").select("id,mailbox_id")
        .eq("company_id", companyId)
        .eq("safety_status", "accepted")
        .in("processing_status", ["pending", "retryable"])
        .is("content_purged_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(remainingAttachments);
      if (attachmentError) throw attachmentError;
      for (const attachment of (attachments ?? []) as Row[]) {
        remainingAttachments--;
        try {
          const decision = await this.processAttachment(
            auth,
            String(attachment.id),
          );
          attachmentsProcessed++;
          const extraction = decision.extraction as Row | undefined;
          if (extraction?.validation_status === "valid") {
            const command = await this.executeCommand(
              auth,
              String(extraction.id),
            );
            commandsProcessed++;
            if (
              setting.auto_allocation_enabled === true &&
              setting.operating_mode === "straight_through"
            ) {
              const allocation = await this.proposeAndAllocateReceipt(
                auth,
                command,
                extraction.extracted_fields as FinancialExtraction,
              );
              if (allocation) allocationsCompleted++;
            }
          }
        } catch (processingError) {
          failures++;
          const errorCode = processingError instanceof BusinessError
            ? processingError.code
            : "INTERNAL_PROCESSING_FAILURE";
          const retryable = [
            "DOCUMENT_INTELLIGENCE_DISABLED",
            "PROVIDER_UNAVAILABLE",
            "INTERNAL_PROCESSING_FAILURE",
          ].includes(errorCode);
          const { error: retryStateError } = await this.client
            .from("automation_source_attachments")
            .update({
              processing_status: retryable ? "retryable" : "processed",
            })
            .eq("id", attachment.id)
            .eq("company_id", auth.companyId)
            .neq("processing_status", "processed");
          if (retryStateError) throw retryStateError;
          if (errorCode === "DOCUMENT_INTELLIGENCE_DISABLED") {
            await this.createException(auth.companyId, {
              mailbox_id: attachment.mailbox_id,
              attachment_id: attachment.id,
              reason_code: "provider_unavailable",
              lifecycle_status: "retryable",
              idempotency_key: await sha256(
                `document_provider_unavailable:${auth.companyId}:${attachment.id}`,
              ),
              safe_details: { error_code: errorCode },
            });
          }
        }
      }
    }

    for (const [companyId, auth] of authByCompany) {
      const setting = settingsByCompany.get(companyId);
      const date = dateInTimeZone(
        this.now(),
        String(setting?.reminder_timezone ?? "UTC"),
      );
      if (setting?.reminder_evaluation_enabled === true) {
        try {
          await this.evaluateReminders(auth, date);
          remindersEvaluated++;
        } catch {
          failures++;
        }
      }
      if (setting?.reminder_delivery_enabled !== true) continue;
      if (remainingReminderDeliveries === 0) continue;
      const { data: deliveryMailbox, error: deliveryMailboxError } = await this
        .client.from("automation_mailboxes").select("id")
        .eq("company_id", companyId).eq("delivery_enabled", true)
        .eq("connection_status", "connected")
        .eq("reconnect_required", false).order("id", { ascending: true })
        .limit(1).maybeSingle();
      if (deliveryMailboxError) throw deliveryMailboxError;
      if (!deliveryMailbox) {
        failures++;
        await this.createException(companyId, {
          reason_code: "mailbox_not_configured",
          lifecycle_status: "open",
          idempotency_key: await sha256(
            `mailbox_not_configured:${companyId}:delivery`,
          ),
          safe_details: { capability: "delivery" },
          actor_user_id: auth.userId,
        });
        continue;
      }
      const { data: reminders, error: remindersError } = await this.client
        .from("invoice_reminders").select("id")
        .eq("company_id", companyId).in("status", ["pending", "failed"])
        .lte("scheduled_for", date).order("scheduled_for", {
          ascending: true,
        }).order("id", { ascending: true }).limit(100);
      if (remindersError) throw remindersError;
      for (const reminder of (reminders ?? []) as Row[]) {
        if (remainingReminderDeliveries === 0) break;
        remainingReminderDeliveries--;
        try {
          await this.deliverReminder(
            auth,
            String(reminder.id),
            String(deliveryMailbox.id),
          );
          remindersDelivered++;
        } catch {
          failures++;
        }
      }
    }
    return {
      companies_considered: settings.length,
      mailboxes_synced: mailboxesSynced,
      attachments_processed: attachmentsProcessed,
      commands_processed: commandsProcessed,
      allocations_completed: allocationsCompleted,
      reminders_evaluated: remindersEvaluated,
      reminders_delivered: remindersDelivered,
      attachment_content_purged: retention.purged,
      failures,
    };
  }

  async overview(auth: AuthContext): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    const count = async (
      table: string,
      filters: Readonly<Record<string, string>> = {},
      requiredField?: string,
    ): Promise<number> => {
      let query = this.client.from(table).select("id", {
        count: "exact",
        head: true,
      }).eq("company_id", auth.companyId);
      for (const [field, value] of Object.entries(filters)) {
        query = query.eq(field, value);
      }
      if (requiredField) query = query.not(requiredField, "is", null);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    };
    const { data: mailboxes, error: mailboxError } = await this.client
      .from("automation_mailboxes")
      .select(
        "id,company_id,provider_type,connection_status,reconnect_required,is_enabled,ingestion_enabled,delivery_enabled,ingestion_secret_ref,delivery_secret_ref,ingestion_token_expires_at,delivery_token_expires_at,last_successful_sync_at,last_failed_sync_at",
      )
      .eq("company_id", auth.companyId)
      .order("id", { ascending: true })
      .limit(100);
    if (mailboxError) throw mailboxError;
    const mailboxRows = (mailboxes ?? []) as Row[];
    const connected = mailboxRows.filter((row) =>
      row.connection_status === "connected" &&
      row.reconnect_required !== true
    );
    const adapterReady = (
      row: Row,
      capability: "ingestion" | "delivery",
    ): boolean => {
      try {
        const providerType = row.provider_type as MailboxProviderType;
        return capability === "ingestion"
          ? this.mailboxProviders[providerType]?.readiness().ready === true
          : this.deliveryProviders[providerType]?.readiness().ready === true;
      } catch {
        return false;
      }
    };
    const now = this.now();
    const capabilityReady = async (
      capability: "ingestion" | "delivery",
    ): Promise<boolean> => {
      for (const row of mailboxRows) {
        if (
          !mailboxCapabilityIsReady(
            row,
            capability,
            now,
            adapterReady(row, capability),
          )
        ) continue;
        try {
          const token = await this.oauthSecretStore.resolveTokenSet(
            this.oauthSecretContext(row, capability),
          );
          if (
            this.oauthTokenSupportsCapability(
              token,
              row.provider_type as MailboxProviderType,
              capability,
              now,
            )
          ) return true;
        } catch {
          // Readiness is a bounded boolean. Secret-provider details remain
          // private and an unavailable opaque token fails closed.
        }
      }
      return false;
    };
    const [ingestionReady, deliveryReady] = await Promise.all([
      capabilityReady("ingestion"),
      capabilityReady("delivery"),
    ]);
    const latest = (field: "last_successful_sync_at" | "last_failed_sync_at") =>
      mailboxRows.map((row) => row[field]).filter((value): value is string =>
        typeof value === "string"
      ).sort().at(-1) ?? null;
    const [
      processingRuns,
      documentsProcessed,
      acceptedDocuments,
      rejectedDocuments,
      invoicesCreated,
      receiptsCreated,
      allocationsCompleted,
      remindersEvaluated,
      remindersSent,
      openExceptions,
      retryableExceptions,
    ] = await Promise.all([
      count("mailbox_sync_runs"),
      count("automation_document_classifications"),
      count("automation_document_classifications", { status: "accepted" }),
      count("automation_document_classifications", { status: "rejected" }),
      count(
        "automation_commands",
        { command_type: "create_invoice", status: "completed" },
        "resulting_invoice_id",
      ),
      count(
        "automation_commands",
        { command_type: "create_receipt", status: "completed" },
        "resulting_receipt_id",
      ),
      count("automation_allocation_decisions", { status: "completed" }),
      count("invoice_reminders"),
      count("invoice_reminders", { status: "delivered" }),
      count("automation_exceptions", { lifecycle_status: "open" }),
      count("automation_exceptions", { lifecycle_status: "retryable" }),
    ]);
    return {
      settings: await this.getSettings(auth),
      ingestion_ready: ingestionReady,
      delivery_ready: deliveryReady,
      document_intelligence_ready: this.documentProvider.enabled,
      connected_mailbox_count: connected.length,
      reconnect_required_mailbox_count:
        mailboxRows.filter((row) =>
          row.reconnect_required === true ||
          row.connection_status === "reconnect_required"
        ).length,
      last_successful_sync_at: latest("last_successful_sync_at"),
      last_failed_sync_at: latest("last_failed_sync_at"),
      processing_runs: processingRuns,
      documents_processed: documentsProcessed,
      accepted_documents: acceptedDocuments,
      rejected_documents: rejectedDocuments,
      invoices_created: invoicesCreated,
      receipts_created: receiptsCreated,
      allocations_completed: allocationsCompleted,
      reminders_evaluated: remindersEvaluated,
      reminders_sent: remindersSent,
      open_exceptions: openExceptions,
      retryable_exceptions: retryableExceptions,
    };
  }

  async getSettings(auth: AuthContext): Promise<Row> {
    requireAnyRole(auth, [
      "AR Clerk",
      "AR Supervisor",
      "Finance Manager",
      "Auditor",
      "System Admin",
    ]);
    const { data, error } = await this.client.from("automation_settings")
      .select("*").eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    return automationSettingsDto(data as Row | null, auth.companyId);
  }

  async updateSettings(auth: AuthContext, patch: Row): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    if (
      patch.operating_mode !== undefined &&
      patch.operating_mode !== "disabled"
    ) {
      requireAnyRole(auth, ["Finance Manager"]);
    }
    if (patch.operating_mode === "straight_through") {
      if (
        patch.activation_confirmation !== "ENABLE_STRAIGHT_THROUGH"
      ) {
        throw new BusinessError(
          "STRAIGHT_THROUGH_CONFIRMATION_REQUIRED",
          "Straight-through mode requires the exact activation confirmation.",
          409,
        );
      }
    } else if (patch.activation_confirmation !== undefined) {
      throw new ValidationError(
        "activation_confirmation is accepted only for straight-through activation.",
      );
    }
    const allowed = new Set([
      "operating_mode",
      "mailbox_sync_enabled",
      "document_intelligence_enabled",
      "invoice_automation_enabled",
      "receipt_automation_enabled",
      "auto_allocation_enabled",
      "reminder_evaluation_enabled",
      "reminder_delivery_enabled",
      "reminder_stage_offsets",
      "reminder_timezone",
      "minimum_overall_confidence",
      "minimum_critical_confidence",
      "activation_confirmation",
    ]);
    const unexpected = Object.keys(patch).filter((key) => !allowed.has(key));
    if (unexpected.length) {
      throw new ValidationError("Unsupported automation setting.", {
        unexpected_fields: unexpected.sort(),
      });
    }
    delete patch.activation_confirmation;
    if (patch.operating_mode !== undefined) {
      patch.operating_mode = requireOperatingMode(patch.operating_mode);
      if (patch.operating_mode !== "disabled") {
        patch.automation_actor_user_id = auth.userId;
      } else {
        patch.automation_actor_user_id = null;
      }
    }
    for (
      const field of [
        "mailbox_sync_enabled",
        "document_intelligence_enabled",
        "invoice_automation_enabled",
        "receipt_automation_enabled",
        "auto_allocation_enabled",
        "reminder_evaluation_enabled",
        "reminder_delivery_enabled",
      ] as const
    ) {
      if (patch[field] !== undefined) {
        patch[field] = parseBoolean(patch[field], field);
      }
    }
    if (patch.reminder_stage_offsets !== undefined) {
      if (
        !Array.isArray(patch.reminder_stage_offsets) ||
        patch.reminder_stage_offsets.length === 0 ||
        patch.reminder_stage_offsets.length > 10 ||
        patch.reminder_stage_offsets.some((offset) =>
          !Number.isInteger(offset) || Number(offset) < -90 ||
          Number(offset) > 0
        ) ||
        new Set(patch.reminder_stage_offsets).size !==
          patch.reminder_stage_offsets.length
      ) {
        throw new ValidationError(
          "reminder_stage_offsets must contain 1 to 10 unique calendar-day offsets from -90 through 0.",
        );
      }
    }
    if (patch.reminder_timezone !== undefined) {
      patch.reminder_timezone = requireBoundedText(
        patch.reminder_timezone,
        "reminder_timezone",
        100,
      );
      dateInTimeZone(this.now(), String(patch.reminder_timezone));
    }
    for (
      const field of [
        "minimum_overall_confidence",
        "minimum_critical_confidence",
      ] as const
    ) {
      if (patch[field] === undefined) continue;
      const confidence = Number(patch[field]);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new ValidationError(`${field} must be between 0 and 1.`);
      }
      patch[field] = confidence.toFixed(4);
    }
    const safe = {
      ...patch,
      company_id: auth.companyId,
      updated_by: auth.userId,
      updated_at: this.now().toISOString(),
    };
    const { data, error } = await this.client.from("automation_settings")
      .upsert(safe, { onConflict: "company_id" }).select("*").single();
    if (error) throw error;
    return automationSettingsDto(data as Row, auth.companyId);
  }

  async listSalesRepresentatives(
    auth: AuthContext,
    page: PageRequest,
    active?: boolean,
  ): Promise<PagedRows> {
    requireAnyRole(auth, [
      "AR Clerk",
      "AR Supervisor",
      "Finance Manager",
      "Auditor",
      "System Admin",
    ]);
    const [from, to] = pageRange(page);
    let query = this.client.from("sales_representatives").select("*", {
      count: "exact",
    })
      .eq("company_id", auth.companyId);
    if (active !== undefined) query = query.eq("is_active", active);
    const { data, count, error } = await query
      .order("name", { ascending: true }).order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const total = count ?? 0;
    return {
      rows: ((data ?? []) as Row[]).map(salesRepresentativeDto),
      meta: { ...page, total, has_more: from + (data?.length ?? 0) < total },
    };
  }

  async createSalesRepresentative(auth: AuthContext, input: Row): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    assertExactKeys(input, ["name", "email", "phone", "is_active"], [
      "name",
      "email",
    ]);
    if (
      input.is_active !== undefined && typeof input.is_active !== "boolean"
    ) {
      throw new ValidationError("is_active must be a boolean.");
    }
    const record = {
      company_id: auth.companyId,
      name: requireBoundedText(input.name, "name", 200),
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      is_active: input.is_active !== false,
      created_by: auth.userId,
      updated_by: auth.userId,
    };
    const { data, error } = await this.client.from("sales_representatives")
      .insert(record).select("*").single();
    if (error) {
      if (error.code === "23505") {
        throw new ConflictError("Sales representative email already exists.");
      }
      throw error;
    }
    return salesRepresentativeDto(data as Row);
  }

  async updateSalesRepresentative(
    auth: AuthContext,
    id: string,
    input: Row,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(id, "id");
    assertExactKeys(input, ["name", "email", "phone", "is_active"]);
    if (Object.keys(input).length === 0) {
      throw new ValidationError("At least one field must be supplied.");
    }
    const patch: Row = {
      updated_by: auth.userId,
      updated_at: this.now().toISOString(),
    };
    if (input.name !== undefined) {
      patch.name = requireBoundedText(input.name, "name", 200);
    }
    if (input.email !== undefined) patch.email = normalizeEmail(input.email);
    if (input.phone !== undefined) patch.phone = normalizePhone(input.phone);
    if (input.is_active !== undefined) {
      if (typeof input.is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean.");
      }
      patch.is_active = input.is_active;
    }
    const { data, error } = await this.client.from("sales_representatives")
      .update(patch).eq("id", id).eq("company_id", auth.companyId).select("*")
      .maybeSingle();
    if (error) throw error;
    return salesRepresentativeDto(
      requiredId(data as Row | null, "SalesRepresentative", id),
    );
  }

  async assignSalesRepresentative(
    auth: AuthContext,
    customerId: string,
    input: Row,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(customerId, "customer_id");
    assertExactKeys(input, [
      "sales_representative_id",
      "assignment_source",
      "reason",
    ], ["sales_representative_id", "assignment_source", "reason"]);
    validateUUID(
      String(input.sales_representative_id),
      "sales_representative_id",
    );
    if (
      ![
        "customer_acquisition",
        "customer_onboarding",
        "manual_assignment",
        "import",
      ].includes(String(input.assignment_source))
    ) {
      throw new ValidationError("Unsupported assignment_source.");
    }
    const reason = requireBoundedText(input.reason, "reason", 500);
    const result = await callRpc<Row>(
      this.client,
      "automation_assign_sales_representative",
      {
        p_company_id: auth.companyId,
        p_actor_user_id: auth.userId,
        p_customer_id: customerId,
        p_sales_representative_id: input.sales_representative_id,
        p_assignment_source: input.assignment_source,
        p_reason: reason,
      },
    );
    return {
      changed: result.changed === true,
      current: await this.getCustomerSalesRepresentative(auth, customerId),
    };
  }

  async getCustomerSalesRepresentative(
    auth: AuthContext,
    customerId: string,
  ): Promise<Row | null> {
    requireOperationalReadRole(auth);
    validateUUID(customerId, "customer_id");
    await requireCustomerAccess(auth, customerId);
    const { data, error } = await this.client
      .from("customer_sales_representative_assignments")
      .select("*, sales_representative:sales_representatives(*)")
      .eq("company_id", auth.companyId).eq("customer_id", customerId)
      .is("superseded_at", null).maybeSingle();
    if (error) throw error;
    return currentAssignmentDto(data as Row | null);
  }

  async listAssignmentHistory(
    auth: AuthContext,
    customerId: string,
    page: PageRequest,
  ): Promise<PagedRows> {
    requireOperationalReadRole(auth);
    validateUUID(customerId, "customer_id");
    await requireCustomerAccess(auth, customerId);
    const [from, to] = pageRange(page);
    const { data, count, error } = await this.client
      .from("customer_sales_representative_assignments")
      .select("*, sales_representative:sales_representatives(*)", {
        count: "exact",
      })
      .eq("company_id", auth.companyId).eq("customer_id", customerId)
      .order("assigned_at", { ascending: false }).order("id", {
        ascending: false,
      })
      .range(from, to);
    if (error) throw error;
    const total = count ?? 0;
    const rows = ((data ?? []) as Row[]).map(assignmentHistoryDto);
    return {
      rows,
      meta: { ...page, total, has_more: from + rows.length < total },
    };
  }

  async listDocumentDecisions(
    auth: AuthContext,
    page: PageRequest,
    filters: Readonly<Record<string, string | undefined>>,
  ): Promise<PagedRows> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
    const [from, to] = pageRange(page);
    let query = this.client.from("automation_document_classifications")
      .select(
        "*, extraction:automation_extraction_results(*), attachment:automation_source_attachments(id,message_id,original_file_name,detected_mime_type,size_bytes,page_count,scan_status,safety_status,processing_status,content_purged_at)",
        { count: "exact" },
      )
      .eq("company_id", auth.companyId);
    for (const field of ["document_type", "status"] as const) {
      if (filters[field] !== undefined) {
        query = query.eq(field, filters[field]);
      }
    }
    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const sourceRows = (data ?? []) as Row[];
    const extractionIds = sourceRows.flatMap((row) => {
      const extraction = row.extraction as Row | null;
      return extraction?.id ? [String(extraction.id)] : [];
    });
    const attachmentIds = sourceRows.map((row) => String(row.attachment_id));
    const commandsByExtraction = new Map<string, Row>();
    if (extractionIds.length > 0) {
      const { data: commands, error: commandError } = await this.client
        .from("automation_commands")
        .select(
          "id,extraction_id,command_type,status,resulting_invoice_id,resulting_receipt_id,failure_code",
        )
        .eq("company_id", auth.companyId)
        .in("extraction_id", extractionIds)
        .order("created_at", { ascending: false })
        .limit(extractionIds.length);
      if (commandError) throw commandError;
      for (const command of (commands ?? []) as Row[]) {
        const id = String(command.extraction_id);
        if (!commandsByExtraction.has(id)) {
          commandsByExtraction.set(id, command);
        }
      }
    }
    const exceptionsByAttachment = new Map<string, string[]>();
    if (attachmentIds.length > 0) {
      const { data: exceptions, error: exceptionError } = await this.client
        .from("automation_exceptions")
        .select("id,attachment_id")
        .eq("company_id", auth.companyId)
        .in("attachment_id", attachmentIds)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (exceptionError) throw exceptionError;
      for (const exception of (exceptions ?? []) as Row[]) {
        const id = String(exception.attachment_id);
        exceptionsByAttachment.set(id, [
          ...(exceptionsByAttachment.get(id) ?? []),
          String(exception.id),
        ]);
      }
    }
    const rows = sourceRows.map((row) => {
      const extraction = row.extraction as Row | null;
      return documentDecisionDto({
        ...row,
        command: extraction?.id
          ? commandsByExtraction.get(String(extraction.id)) ?? null
          : null,
        linked_exception_ids: exceptionsByAttachment.get(
          String(row.attachment_id),
        ) ?? [],
      });
    });
    const total = count ?? 0;
    return {
      rows,
      meta: { ...page, total, has_more: from + rows.length < total },
    };
  }

  async listTable(
    auth: AuthContext,
    table: string,
    page: PageRequest,
    filters: Readonly<Record<string, string | boolean | undefined>> = {},
  ): Promise<PagedRows> {
    requireAnyRole(
      auth,
      table === "automation_mailboxes"
        ? ["Finance Manager", "Auditor", "System Admin"]
        : ["AR Supervisor", "Finance Manager", "Auditor"],
    );
    const allowedTables = new Set([
      "automation_mailboxes",
      "mailbox_sync_runs",
      "automation_document_classifications",
      "automation_exceptions",
      "invoice_reminders",
      "reminder_delivery_attempts",
      "automation_audit_events",
      "automation_commands",
    ]);
    if (!allowedTables.has(table)) {
      throw new ValidationError("Unsupported automation collection.");
    }
    if (table === "invoice_reminders" && filters.invoice_id !== undefined) {
      validateUUID(String(filters.invoice_id), "invoice_id");
      const { data: invoice, error: invoiceError } = await this.client
        .from("invoices").select("id,customer_id")
        .eq("id", filters.invoice_id).eq("company_id", auth.companyId)
        .maybeSingle();
      if (invoiceError) throw invoiceError;
      const visibleInvoice = requiredId(
        invoice as Row | null,
        "Invoice",
        String(filters.invoice_id),
      );
      await requireCustomerAccess(auth, String(visibleInvoice.customer_id));
    }
    if (
      table === "reminder_delivery_attempts" &&
      filters.reminder_id !== undefined
    ) {
      validateUUID(String(filters.reminder_id), "reminder_id");
      const { data: reminder, error: reminderError } = await this.client
        .from("invoice_reminders").select("id,customer_id")
        .eq("id", filters.reminder_id).eq("company_id", auth.companyId)
        .maybeSingle();
      if (reminderError) throw reminderError;
      const visibleReminder = requiredId(
        reminder as Row | null,
        "InvoiceReminder",
        String(filters.reminder_id),
      );
      await requireCustomerAccess(auth, String(visibleReminder.customer_id));
    }
    const [from, to] = pageRange(page);
    let query = this.client.from(table).select("*", { count: "exact" })
      .eq("company_id", auth.companyId);
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) {
        const normalized = table === "automation_audit_events" &&
            key === "actor_type"
          ? value === "system"
            ? "system_worker"
            : value === "provider"
            ? "provider_fixture"
            : value
          : value;
        query = query.eq(key, normalized);
      }
    }
    const orderField = table === "invoice_reminders"
      ? "scheduled_for"
      : table === "reminder_delivery_attempts"
      ? "attempt_number"
      : table === "automation_exceptions"
      ? "opened_at"
      : "created_at";
    const { data, count, error } = await query
      .order(orderField, {
        ascending: false,
      })
      .order("id", { ascending: false }).range(from, to);
    if (error) throw error;
    let sourceRows = (data ?? []) as Row[];
    if (table === "automation_exceptions") {
      const attachmentIds = [
        ...new Set(
          sourceRows.flatMap((row) =>
            typeof row.attachment_id === "string" ? [row.attachment_id] : []
          ),
        ),
      ];
      if (attachmentIds.length > 0) {
        const [attachmentsResult, classificationsResult] = await Promise.all([
          this.client.from("automation_source_attachments")
            .select("id,original_file_name,processing_status")
            .eq("company_id", auth.companyId).in("id", attachmentIds)
            .limit(attachmentIds.length),
          this.client.from("automation_document_classifications")
            .select("id,attachment_id,document_type,status,created_at")
            .eq("company_id", auth.companyId).in("attachment_id", attachmentIds)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(Math.min(attachmentIds.length * 10, 1000)),
        ]);
        if (attachmentsResult.error) throw attachmentsResult.error;
        if (classificationsResult.error) throw classificationsResult.error;
        const attachmentById = new Map(
          ((attachmentsResult.data ?? []) as Row[]).map((row) => [
            String(row.id),
            row,
          ]),
        );
        const classificationByAttachment = new Map<string, Row>();
        for (const row of (classificationsResult.data ?? []) as Row[]) {
          const attachmentId = String(row.attachment_id);
          if (!classificationByAttachment.has(attachmentId)) {
            classificationByAttachment.set(attachmentId, row);
          }
        }
        sourceRows = sourceRows.map((row) => {
          const attachmentId = typeof row.attachment_id === "string"
            ? row.attachment_id
            : null;
          const attachment = attachmentId
            ? attachmentById.get(attachmentId)
            : undefined;
          const classification = attachmentId
            ? classificationByAttachment.get(attachmentId)
            : undefined;
          return {
            ...row,
            document_context: attachment
              ? {
                file_name: attachment.original_file_name,
                processing_status: attachment.processing_status,
                document_type: classification?.document_type ?? null,
                classification_status: classification?.status ?? null,
              }
              : null,
          };
        });
      } else {
        sourceRows = sourceRows.map((row) => ({
          ...row,
          document_context: null,
        }));
      }
    }
    const total = count ?? 0;
    const rows = sourceRows.map((row) =>
      mapAutomationCollectionRow(table, row)
    );
    return {
      rows,
      meta: { ...page, total, has_more: from + rows.length < total },
    };
  }

  async createMailbox(auth: AuthContext, input: Row): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    assertExactKeys(input, [
      "provider_type",
      "mailbox_address",
      "default_bank_account_id",
      "ingestion_secret_ref",
      "delivery_secret_ref",
    ], ["provider_type", "mailbox_address"]);
    const provider = input.provider_type;
    if (provider !== "gmail" && provider !== "microsoft") {
      throw new ValidationError("provider_type must be gmail or microsoft.");
    }
    if (
      input.default_bank_account_id !== undefined &&
      input.default_bank_account_id !== null
    ) {
      validateUUID(
        String(input.default_bank_account_id),
        "default_bank_account_id",
      );
    }
    for (
      const field of ["ingestion_secret_ref", "delivery_secret_ref"] as const
    ) {
      if (input[field] === undefined || input[field] === null) continue;
      const reference = requireBoundedText(input[field], field, 128);
      if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(reference)) {
        throw new ValidationError(`${field} must be an opaque secret name.`);
      }
      input[field] = reference;
    }
    const record = {
      company_id: auth.companyId,
      provider_type: provider,
      mailbox_address: normalizeEmail(input.mailbox_address, "mailbox_address"),
      default_bank_account_id: input.default_bank_account_id ?? null,
      ingestion_secret_ref: input.ingestion_secret_ref ?? null,
      delivery_secret_ref: input.delivery_secret_ref ?? null,
      connection_status: "disabled",
      is_enabled: false,
      ingestion_enabled: false,
      delivery_enabled: false,
      created_by: auth.userId,
      updated_by: auth.userId,
    };
    const { data, error } = await this.client.from("automation_mailboxes")
      .insert(record).select("*").single();
    if (error) throwMailboxPersistenceError(error);
    return mailboxDto(data as Row);
  }

  async updateMailbox(
    auth: AuthContext,
    mailboxId: string,
    input: Row,
  ): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    validateUUID(mailboxId, "mailbox_id");
    assertExactKeys(input, [
      "default_bank_account_id",
      "ingestion_secret_ref",
      "delivery_secret_ref",
      "is_enabled",
      "ingestion_enabled",
      "delivery_enabled",
    ]);
    if (Object.keys(input).length === 0) {
      throw new ValidationError("At least one field must be supplied.");
    }
    const patch: Row = {
      updated_by: auth.userId,
      updated_at: this.now().toISOString(),
    };
    for (
      const field of [
        "default_bank_account_id",
        "ingestion_secret_ref",
        "delivery_secret_ref",
      ] as const
    ) {
      if (input[field] === undefined) continue;
      if (input[field] === null) {
        patch[field] = null;
      } else if (field === "default_bank_account_id") {
        validateUUID(String(input[field]), field);
        patch[field] = input[field];
      } else {
        const reference = requireBoundedText(input[field], field, 128);
        if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(reference)) {
          throw new ValidationError(`${field} must be an opaque secret name.`);
        }
        patch[field] = reference;
      }
    }
    for (
      const field of [
        "is_enabled",
        "ingestion_enabled",
        "delivery_enabled",
      ] as const
    ) {
      if (input[field] === undefined) continue;
      if (typeof input[field] !== "boolean") {
        throw new ValidationError(`${field} must be a boolean.`);
      }
      patch[field] = input[field];
    }
    const { data: currentRaw, error: currentError } = await this.client
      .from("automation_mailboxes").select("*")
      .eq("id", mailboxId).eq("company_id", auth.companyId).maybeSingle();
    if (currentError) throw currentError;
    const current = requiredId(
      currentRaw as Row | null,
      "Mailbox",
      mailboxId,
    );
    const next = { ...current, ...patch };
    for (const capability of ["ingestion", "delivery"] as const) {
      const referenceField = `${capability}_secret_ref`;
      if (
        patch[referenceField] !== undefined &&
        patch[referenceField] !== current[referenceField] &&
        current[`${capability}_token_expires_at`] !== null
      ) {
        throw new BusinessError(
          "OAUTH_DISCONNECT_REQUIRED",
          "Disconnect the existing OAuth capability before changing its secret reference.",
          409,
        );
      }
    }
    if (
      (next.is_enabled === true || next.ingestion_enabled === true) &&
      (next.connection_status !== "connected" ||
        next.reconnect_required === true ||
        !next.ingestion_secret_ref)
    ) {
      throw new BusinessError(
        "MAILBOX_NOT_READY",
        "Mailbox ingestion cannot be enabled until OAuth readiness is proven.",
        409,
      );
    }
    if (
      next.delivery_enabled === true &&
      (next.connection_status !== "connected" ||
        next.reconnect_required === true ||
        !next.delivery_secret_ref)
    ) {
      throw new BusinessError(
        "MAILBOX_NOT_READY",
        "Mailbox delivery cannot be enabled until OAuth readiness is proven.",
        409,
      );
    }
    for (const capability of ["ingestion", "delivery"] as const) {
      const enabled = capability === "ingestion"
        ? next.is_enabled === true || next.ingestion_enabled === true
        : next.delivery_enabled === true;
      if (!enabled) continue;
      try {
        await this.resolveOAuthAccessTokenForRuntime(next, capability);
      } catch {
        throw new BusinessError(
          "MAILBOX_NOT_READY",
          `Mailbox ${capability} cannot be enabled until its secure OAuth token resolves.`,
          409,
        );
      }
    }
    const { data, error } = await this.client.from("automation_mailboxes")
      .update(patch).eq("id", mailboxId).eq("company_id", auth.companyId)
      .select("*").maybeSingle();
    if (error) throwMailboxPersistenceError(error);
    return mailboxDto(requiredId(data as Row | null, "Mailbox", mailboxId));
  }

  async disconnectMailboxOAuth(
    auth: AuthContext,
    mailboxId: string,
    capability: OAuthCapability | "all",
  ): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    validateUUID(mailboxId, "mailbox_id");
    const { data: mailboxRaw, error: mailboxError } = await this.client
      .from("automation_mailboxes").select("*")
      .eq("id", mailboxId).eq("company_id", auth.companyId).maybeSingle();
    if (mailboxError) throw mailboxError;
    const mailbox = requiredId(
      mailboxRaw as Row | null,
      "Mailbox",
      mailboxId,
    );
    const capabilities: OAuthCapability[] = capability === "all"
      ? ["ingestion", "delivery"]
      : [capability];
    for (const currentCapability of capabilities) {
      if (mailbox[`${currentCapability}_secret_ref`]) {
        await this.oauthSecretStore.deleteTokenSet(
          this.oauthSecretContext(mailbox, currentCapability),
        );
      }
    }
    const patch: Row = {
      reconnect_required: false,
      redacted_error_code: null,
      updated_by: auth.userId,
      updated_at: this.now().toISOString(),
    };
    if (capabilities.includes("ingestion")) {
      patch.is_enabled = false;
      patch.ingestion_enabled = false;
      patch.ingestion_token_expires_at = null;
    }
    if (capabilities.includes("delivery")) {
      patch.delivery_enabled = false;
      patch.delivery_token_expires_at = null;
    }
    const ingestionRemains = !capabilities.includes("ingestion") &&
      tokenExpiryIsCurrent(mailbox.ingestion_token_expires_at, this.now());
    const deliveryRemains = !capabilities.includes("delivery") &&
      tokenExpiryIsCurrent(mailbox.delivery_token_expires_at, this.now());
    patch.connection_status = ingestionRemains || deliveryRemains
      ? "connected"
      : "disabled";
    const { data, error } = await this.client.from("automation_mailboxes")
      .update(patch).eq("id", mailboxId).eq("company_id", auth.companyId)
      .select("*").maybeSingle();
    if (error) throw error;
    return mailboxDto(requiredId(data as Row | null, "Mailbox", mailboxId));
  }

  async beginOAuth(
    auth: AuthContext,
    mailboxId: string,
    capability: "ingestion" | "delivery",
  ): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    validateUUID(mailboxId, "mailbox_id");
    const { data: mailboxRaw, error } = await this.client
      .from("automation_mailboxes").select("*")
      .eq("id", mailboxId).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    const mailbox = requiredId(
      mailboxRaw as Row | null,
      "Mailbox",
      mailboxId,
    );
    const provider = mailbox.provider_type as MailboxProviderType;
    const clientId = this.oauthClientId(provider);
    const redirectUri = this.oauthRedirectUri(provider);
    const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
      "-",
      "",
    );
    const stateHash = await sha256(state);
    const scopes = this.oauthRequiredScopes(provider, capability);
    const expiresAt = new Date(this.now().getTime() + 10 * 60 * 1000)
      .toISOString();
    const { error: stateError } = await this.client.from(
      "automation_oauth_states",
    ).insert({
      company_id: auth.companyId,
      mailbox_id: mailboxId,
      provider_type: provider,
      state_hash: stateHash,
      redirect_uri: redirectUri,
      requested_scopes: scopes,
      expires_at: expiresAt,
      created_by: auth.userId,
    });
    if (stateError) throw stateError;
    const authorizationUrl = buildOAuthAuthorizationUrl({
      configuration: {
        provider,
        client_id: clientId,
        client_secret: "",
        redirect_uri: redirectUri,
        tenant: provider === "microsoft"
          ? Deno.env.get("MICROSOFT_OAUTH_TENANT") ?? "common"
          : undefined,
      },
      state,
      capability,
    });
    return {
      provider,
      authorization_url: boundedOAuthAuthorizationUrl(
        provider,
        authorizationUrl,
      ),
      expires_at: expiresAt,
      capability,
    };
  }

  async completeOAuth(
    provider: MailboxProviderType,
    state: string,
    code: string,
  ): Promise<Row> {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(state)) {
      throw new ValidationError("OAuth state is invalid.");
    }
    const stateHash = await sha256(state);
    const { data: stateRaw, error } = await this.client.from(
      "automation_oauth_states",
    )
      .select("*, mailbox:automation_mailboxes(*)")
      .eq("state_hash", stateHash).eq("provider_type", provider)
      .is("consumed_at", null).maybeSingle();
    if (error) throw error;
    const oauthState = requiredId(
      stateRaw as Row | null,
      "OAuthState",
      stateHash,
    );
    if (
      new Date(String(oauthState.expires_at)).getTime() <= this.now().getTime()
    ) {
      throw new BusinessError(
        "OAUTH_STATE_EXPIRED",
        "OAuth state has expired.",
        409,
      );
    }
    const mailbox = oauthState.mailbox as Row;
    const companyId = String(oauthState.company_id);
    if (
      mailbox.provider_type !== provider ||
      String(oauthState.redirect_uri) !== this.oauthRedirectUri(provider)
    ) {
      throw new BusinessError(
        "OAUTH_STATE_MISMATCH",
        "OAuth state does not match the provider callback.",
        409,
      );
    }
    const requestedScopes = Array.isArray(oauthState.requested_scopes)
      ? oauthState.requested_scopes.map(String)
      : [];
    const scopeKey = (scopes: readonly string[]) =>
      scopes.map((scope) => scope.toLowerCase()).sort().join("\u0000");
    const requestedScopeKey = scopeKey(requestedScopes);
    const ingestionScopeKey = scopeKey(
      this.oauthRequiredScopes(provider, "ingestion"),
    );
    const deliveryScopeKey = scopeKey(
      this.oauthRequiredScopes(provider, "delivery"),
    );
    const capability: OAuthCapability = requestedScopeKey === ingestionScopeKey
      ? "ingestion"
      : requestedScopeKey === deliveryScopeKey
      ? "delivery"
      : (() => {
        throw new BusinessError(
          "OAUTH_STATE_MISMATCH",
          "OAuth state does not match an exact provider capability.",
          409,
        );
      })();
    const secretReference = String(
      capability === "delivery"
        ? mailbox.delivery_secret_ref ?? ""
        : mailbox.ingestion_secret_ref ?? "",
    );
    if (!secretReference) {
      throw new BusinessError(
        "SECRET_REFERENCE_UNAVAILABLE",
        "Mailbox token secret reference has not been provisioned.",
        503,
      );
    }
    const clientId = this.oauthClientId(provider);
    const claimedAt = this.now().toISOString();
    const { data: claimedState, error: claimError } = await this.client.from(
      "automation_oauth_states",
    ).update({
      consumed_at: claimedAt,
    }).eq("id", oauthState.id).eq("company_id", companyId)
      .is("consumed_at", null).select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimedState) {
      throw new BusinessError(
        "OAUTH_STATE_ALREADY_USED",
        "OAuth state has already been consumed.",
        409,
      );
    }
    const result = await completeOAuthCallback({
      configuration: {
        provider,
        client_id: clientId,
        client_secret: await this.secretResolver.resolve(
          provider === "gmail"
            ? "GMAIL_OAUTH_CLIENT_SECRET"
            : "MICROSOFT_OAUTH_CLIENT_SECRET",
        ),
        redirect_uri: String(oauthState.redirect_uri),
        tenant: provider === "microsoft"
          ? Deno.env.get("MICROSOFT_OAUTH_TENANT") ?? "common"
          : undefined,
      },
      code,
      secret_context: {
        company_id: companyId,
        mailbox_id: String(mailbox.id),
        provider,
        capability,
        secret_reference: secretReference,
      },
      required_scopes: requestedScopes,
      writer: this.oauthSecretStore,
      fetcher: this.oauthFetcher,
      now: this.now(),
    });
    const completedAt = this.now().toISOString();
    const { data: connectedMailbox, error: mailboxUpdateError } = await this
      .client.from("automation_mailboxes").update({
        connection_status: "connected",
        reconnect_required: false,
        [
          capability === "delivery"
            ? "delivery_token_expires_at"
            : "ingestion_token_expires_at"
        ]: result.expires_at,
        redacted_error_code: null,
        updated_by: oauthState.created_by,
        updated_at: completedAt,
      }).eq("id", mailbox.id).eq("company_id", companyId).select("id")
      .maybeSingle();
    if (mailboxUpdateError) throw mailboxUpdateError;
    if (!connectedMailbox) {
      throw new BusinessError(
        "OAUTH_MAILBOX_UPDATE_FAILED",
        "Mailbox authorization state could not be persisted.",
        409,
      );
    }
    return {
      mailbox_id: mailbox.id,
      provider,
      capability,
      connection_status: "connected",
      token_expires_at: result.expires_at,
      granted_scopes: result.scopes,
    };
  }

  async rejectOAuth(
    provider: MailboxProviderType,
    state: string,
  ): Promise<never> {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(state)) {
      throw new ValidationError("OAuth state is invalid.");
    }
    const stateHash = await sha256(state);
    const { data: stateRaw, error } = await this.client.from(
      "automation_oauth_states",
    ).select("id,company_id,mailbox_id,expires_at,consumed_at")
      .eq("state_hash", stateHash).eq("provider_type", provider)
      .is("consumed_at", null).maybeSingle();
    if (error) throw error;
    const oauthState = requiredId(
      stateRaw as Row | null,
      "OAuthState",
      stateHash,
    );
    if (
      new Date(String(oauthState.expires_at)).getTime() <= this.now().getTime()
    ) {
      throw new BusinessError(
        "OAUTH_STATE_EXPIRED",
        "OAuth state has expired.",
        409,
      );
    }
    const claimedAt = this.now().toISOString();
    const { data: claimed, error: claimError } = await this.client.from(
      "automation_oauth_states",
    ).update({ consumed_at: claimedAt }).eq("id", oauthState.id)
      .eq("company_id", oauthState.company_id).is("consumed_at", null)
      .select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      throw new BusinessError(
        "OAUTH_STATE_ALREADY_USED",
        "OAuth state has already been consumed.",
        409,
      );
    }
    const { error: mailboxError } = await this.client.from(
      "automation_mailboxes",
    ).update({
      connection_status: "error",
      reconnect_required: true,
      redacted_error_code: "OAUTH_PROVIDER_DENIED",
      updated_at: claimedAt,
    }).eq("id", oauthState.mailbox_id).eq(
      "company_id",
      oauthState.company_id,
    );
    if (mailboxError) throw mailboxError;
    throw new BusinessError(
      "OAUTH_PROVIDER_DENIED",
      "OAuth consent was not completed.",
      409,
    );
  }

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

  private async createException(companyId: string, input: Row): Promise<void> {
    const row = {
      company_id: companyId,
      lifecycle_status: "open",
      ...input,
    };
    const { error } = await this.client.from("automation_exceptions").insert(
      row,
    );
    if (
      error &&
      !(input.idempotency_key &&
        isAutomationExceptionIdempotencyConflict(error))
    ) {
      throw error;
    }
  }

  async processAttachment(
    auth: AuthContext,
    attachmentId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(attachmentId, "attachment_id");
    try {
      const result = await this.processAttachmentDecision(auth, attachmentId);
      await this.setAttachmentProcessingStatus(
        auth.companyId,
        attachmentId,
        "processed",
      );
      return documentProcessingResultDto(result);
    } catch (error) {
      const code = error instanceof BusinessError
        ? error.code
        : "INTERNAL_PROCESSING_FAILURE";
      await this.setAttachmentProcessingStatus(
        auth.companyId,
        attachmentId,
        [
            "DOCUMENT_INTELLIGENCE_DISABLED",
            "PROVIDER_UNAVAILABLE",
            "INTERNAL_PROCESSING_FAILURE",
          ].includes(code)
          ? "retryable"
          : "processed",
      );
      throw error;
    }
  }

  private async setAttachmentProcessingStatus(
    companyId: string,
    attachmentId: string,
    processingStatus: "retryable" | "processed",
  ): Promise<void> {
    const { error } = await this.client.from("automation_source_attachments")
      .update({ processing_status: processingStatus })
      .eq("id", attachmentId)
      .eq("company_id", companyId)
      .neq("processing_status", "processed");
    if (error) throw error;
  }

  private async processAttachmentDecision(
    auth: AuthContext,
    attachmentId: string,
  ): Promise<Row> {
    const settings = await this.getSettings(auth);
    if (
      settings.operating_mode === "disabled" ||
      settings.document_intelligence_enabled !== true ||
      !this.documentProvider.enabled
    ) {
      throw new BusinessError(
        "DOCUMENT_INTELLIGENCE_DISABLED",
        "Document intelligence is disabled.",
        409,
      );
    }
    const { data: attachmentRaw, error } = await this.client
      .from("automation_source_attachments").select("*")
      .eq("id", attachmentId).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    const attachment = requiredId(
      attachmentRaw as Row | null,
      "Attachment",
      attachmentId,
    );
    if (
      attachment.safety_status !== "accepted" ||
      attachment.content_purged_at !== null
    ) {
      throw new BusinessError(
        "ATTACHMENT_UNAVAILABLE",
        "The attachment is not eligible for document processing.",
        409,
      );
    }
    const { data: existingClassification, error: existingClassError } =
      await this.client.from("automation_document_classifications").select("*")
        .eq("attachment_id", attachmentId).eq("schema_version", 1)
        .eq("company_id", auth.companyId).maybeSingle();
    if (existingClassError) throw existingClassError;
    if (existingClassification) {
      const { data: existingExtraction, error: existingExtractionError } =
        await this.client.from("automation_extraction_results").select("*")
          .eq("classification_id", existingClassification.id)
          .eq("schema_version", 1).eq("company_id", auth.companyId)
          .maybeSingle();
      if (existingExtractionError) throw existingExtractionError;
      if (!existingExtraction) return existingClassification as Row;
      if (existingExtraction.validation_status === "valid") {
        return {
          classification: existingClassification,
          extraction: existingExtraction,
        };
      }
      if (
        ["invalid", "ambiguous"].includes(
          String(existingExtraction.validation_status),
        )
      ) {
        const validationCodes = Array.isArray(
            existingExtraction.validation_codes,
          )
          ? existingExtraction.validation_codes.map(String)
          : [];
        if (!customerResolutionFailureMayRecover(validationCodes)) {
          return {
            classification: existingClassification,
            extraction: existingExtraction,
          };
        }
        const fields = existingExtraction
          .extracted_fields as FinancialExtraction;
        const resolved = await this.resolveCustomer(
          auth,
          fields.customer,
          fields.document_type === "receipt" ? fields.invoice_references : [],
        );
        await this.assertNoFinancialIdentifierConflict(
          auth,
          fields,
          resolved.customer_id,
        );
        const { data: recovered, error: recoveryError } = await this.client
          .from("automation_extraction_results").update({
            validation_status: "valid",
            validation_codes: [],
            customer_id: resolved.customer_id,
            customer_resolution_method: resolved.method,
            validated_at: this.now().toISOString(),
          }).eq("id", existingExtraction.id).eq("company_id", auth.companyId)
          .select("*").single();
        if (recoveryError) throw recoveryError;
        return {
          classification: existingClassification,
          extraction: recovered,
        };
      }
      return {
        classification: existingClassification,
        extraction: existingExtraction,
      };
    }
    const { data: file, error: downloadError } = await this.client.storage
      .from(STORAGE_BUCKET).download(String(attachment.safe_storage_path));
    if (downloadError) throw downloadError;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const input = {
      file_name: String(attachment.original_file_name),
      detected_mime_type: String(attachment.detected_mime_type),
      sha256: String(attachment.sha256),
      bytes,
    };
    assertProviderTextIsDataOnly(input);
    let result: DocumentIntelligenceResult;
    try {
      result = validateDocumentResult(
        await this.documentProvider.analyze(input),
        {
          overall: Number(settings.minimum_overall_confidence),
          critical: Number(settings.minimum_critical_confidence),
        },
      );
    } catch (providerError) {
      const reasonCode = documentExceptionReason(providerError);
      await this.createException(auth.companyId, {
        mailbox_id: attachment.mailbox_id,
        message_id: attachment.message_id,
        attachment_id: attachmentId,
        reason_code: reasonCode,
        lifecycle_status: reasonCode === "provider_unavailable"
          ? "retryable"
          : "open",
        safe_details: {
          error_code: providerError instanceof BusinessError ||
              providerError instanceof ValidationError
            ? providerError.code
            : "INTERNAL_PROCESSING_FAILURE",
        },
        actor_user_id: auth.userId,
      });
      throw providerError;
    }
    const classificationRecord = {
      company_id: auth.companyId,
      attachment_id: attachmentId,
      schema_version: result.classification.schema_version,
      provider_name: result.classification.provider,
      provider_model: result.classification.model,
      provider_version: result.classification.provider_version,
      document_type: result.classification.document_type,
      confidence: result.classification.confidence,
      critical_confidence: result.classification.critical_field_confidence,
      status:
        ["invoice", "receipt"].includes(result.classification.document_type)
          ? "accepted"
          : "rejected",
      trace_id: result.classification.trace_id,
    };
    const { data: classificationInserted, error: classError } = await this
      .client.from("automation_document_classifications").upsert(
        classificationRecord,
        {
          onConflict: "attachment_id,schema_version",
          ignoreDuplicates: true,
        },
      ).select("*").maybeSingle();
    if (classError) throw classError;
    let classification = classificationInserted as Row | null;
    if (!classification) {
      const { data: existing, error: existingError } = await this.client
        .from("automation_document_classifications").select("*")
        .eq("attachment_id", attachmentId).eq("schema_version", 1)
        .eq("company_id", auth.companyId).maybeSingle();
      if (existingError) throw existingError;
      classification = requiredId(
        existing as Row | null,
        "DocumentClassification",
        attachmentId,
      );
    }
    if (!result.extraction) {
      await this.createException(auth.companyId, {
        mailbox_id: attachment.mailbox_id,
        message_id: attachment.message_id,
        attachment_id: attachmentId,
        reason_code: result.classification.document_type === "ambiguous"
          ? "ambiguous_classification"
          : "unsupported_document",
        safe_details: {
          classification_id: classification.id,
          document_type: result.classification.document_type,
        },
        actor_user_id: auth.userId,
      });
      return classification as Row;
    }

    let customerId: { customer_id: string; method: string };
    try {
      customerId = await this.resolveCustomer(
        auth,
        result.extraction.customer,
        result.extraction.document_type === "receipt"
          ? result.extraction.invoice_references
          : [],
      );
    } catch (resolutionError) {
      const reasonCode = documentExceptionReason(resolutionError);
      const { data: rejectedExtraction, error: rejectedError } = await this
        .client.from("automation_extraction_results").upsert({
          company_id: auth.companyId,
          classification_id: classification.id,
          schema_version: 1,
          provider_name: result.classification.provider,
          provider_model: result.classification.model,
          provider_version: result.classification.provider_version,
          extracted_fields: result.extraction,
          field_confidence: result.field_confidence,
          validation_status: reasonCode === "customer_ambiguous"
            ? "ambiguous"
            : "invalid",
          validation_codes: [reasonCode],
          customer_id: null,
          customer_resolution_method: null,
          trace_id: result.classification.trace_id,
          validated_at: this.now().toISOString(),
        }, { onConflict: "classification_id,schema_version" }).select("*")
        .single();
      if (rejectedError) throw rejectedError;
      await this.createException(auth.companyId, {
        mailbox_id: attachment.mailbox_id,
        message_id: attachment.message_id,
        attachment_id: attachmentId,
        reason_code: reasonCode,
        lifecycle_status: "retryable",
        safe_details: {
          classification_id: classification.id,
          extraction_id: rejectedExtraction.id,
        },
        actor_user_id: auth.userId,
      });
      return {
        classification,
        extraction: rejectedExtraction,
      };
    }
    try {
      await this.assertNoFinancialIdentifierConflict(
        auth,
        result.extraction,
        customerId.customer_id,
      );
    } catch (conflictError) {
      const reasonCode = result.extraction.document_type === "invoice"
        ? "invoice_conflict"
        : "receipt_conflict";
      const { data: rejectedExtraction, error: rejectedError } = await this
        .client.from("automation_extraction_results").upsert({
          company_id: auth.companyId,
          classification_id: classification.id,
          schema_version: 1,
          provider_name: result.classification.provider,
          provider_model: result.classification.model,
          provider_version: result.classification.provider_version,
          extracted_fields: result.extraction,
          field_confidence: result.field_confidence,
          validation_status: "invalid",
          validation_codes: [reasonCode],
          customer_id: customerId.customer_id,
          customer_resolution_method: customerId.method,
          trace_id: result.classification.trace_id,
          validated_at: this.now().toISOString(),
        }, { onConflict: "classification_id,schema_version" }).select("*")
        .single();
      if (rejectedError) throw rejectedError;
      await this.createException(auth.companyId, {
        mailbox_id: attachment.mailbox_id,
        message_id: attachment.message_id,
        attachment_id: attachmentId,
        reason_code: reasonCode,
        lifecycle_status: "open",
        safe_details: {
          classification_id: classification.id,
          extraction_id: rejectedExtraction.id,
          error_code: conflictError instanceof BusinessError
            ? conflictError.code
            : "FINANCIAL_IDENTIFIER_CONFLICT",
        },
        actor_user_id: auth.userId,
      });
      return {
        classification,
        extraction: rejectedExtraction,
      };
    }
    const { data: extraction, error: extractionError } = await this.client
      .from("automation_extraction_results").upsert({
        company_id: auth.companyId,
        classification_id: classification.id,
        schema_version: 1,
        provider_name: result.classification.provider,
        provider_model: result.classification.model,
        provider_version: result.classification.provider_version,
        extracted_fields: result.extraction,
        field_confidence: result.field_confidence,
        validation_status: "valid",
        validation_codes: [],
        customer_id: customerId.customer_id,
        customer_resolution_method: customerId.method,
        trace_id: result.classification.trace_id,
        validated_at: this.now().toISOString(),
      }, { onConflict: "classification_id,schema_version" }).select("*")
      .single();
    if (extractionError) throw extractionError;
    return { classification, extraction };
  }

  private async assertNoFinancialIdentifierConflict(
    auth: AuthContext,
    extraction: FinancialExtraction,
    customerId: string,
  ): Promise<void> {
    const reference = extraction.reference_no?.trim();
    if (!reference) return;
    const table = extraction.document_type === "invoice"
      ? "invoices"
      : "receipts";
    const { count, error } = await this.client.from(table).select("id", {
      count: "exact",
      head: true,
    })
      .eq("company_id", auth.companyId)
      .eq("customer_id", customerId)
      .eq("reference_no", reference);
    if (error) throw error;
    if ((count ?? 0) > 0) {
      throw new BusinessError(
        extraction.document_type === "invoice"
          ? "INVOICE_CONFLICT"
          : "RECEIPT_CONFLICT",
        "A financial record with this source reference already exists.",
        409,
      );
    }
  }

  private async resolveCustomer(
    auth: AuthContext,
    extracted: {
      customer_code?: string;
      registration_identifier?: string;
      email?: string;
      company_name?: string;
      invoice_reference?: string;
    },
    invoiceReferences: readonly string[],
  ): Promise<{ customer_id: string; method: string }> {
    const columns = AUTOMATION_CUSTOMER_RESOLUTION_SELECT;
    const resolve = (
      rows: readonly Row[],
      method: string,
    ): { customer_id: string; method: string } | null => {
      const unique = [...new Map(
        rows.map((row) => [String(row.id), row]),
      ).values()];
      if (unique.length > 1) {
        throw new BusinessError(
          "CUSTOMER_AMBIGUOUS",
          "Customer resolution is ambiguous.",
        );
      }
      return unique.length === 1
        ? { customer_id: String(unique[0].id), method }
        : null;
    };
    const base = () =>
      this.client.from("customers").select(columns)
        .eq("company_id", auth.companyId)
        .eq("is_deleted", false).eq("is_hidden", false);

    if (extracted.customer_code?.trim()) {
      const { data, error } = await base().eq(
        AUTOMATION_CUSTOMER_CODE_DATABASE_COLUMN,
        extracted.customer_code.trim(),
      ).limit(2);
      if (error) throw error;
      const match = resolve((data ?? []) as Row[], "customer_code");
      if (match) return match;
    }
    if (extracted.registration_identifier?.trim()) {
      const identifier = extracted.registration_identifier.trim();
      const [registration, tax] = await Promise.all([
        base().eq("registration_no", identifier).limit(2),
        base().eq("tax_id", identifier).limit(2),
      ]);
      if (registration.error) throw registration.error;
      if (tax.error) throw tax.error;
      const match = resolve(
        [...(registration.data ?? []), ...(tax.data ?? [])] as Row[],
        "registration_identifier",
      );
      if (match) return match;
    }
    if (extracted.email?.trim()) {
      const { data, error } = await base().eq(
        "contact_email",
        normalizeEmail(extracted.email, "customer.email"),
      ).limit(2);
      if (error) throw error;
      const match = resolve((data ?? []) as Row[], "known_email");
      if (match) return match;
    }
    const exactInvoiceReferences = [
      ...(extracted.invoice_reference?.trim()
        ? [extracted.invoice_reference.trim()]
        : []),
      ...invoiceReferences.map((reference) => reference.trim()).filter(Boolean),
    ];
    if (exactInvoiceReferences.length > 0) {
      const { data: invoices, error: invoiceError } = await this.client
        .from("invoices").select("customer_id")
        .eq("company_id", auth.companyId)
        .in("invoice_no", [...new Set(exactInvoiceReferences)])
        .limit(101);
      if (invoiceError) throw invoiceError;
      const customerIds = [
        ...new Set(
          (invoices ?? []).map((invoice: Row) => String(invoice.customer_id)),
        ),
      ];
      if (customerIds.length > 1) {
        throw new BusinessError(
          "CUSTOMER_AMBIGUOUS",
          "Invoice references resolve to different customers.",
        );
      }
      if (customerIds.length === 1) {
        const { data, error } = await base().eq("id", customerIds[0]).limit(1);
        if (error) throw error;
        const match = resolve((data ?? []) as Row[], "invoice_reference");
        if (match) return match;
      }
    }
    if (extracted.company_name?.trim()) {
      const normalized = extracted.company_name.trim().toLocaleLowerCase("en");
      const pattern = extracted.company_name.trim()
        .replaceAll("\\", "\\\\").replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
      const { data, error } = await base().ilike("customer_name", pattern)
        .limit(3);
      if (error) throw error;
      const exact = ((data ?? []) as Row[]).filter((row) =>
        String(row.customer_name).trim().toLocaleLowerCase("en") === normalized
      );
      const match = resolve(exact, "unique_normalized_name");
      if (match) return match;
    }
    throw new BusinessError(
      "CUSTOMER_UNRESOLVED",
      "Customer could not be resolved.",
    );
  }

  async executeCommand(auth: AuthContext, extractionId: string): Promise<Row> {
    requireRole(auth, "AR Clerk");
    validateUUID(extractionId, "extraction_id");
    const settings = await this.getSettings(auth);
    const mode = settings.operating_mode as AutomationOperatingMode;
    if (mode === "disabled") {
      throw new BusinessError(
        "AUTOMATION_DISABLED",
        "Financial automation is disabled.",
        409,
      );
    }
    const { data: extractionRaw, error } = await this.client
      .from("automation_extraction_results")
      .select(
        "*, classification:automation_document_classifications(*, attachment:automation_source_attachments(*, message:automation_source_messages(*)))",
      )
      .eq("id", extractionId).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    const extraction = requiredId(
      extractionRaw as Row | null,
      "Extraction",
      extractionId,
    );
    if (extraction.validation_status !== "valid") {
      throw new BusinessError(
        "EXTRACTION_NOT_VALID",
        "Only validated extraction results can create commands.",
      );
    }
    const classification = extraction.classification as Row;
    const attachment = classification.attachment as Row;
    const message = attachment.message as Row;
    const type = classification.document_type;
    const commandType = type === "invoice"
      ? "create_invoice"
      : type === "receipt"
      ? "create_receipt"
      : null;
    if (!commandType) {
      throw new BusinessError(
        "UNSUPPORTED_DOCUMENT",
        "Document cannot create a financial command.",
      );
    }
    if (
      (commandType === "create_invoice" &&
        settings.invoice_automation_enabled !== true) ||
      (commandType === "create_receipt" &&
        settings.receipt_automation_enabled !== true)
    ) {
      throw new BusinessError(
        "AUTOMATION_DISABLED",
        "Document automation kill switch is disabled.",
        409,
      );
    }
    const key = await sha256([
      auth.companyId,
      attachment.mailbox_id,
      message.provider_message_id,
      attachment.sha256,
      commandType,
      extraction.schema_version,
    ].join(":"));
    const { data: commandRaw, error: commandError } = await this.client
      .from("automation_commands").upsert({
        company_id: auth.companyId,
        mailbox_id: attachment.mailbox_id,
        message_id: message.id,
        attachment_id: attachment.id,
        extraction_id: extractionId,
        command_type: commandType,
        schema_version: extraction.schema_version,
        operating_mode: mode,
        idempotency_key: key,
        command_payload: extraction.extracted_fields,
        status: mode === "observe_only" ? "proposed" : "pending",
        created_by: auth.userId,
      }, { onConflict: "company_id,idempotency_key", ignoreDuplicates: true })
      .select("*").maybeSingle();
    if (commandError) throw commandError;
    let command: Row;
    let reclaimStaleRunning = false;
    if (!commandRaw) {
      const { data: existing, error: existingError } = await this.client
        .from("automation_commands").select("*")
        .eq("company_id", auth.companyId).eq("idempotency_key", key).single();
      if (existingError) throw existingError;
      command = existing as Row;
      if (["completed", "proposed"].includes(String(command.status))) {
        return commandDto(command);
      }
      if (command.status === "running") {
        const startedAt = Date.parse(String(command.started_at ?? ""));
        const staleBefore = this.now().getTime() - 15 * 60 * 1000;
        if (!Number.isFinite(startedAt) || startedAt > staleBefore) {
          return commandDto(command);
        }
        reclaimStaleRunning = true;
      }
      if (command.status !== "failed") {
        if (!reclaimStaleRunning) {
          throw new BusinessError(
            "COMMAND_NOT_RETRYABLE",
            "Automation command cannot be retried.",
            409,
          );
        }
      }
    } else {
      command = commandRaw as Row;
    }
    if (mode === "observe_only") return commandDto(command);

    try {
      let claim = this.client
        .from("automation_commands").update({
          status: "running",
          started_at: this.now().toISOString(),
          failed_at: null,
          failure_code: null,
        }).eq("id", command.id);
      claim = reclaimStaleRunning
        ? claim.eq("status", "running").lt(
          "started_at",
          new Date(this.now().getTime() - 15 * 60 * 1000).toISOString(),
        )
        : claim.in("status", ["pending", "failed"]);
      const { data: claimed, error: claimError } = await claim.select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) {
        throw new BusinessError(
          "CONCURRENCY_CONFLICT",
          "Automation command is already being processed.",
          409,
        );
      }
      let resultId: string;
      if (commandType === "create_invoice") {
        const payload = extraction.extracted_fields as {
          invoice_date: string;
          currency: string;
          reference_no?: string;
          tax_total: string;
          lines: Array<{
            description: string;
            quantity: string;
            unit_price: string;
          }>;
        };
        if (payload.tax_total !== "0" && payload.tax_total !== "0.00") {
          throw new BusinessError(
            "TAX_MAPPING_REQUIRED",
            "Automated invoice tax requires an exact configured tax-code mapping.",
          );
        }
        const invoice = new InvoiceService(this.client);
        const created = await invoice.createInvoice(
          auth,
          {
            doc_type: "Invoice",
            invoice_date: payload.invoice_date,
            customer_id: String(extraction.customer_id),
            currency: payload.currency,
            reference_no: payload.reference_no,
            internal_remarks: "Created by Gate E automation.",
          } satisfies CreateInvoiceInput,
          payload.lines.map((line) => ({
            description: line.description,
            quantity: exactAutomationDecimalNumber(
              line.quantity,
              3,
              "quantity",
            ),
            unit_price: exactAutomationDecimalNumber(
              line.unit_price,
              4,
              "unit_price",
            ),
          } satisfies CreateInvoiceLineInput)),
          {
            automationCommandId: String(command.id),
            importOrigin: {
              source: "gate_e_automation",
              automation_command_id: String(command.id),
              provider_message_id: String(message.provider_message_id),
              attachment_sha256: String(attachment.sha256),
            },
            postAtomically: mode === "straight_through",
          },
        );
        resultId = created.id;
      } else {
        const payload = extraction.extracted_fields as {
          receipt_date: string;
          currency: string;
          amount: string;
          payment_method: CreateReceiptInput["payment_method"];
          reference_no?: string;
        };
        const mailbox = attachment.mailbox_id;
        const { data: mailboxConfig, error: mailboxError } = await this.client
          .from("automation_mailboxes").select("default_bank_account_id")
          .eq("id", mailbox).eq("company_id", auth.companyId).maybeSingle();
        if (mailboxError) throw mailboxError;
        if (!mailboxConfig?.default_bank_account_id) {
          throw new BusinessError(
            "BANK_ACCOUNT_MAPPING_REQUIRED",
            "Automated receipt creation requires a configured tenant bank account.",
          );
        }
        const receipt = new ReceiptService(this.client);
        const created = await receipt.createReceipt(
          auth,
          {
            receipt_date: payload.receipt_date,
            customer_id: String(extraction.customer_id),
            payment_method: payload.payment_method,
            currency: payload.currency,
            receipt_amount: exactAutomationDecimalNumber(
              payload.amount,
              2,
              "receipt_amount",
            ),
            bank_account_id: String(mailboxConfig.default_bank_account_id),
            reference_no: payload.reference_no,
            remarks: "Created by Gate E automation.",
          },
          {
            automationCommandId: String(command.id),
            importOrigin: {
              source: "gate_e_automation",
              automation_command_id: String(command.id),
              provider_message_id: String(message.provider_message_id),
              attachment_sha256: String(attachment.sha256),
            },
            postAtomically: mode === "straight_through",
          },
        );
        resultId = created.id;
      }
      return commandDto({
        ...command,
        status: "completed",
        completed_at: this.now().toISOString(),
        resulting_invoice_id: commandType === "create_invoice"
          ? resultId
          : null,
        resulting_receipt_id: commandType === "create_receipt"
          ? resultId
          : null,
      });
    } catch (commandFailure) {
      const failureCode = commandFailure instanceof BusinessError ||
          commandFailure instanceof ConflictError
        ? commandFailure.code
        : "INTERNAL_PROCESSING_FAILURE";
      const { error: commandFailureUpdateError } = await this.client.from(
        "automation_commands",
      ).update({
        status: "failed",
        failure_code: failureCode,
        failed_at: this.now().toISOString(),
      }).eq("id", command.id);
      if (commandFailureUpdateError) throw commandFailureUpdateError;
      await this.createException(auth.companyId, {
        mailbox_id: command.mailbox_id,
        message_id: command.message_id,
        attachment_id: command.attachment_id,
        command_id: command.id,
        reason_code: commandType === "create_invoice"
          ? "invoice_conflict"
          : "receipt_conflict",
        lifecycle_status: "retryable",
        safe_details: { error_code: failureCode },
        actor_user_id: auth.userId,
      });
      throw commandFailure;
    }
  }

  private async proposeAndAllocateReceipt(
    auth: AuthContext,
    command: Row,
    extraction: FinancialExtraction,
  ): Promise<Row | null> {
    if (
      extraction.document_type !== "receipt" ||
      !command.id ||
      !(command.resulting_receipt_id ?? command.resulting_record_id)
    ) {
      return null;
    }
    const receiptId = String(
      command.resulting_receipt_id ?? command.resulting_record_id,
    );
    const { data: receiptRaw, error: receiptError } = await this.client
      .from("receipts")
      .select("id,customer_id,currency,status,unallocated_amount")
      .eq("id", receiptId)
      .eq("company_id", auth.companyId)
      .maybeSingle();
    if (receiptError) throw receiptError;
    const receipt = requiredId(receiptRaw as Row | null, "Receipt", receiptId);
    const references = [
      ...new Set(
        extraction.invoice_references.map((value) => value.trim()).filter(
          Boolean,
        ),
      ),
    ].slice(0, 100);
    let invoices: Row[];
    if (references.length > 0) {
      const { data, error } = await this.client.from("invoices")
        .select("id,invoice_no,customer_id,currency,status,outstanding")
        .eq("company_id", auth.companyId)
        .eq("customer_id", receipt.customer_id)
        .eq("currency", receipt.currency)
        .in("status", ["Open", "Overdue", "Partially Paid"])
        .in("invoice_no", references)
        .order("invoice_no", { ascending: true })
        .order("id", { ascending: true })
        .limit(101);
      if (error) throw error;
      invoices = (data ?? []) as Row[];
    } else {
      const available = monetaryMinorUnits(receipt.unallocated_amount);
      if (available <= 0n) return null;
      const { data, error } = await this.client.from("invoices")
        .select("id,invoice_no,customer_id,currency,status,outstanding")
        .eq("company_id", auth.companyId)
        .eq("customer_id", receipt.customer_id)
        .eq("currency", receipt.currency)
        .in("status", ["Open", "Overdue", "Partially Paid"])
        .eq("outstanding", minorUnitsDecimal(available))
        .order("invoice_no", { ascending: true })
        .order("id", { ascending: true })
        .limit(2);
      if (error) throw error;
      invoices = (data ?? []) as Row[];
    }
    const plan = buildAutomaticAllocationPlan({
      receipt_unallocated: receipt.unallocated_amount,
      invoice_references: references,
      payment_reference: extraction.reference_no,
      invoices,
    });
    if (!plan.ok) {
      await this.createAllocationException(
        auth,
        command,
        receiptId,
        "allocation_evidence_insufficient",
        plan.error_code,
      );
      return null;
    }
    return await this.persistAutomaticAllocation(auth, String(command.id), {
      receipt_id: receiptId,
      evidence_type: plan.evidence_type,
      evidence: plan.evidence,
      allocations: plan.allocations,
    });
  }

  private async createAllocationException(
    auth: AuthContext,
    command: Row,
    receiptId: string,
    reasonCode:
      | "allocation_evidence_insufficient"
      | "allocation_currency_mismatch"
      | "allocation_conflict"
      | "concurrency_conflict",
    errorCode: string,
  ): Promise<void> {
    await this.createException(auth.companyId, {
      mailbox_id: command.mailbox_id,
      message_id: command.message_id,
      attachment_id: command.attachment_id,
      command_id: command.id,
      receipt_id: receiptId,
      reason_code: reasonCode,
      lifecycle_status: "open",
      safe_details: { error_code: errorCode },
      actor_user_id: auth.userId,
    });
  }

  async allocateCommand(
    auth: AuthContext,
    commandId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Clerk", "AR Supervisor", "Finance Manager"]);
    validateUUID(commandId, "command_id");
    const { data: commandRaw, error } = await this.client
      .from("automation_commands")
      .select("*, extraction:automation_extraction_results(extracted_fields)")
      .eq("id", commandId)
      .eq("company_id", auth.companyId)
      .maybeSingle();
    if (error) throw error;
    const command = requiredId(
      commandRaw as Row | null,
      "AutomationCommand",
      commandId,
    );
    assertAutomaticAllocationCommandEligible(command);
    const extraction = command.extraction as Row | null;
    const extractedFields = extraction?.extracted_fields;
    if (
      !extractedFields || typeof extractedFields !== "object" ||
      Array.isArray(extractedFields)
    ) {
      throw new BusinessError(
        "ALLOCATION_EVIDENCE_INSUFFICIENT",
        "Stored document evidence is unavailable for automatic allocation.",
        409,
      );
    }
    const result = await this.proposeAndAllocateReceipt(
      auth,
      command,
      extractedFields as FinancialExtraction,
    );
    if (!result) {
      throw new BusinessError(
        "ALLOCATION_EVIDENCE_INSUFFICIENT",
        "Stored document evidence is insufficient for automatic allocation.",
        409,
      );
    }
    return allocationResultDto(commandId, result);
  }

  private async persistAutomaticAllocation(
    auth: AuthContext,
    commandId: string,
    input: Row,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Clerk", "AR Supervisor", "Finance Manager"]);
    validateUUID(commandId, "command_id");
    assertExactKeys(input, [
      "receipt_id",
      "evidence_type",
      "evidence",
      "allocations",
    ], ["receipt_id", "evidence_type", "evidence", "allocations"]);
    const receiptId = String(input.receipt_id);
    validateUUID(receiptId, "receipt_id");
    const evidenceTypes = [
      "exact_invoice_reference",
      "exact_amount_single_invoice",
      "explicit_partial_reference",
      "explicit_multi_invoice_references",
    ] as const;
    if (
      !evidenceTypes.includes(
        input.evidence_type as typeof evidenceTypes[number],
      )
    ) {
      throw new ValidationError("Unsupported allocation evidence_type.");
    }
    if (
      !input.evidence || typeof input.evidence !== "object" ||
      Array.isArray(input.evidence)
    ) {
      throw new ValidationError("evidence must be an object.");
    }
    const evidence = input.evidence as Row;
    assertExactKeys(evidence, [
      "invoice_references",
      "payment_reference",
      "source",
    ]);
    if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
      throw new ValidationError("allocations must be a non-empty array.");
    }
    if (input.allocations.length > 100) {
      throw new ValidationError("allocations must not exceed 100 entries.");
    }
    const allocations = input.allocations.map((candidate) => {
      if (
        !candidate || typeof candidate !== "object" || Array.isArray(candidate)
      ) {
        throw new ValidationError("Each allocation must be an object.");
      }
      const allocation = candidate as Row;
      assertExactKeys(allocation, [
        "invoice_id",
        "amount",
        "discount_amount",
      ], ["invoice_id", "amount"]);
      validateUUID(String(allocation.invoice_id), "invoice_id");
      for (const field of ["amount", "discount_amount"] as const) {
        if (allocation[field] === undefined) continue;
        if (
          typeof allocation[field] !== "string" ||
          !/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(
            allocation[field] as string,
          )
        ) {
          throw new ValidationError(
            `${field} must be a non-negative decimal string with at most two decimals.`,
          );
        }
      }
      if (/^0(?:\.0{1,2})?$/.test(String(allocation.amount))) {
        throw new ValidationError("amount must be greater than zero.");
      }
      return {
        invoice_id: allocation.invoice_id,
        amount: allocation.amount,
        discount_amount: allocation.discount_amount ?? "0.00",
      };
    }).sort((left, right) =>
      String(left.invoice_id).localeCompare(String(right.invoice_id))
    );
    const idempotencyKey = await sha256(canonicalJson({
      company_id: auth.companyId,
      command_id: commandId,
      receipt_id: receiptId,
      evidence_type: input.evidence_type,
      evidence,
      allocations,
      schema_version: 1,
    }));
    try {
      return await callRpc<Row>(
        this.client,
        "automation_allocate_receipt",
        {
          p_company_id: auth.companyId,
          p_actor_user_id: auth.userId,
          p_command_id: commandId,
          p_receipt_id: receiptId,
          p_evidence_type: input.evidence_type,
          p_evidence: evidence,
          p_allocations: allocations,
          p_idempotency_key: idempotencyKey,
        },
      );
    } catch (error) {
      const code =
        error instanceof BusinessError || error instanceof ConflictError
          ? error.code
          : "INTERNAL_PROCESSING_FAILURE";
      const reasonCode = code === "BR-AUTO-ALLOC-MISMATCH"
        ? "allocation_currency_mismatch"
        : code === "CONFLICT"
        ? "allocation_conflict"
        : code === "BR-AUTO-ALLOC-EVIDENCE" ||
            code === "BR-AUTO-FX-UNAVAILABLE"
        ? "allocation_evidence_insufficient"
        : "internal_processing_failure";
      await this.createException(auth.companyId, {
        command_id: commandId,
        receipt_id: receiptId,
        reason_code: reasonCode,
        lifecycle_status: "open",
        safe_details: { error_code: code },
        actor_user_id: auth.userId,
      });
      throw error;
    }
  }

  async retryException(auth: AuthContext, id: string): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(id, "id");
    const { data: exceptionRaw, error } = await this.client.from(
      "automation_exceptions",
    )
      .select("*").eq("id", id).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    const exception = requiredId(
      exceptionRaw as Row | null,
      "AutomationException",
      id,
    );
    if (
      exception.lifecycle_status !== "retryable" ||
      Number(exception.retry_count) >= Number(exception.max_retries)
    ) {
      throw new BusinessError(
        "EXCEPTION_NOT_RETRYABLE",
        "Automation exception is not retryable.",
        409,
      );
    }
    try {
      if (
        exception.command_id &&
        ["invoice_conflict", "receipt_conflict"].includes(
          String(exception.reason_code),
        )
      ) {
        const { data: command, error: commandError } = await this.client
          .from("automation_commands").select("extraction_id")
          .eq("id", exception.command_id).eq("company_id", auth.companyId)
          .maybeSingle();
        if (commandError) throw commandError;
        if (!command) {
          throw new NotFoundError(
            "AutomationCommand",
            String(exception.command_id),
          );
        }
        await this.executeCommand(auth, String(command.extraction_id));
      } else if (exception.attachment_id) {
        await this.processAttachment(auth, String(exception.attachment_id));
      } else if (
        exception.mailbox_id &&
        [
          "mailbox_reconnect_required",
          "provider_unavailable",
          "internal_processing_failure",
        ].includes(String(exception.reason_code))
      ) {
        await this.syncMailbox(auth, String(exception.mailbox_id));
      } else if (
        exception.invoice_id &&
        ["missing_salesman", "invalid_salesman_email"].includes(
          String(exception.reason_code),
        )
      ) {
        const { data: invoice, error: invoiceError } = await this.client
          .from("invoices").select("due_date")
          .eq("id", exception.invoice_id).eq("company_id", auth.companyId)
          .maybeSingle();
        if (invoiceError) throw invoiceError;
        if (!invoice) {
          throw new NotFoundError("Invoice", String(exception.invoice_id));
        }
        const details = exception.safe_details as Row;
        const offset = Number(details.stage_offset_days);
        if (!Number.isInteger(offset) || offset < -90 || offset > 0) {
          throw new BusinessError(
            "EXCEPTION_RETRY_CONTEXT_INVALID",
            "Reminder retry context is invalid.",
            409,
          );
        }
        const evaluation = new Date(`${invoice.due_date}T00:00:00.000Z`);
        evaluation.setUTCDate(evaluation.getUTCDate() + offset);
        await this.evaluateReminders(
          auth,
          evaluation.toISOString().slice(0, 10),
        );
      } else if (
        exception.reason_code === "provider_delivery_failed"
      ) {
        const details = exception.safe_details as Row;
        validateUUID(String(details.reminder_id), "reminder_id");
        validateUUID(String(details.mailbox_id), "mailbox_id");
        await this.deliverReminder(
          auth,
          String(details.reminder_id),
          String(details.mailbox_id),
        );
      } else {
        throw new BusinessError(
          "EXCEPTION_NOT_RETRYABLE",
          "Automation exception has no safe retry path.",
          409,
        );
      }
      const completedAt = this.now().toISOString();
      const { data, error: updateError } = await this.client.from(
        "automation_exceptions",
      ).update({
        lifecycle_status: "resolved",
        retry_count: Number(exception.retry_count) + 1,
        actor_user_id: auth.userId,
        resolution_note: "Authoritative retry completed successfully.",
        resolved_at: completedAt,
        updated_at: completedAt,
      }).eq("id", id).eq("company_id", auth.companyId).select("*").single();
      if (updateError) throw updateError;
      return exceptionDto(data as Row);
    } catch (retryError) {
      const { error: retryUpdateError } = await this.client.from(
        "automation_exceptions",
      ).update({
        lifecycle_status: "retryable",
        retry_count: Number(exception.retry_count) + 1,
        actor_user_id: auth.userId,
        updated_at: this.now().toISOString(),
      }).eq("id", id).eq("company_id", auth.companyId);
      if (retryUpdateError) throw retryUpdateError;
      throw retryError;
    }
  }

  async closeException(
    auth: AuthContext,
    id: string,
    lifecycle: "resolved" | "dismissed",
    note: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["AR Supervisor", "Finance Manager"]);
    validateUUID(id, "id");
    if (!note.trim()) throw new ValidationError("resolution_note is required.");
    const timestamp = this.now().toISOString();
    const { data, error } = await this.client.from("automation_exceptions")
      .update({
        lifecycle_status: lifecycle,
        resolution_note: note.trim().slice(0, 1000),
        actor_user_id: auth.userId,
        updated_at: timestamp,
        ...(lifecycle === "resolved"
          ? { resolved_at: timestamp }
          : { dismissed_at: timestamp }),
      }).eq("id", id).eq("company_id", auth.companyId).select("*")
      .maybeSingle();
    if (error) throw error;
    return exceptionDto(
      requiredId(data as Row | null, "AutomationException", id),
    );
  }

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
      !["draft_only", "straight_through"].includes(
        String(settings.operating_mode),
      ) ||
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
      mailbox.connection_status !== "connected" ||
      mailbox.delivery_enabled !== true ||
      mailbox.reconnect_required === true ||
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

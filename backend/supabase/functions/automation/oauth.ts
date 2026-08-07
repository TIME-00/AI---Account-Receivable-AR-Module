import { BusinessError, ValidationError } from "../_shared/errors.ts";
import {
  isSemanticIsoTimestamp,
  type MailboxProviderType,
} from "./contract.ts";
import { OAUTH_SCOPES } from "./providers.ts";
import type { SupabaseClient } from "supabase";

type Fetcher = typeof fetch;
const OAUTH_TIMEOUT_MS = 15_000;
const OAUTH_RESPONSE_LIMIT_BYTES = 1024 * 1024;

export interface OAuthClientConfiguration {
  provider: MailboxProviderType;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  tenant?: string;
}

export interface OAuthTokenSet {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope: string[];
  token_type: "Bearer";
}

export type OAuthCapability = "ingestion" | "delivery";

export interface OAuthSecretContext {
  company_id: string;
  mailbox_id: string;
  provider: MailboxProviderType;
  capability: OAuthCapability;
  secret_reference: string;
}

export interface OAuthSecretWriter {
  writeTokenSet(
    context: OAuthSecretContext,
    tokens: OAuthTokenSet,
  ): Promise<void>;
}

export interface OAuthSecretResolver {
  resolveTokenSet(context: OAuthSecretContext): Promise<OAuthTokenSet>;
  deleteTokenSet(context: OAuthSecretContext): Promise<void>;
}

export interface OAuthSecretStore
  extends OAuthSecretWriter, OAuthSecretResolver {
}

export class DisabledOAuthSecretWriter implements OAuthSecretStore {
  writeTokenSet(
    _context: OAuthSecretContext,
    _tokens: OAuthTokenSet,
  ): Promise<void> {
    return Promise.reject(
      new BusinessError(
        "OAUTH_SECRET_WRITER_DISABLED",
        "OAuth completion requires separately provisioned secure token storage.",
        503,
      ),
    );
  }

  resolveTokenSet(_context: OAuthSecretContext): Promise<OAuthTokenSet> {
    return Promise.reject(
      new BusinessError(
        "OAUTH_SECRET_RESOLVER_DISABLED",
        "OAuth token resolution requires separately provisioned secure storage.",
        503,
      ),
    );
  }

  deleteTokenSet(_context: OAuthSecretContext): Promise<void> {
    return Promise.reject(
      new BusinessError(
        "OAUTH_SECRET_WRITER_DISABLED",
        "OAuth token revocation requires separately provisioned secure storage.",
        503,
      ),
    );
  }
}

function contextKey(context: OAuthSecretContext): string {
  return [
    context.company_id,
    context.mailbox_id,
    context.provider,
    context.capability,
    context.secret_reference,
  ].join(":");
}

export class FixtureOAuthSecretWriter implements OAuthSecretStore {
  readonly writes: Array<{
    context: OAuthSecretContext;
    tokens: OAuthTokenSet;
  }> = [];
  readonly deletes: OAuthSecretContext[] = [];
  private readonly values = new Map<string, OAuthTokenSet>();

  writeTokenSet(
    context: OAuthSecretContext,
    tokens: OAuthTokenSet,
  ): Promise<void> {
    assertOAuthSecretContext(context);
    const copy = structuredClone(tokens);
    this.writes.push({ context: structuredClone(context), tokens: copy });
    this.values.set(contextKey(context), copy);
    return Promise.resolve();
  }

  resolveTokenSet(context: OAuthSecretContext): Promise<OAuthTokenSet> {
    assertOAuthSecretContext(context);
    const value = this.values.get(contextKey(context));
    if (!value) {
      return Promise.reject(
        new BusinessError(
          "OAUTH_SECRET_UNAVAILABLE",
          "OAuth authorization must be reconnected.",
          409,
        ),
      );
    }
    return Promise.resolve(structuredClone(value));
  }

  deleteTokenSet(context: OAuthSecretContext): Promise<void> {
    assertOAuthSecretContext(context);
    this.values.delete(contextKey(context));
    this.deletes.push(structuredClone(context));
    return Promise.resolve();
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_REFERENCE_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/;
const STORED_OAUTH_SCHEMA_VERSION = "gate-e-oauth.1";

function assertOAuthSecretContext(context: OAuthSecretContext): void {
  if (
    !UUID_PATTERN.test(context.company_id) ||
    !UUID_PATTERN.test(context.mailbox_id) ||
    !["gmail", "microsoft"].includes(context.provider) ||
    !["ingestion", "delivery"].includes(context.capability) ||
    !SECRET_REFERENCE_PATTERN.test(context.secret_reference)
  ) {
    throw new ValidationError("OAuth secret context is invalid.");
  }
}

function assertOAuthTokenSet(value: unknown): OAuthTokenSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BusinessError(
      "OAUTH_SECRET_INVALID",
      "OAuth authorization must be reconnected.",
      409,
    );
  }
  const record = value as Record<string, unknown>;
  const exactKeys = Object.keys(record).sort();
  if (
    JSON.stringify(exactKeys) !== JSON.stringify([
        "access_token",
        "expires_at",
        "refresh_token",
        "scope",
        "token_type",
      ]) ||
    typeof record.access_token !== "string" ||
    record.access_token.length < 8 ||
    record.access_token.length > 16_384 ||
    (record.refresh_token !== null &&
      (typeof record.refresh_token !== "string" ||
        record.refresh_token.length < 8 ||
        record.refresh_token.length > 16_384)) ||
    !isSemanticIsoTimestamp(record.expires_at) ||
    !Array.isArray(record.scope) ||
    record.scope.length > 20 ||
    record.scope.some((scope) =>
      typeof scope !== "string" || scope.length === 0 || scope.length > 512
    ) ||
    record.token_type !== "Bearer"
  ) {
    throw new BusinessError(
      "OAUTH_SECRET_INVALID",
      "OAuth authorization must be reconnected.",
      409,
    );
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token as string | null,
    expires_at: record.expires_at,
    scope: [...record.scope] as string[],
    token_type: "Bearer",
  };
}

export function serializeOAuthTokenSet(tokens: OAuthTokenSet): string {
  const valid = assertOAuthTokenSet(tokens);
  return JSON.stringify({
    schema_version: STORED_OAUTH_SCHEMA_VERSION,
    tokens: valid,
  });
}

export function parseStoredOAuthTokenSet(payload: unknown): OAuthTokenSet {
  let parsed: unknown;
  try {
    parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    throw new BusinessError(
      "OAUTH_SECRET_INVALID",
      "OAuth authorization must be reconnected.",
      409,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BusinessError(
      "OAUTH_SECRET_INVALID",
      "OAuth authorization must be reconnected.",
      409,
    );
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.schema_version !== STORED_OAUTH_SCHEMA_VERSION ||
    Object.keys(record).length !== 2 ||
    !("tokens" in record)
  ) {
    throw new BusinessError(
      "OAUTH_SECRET_INVALID",
      "OAuth authorization must be reconnected.",
      409,
    );
  }
  return assertOAuthTokenSet(record.tokens);
}

export class VaultOAuthSecretStore implements OAuthSecretStore {
  constructor(private readonly client: SupabaseClient) {}

  private parameters(context: OAuthSecretContext): Record<string, unknown> {
    assertOAuthSecretContext(context);
    return {
      p_company_id: context.company_id,
      p_mailbox_id: context.mailbox_id,
      p_provider_type: context.provider,
      p_capability: context.capability,
      p_secret_reference: context.secret_reference,
    };
  }

  async writeTokenSet(
    context: OAuthSecretContext,
    tokens: OAuthTokenSet,
  ): Promise<void> {
    const { error } = await this.client.rpc("automation_oauth_secret_write", {
      ...this.parameters(context),
      p_secret_payload: serializeOAuthTokenSet(tokens),
    });
    if (error) {
      throw new BusinessError(
        "OAUTH_SECRET_WRITE_FAILED",
        "OAuth authorization could not be stored securely.",
        503,
      );
    }
  }

  async resolveTokenSet(context: OAuthSecretContext): Promise<OAuthTokenSet> {
    const { data, error } = await this.client.rpc(
      "automation_oauth_secret_resolve",
      this.parameters(context),
    );
    if (error) {
      throw new BusinessError(
        "OAUTH_SECRET_RESOLUTION_FAILED",
        "OAuth secure storage is temporarily unavailable.",
        503,
      );
    }
    if (typeof data !== "string") {
      throw new BusinessError(
        "OAUTH_SECRET_UNAVAILABLE",
        "OAuth authorization must be reconnected.",
        409,
      );
    }
    return parseStoredOAuthTokenSet(data);
  }

  async deleteTokenSet(context: OAuthSecretContext): Promise<void> {
    const { error } = await this.client.rpc(
      "automation_oauth_secret_delete",
      this.parameters(context),
    );
    if (error) {
      throw new BusinessError(
        "OAUTH_SECRET_DELETE_FAILED",
        "OAuth authorization could not be revoked safely.",
        503,
      );
    }
  }
}

export function buildOAuthAuthorizationUrl(input: {
  configuration: OAuthClientConfiguration;
  state: string;
  capability: "ingestion" | "delivery";
}): string {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.state)) {
    throw new ValidationError("OAuth state is invalid.");
  }
  const { configuration } = input;
  const scopes = configuration.provider === "gmail"
    ? input.capability === "ingestion"
      ? OAUTH_SCOPES.gmail_ingestion
      : OAUTH_SCOPES.gmail_delivery
    : input.capability === "ingestion"
    ? OAUTH_SCOPES.microsoft_ingestion
    : OAUTH_SCOPES.microsoft_delivery;
  if (configuration.provider === "gmail") {
    const query = new URLSearchParams({
      client_id: configuration.client_id,
      redirect_uri: configuration.redirect_uri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      state: input.state,
      scope: scopes.join(" "),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  }
  const tenant = configuration.tenant ?? "common";
  if (!/^[A-Za-z0-9.-]{1,100}$/.test(tenant)) {
    throw new ValidationError("Microsoft tenant is invalid.");
  }
  const query = new URLSearchParams({
    client_id: configuration.client_id,
    redirect_uri: configuration.redirect_uri,
    response_type: "code",
    response_mode: "query",
    state: input.state,
    scope: scopes.join(" "),
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${query}`;
}

export function validateOAuthRedirectUri(
  provider: MailboxProviderType,
  value: string | undefined,
  expectedBaseUrl: string | undefined,
): string {
  if (!value || value.length > 2048 || !expectedBaseUrl) {
    throw new BusinessError(
      "OAUTH_NOT_CONFIGURED",
      "OAuth provider configuration has not been provisioned.",
      503,
    );
  }
  let url: URL;
  let expectedOrigin: string;
  try {
    url = new URL(value);
    const base = new URL(expectedBaseUrl);
    if (
      base.protocol !== "https:" || base.username !== "" ||
      base.password !== "" || base.search !== "" || base.hash !== ""
    ) {
      throw new Error("invalid base URL");
    }
    expectedOrigin = base.origin;
  } catch {
    throw new BusinessError(
      "OAUTH_NOT_CONFIGURED",
      "OAuth provider configuration is invalid.",
      503,
    );
  }
  const expectedPath = provider === "gmail"
    ? "/functions/v1/automation/oauth/gmail/callback"
    : "/functions/v1/automation/oauth/microsoft/callback";
  if (
    url.protocol !== "https:" ||
    url.origin !== expectedOrigin ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.pathname !== expectedPath ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new BusinessError(
      "OAUTH_NOT_CONFIGURED",
      "OAuth provider configuration is invalid.",
      503,
    );
  }
  return url.toString();
}

function parseTokenResponse(
  value: unknown,
  now: Date,
): OAuthTokenSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BusinessError(
      "OAUTH_RESPONSE_INVALID",
      "OAuth provider response was invalid.",
      502,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.access_token !== "string" ||
    record.access_token.length < 8 ||
    record.access_token.length > 16_384 ||
    record.token_type !== "Bearer" ||
    !Number.isInteger(record.expires_in) ||
    Number(record.expires_in) < 60 ||
    Number(record.expires_in) > 86_400 ||
    (record.refresh_token !== undefined &&
      (typeof record.refresh_token !== "string" ||
        record.refresh_token.length < 8 ||
        record.refresh_token.length > 16_384)) ||
    (record.scope !== undefined &&
      (typeof record.scope !== "string" || record.scope.length > 8_192))
  ) {
    throw new BusinessError(
      "OAUTH_RESPONSE_INVALID",
      "OAuth provider response was invalid.",
      502,
    );
  }
  return {
    access_token: record.access_token,
    refresh_token: typeof record.refresh_token === "string"
      ? record.refresh_token
      : null,
    expires_at: new Date(now.getTime() + Number(record.expires_in) * 1000)
      .toISOString(),
    scope: typeof record.scope === "string"
      ? record.scope.split(/\s+/).filter(Boolean)
      : [],
    token_type: "Bearer",
  };
}

export async function exchangeOAuthCode(input: {
  configuration: OAuthClientConfiguration;
  code: string;
  fetcher?: Fetcher;
  now?: Date;
}): Promise<OAuthTokenSet> {
  if (!/^[^\s]{8,4096}$/.test(input.code)) {
    throw new ValidationError("OAuth authorization code is invalid.");
  }
  const { configuration } = input;
  const fetcher = input.fetcher ?? fetch;
  const tokenUrl = configuration.provider === "gmail"
    ? "https://oauth2.googleapis.com/token"
    : `https://login.microsoftonline.com/${
      configuration.tenant ?? "common"
    }/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: configuration.client_id,
    client_secret: configuration.client_secret,
    code: input.code,
    redirect_uri: configuration.redirect_uri,
    grant_type: "authorization_code",
  });
  let response: Response;
  try {
    response = await fetcher(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new BusinessError(
        "PROVIDER_UNAVAILABLE",
        "OAuth token exchange timed out.",
        503,
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new BusinessError(
      response.status === 400 || response.status === 401
        ? "OAUTH_RECONNECT_REQUIRED"
        : "PROVIDER_UNAVAILABLE",
      "OAuth token exchange failed.",
      response.status === 400 || response.status === 401 ? 409 : 503,
      { provider_status: response.status },
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > OAUTH_RESPONSE_LIMIT_BYTES
  ) {
    throw new BusinessError(
      "OAUTH_RESPONSE_INVALID",
      "OAuth provider response was invalid.",
      502,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > OAUTH_RESPONSE_LIMIT_BYTES) {
    throw new BusinessError(
      "OAUTH_RESPONSE_INVALID",
      "OAuth provider response was invalid.",
      502,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BusinessError(
      "OAUTH_RESPONSE_INVALID",
      "OAuth provider response was invalid.",
      502,
    );
  }
  return parseTokenResponse(value, input.now ?? new Date());
}

export async function refreshOAuthTokens(input: {
  configuration: OAuthClientConfiguration;
  current: OAuthTokenSet;
  fetcher?: Fetcher;
  now?: Date;
}): Promise<OAuthTokenSet> {
  const current = assertOAuthTokenSet(input.current);
  if (!current.refresh_token) {
    throw new BusinessError(
      "OAUTH_RECONNECT_REQUIRED",
      "OAuth authorization must be reconnected.",
      409,
    );
  }
  const { configuration } = input;
  const tokenUrl = configuration.provider === "gmail"
    ? "https://oauth2.googleapis.com/token"
    : `https://login.microsoftonline.com/${
      configuration.tenant ?? "common"
    }/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: configuration.client_id,
    client_secret: configuration.client_secret,
    refresh_token: current.refresh_token,
    grant_type: "refresh_token",
  });
  if (configuration.provider === "microsoft") {
    body.set("scope", current.scope.join(" "));
  }
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new BusinessError(
        "PROVIDER_UNAVAILABLE",
        "OAuth token refresh timed out.",
        503,
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new BusinessError(
      response.status === 400 || response.status === 401
        ? "OAUTH_RECONNECT_REQUIRED"
        : "PROVIDER_UNAVAILABLE",
      response.status === 400 || response.status === 401
        ? "OAuth authorization must be reconnected."
        : "OAuth token refresh failed.",
      response.status === 400 || response.status === 401 ? 409 : 503,
      { provider_status: response.status },
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > OAUTH_RESPONSE_LIMIT_BYTES
  ) {
    throw new BusinessError(
      "OAUTH_RESPONSE_INVALID",
      "OAuth provider response was invalid.",
      502,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > OAUTH_RESPONSE_LIMIT_BYTES) {
    throw new BusinessError(
      "OAUTH_RESPONSE_INVALID",
      "OAuth provider response was invalid.",
      502,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BusinessError(
      "OAUTH_RESPONSE_INVALID",
      "OAuth provider response was invalid.",
      502,
    );
  }
  const refreshed = parseTokenResponse(value, input.now ?? new Date());
  const scope = refreshed.scope.length > 0
    ? [...refreshed.scope]
    : [...current.scope];
  if (
    configuration.provider === "microsoft" &&
    current.scope.some((value) => value.toLowerCase() === "offline_access") &&
    !scope.some((value) => value.toLowerCase() === "offline_access")
  ) {
    scope.push("offline_access");
  }
  return {
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? current.refresh_token,
    scope,
  };
}

export async function completeOAuthCallback(input: {
  configuration: OAuthClientConfiguration;
  code: string;
  secret_context: OAuthSecretContext;
  required_scopes: readonly string[];
  writer: OAuthSecretWriter;
  fetcher?: Fetcher;
  now?: Date;
}): Promise<
  { secret_reference: string; expires_at: string; scopes: string[] }
> {
  assertOAuthSecretContext(input.secret_context);
  if (input.secret_context.provider !== input.configuration.provider) {
    throw new ValidationError("OAuth secret provider is invalid.");
  }
  const exchangedTokens = await exchangeOAuthCode(input);
  const missingScopes = input.required_scopes.filter((scope) =>
    scope.toLowerCase() === "offline_access"
      ? !exchangedTokens.refresh_token
      : !exchangedTokens.scope.some((granted) =>
        granted.toLowerCase() === scope.toLowerCase()
      )
  );
  if (missingScopes.length > 0) {
    throw new BusinessError(
      "OAUTH_SCOPE_INSUFFICIENT",
      "OAuth consent did not grant the required capability.",
      409,
      { missing_scopes: missingScopes },
    );
  }
  if (!exchangedTokens.refresh_token) {
    throw new BusinessError(
      "OAUTH_REFRESH_TOKEN_REQUIRED",
      "OAuth consent did not provide renewable offline authorization.",
      409,
    );
  }
  const tokens = input.configuration.provider === "microsoft" &&
      input.required_scopes.some((scope) =>
        scope.toLowerCase() === "offline_access"
      ) &&
      !exchangedTokens.scope.some((scope) =>
        scope.toLowerCase() === "offline_access"
      )
    ? {
      ...exchangedTokens,
      scope: [...exchangedTokens.scope, "offline_access"],
    }
    : exchangedTokens;
  await input.writer.writeTokenSet(input.secret_context, tokens);
  return {
    secret_reference: input.secret_context.secret_reference,
    expires_at: tokens.expires_at,
    scopes: tokens.scope,
  };
}

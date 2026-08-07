import { BusinessError, ValidationError } from "../_shared/errors.ts";
import type { MailboxProviderType } from "./contract.ts";
import { OAUTH_SCOPES } from "./providers.ts";

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

export interface OAuthSecretWriter {
  writeTokenSet(referenceName: string, tokens: OAuthTokenSet): Promise<void>;
}

export class DisabledOAuthSecretWriter implements OAuthSecretWriter {
  writeTokenSet(
    _referenceName: string,
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
}

export class FixtureOAuthSecretWriter implements OAuthSecretWriter {
  readonly writes: Array<{ referenceName: string; tokens: OAuthTokenSet }> = [];
  writeTokenSet(
    referenceName: string,
    tokens: OAuthTokenSet,
  ): Promise<void> {
    this.writes.push({ referenceName, tokens: structuredClone(tokens) });
    return Promise.resolve();
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
      include_granted_scopes: "true",
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

export async function completeOAuthCallback(input: {
  configuration: OAuthClientConfiguration;
  code: string;
  secret_reference: string;
  required_scopes: readonly string[];
  writer: OAuthSecretWriter;
  fetcher?: Fetcher;
  now?: Date;
}): Promise<
  { secret_reference: string; expires_at: string; scopes: string[] }
> {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(input.secret_reference)) {
    throw new ValidationError("OAuth secret reference is invalid.");
  }
  const tokens = await exchangeOAuthCode(input);
  const missingScopes = input.required_scopes.filter((scope) =>
    !tokens.scope.some((granted) =>
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
  await input.writer.writeTokenSet(input.secret_reference, tokens);
  return {
    secret_reference: input.secret_reference,
    expires_at: tokens.expires_at,
    scopes: tokens.scope,
  };
}

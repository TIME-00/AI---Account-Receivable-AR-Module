import type { AuthContext } from "../_shared/auth.ts";
import { requireAnyRole } from "../_shared/auth.ts";
import { BusinessError, ValidationError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import {
  assertExactKeys,
  type AutomationOAuthIntent,
  type MailboxProviderType,
  normalizeEmail,
  requireBoundedText,
} from "./contract.ts";
import {
  buildOAuthAuthorizationUrl,
  completeOAuthCallback,
  type OAuthCapability,
  serializeOAuthTokenSet,
} from "./oauth.ts";
import { mailboxDto } from "./dto.ts";
import {
  boundedOAuthAuthorizationUrl,
  deliverySecretReference,
  tokenExpiryIsCurrent,
} from "./authority.ts";
import {
  requiredId,
  type Row,
  sha256,
  throwMailboxPersistenceError,
} from "./service-base.ts";
import { AutomationDirectoryService } from "./directory-service.ts";
export abstract class AutomationMailboxService
  extends AutomationDirectoryService {
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
      delivery_reconnect_required: false,
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
      (next.delivery_reconnect_required === true ||
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
      patch.delivery_reconnect_required = false;
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
    requestedIntent?: AutomationOAuthIntent,
  ): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    validateUUID(mailboxId, "mailbox_id");
    const { data: mailboxRaw, error } = await this.client
      .from("automation_mailboxes").select("*")
      .eq("id", mailboxId).eq("company_id", auth.companyId).maybeSingle();
    if (error) throw error;
    let mailbox = requiredId(
      mailboxRaw as Row | null,
      "Mailbox",
      mailboxId,
    );
    const intent: AutomationOAuthIntent = capability === "delivery"
      ? requestedIntent === "reconnect_delivery"
        ? "reconnect_delivery"
        : "enable_delivery"
      : "connect_capability";
    if (capability === "delivery" && !mailbox.delivery_secret_ref) {
      const reference = deliverySecretReference(mailboxId);
      const { data: assignedRaw, error: assignmentError } = await this.client
        .from("automation_mailboxes").update({
          delivery_secret_ref: reference,
          updated_by: auth.userId,
          updated_at: this.now().toISOString(),
        }).eq("id", mailboxId).eq("company_id", auth.companyId)
        .is("delivery_secret_ref", null).select("*").maybeSingle();
      if (assignmentError) throwMailboxPersistenceError(assignmentError);
      if (assignedRaw) {
        mailbox = assignedRaw as Row;
      } else {
        const { data: refreshedRaw, error: refreshedError } = await this.client
          .from("automation_mailboxes").select("*").eq("id", mailboxId)
          .eq("company_id", auth.companyId).maybeSingle();
        if (refreshedError) throw refreshedError;
        mailbox = requiredId(
          refreshedRaw as Row | null,
          "Mailbox",
          mailboxId,
        );
        if (!mailbox.delivery_secret_ref) {
          throw new BusinessError(
            "SECRET_REFERENCE_UNAVAILABLE",
            "Mailbox delivery authorization could not be prepared safely.",
            503,
          );
        }
      }
    }
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
    if (capability === "delivery") {
      const { error: invalidateError } = await this.client.from(
        "automation_oauth_states",
      ).update({ consumed_at: this.now().toISOString() })
        .eq("company_id", auth.companyId).eq("mailbox_id", mailboxId)
        .eq("provider_type", provider).is("consumed_at", null)
        .in("oauth_intent", ["enable_delivery", "reconnect_delivery"]);
      if (invalidateError) throw invalidateError;
    }
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
      oauth_intent: intent,
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
      intent,
    };
  }

  async enableMailboxDelivery(
    auth: AuthContext,
    mailboxId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    validateUUID(mailboxId, "mailbox_id");
    const { data: mailboxRaw, error } = await this.client.from(
      "automation_mailboxes",
    ).select("*").eq("id", mailboxId).eq("company_id", auth.companyId)
      .maybeSingle();
    if (error) throw error;
    const mailbox = requiredId(mailboxRaw as Row | null, "Mailbox", mailboxId);
    if (mailbox.delivery_enabled === true) {
      return { outcome: "enabled", mailbox: mailboxDto(mailbox) };
    }
    if (mailbox.delivery_secret_ref) {
      try {
        await this.resolveOAuthAccessTokenForRuntime(mailbox, "delivery");
        const { data: enabledRaw, error: enabledError } = await this.client
          .from("automation_mailboxes").update({
            delivery_enabled: true,
            delivery_reconnect_required: false,
            updated_by: auth.userId,
            updated_at: this.now().toISOString(),
          }).eq("id", mailboxId).eq("company_id", auth.companyId)
          .select("*").maybeSingle();
        if (enabledError) throwMailboxPersistenceError(enabledError);
        return {
          outcome: "enabled",
          mailbox: mailboxDto(
            requiredId(enabledRaw as Row | null, "Mailbox", mailboxId),
          ),
        };
      } catch (caught) {
        if (
          !(caught instanceof BusinessError) ||
          ![
            "OAUTH_SECRET_UNAVAILABLE",
            "OAUTH_SECRET_INVALID",
            "OAUTH_SECRET_RESOLUTION_FAILED",
            "OAUTH_RECONNECT_REQUIRED",
          ].includes(caught.code)
        ) throw caught;
      }
    }
    return {
      outcome: "oauth_required",
      ...(await this.beginOAuth(
        auth,
        mailboxId,
        "delivery",
        "enable_delivery",
      )),
    };
  }

  async reconnectMailboxDelivery(
    auth: AuthContext,
    mailboxId: string,
  ): Promise<Row> {
    return {
      outcome: "oauth_required",
      ...(await this.beginOAuth(
        auth,
        mailboxId,
        "delivery",
        "reconnect_delivery",
      )),
    };
  }

  async disableMailboxDelivery(
    auth: AuthContext,
    mailboxId: string,
  ): Promise<Row> {
    requireAnyRole(auth, ["Finance Manager", "System Admin"]);
    validateUUID(mailboxId, "mailbox_id");
    const disabledAt = this.now().toISOString();
    const { error: invalidateError } = await this.client.from(
      "automation_oauth_states",
    ).update({ consumed_at: disabledAt }).eq("company_id", auth.companyId)
      .eq("mailbox_id", mailboxId).is("consumed_at", null)
      .in("oauth_intent", ["enable_delivery", "reconnect_delivery"]);
    if (invalidateError) throw invalidateError;
    const { data, error } = await this.client.from("automation_mailboxes")
      .update({
        delivery_enabled: false,
        delivery_reconnect_required: false,
        updated_by: auth.userId,
        updated_at: disabledAt,
      }).eq("id", mailboxId).eq("company_id", auth.companyId).select("*")
      .maybeSingle();
    if (error) throwMailboxPersistenceError(error);
    return mailboxDto(requiredId(data as Row | null, "Mailbox", mailboxId));
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
    const intent = String(
      oauthState.oauth_intent ?? "connect_capability",
    ) as AutomationOAuthIntent;
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
      writer: capability === "delivery" &&
          ["enable_delivery", "reconnect_delivery"].includes(intent)
        ? {
          writeTokenSet: async (context, tokens) => {
            const { error: finalizeError } = await this.client.rpc(
              "automation_oauth_delivery_finalize",
              {
                p_state_id: oauthState.id,
                p_company_id: companyId,
                p_mailbox_id: String(mailbox.id),
                p_provider_type: provider,
                p_actor_user_id: oauthState.created_by,
                p_oauth_intent: intent,
                p_secret_reference: context.secret_reference,
                p_secret_payload: serializeOAuthTokenSet(tokens),
                p_token_expires_at: tokens.expires_at,
              },
            );
            if (finalizeError) {
              throw new BusinessError(
                "OAUTH_DELIVERY_FINALIZE_FAILED",
                "Mailbox delivery authorization could not be activated safely.",
                503,
              );
            }
          },
        }
        : this.oauthSecretStore,
      fetcher: this.oauthFetcher,
      now: this.now(),
    });
    if (
      capability !== "delivery" ||
      !["enable_delivery", "reconnect_delivery"].includes(intent)
    ) {
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
    }
    return {
      mailbox_id: mailbox.id,
      provider,
      capability,
      connection_status: "connected",
      token_expires_at: result.expires_at,
      granted_scopes: result.scopes,
      intent,
      delivery_enabled: capability === "delivery" &&
        ["enable_delivery", "reconnect_delivery"].includes(intent),
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
    ).select("id,company_id,mailbox_id,expires_at,consumed_at,oauth_intent")
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
    const deliveryIntent = ["enable_delivery", "reconnect_delivery"].includes(
      String(oauthState.oauth_intent),
    );
    const { error: mailboxError } = await this.client.from(
      "automation_mailboxes",
    ).update(
      deliveryIntent
        ? {
          delivery_enabled: false,
          delivery_reconnect_required: true,
          updated_at: claimedAt,
        }
        : {
          connection_status: "error",
          reconnect_required: true,
          redacted_error_code: "OAUTH_PROVIDER_DENIED",
          updated_at: claimedAt,
        },
    ).eq("id", oauthState.mailbox_id).eq(
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
}

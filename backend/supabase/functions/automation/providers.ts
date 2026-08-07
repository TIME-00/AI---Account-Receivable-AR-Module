import { BusinessError, ValidationError } from "../_shared/errors.ts";
import { type MailboxProviderType, safeErrorCode } from "./contract.ts";

export interface SecretResolver {
  resolve(referenceName: string): Promise<string>;
}

export class DisabledSecretResolver implements SecretResolver {
  resolve(_referenceName: string): Promise<string> {
    return Promise.reject(
      new BusinessError(
        "SECRET_RESOLUTION_DISABLED",
        "Provider secret resolution is disabled.",
        503,
      ),
    );
  }
}

export class EnvironmentSecretResolver implements SecretResolver {
  resolve(referenceName: string): Promise<string> {
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(referenceName)) {
      return Promise.reject(
        new BusinessError(
          "SECRET_REFERENCE_INVALID",
          "Secret reference is invalid.",
          503,
        ),
      );
    }
    const value = Deno.env.get(referenceName);
    if (!value) {
      return Promise.reject(
        new BusinessError(
          "SECRET_REFERENCE_UNAVAILABLE",
          "The provider connection requires secure provisioning.",
          503,
        ),
      );
    }
    return Promise.resolve(value);
  }
}

export class FixtureSecretResolver implements SecretResolver {
  constructor(private readonly values: Readonly<Record<string, string>>) {}
  resolve(referenceName: string): Promise<string> {
    const value = this.values[referenceName];
    if (!value) return Promise.reject(new Error("fixture secret missing"));
    return Promise.resolve(value);
  }
}

export interface ProviderAttachment {
  provider_attachment_id: string;
  file_name: string;
  content_type: string;
  size: number;
  bytes?: Uint8Array;
}

export interface ProviderMessage {
  provider_message_id: string;
  provider_thread_id: string | null;
  internet_message_id: string | null;
  received_at: string;
  sender_address: string | null;
  subject: string | null;
  mime_type: string | null;
  revision: string | null;
  attachments: ProviderAttachment[];
}

export interface MailboxSyncPage {
  provider: MailboxProviderType;
  messages: ProviderMessage[];
  next_page_token: string | null;
  completed_cursor: string | null;
  cursor_invalid: boolean;
}

export interface MailboxProvider {
  readonly type: MailboxProviderType;
  readiness(): { ready: boolean; code: string };
  syncPage(input: {
    accessToken: string;
    cursor: string | null;
    pageToken: string | null;
  }): Promise<MailboxSyncPage>;
  getAttachment(input: {
    accessToken: string;
    messageId: string;
    attachmentId: string;
  }): Promise<Uint8Array>;
}

type Fetcher = typeof fetch;
const PROVIDER_TIMEOUT_MS = 15_000;
const PROVIDER_JSON_LIMIT_BYTES = 16 * 1024 * 1024;

async function providerFetch(
  fetcher: Fetcher,
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetcher(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new BusinessError(
        "PROVIDER_UNAVAILABLE",
        "Mailbox provider request timed out.",
        503,
      );
    }
    throw error;
  }
}

async function providerJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new BusinessError(
      response.status === 401 || response.status === 403
        ? "MAILBOX_RECONNECT_REQUIRED"
        : response.status === 429 || response.status >= 500
        ? "PROVIDER_UNAVAILABLE"
        : "PROVIDER_REQUEST_REJECTED",
      "Mailbox provider request failed.",
      response.status === 401 || response.status === 403 ? 409 : 503,
      { provider_status: response.status },
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > PROVIDER_JSON_LIMIT_BYTES
  ) {
    throw new BusinessError(
      "PROVIDER_RESPONSE_INVALID",
      "Mailbox provider response exceeded the supported size.",
      502,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > PROVIDER_JSON_LIMIT_BYTES) {
    throw new BusinessError(
      "PROVIDER_RESPONSE_INVALID",
      "Mailbox provider response exceeded the supported size.",
      502,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BusinessError(
      "PROVIDER_RESPONSE_INVALID",
      "Mailbox provider response was invalid.",
      502,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BusinessError(
      "PROVIDER_RESPONSE_INVALID",
      "Mailbox provider response was invalid.",
      502,
    );
  }
  return value as Record<string, unknown>;
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    throw new BusinessError(
      "PROVIDER_RESPONSE_INVALID",
      "Provider attachment encoding was invalid.",
      502,
    );
  }
}

function headerValue(
  headers: unknown,
  name: string,
): string | null {
  if (!Array.isArray(headers)) return null;
  const found = headers.find((item) =>
    item && typeof item === "object" &&
    String((item as Record<string, unknown>).name).toLowerCase() ===
      name.toLowerCase()
  ) as Record<string, unknown> | undefined;
  return found && typeof found.value === "string" ? found.value : null;
}

export class GmailMailboxProvider implements MailboxProvider {
  readonly type = "gmail" as const;
  constructor(private readonly fetcher: Fetcher = fetch) {}

  readiness() {
    return { ready: true, code: "READY" };
  }

  async syncPage(input: {
    accessToken: string;
    cursor: string | null;
    pageToken: string | null;
  }): Promise<MailboxSyncPage> {
    const query = new URLSearchParams({ maxResults: "100" });
    let url: string;
    if (input.cursor) {
      query.set("startHistoryId", input.cursor);
      if (input.pageToken) query.set("pageToken", input.pageToken);
      url = `https://gmail.googleapis.com/gmail/v1/users/me/history?${query}`;
    } else {
      query.set("q", "has:attachment");
      if (input.pageToken) query.set("pageToken", input.pageToken);
      url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`;
    }

    const response = await providerFetch(this.fetcher, url, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    if (response.status === 404 && input.cursor) {
      return {
        provider: this.type,
        messages: [],
        next_page_token: null,
        completed_cursor: null,
        cursor_invalid: true,
      };
    }
    const body = await providerJson(response);
    const ids = new Set<string>();
    if (input.cursor && Array.isArray(body.history)) {
      for (const history of body.history) {
        const record = history as Record<string, unknown>;
        for (
          const collection of [
            record.messagesAdded,
            record.labelsAdded,
            record.labelsRemoved,
          ]
        ) {
          if (!Array.isArray(collection)) continue;
          for (const item of collection) {
            const message = (item as Record<string, unknown>).message;
            if (message && typeof message === "object") {
              const id = (message as Record<string, unknown>).id;
              if (typeof id === "string") ids.add(id);
            }
          }
        }
      }
    } else if (Array.isArray(body.messages)) {
      for (const item of body.messages) {
        const id = (item as Record<string, unknown>).id;
        if (typeof id === "string") ids.add(id);
      }
    }

    const messages: ProviderMessage[] = [];
    for (const id of [...ids].sort()) {
      const detail = await providerJson(
        await providerFetch(
          this.fetcher,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${
            encodeURIComponent(id)
          }?format=full`,
          { headers: { Authorization: `Bearer ${input.accessToken}` } },
        ),
      );
      const payload = detail.payload as Record<string, unknown> | undefined;
      const headers = payload?.headers;
      const attachments: ProviderAttachment[] = [];
      const walk = (part: unknown): void => {
        if (!part || typeof part !== "object") return;
        const record = part as Record<string, unknown>;
        const bodyPart = record.body as Record<string, unknown> | undefined;
        if (typeof bodyPart?.attachmentId === "string") {
          attachments.push({
            provider_attachment_id: bodyPart.attachmentId,
            file_name: typeof record.filename === "string"
              ? record.filename
              : "attachment",
            content_type: typeof record.mimeType === "string"
              ? record.mimeType
              : "application/octet-stream",
            size: typeof bodyPart.size === "number" ? bodyPart.size : 0,
          });
        } else if (
          typeof record.filename === "string" && record.filename.length > 0 &&
          typeof bodyPart?.data === "string"
        ) {
          attachments.push({
            provider_attachment_id: `inline:${
              typeof record.partId === "string"
                ? record.partId
                : attachments.length
            }`,
            file_name: record.filename,
            content_type: typeof record.mimeType === "string"
              ? record.mimeType
              : "application/octet-stream",
            size: typeof bodyPart.size === "number" ? bodyPart.size : 0,
            bytes: base64UrlBytes(bodyPart.data),
          });
        }
        if (Array.isArray(record.parts)) record.parts.forEach(walk);
      };
      walk(payload);
      messages.push({
        provider_message_id: id,
        provider_thread_id: typeof detail.threadId === "string"
          ? detail.threadId
          : null,
        internet_message_id: headerValue(headers, "Message-ID"),
        received_at: new Date(Number(detail.internalDate ?? Date.now()))
          .toISOString(),
        sender_address: headerValue(headers, "From"),
        subject: headerValue(headers, "Subject"),
        mime_type: typeof payload?.mimeType === "string"
          ? payload.mimeType
          : null,
        revision: typeof detail.historyId === "string"
          ? detail.historyId
          : null,
        attachments,
      });
    }
    const next = typeof body.nextPageToken === "string"
      ? body.nextPageToken
      : null;
    let completedCursor = typeof body.historyId === "string"
      ? body.historyId
      : input.cursor;
    if (!next && !input.cursor && !completedCursor) {
      const profile = await providerJson(
        await providerFetch(
          this.fetcher,
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          { headers: { Authorization: `Bearer ${input.accessToken}` } },
        ),
      );
      if (typeof profile.historyId !== "string") {
        throw new BusinessError(
          "PROVIDER_RESPONSE_INVALID",
          "Gmail initial history state was missing.",
          502,
        );
      }
      completedCursor = profile.historyId;
    }
    return {
      provider: this.type,
      messages,
      next_page_token: next,
      completed_cursor: next ? null : completedCursor,
      cursor_invalid: false,
    };
  }

  async getAttachment(input: {
    accessToken: string;
    messageId: string;
    attachmentId: string;
  }): Promise<Uint8Array> {
    const body = await providerJson(
      await providerFetch(
        this.fetcher,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${
          encodeURIComponent(input.messageId)
        }/attachments/${encodeURIComponent(input.attachmentId)}`,
        { headers: { Authorization: `Bearer ${input.accessToken}` } },
      ),
    );
    if (typeof body.data !== "string") {
      throw new BusinessError(
        "PROVIDER_RESPONSE_INVALID",
        "Gmail attachment data was missing.",
        502,
      );
    }
    return base64UrlBytes(body.data);
  }
}

export class MicrosoftMailboxProvider implements MailboxProvider {
  readonly type = "microsoft" as const;
  constructor(private readonly fetcher: Fetcher = fetch) {}

  readiness() {
    return { ready: true, code: "READY" };
  }

  async syncPage(input: {
    accessToken: string;
    cursor: string | null;
    pageToken: string | null;
  }): Promise<MailboxSyncPage> {
    const url = input.pageToken ?? input.cursor ??
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,internetMessageId,receivedDateTime,from,subject,hasAttachments,changeKey&$top=100";
    if (!url.startsWith("https://graph.microsoft.com/v1.0/")) {
      throw new ValidationError(
        "Microsoft delta cursor is not an approved Graph URL.",
      );
    }
    const response = await providerFetch(this.fetcher, url, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    if ((response.status === 404 || response.status === 410) && input.cursor) {
      return {
        provider: this.type,
        messages: [],
        next_page_token: null,
        completed_cursor: null,
        cursor_invalid: true,
      };
    }
    const body = await providerJson(response);
    const messages: ProviderMessage[] = [];
    for (const raw of Array.isArray(body.value) ? body.value : []) {
      const record = raw as Record<string, unknown>;
      if (record["@removed"]) continue;
      if (
        typeof record.id !== "string" ||
        typeof record.receivedDateTime !== "string"
      ) {
        throw new BusinessError(
          "PROVIDER_RESPONSE_INVALID",
          "Microsoft message was invalid.",
          502,
        );
      }
      const attachments: ProviderAttachment[] = [];
      if (record.hasAttachments === true) {
        const attachmentBody = await providerJson(
          await providerFetch(
            this.fetcher,
            `https://graph.microsoft.com/v1.0/me/messages/${
              encodeURIComponent(record.id)
            }/attachments?$select=id,name,contentType,size`,
            { headers: { Authorization: `Bearer ${input.accessToken}` } },
          ),
        );
        for (
          const item of Array.isArray(attachmentBody.value)
            ? attachmentBody.value
            : []
        ) {
          const attachment = item as Record<string, unknown>;
          if (typeof attachment.id === "string") {
            attachments.push({
              provider_attachment_id: attachment.id,
              file_name: typeof attachment.name === "string"
                ? attachment.name
                : "attachment",
              content_type: typeof attachment.contentType === "string"
                ? attachment.contentType
                : "application/octet-stream",
              size: typeof attachment.size === "number" ? attachment.size : 0,
            });
          }
        }
      }
      const from = record.from as Record<string, unknown> | undefined;
      const address = from?.emailAddress as Record<string, unknown> | undefined;
      messages.push({
        provider_message_id: record.id,
        provider_thread_id: null,
        internet_message_id: typeof record.internetMessageId === "string"
          ? record.internetMessageId
          : null,
        received_at: new Date(record.receivedDateTime).toISOString(),
        sender_address: typeof address?.address === "string"
          ? address.address
          : null,
        subject: typeof record.subject === "string" ? record.subject : null,
        mime_type: "message/rfc822",
        revision: typeof record.changeKey === "string"
          ? record.changeKey
          : null,
        attachments,
      });
    }
    const next = typeof body["@odata.nextLink"] === "string"
      ? body["@odata.nextLink"]
      : null;
    const delta = typeof body["@odata.deltaLink"] === "string"
      ? body["@odata.deltaLink"]
      : null;
    if (!next && !delta) {
      throw new BusinessError(
        "PROVIDER_RESPONSE_INVALID",
        "Microsoft delta state was missing.",
        502,
      );
    }
    return {
      provider: this.type,
      messages,
      next_page_token: next,
      completed_cursor: next ? null : delta,
      cursor_invalid: false,
    };
  }

  async getAttachment(input: {
    accessToken: string;
    messageId: string;
    attachmentId: string;
  }): Promise<Uint8Array> {
    const body = await providerJson(
      await providerFetch(
        this.fetcher,
        `https://graph.microsoft.com/v1.0/me/messages/${
          encodeURIComponent(input.messageId)
        }/attachments/${encodeURIComponent(input.attachmentId)}`,
        { headers: { Authorization: `Bearer ${input.accessToken}` } },
      ),
    );
    if (typeof body.contentBytes !== "string") {
      throw new BusinessError(
        "PROVIDER_RESPONSE_INVALID",
        "Microsoft attachment data was missing.",
        502,
      );
    }
    try {
      return Uint8Array.from(
        atob(body.contentBytes),
        (char) => char.charCodeAt(0),
      );
    } catch {
      throw new BusinessError(
        "PROVIDER_RESPONSE_INVALID",
        "Microsoft attachment encoding was invalid.",
        502,
      );
    }
  }
}

export interface DeliveryRequest {
  accessToken: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  textBody: string;
  idempotencyKey: string;
}

export interface DeliveryResult {
  provider_message_id: string | null;
  accepted: true;
}

export interface ReminderDeliveryProvider {
  readonly type: MailboxProviderType;
  readiness(): { ready: boolean; code: string };
  send(request: DeliveryRequest): Promise<DeliveryResult>;
}

function assertReminderContent(request: DeliveryRequest): void {
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.toAddress) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.fromAddress) ||
    /[\r\n]/.test(request.subject) ||
    !/^[0-9a-f]{64}$/.test(request.idempotencyKey)
  ) {
    throw new ValidationError("Reminder delivery headers are invalid.");
  }
  if (request.textBody.length > 4000 || request.subject.length > 200) {
    throw new ValidationError(
      "Reminder content exceeds the bounded delivery contract.",
    );
  }
  if (/attachment|bank account|password|secret/i.test(request.textBody)) {
    throw new ValidationError("Reminder content includes prohibited material.");
  }
}

export class GmailDeliveryProvider implements ReminderDeliveryProvider {
  readonly type = "gmail" as const;
  constructor(private readonly fetcher: Fetcher = fetch) {}
  readiness() {
    return { ready: true, code: "READY" };
  }
  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    assertReminderContent(request);
    const mime = [
      `From: ${request.fromAddress}`,
      `To: ${request.toAddress}`,
      `Subject: ${request.subject}`,
      "Content-Type: text/plain; charset=UTF-8",
      `X-AR-Idempotency-Key: ${request.idempotencyKey}`,
      "",
      request.textBody,
    ].join("\r\n");
    const raw = btoa(unescape(encodeURIComponent(mime)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    let response: Response;
    try {
      response = await providerFetch(
        this.fetcher,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${request.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
        },
      );
    } catch {
      throw new BusinessError(
        "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED",
        "Gmail reminder delivery outcome could not be confirmed.",
        409,
      );
    }
    if (!response.ok) {
      if (response.status === 429) {
        throw new BusinessError(
          "PROVIDER_DELIVERY_RETRYABLE",
          "Gmail reminder delivery was throttled before acceptance.",
          503,
        );
      }
      if (response.status >= 500) {
        throw new BusinessError(
          "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED",
          "Gmail reminder delivery outcome could not be confirmed.",
          409,
        );
      }
      throw new BusinessError(
        "PROVIDER_DELIVERY_REJECTED",
        "Gmail reminder delivery was rejected.",
        response.status === 401 || response.status === 403 ? 409 : 400,
      );
    }
    let body: Record<string, unknown>;
    try {
      body = await providerJson(response);
    } catch {
      // A successful provider status followed by a malformed/lost response is
      // not safe to retry automatically: the message may already exist.
      throw new BusinessError(
        "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED",
        "Gmail reminder delivery outcome could not be confirmed.",
        409,
      );
    }
    if (typeof body.id !== "string") {
      throw new BusinessError(
        "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED",
        "Gmail reminder delivery outcome could not be confirmed.",
        409,
      );
    }
    return { provider_message_id: body.id, accepted: true };
  }
}

export class MicrosoftDeliveryProvider implements ReminderDeliveryProvider {
  readonly type = "microsoft" as const;
  constructor(private readonly fetcher: Fetcher = fetch) {}
  readiness() {
    return { ready: true, code: "READY" };
  }
  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    assertReminderContent(request);
    let response: Response;
    try {
      response = await providerFetch(
        this.fetcher,
        "https://graph.microsoft.com/v1.0/me/sendMail",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${request.accessToken}`,
            "Content-Type": "application/json",
            "client-request-id": request.idempotencyKey,
          },
          body: JSON.stringify({
            message: {
              subject: request.subject,
              body: { contentType: "Text", content: request.textBody },
              toRecipients: [{
                emailAddress: { address: request.toAddress },
              }],
            },
            saveToSentItems: true,
          }),
        },
      );
    } catch {
      throw new BusinessError(
        "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED",
        "Microsoft reminder delivery outcome could not be confirmed.",
        409,
      );
    }
    if (!response.ok) {
      throw new BusinessError(
        response.status === 429
          ? "PROVIDER_DELIVERY_RETRYABLE"
          : response.status >= 500
          ? "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED"
          : "PROVIDER_DELIVERY_REJECTED",
        response.status >= 500
          ? "Microsoft reminder delivery outcome could not be confirmed."
          : "Microsoft reminder delivery failed.",
        response.status === 429 ? 503 : 409,
      );
    }
    return {
      // Graph sendMail returns 202 with no message resource identifier. The
      // attempt ledger retains the idempotency key; no synthetic message ID is
      // presented as provider evidence.
      provider_message_id: null,
      accepted: true,
    };
  }
}

export class DisabledDeliveryProvider implements ReminderDeliveryProvider {
  constructor(readonly type: MailboxProviderType) {}
  readiness() {
    return { ready: false, code: "REMINDER_DELIVERY_DISABLED" };
  }
  send(_request: DeliveryRequest): Promise<DeliveryResult> {
    return Promise.reject(
      new BusinessError(
        "REMINDER_DELIVERY_DISABLED",
        "Reminder delivery is disabled.",
        409,
      ),
    );
  }
}

export function classifyProviderFailure(error: unknown): {
  retryable: boolean;
  code: string;
} {
  if (error instanceof BusinessError) {
    return {
      retryable: [
        "PROVIDER_UNAVAILABLE",
        "PROVIDER_DELIVERY_RETRYABLE",
      ].includes(error.code),
      code: safeErrorCode(error.code),
    };
  }
  return { retryable: false, code: "INTERNAL_PROCESSING_FAILURE" };
}

export const OAUTH_SCOPES = {
  gmail_ingestion: ["https://www.googleapis.com/auth/gmail.readonly"],
  gmail_delivery: ["https://www.googleapis.com/auth/gmail.send"],
  microsoft_ingestion: ["offline_access", "Mail.Read"],
  microsoft_delivery: ["offline_access", "Mail.Send"],
} as const;

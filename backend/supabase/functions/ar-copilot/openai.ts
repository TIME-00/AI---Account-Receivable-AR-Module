import { BusinessError, ValidationError } from "../_shared/errors.ts";
import {
  DEFAULT_OPENAI_DOCUMENT_MODEL,
  OPENAI_RESPONSES_ENDPOINT,
  validateOpenAIDocumentModel,
} from "../automation/openai-document.ts";
import { AR_COPILOT_POLICY } from "./policy.ts";
import { COPILOT_TOOL_DEFINITIONS } from "./tools.ts";

export const DEFAULT_OPENAI_COPILOT_MODEL = DEFAULT_OPENAI_DOCUMENT_MODEL;
export const OPENAI_COPILOT_TIMEOUT_MS = 20_000;
export const OPENAI_COPILOT_MAX_OUTPUT_TOKENS = 1_200;
const OPENAI_COPILOT_MAX_ATTEMPTS = 2;
const OPENAI_RESPONSE_MAX_BYTES = 256 * 1024;

export type CopilotModelInputItem = Record<string, unknown>;

export interface CopilotModelToolCall {
  call_id: string;
  name: string;
  arguments: string;
  replay_item?: CopilotModelInputItem;
}

export type CopilotModelTurn =
  | { type: "answer"; answer: string }
  | { type: "tool_calls"; calls: CopilotModelToolCall[] };

export interface CopilotModelProvider {
  readonly provider: "openai";
  readonly model: string;
  turn(
    input: CopilotModelInputItem[],
    context?: CopilotModelTurnContext,
  ): Promise<CopilotModelTurn>;
}

export interface CopilotModelTurnContext {
  requestId: string;
  phase: "initial_openai" | "post_tool_openai";
  round: number;
}

export interface CopilotProviderDiagnostic {
  request_id: string;
  phase: CopilotModelTurnContext["phase"];
  round: number;
  attempt: number;
  provider_http_status: number | null;
  provider_error_category: string | null;
  latency_ms: number;
}

export interface OpenAICopilotOptions {
  apiKey: string;
  model?: string | null;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  sleeper?: (milliseconds: number) => Promise<void>;
  recordDiagnostic?: (event: CopilotProviderDiagnostic) => void;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function providerUnavailable(
  message = "Assistant temporarily unavailable.",
): BusinessError {
  return new BusinessError("COPILOT_UNAVAILABLE", message, 503);
}

function providerInvalid(): BusinessError {
  return new BusinessError(
    "COPILOT_RESPONSE_UNVERIFIED",
    "The requested information could not be verified.",
    502,
  );
}

function validateApiKey(value: string): string {
  const key = value.trim();
  const unsafeCharacter = [...key].some((character) => {
    const code = character.charCodeAt(0);
    return /\s/.test(character) || code <= 0x1f || code === 0x7f;
  });
  if (key.length < 20 || key.length > 512 || unsafeCharacter) {
    throw new ValidationError(
      "OpenAI Copilot provider configuration is invalid.",
    );
  }
  return key;
}

export function validateOpenAICopilotModel(value?: string | null): string {
  return validateOpenAIDocumentModel(value ?? DEFAULT_OPENAI_COPILOT_MODEL);
}

export function buildOpenAICopilotRequest(
  model: string,
  input: CopilotModelInputItem[],
): JsonRecord {
  return {
    model,
    instructions: AR_COPILOT_POLICY,
    input,
    reasoning: { effort: "none" },
    tools: COPILOT_TOOL_DEFINITIONS,
    tool_choice: "auto",
    parallel_tool_calls: false,
    max_output_tokens: OPENAI_COPILOT_MAX_OUTPUT_TOKENS,
    store: false,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > OPENAI_RESPONSE_MAX_BYTES) {
    await response.body?.cancel();
    throw providerInvalid();
  }
  if (!response.body) throw providerInvalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OPENAI_RESPONSE_MAX_BYTES) {
      await reader.cancel();
      throw providerInvalid();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } catch {
    throw providerInvalid();
  }
}

function parseTurn(value: unknown): CopilotModelTurn {
  const payload = record(value);
  if (!payload || !Array.isArray(payload.output)) throw providerInvalid();
  const calls: CopilotModelToolCall[] = [];
  const text: string[] = [];
  for (const rawItem of payload.output) {
    const item = record(rawItem);
    if (!item) throw providerInvalid();
    if (item.type === "function_call") {
      if (
        typeof item.call_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(item.call_id) ||
        typeof item.name !== "string" || item.name.length > 80 ||
        typeof item.arguments !== "string"
      ) throw providerInvalid();
      calls.push({
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
        replay_item: {
          type: "function_call",
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        },
      });
      continue;
    }
    if (item.type === "message") {
      if (!Array.isArray(item.content)) throw providerInvalid();
      for (const rawContent of item.content) {
        const content = record(rawContent);
        if (!content) throw providerInvalid();
        if (
          content.type === "output_text" && typeof content.text === "string"
        ) {
          text.push(content.text);
        }
      }
    }
  }
  if (calls.length > 0 && text.join("").trim()) throw providerInvalid();
  if (calls.length > 0) return { type: "tool_calls", calls };
  const answer = text.join("\n").trim();
  if (!answer) throw providerInvalid();
  return { type: "answer", answer };
}

function retryable(status: number): boolean {
  return status === 429 || [500, 502, 503, 504].includes(status);
}

const OPENAI_ERROR_MAX_BYTES = 16 * 1024;

async function readProviderErrorCategory(response: Response): Promise<string> {
  let code = "";
  let type = "";
  let parameter = "";
  try {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > OPENAI_ERROR_MAX_BYTES) {
      await response.body?.cancel();
    } else if (response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > OPENAI_ERROR_MAX_BYTES) {
          await reader.cancel();
          chunks.length = 0;
          break;
        }
        chunks.push(value);
      }
      if (chunks.length > 0) {
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const payload = record(JSON.parse(new TextDecoder().decode(joined)));
        const error = record(payload?.error);
        code = typeof error?.code === "string" ? error.code.toLowerCase() : "";
        type = typeof error?.type === "string" ? error.type.toLowerCase() : "";
        parameter = typeof error?.param === "string"
          ? error.param.toLowerCase()
          : "";
      }
    }
  } catch {
    // Provider bodies are never exposed. HTTP status remains the authority.
  }
  if (response.status === 429) {
    return code === "insufficient_quota" || type === "insufficient_quota"
      ? "quota_exhausted"
      : "rate_limit";
  }
  if (
    response.status === 400 &&
    (code.includes("model_not_found") || code.includes("invalid_model"))
  ) return "invalid_model";
  if (
    response.status === 400 &&
    (code === "invalid_function_parameters" ||
      (type === "invalid_request_error" &&
        /^(?:tools|tool_choice)(?:\[|\.|$)/.test(parameter)))
  ) return "invalid_tool_schema";
  if (response.status === 400) return "invalid_request";
  if (response.status === 401) return "provider_authentication";
  if (response.status === 403) return "provider_permission";
  if (response.status >= 500) return "provider_upstream";
  return "provider_http_error";
}

export class OpenAICopilotProvider implements CopilotModelProvider {
  readonly provider = "openai" as const;
  readonly model: string;
  readonly #apiKey: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #sleeper: (milliseconds: number) => Promise<void>;
  readonly #recordDiagnostic: (event: CopilotProviderDiagnostic) => void;

  constructor(options: OpenAICopilotOptions) {
    this.#apiKey = validateApiKey(options.apiKey);
    this.model = validateOpenAICopilotModel(options.model);
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? OPENAI_COPILOT_TIMEOUT_MS;
    this.#maxAttempts = options.maxAttempts ?? OPENAI_COPILOT_MAX_ATTEMPTS;
    this.#sleeper = options.sleeper ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#recordDiagnostic = options.recordDiagnostic ??
      ((event) =>
        console.info(
          JSON.stringify({ event: "ar_copilot_provider", ...event }),
        ));
    if (
      !Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 ||
      this.#timeoutMs > OPENAI_COPILOT_TIMEOUT_MS ||
      !Number.isSafeInteger(this.#maxAttempts) || this.#maxAttempts < 1 ||
      this.#maxAttempts > OPENAI_COPILOT_MAX_ATTEMPTS
    ) throw new ValidationError("OpenAI Copilot provider bounds are invalid.");
  }

  async turn(
    input: CopilotModelInputItem[],
    context?: CopilotModelTurnContext,
  ): Promise<CopilotModelTurn> {
    const body = JSON.stringify(buildOpenAICopilotRequest(this.model, input));
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const started = Date.now();
      const requestId = context?.requestId ?? "untracked";
      const phase = context?.phase ?? "initial_openai";
      const round = context?.round ?? 0;
      const diagnose = (
        providerHttpStatus: number | null,
        providerErrorCategory: string | null,
      ) =>
        this.#recordDiagnostic({
          request_id: requestId,
          phase,
          round,
          attempt,
          provider_http_status: providerHttpStatus,
          provider_error_category: providerErrorCategory,
          latency_ms: Math.max(0, Date.now() - started),
        });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        let response: Response;
        try {
          response = await this.#fetcher(OPENAI_RESPONSES_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.#apiKey}`,
              "Content-Type": "application/json",
            },
            body,
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            diagnose(null, "timeout");
            throw providerUnavailable();
          }
          if (attempt < this.#maxAttempts && error instanceof TypeError) {
            diagnose(null, "network_error_retry");
            await this.#sleeper(250);
            continue;
          }
          diagnose(null, "network_error");
          throw providerUnavailable();
        }
        if (!response.ok) {
          const category = await readProviderErrorCategory(response);
          diagnose(response.status, category);
          if (attempt < this.#maxAttempts && retryable(response.status)) {
            await this.#sleeper(250);
            continue;
          }
          if (response.status === 429) {
            throw new BusinessError(
              "COPILOT_LIMIT_EXCEEDED",
              "Assistant request limit reached. Please retry shortly.",
              429,
            );
          }
          throw providerUnavailable();
        }
        if (
          !(response.headers.get("content-type") ?? "").toLowerCase()
            .startsWith("application/json")
        ) {
          await response.body?.cancel();
          diagnose(response.status, "invalid_content_type");
          throw providerInvalid();
        }
        try {
          const turn = parseTurn(await readBoundedJson(response));
          diagnose(response.status, null);
          return turn;
        } catch (error) {
          diagnose(response.status, "invalid_response");
          throw error;
        }
      } catch (error) {
        if (controller.signal.aborted) throw providerUnavailable();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw providerUnavailable();
  }
}

export function createOpenAICopilotProvider(configuration: {
  apiKey?: string | null;
  model?: string | null;
}): CopilotModelProvider {
  if (!configuration.apiKey?.trim()) throw providerUnavailable();
  try {
    return new OpenAICopilotProvider({
      apiKey: configuration.apiKey,
      model: configuration.model,
    });
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw providerUnavailable();
  }
}

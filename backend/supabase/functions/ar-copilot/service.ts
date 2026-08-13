import type { AuthContext } from "../_shared/auth.ts";
import {
  AuthorizationError,
  BusinessError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import type {
  CopilotChatRequest,
  CopilotChatResponse,
  CopilotEvidence,
  CopilotLink,
  CopilotToolOutcome,
} from "./contract.ts";
import {
  COPILOT_MAX_TOOL_CALLS,
  COPILOT_MAX_TOOL_ROUNDS,
  validateCopilotAnswer,
} from "./contract.ts";
import type { CopilotModelInputItem, CopilotModelProvider } from "./openai.ts";
import { UNTRUSTED_CONTEXT_NOTICE } from "./policy.ts";
import type { CopilotReadServiceContract } from "./read-service.ts";
import {
  CopilotToolRegistry,
  isLiveDataTool,
  questionRequiresLiveData,
} from "./tools.ts";

export interface CopilotTelemetry {
  request_id: string;
  user_id: string;
  company_id: string;
  provider: "openai";
  model: string;
  success: boolean;
  tool_names: string[];
  tool_call_count: number;
  latency_ms: number;
  error_category: string | null;
}

export interface CopilotServiceDependencies {
  model: CopilotModelProvider;
  reads: CopilotReadServiceContract;
  requestId?: () => string;
  now?: () => number;
  recordTelemetry?: (event: CopilotTelemetry) => void;
}

function uniqueEvidence(items: CopilotEvidence[]): CopilotEvidence[] {
  const found = new Map<string, CopilotEvidence>();
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (!found.has(key) && found.size < 20) found.set(key, item);
  }
  return [...found.values()];
}

function uniqueLinks(items: CopilotLink[]): CopilotLink[] {
  const found = new Map<string, CopilotLink>();
  for (const item of items) {
    const key = `${item.entity_type}:${item.entity_id}:${item.href}`;
    if (!found.has(key) && found.size < 10) found.set(key, item);
  }
  return [...found.values()];
}

function errorCategory(error: unknown): string {
  if (error instanceof AuthorizationError) return "forbidden";
  if (error instanceof NotFoundError) return "context_not_found";
  if (error instanceof ValidationError) return "invalid_request";
  if (error instanceof BusinessError) return error.code.toLowerCase();
  return "internal";
}

function toolOutput(outcome: CopilotToolOutcome): string {
  return JSON.stringify({ data: outcome.data });
}

function contextInput(
  request: CopilotChatRequest,
  outcome: CopilotToolOutcome | null,
): CopilotModelInputItem {
  return {
    role: "user",
    content: [{
      type: "input_text",
      text: `${UNTRUSTED_CONTEXT_NOTICE}\n<untrusted_page_context>\n${
        JSON.stringify({
          page: request.context.page,
          entity: outcome?.data ?? null,
        })
      }\n</untrusted_page_context>`,
    }],
  };
}

export class CopilotService {
  readonly #model: CopilotModelProvider;
  readonly #reads: CopilotReadServiceContract;
  readonly #tools: CopilotToolRegistry;
  readonly #requestId: () => string;
  readonly #now: () => number;
  readonly #recordTelemetry: (event: CopilotTelemetry) => void;

  constructor(dependencies: CopilotServiceDependencies) {
    this.#model = dependencies.model;
    this.#reads = dependencies.reads;
    this.#tools = new CopilotToolRegistry(dependencies.reads);
    this.#requestId = dependencies.requestId ?? (() => crypto.randomUUID());
    this.#now = dependencies.now ?? (() => Date.now());
    this.#recordTelemetry = dependencies.recordTelemetry ??
      ((event) =>
        console.info(
          JSON.stringify({ event: "ar_copilot_request", ...event }),
        ));
  }

  async chat(
    auth: AuthContext,
    request: CopilotChatRequest,
  ): Promise<CopilotChatResponse> {
    const requestId = this.#requestId();
    const started = this.#now();
    const toolNames: string[] = [];
    let calls = 0;
    let success = false;
    let failure: unknown = null;
    try {
      let context: CopilotToolOutcome | null = null;
      if (request.context.entity_type && request.context.entity_id) {
        context = await this.#reads.validateContext(
          auth,
          request.context.entity_type,
          request.context.entity_id,
        );
      }
      const evidence: CopilotEvidence[] = [...(context?.evidence ?? [])];
      const links: CopilotLink[] = [...(context?.links ?? [])];
      const input: CopilotModelInputItem[] = request.messages.map((
        message,
      ) => ({
        role: message.role,
        content: [{ type: "input_text", text: message.content }],
      }));
      input.push(contextInput(request, context));
      const question = request.messages.at(-1)?.content ?? "";

      for (let round = 0; round <= COPILOT_MAX_TOOL_ROUNDS; round += 1) {
        const turn = await this.#model.turn(input);
        if (turn.type === "answer") {
          const usedLiveTool = toolNames.some(isLiveDataTool);
          const answer = questionRequiresLiveData(question) && !usedLiveTool
            ? "I cannot verify the current company information from system guidance alone. Please ask again so I can check the authorized live records."
            : validateCopilotAnswer(turn.answer);
          success = true;
          return {
            answer,
            evidence: uniqueEvidence(evidence),
            links: uniqueLinks(links),
            status: {
              request_id: requestId,
              provider: this.#model.provider,
              model: this.#model.model,
              tool_names: [...new Set(toolNames)],
              tool_call_count: calls,
            },
          };
        }
        if (round === COPILOT_MAX_TOOL_ROUNDS || turn.calls.length === 0) {
          throw new BusinessError(
            "COPILOT_RESPONSE_UNVERIFIED",
            "The requested information could not be verified.",
            502,
          );
        }
        if (calls + turn.calls.length > COPILOT_MAX_TOOL_CALLS) {
          throw new BusinessError(
            "COPILOT_LIMIT_EXCEEDED",
            "The assistant reached its read-tool limit.",
            429,
          );
        }
        for (const call of turn.calls) {
          let outcome: CopilotToolOutcome;
          try {
            outcome = await this.#tools.execute(
              auth,
              call.name,
              call.arguments,
            );
          } catch (error) {
            if (error instanceof AuthorizationError) throw error;
            if (error instanceof ValidationError) {
              throw new BusinessError(
                "COPILOT_RESPONSE_UNVERIFIED",
                "The requested information could not be verified.",
                502,
              );
            }
            throw error;
          }
          calls += 1;
          toolNames.push(call.name);
          evidence.push(...outcome.evidence);
          links.push(...outcome.links);
          input.push({
            type: "function_call",
            call_id: call.call_id,
            name: call.name,
            arguments: call.arguments,
          });
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: toolOutput(outcome),
          });
        }
      }
      throw new BusinessError(
        "COPILOT_RESPONSE_UNVERIFIED",
        "The requested information could not be verified.",
        502,
      );
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      this.#recordTelemetry({
        request_id: requestId,
        user_id: auth.userId,
        company_id: auth.companyId,
        provider: this.#model.provider,
        model: this.#model.model,
        success,
        tool_names: [...new Set(toolNames)],
        tool_call_count: calls,
        latency_ms: Math.max(0, this.#now() - started),
        error_category: failure ? errorCategory(failure) : null,
      });
    }
  }
}

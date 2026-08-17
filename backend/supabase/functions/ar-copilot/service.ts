import type { AuthContext } from "../_shared/auth.ts";
import {
  AuthorizationError,
  BusinessError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import type {
  CopilotArtifact,
  CopilotChatRequest,
  CopilotChatResponse,
  CopilotEvidence,
  CopilotLink,
  CopilotToolOutcome,
} from "./contract.ts";
import {
  COPILOT_MAX_ANALYTICAL_TOOL_CALLS,
  COPILOT_MAX_TOOL_CALLS,
  COPILOT_MAX_TOOL_ROUNDS,
  validateCopilotAnswer,
} from "./contract.ts";
import type { CopilotModelInputItem, CopilotModelProvider } from "./openai.ts";
import { UNTRUSTED_CONTEXT_NOTICE } from "./policy.ts";
import type { CopilotReadServiceContract } from "./read-service.ts";
import type { CopilotAnalystServiceContract } from "./analyst-service.ts";
import { ANALYST_TOOL_NAMES, type AnalystToolName } from "./analyst-tools.ts";
import { languageInstruction, selectCopilotLanguage } from "./language.ts";
import {
  liveEvidenceGrantsFromOutcome,
  questionMayNeedLiveEvidence,
  validatedContextGrant,
  verifyFinalAnswerLiveEvidence,
} from "./live-evidence.ts";
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

export interface CopilotPhaseTelemetry {
  request_id: string;
  phase: "tool_execution";
  round: number;
  tool_name: string;
  success: boolean;
  latency_ms: number;
  error_category: string | null;
}

export interface CopilotServiceDependencies {
  model: CopilotModelProvider;
  reads: CopilotReadServiceContract;
  analytics?: CopilotAnalystServiceContract;
  businessDate?: string | null;
  requestId?: () => string;
  now?: () => number;
  recordTelemetry?: (event: CopilotTelemetry) => void;
  recordPhaseTelemetry?: (event: CopilotPhaseTelemetry) => void;
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

function uniqueArtifacts(items: CopilotArtifact[]): CopilotArtifact[] {
  const found = new Map<string, CopilotArtifact>();
  for (const item of items) {
    const body = item.kind === "analysis"
      ? item.analysis
      : item.kind === "daily_brief"
      ? item.daily_brief
      : item.kind === "report"
      ? item.report
      : item.kind === "document_analysis"
      ? item.document_analysis
      : item.recovery_plan;
    const discriminator = item.kind === "analysis"
      ? body.analysis_type
      : item.kind === "report"
      ? body.report_type
      : item.kind === "document_analysis"
      ? body.document_id
      : item.kind === "recovery_plan"
      ? body.exception_id
      : body.as_of;
    const key = `${item.kind}:${String(discriminator ?? "default")}`;
    if (!found.has(key) && found.size < 4) found.set(key, item);
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

function responseUnverified(
  phase: string,
  round: number,
  options: { toolName?: string; errorCategory?: string } = {},
): BusinessError {
  return new BusinessError(
    "COPILOT_RESPONSE_UNVERIFIED",
    "The requested information could not be verified.",
    502,
    {
      phase,
      round,
      ...(options.toolName ? { tool_name: options.toolName } : {}),
      ...(options.errorCategory
        ? { error_category: options.errorCategory }
        : {}),
    },
  );
}

function toolOutput(outcome: CopilotToolOutcome): string {
  return JSON.stringify({ data: outcome.data });
}

function contextInput(
  request: CopilotChatRequest,
  outcome: CopilotToolOutcome | null,
  language: ReturnType<typeof selectCopilotLanguage>,
): CopilotModelInputItem {
  return {
    role: "user",
    content: `${
      languageInstruction(language)
    }\n${UNTRUSTED_CONTEXT_NOTICE}\n<untrusted_page_context>\n${
      JSON.stringify({
        page: request.context.page,
        entity: outcome?.data ?? null,
      })
    }\n</untrusted_page_context>`,
  };
}

export function conversationInput(
  request: CopilotChatRequest,
): CopilotModelInputItem[] {
  return request.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export class CopilotService {
  readonly #model: CopilotModelProvider;
  readonly #reads: CopilotReadServiceContract;
  readonly #tools: CopilotToolRegistry;
  readonly #requestId: () => string;
  readonly #now: () => number;
  readonly #recordTelemetry: (event: CopilotTelemetry) => void;
  readonly #recordPhaseTelemetry: (event: CopilotPhaseTelemetry) => void;
  readonly #businessDate: string | null;

  constructor(dependencies: CopilotServiceDependencies) {
    this.#model = dependencies.model;
    this.#reads = dependencies.reads;
    this.#tools = new CopilotToolRegistry(
      dependencies.reads,
      dependencies.analytics,
    );
    this.#businessDate = dependencies.businessDate ?? null;
    this.#requestId = dependencies.requestId ?? (() => crypto.randomUUID());
    this.#now = dependencies.now ?? (() => Date.now());
    this.#recordTelemetry = dependencies.recordTelemetry ??
      ((event) =>
        console.info(
          JSON.stringify({ event: "ar_copilot_request", ...event }),
        ));
    this.#recordPhaseTelemetry = dependencies.recordPhaseTelemetry ??
      ((event) =>
        console.info(
          JSON.stringify({ event: "ar_copilot_phase", ...event }),
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
    let analyticalCalls = 0;
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
      const artifacts: CopilotArtifact[] = [...(context?.artifacts ?? [])];
      const liveEvidenceGrants = validatedContextGrant(
        request.context,
        context,
      );
      const input = conversationInput(request);
      const question = request.messages.at(-1)?.content ?? "";
      const language = selectCopilotLanguage(question, request.messages);
      input.push(contextInput(request, context, language));
      const requiresLiveData = questionRequiresLiveData(question);
      const independentLiveSignal = questionMayNeedLiveEvidence(
        question,
        request.context,
      );
      const allowsLiveTools = requiresLiveData || independentLiveSignal ||
        context !== null;

      for (let round = 0; round <= COPILOT_MAX_TOOL_ROUNDS; round += 1) {
        const turn = await this.#model.turn(input, {
          requestId,
          phase: round === 0 ? "initial_openai" : "post_tool_openai",
          round,
        });
        if (turn.type === "answer") {
          const candidate = validateCopilotAnswer(turn.answer);
          const verification = verifyFinalAnswerLiveEvidence({
            question,
            answer: candidate,
            context: request.context,
            grants: liveEvidenceGrants,
          });
          const answer = verification.allowed
            ? candidate
            : "I cannot verify that without checking the authorized live AR records.";
          success = true;
          const structured = uniqueArtifacts(artifacts);
          return {
            answer,
            evidence: uniqueEvidence(evidence),
            links: uniqueLinks(links),
            ...(structured.length > 0 ? { artifacts: structured } : {}),
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
          throw responseUnverified("tool_loop", round, {
            errorCategory: "no_final_answer",
          });
        }
        if (calls + turn.calls.length > COPILOT_MAX_TOOL_CALLS) {
          throw new BusinessError(
            "COPILOT_LIMIT_EXCEEDED",
            "The assistant reached its read-tool limit.",
            429,
          );
        }
        const roundAnalyticalCalls = turn.calls.filter((call) =>
          ANALYST_TOOL_NAMES.includes(call.name as AnalystToolName)
        ).length;
        if (
          analyticalCalls + roundAnalyticalCalls >
            COPILOT_MAX_ANALYTICAL_TOOL_CALLS
        ) {
          throw new BusinessError(
            "COPILOT_LIMIT_EXCEEDED",
            "The assistant reached its analytical-tool limit.",
            429,
          );
        }
        const executed: Array<{
          call: typeof turn.calls[number];
          outcome: CopilotToolOutcome;
        }> = [];
        for (const call of turn.calls) {
          if (isLiveDataTool(call.name) && !allowsLiveTools) {
            throw responseUnverified("tool_authorization", round, {
              toolName: call.name,
              errorCategory: "live_tool_not_authorized_for_question",
            });
          }
          const toolStarted = this.#now();
          let outcome: CopilotToolOutcome;
          try {
            outcome = await this.#tools.execute(
              auth,
              call.name,
              call.arguments,
            );
          } catch (error) {
            this.#recordPhaseTelemetry({
              request_id: requestId,
              phase: "tool_execution",
              round,
              tool_name: call.name,
              success: false,
              latency_ms: Math.max(0, this.#now() - toolStarted),
              error_category: errorCategory(error),
            });
            if (error instanceof AuthorizationError) {
              throw error;
            }
            if (error instanceof ValidationError) {
              throw responseUnverified("tool_execution", round, {
                toolName: call.name,
                errorCategory: "validation_failure",
              });
            }
            throw error;
          }
          calls += 1;
          if (ANALYST_TOOL_NAMES.includes(call.name as AnalystToolName)) {
            analyticalCalls += 1;
          }
          toolNames.push(call.name);
          this.#recordPhaseTelemetry({
            request_id: requestId,
            phase: "tool_execution",
            round,
            tool_name: call.name,
            success: true,
            latency_ms: Math.max(0, this.#now() - toolStarted),
            error_category: null,
          });
          evidence.push(...outcome.evidence);
          links.push(...outcome.links);
          artifacts.push(...(outcome.artifacts ?? []));
          liveEvidenceGrants.push(
            ...liveEvidenceGrantsFromOutcome(call.name, outcome, {
              businessDate: this.#businessDate,
            }),
          );
          executed.push({ call, outcome });
        }
        for (const { call } of executed) {
          input.push(
            call.replay_item ?? {
              type: "function_call",
              call_id: call.call_id,
              name: call.name,
              arguments: call.arguments,
            },
          );
        }
        for (const { call, outcome } of executed) {
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: toolOutput(outcome),
          });
        }
      }
      throw responseUnverified("tool_loop", COPILOT_MAX_TOOL_ROUNDS, {
        errorCategory: "round_limit",
      });
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

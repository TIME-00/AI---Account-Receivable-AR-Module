import type { AuthContext } from "../_shared/auth.ts";
import { AuthorizationError, ValidationError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import type { CopilotToolOutcome } from "./contract.ts";
import type { CopilotAnalystServiceContract } from "./analyst-service.ts";
import { parseAnalystReportPlan } from "./analyst-contract.ts";

export const ANALYST_TOOL_NAMES = [
  "get_ar_priority_analysis",
  "get_customer_risk_analysis",
  "get_collection_health_analysis",
  "get_exposure_movement_analysis",
  "get_unapplied_cash_analysis",
  "get_root_cause_analysis",
  "get_daily_brief",
  "run_ar_report",
  "analyze_automation_document",
  "analyze_exception_recovery",
] as const;
export type AnalystToolName = typeof ANALYST_TOOL_NAMES[number];

const UUID_SCHEMA = { type: "string", format: "uuid" } as const;
const LIMIT_10 = { type: "integer", minimum: 1, maximum: 10 } as const;
const nullableDate = {
  anyOf: [{ type: "string", format: "date" }, { type: "null" }],
} as const;
const nullableChart = {
  anyOf: [{ type: "string", enum: ["bar", "line", "pie"] }, { type: "null" }],
} as const;

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

export const ANALYST_TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "get_ar_priority_analysis",
    description:
      "Return deterministic, reason-coded AR attention priorities from the caller's authorized scope. No AI risk score.",
    parameters: objectSchema({ limit: LIMIT_10 }, ["limit"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_customer_risk_analysis",
    description:
      "Explain the stored customer credit rating and current authorized overdue evidence without changing the rating.",
    parameters: objectSchema({ customer_id: UUID_SCHEMA }, ["customer_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_collection_health_analysis",
    description:
      "Compare bounded authoritative monthly collection points and return deterministic change factors.",
    parameters: objectSchema({
      months: { type: "integer", minimum: 2, maximum: 12 },
    }, ["months"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_exposure_movement_analysis",
    description:
      "Check whether authoritative historical overdue or aging evidence exists before explaining a movement. Returns insufficient evidence rather than inventing causality.",
    parameters: objectSchema({
      metric: { type: "string", enum: ["overdue", "aging"] },
    }, ["metric"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_unapplied_cash_analysis",
    description:
      "List bounded posted receipts with authoritative unapplied balances in the caller's authorized customer scope.",
    parameters: objectSchema({ limit: LIMIT_10 }, ["limit"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_root_cause_analysis",
    description:
      "Return direct stored factors for why an authorized customer, Invoice, Receipt, or Automation document needs attention. Never infer customer intent.",
    parameters: objectSchema({
      target_type: {
        type: "string",
        enum: ["customer", "invoice", "receipt", "automation_document"],
      },
      target_id: UUID_SCHEMA,
    }, ["target_type", "target_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_daily_brief",
    description:
      "Compute an on-demand deterministic Daily Brief from explicit AR conditions; no prompt or response is persisted.",
    parameters: objectSchema({
      limit: { type: "integer", minimum: 1, maximum: 8 },
    }, ["limit"]),
    strict: true,
  },
  {
    type: "function",
    name: "run_ar_report",
    description:
      "Execute a strictly allow-listed AR report plan. Never accepts SQL, table names, arbitrary columns, or unbounded rows.",
    parameters: objectSchema({
      report: {
        type: "string",
        enum: [
          "aging",
          "invoice_summary",
          "receipt_summary",
          "customer_outstanding",
          "collections",
          "overdue_exposure",
        ],
      },
      metrics: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [
            "invoice_count",
            "receipt_count",
            "total_amount",
            "outstanding_amount",
            "overdue_amount",
            "unapplied_amount",
            "collection_amount",
          ],
        },
      },
      dimensions: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [
            "customer",
            "status",
            "aging_bucket",
            "currency",
            "period",
            "credit_rating",
            "document",
          ],
        },
      },
      filters: {
        type: "array",
        maxItems: 4,
        items: objectSchema({
          field: {
            type: "string",
            enum: ["status", "currency", "credit_rating", "minimum_amount"],
          },
          operator: { type: "string", enum: ["eq", "gte"] },
          value: { type: "string", minLength: 1, maxLength: 80 },
        }, ["field", "operator", "value"]),
      },
      period: objectSchema({
        date_from: nullableDate,
        date_to: nullableDate,
        as_of_date: nullableDate,
      }, ["date_from", "date_to", "as_of_date"]),
      sort: {
        anyOf: [
          objectSchema({
            metric: {
              type: "string",
              enum: [
                "invoice_count",
                "receipt_count",
                "total_amount",
                "outstanding_amount",
                "overdue_amount",
                "unapplied_amount",
                "collection_amount",
              ],
            },
            direction: { type: "string", enum: ["asc", "desc"] },
          }, ["metric", "direction"]),
          { type: "null" },
        ],
      },
      limit: { type: "integer", minimum: 1, maximum: 50 },
      chart_type: nullableChart,
    }, [
      "report",
      "metrics",
      "dimensions",
      "filters",
      "period",
      "sort",
      "limit",
      "chart_type",
    ]),
    strict: true,
  },
  {
    type: "function",
    name: "analyze_automation_document",
    description:
      "Return safe field-level provenance, validation codes, and linked status for one authorized Automation document. Raw OCR, Gmail, attachments, and provider payloads are excluded.",
    parameters: objectSchema({ document_id: UUID_SCHEMA }, ["document_id"]),
    strict: true,
  },
  {
    type: "function",
    name: "analyze_exception_recovery",
    description:
      "Return a bounded read-only recovery plan for one authorized Automation exception. It cannot retry, allocate, reassign, or mutate state.",
    parameters: objectSchema({ exception_id: UUID_SCHEMA }, ["exception_id"]),
    strict: true,
  },
] as const;

type Args = Record<string, unknown>;

function parseArgs(value: string): Args {
  if (value.length > 8_000) {
    throw new ValidationError("Analyst tool arguments are too large.");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as Args;
  } catch {
    throw new ValidationError("Analyst tool arguments are invalid.");
  }
}

function exact(args: Args, keys: readonly string[]): void {
  const actual = Object.keys(args).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ValidationError(
      "Analyst tool arguments contain unsupported fields.",
    );
  }
}

function limit(args: Args, maximum: number, field = "limit"): number {
  const value = args[field];
  if (
    !Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum
  ) throw new ValidationError(`${field} is outside the supported bound.`);
  return Number(value);
}

function uuid(args: Args, field: string): string {
  if (typeof args[field] !== "string") {
    throw new ValidationError(`${field} is invalid.`);
  }
  validateUUID(args[field] as string, field);
  return args[field] as string;
}

function operational(auth: AuthContext): void {
  if (
    !auth.roles.some((role) =>
      ["AR Clerk", "AR Supervisor", "Finance Manager", "Auditor"].includes(role)
    )
  ) {
    throw new AuthorizationError(
      "Copilot analysis is not permitted for this role.",
    );
  }
}

function automation(auth: AuthContext): void {
  if (
    !auth.roles.some((role) =>
      ["AR Supervisor", "Finance Manager", "Auditor"].includes(role)
    )
  ) {
    throw new AuthorizationError(
      "Automation analysis is not permitted for this role.",
    );
  }
}

export class AnalystToolExecutor {
  constructor(private readonly service: CopilotAnalystServiceContract) {}

  async execute(
    auth: AuthContext,
    name: AnalystToolName,
    argumentsJson: string,
  ): Promise<CopilotToolOutcome> {
    const args = parseArgs(argumentsJson);
    switch (name) {
      case "get_ar_priority_analysis":
        exact(args, ["limit"]);
        operational(auth);
        return await this.service.getArPriorityAnalysis(auth, limit(args, 10));
      case "get_customer_risk_analysis":
        exact(args, ["customer_id"]);
        operational(auth);
        return await this.service.getCustomerRiskAnalysis(
          auth,
          uuid(args, "customer_id"),
        );
      case "get_collection_health_analysis":
        exact(args, ["months"]);
        operational(auth);
        return await this.service.getCollectionHealthAnalysis(
          auth,
          limit(args, 12, "months"),
        );
      case "get_exposure_movement_analysis":
        exact(args, ["metric"]);
        operational(auth);
        if (!["overdue", "aging"].includes(String(args.metric))) {
          throw new ValidationError("movement metric is unsupported.");
        }
        return await this.service.getExposureMovementAnalysis(
          auth,
          args.metric as "overdue" | "aging",
        );
      case "get_unapplied_cash_analysis":
        exact(args, ["limit"]);
        operational(auth);
        return await this.service.getUnappliedCashAnalysis(
          auth,
          limit(args, 10),
        );
      case "get_root_cause_analysis": {
        exact(args, ["target_type", "target_id"]);
        operational(auth);
        if (
          !["customer", "invoice", "receipt", "automation_document"].includes(
            String(args.target_type),
          )
        ) throw new ValidationError("target_type is unsupported.");
        if (args.target_type === "automation_document") automation(auth);
        return await this.service.getRootCauseAnalysis(
          auth,
          args.target_type as
            | "customer"
            | "invoice"
            | "receipt"
            | "automation_document",
          uuid(args, "target_id"),
        );
      }
      case "get_daily_brief":
        exact(args, ["limit"]);
        operational(auth);
        return await this.service.getDailyBrief(auth, limit(args, 8));
      case "run_ar_report":
        operational(auth);
        return await this.service.runReport(auth, parseAnalystReportPlan(args));
      case "analyze_automation_document":
        exact(args, ["document_id"]);
        automation(auth);
        return await this.service.analyzeAutomationDocument(
          auth,
          uuid(args, "document_id"),
        );
      case "analyze_exception_recovery":
        exact(args, ["exception_id"]);
        automation(auth);
        return await this.service.analyzeExceptionRecovery(
          auth,
          uuid(args, "exception_id"),
        );
    }
  }
}

import { handleCORS, jsonResponse } from "../_shared/cors.ts";
import {
  type AuthContext,
  extractCompanyId,
  getAuthContext,
} from "../_shared/auth.ts";
import {
  AuthenticationError,
  AuthorizationError,
  BusinessError,
  ConflictError,
  errorResponse,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import { parseRequestBody, validateUUID } from "../_shared/validators.ts";
import {
  assertExactKeys,
  assertQueryParameters,
  AUTOMATION_CONTRACT_VERSION,
  automationSuccess,
  parsePage,
} from "./contract.ts";
import { AutomationService } from "./service.ts";
import {
  AUTOMATION_WORKER_SECRET_ENV,
  validateAutomationWorker,
} from "./worker-auth.ts";

type Params = Record<string, string>;

const COLLECTIONS: Record<string, string> = {
  mailboxes: "automation_mailboxes",
  runs: "mailbox_sync_runs",
  documents: "automation_document_classifications",
  exceptions: "automation_exceptions",
  reminders: "invoice_reminders",
  "reminder-attempts": "reminder_delivery_attempts",
  audit: "automation_audit_events",
  commands: "automation_commands",
};

const COLLECTION_FILTERS: Record<string, readonly string[]> = {
  mailboxes: ["provider_type", "connection_status"],
  runs: ["provider_type", "status"],
  documents: ["document_type", "status"],
  exceptions: ["lifecycle_status", "reason_code"],
  reminders: ["status", "invoice_id"],
  "reminder-attempts": ["provider_type", "status", "reminder_id"],
  audit: ["event_type", "entity_type", "entity_id", "actor_type"],
  commands: ["command_type", "status"],
};

const COLLECTION_FILTER_VALUES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  mailboxes: {
    provider_type: ["gmail", "microsoft"],
    connection_status: [
      "disabled",
      "pending_consent",
      "connected",
      "reconnect_required",
      "error",
    ],
  },
  runs: {
    provider_type: ["gmail", "microsoft"],
    status: [
      "pending",
      "running",
      "completed",
      "failed",
      "reconnect_required",
    ],
  },
  documents: {
    document_type: [
      "invoice",
      "receipt",
      "payment_advice",
      "unsupported",
      "ambiguous",
    ],
    status: ["proposed", "accepted", "rejected"],
  },
  exceptions: {
    lifecycle_status: ["open", "retryable", "resolved", "dismissed"],
    reason_code: [
      "mailbox_not_configured",
      "mailbox_reconnect_required",
      "provider_unavailable",
      "message_duplicate",
      "attachment_duplicate",
      "unsupported_file",
      "unsafe_file",
      "encrypted_document",
      "oversized_document",
      "ambiguous_classification",
      "unsupported_document",
      "low_confidence",
      "extraction_schema_invalid",
      "arithmetic_mismatch",
      "currency_unsupported",
      "customer_unresolved",
      "customer_ambiguous",
      "invoice_conflict",
      "receipt_conflict",
      "missing_salesman",
      "invalid_salesman_email",
      "allocation_evidence_insufficient",
      "allocation_currency_mismatch",
      "allocation_conflict",
      "concurrency_conflict",
      "provider_delivery_failed",
      "internal_processing_failure",
    ],
  },
  reminders: {
    status: ["pending", "sending", "delivered", "failed", "cancelled"],
  },
  "reminder-attempts": {
    provider_type: ["gmail", "microsoft"],
    status: [
      "pending",
      "sending",
      "sent",
      "retryable_failure",
      "permanent_failure",
    ],
  },
  audit: {
    actor_type: ["user", "system", "provider"],
  },
  commands: {
    command_type: ["create_invoice", "create_receipt", "allocate_receipt"],
    status: [
      "proposed",
      "pending",
      "running",
      "completed",
      "failed",
      "refused",
    ],
  },
};

function validateCollectionFilter(
  collection: string,
  field: string,
  value: string,
): string {
  if (["invoice_id", "reminder_id", "entity_id"].includes(field)) {
    validateUUID(value, field);
    return value;
  }
  const allowed = COLLECTION_FILTER_VALUES[collection]?.[field];
  if (allowed && !allowed.includes(value)) {
    throw new ValidationError(`Invalid ${field} filter.`, {
      field,
      allowed,
    });
  }
  if (!allowed && (value.length === 0 || value.length > 80)) {
    throw new ValidationError(`${field} filter is invalid.`, { field });
  }
  return value;
}

interface Route {
  name: string;
  pattern: RegExp;
}

const ROUTES: Route[] = [
  { name: "worker-run", pattern: /^\/worker\/run\/?$/ },
  { name: "overview", pattern: /^\/overview\/?$/ },
  { name: "settings", pattern: /^\/settings\/?$/ },
  { name: "sales-representatives", pattern: /^\/sales-representatives\/?$/ },
  {
    name: "sales-representative",
    pattern: /^\/sales-representatives\/([0-9a-f-]{36})\/?$/i,
  },
  {
    name: "mailbox",
    pattern: /^\/mailboxes\/([0-9a-f-]{36})\/?$/i,
  },
  {
    name: "customer-owner",
    pattern: /^\/customers\/([0-9a-f-]{36})\/sales-representative\/?$/i,
  },
  {
    name: "customer-owner-assign",
    pattern: /^\/customers\/([0-9a-f-]{36})\/sales-representative\/assign\/?$/i,
  },
  {
    name: "customer-owner-history",
    pattern:
      /^\/customers\/([0-9a-f-]{36})\/sales-representative\/history\/?$/i,
  },
  { name: "mailbox-sync", pattern: /^\/mailboxes\/([0-9a-f-]{36})\/sync\/?$/i },
  {
    name: "oauth-start",
    pattern: /^\/mailboxes\/([0-9a-f-]{36})\/oauth\/start\/?$/i,
  },
  {
    name: "oauth-disconnect",
    pattern: /^\/mailboxes\/([0-9a-f-]{36})\/oauth\/disconnect\/?$/i,
  },
  {
    name: "oauth-callback",
    pattern: /^\/oauth\/(gmail|microsoft)\/callback\/?$/,
  },
  {
    name: "document-process",
    pattern: /^\/documents\/([0-9a-f-]{36})\/process\/?$/i,
  },
  {
    name: "command-execute",
    pattern: /^\/extractions\/([0-9a-f-]{36})\/command\/?$/i,
  },
  {
    name: "command-allocate",
    pattern: /^\/commands\/([0-9a-f-]{36})\/allocate\/?$/i,
  },
  {
    name: "exception-retry",
    pattern: /^\/exceptions\/([0-9a-f-]{36})\/retry\/?$/i,
  },
  {
    name: "exception-resolve",
    pattern: /^\/exceptions\/([0-9a-f-]{36})\/resolve\/?$/i,
  },
  {
    name: "exception-dismiss",
    pattern: /^\/exceptions\/([0-9a-f-]{36})\/dismiss\/?$/i,
  },
  { name: "reminder-evaluate", pattern: /^\/reminders\/evaluate\/?$/ },
  {
    name: "reminder-deliver",
    pattern: /^\/reminders\/([0-9a-f-]{36})\/deliver\/?$/i,
  },
  {
    name: "collection",
    pattern:
      /^\/(mailboxes|runs|documents|exceptions|reminders|reminder-attempts|audit|commands)\/?$/,
  },
];

function subPath(pathname: string): string {
  const index = pathname.indexOf("/automation");
  return index >= 0
    ? pathname.slice(index + "/automation".length) || "/"
    : pathname;
}

function match(pathname: string): { name: string; params: Params } {
  const path = subPath(pathname);
  for (const route of ROUTES) {
    const found = path.match(route.pattern);
    if (found) {
      return {
        name: route.name,
        params: found[1]
          ? route.name === "collection"
            ? { collection: found[1] }
            : { id: found[1] }
          : {},
      };
    }
  }
  return { name: "not-found", params: {} };
}

export interface AutomationHandlerDependencies {
  authenticate(req: Request, companyId: string): Promise<AuthContext>;
  authenticateWorker?(req: Request): void;
  createService(): AutomationService;
}

const productionDependencies: AutomationHandlerDependencies = {
  authenticate: getAuthContext,
  authenticateWorker: (req) =>
    validateAutomationWorker(
      req,
      Deno.env.get(AUTOMATION_WORKER_SECRET_ENV),
    ),
  createService: () => new AutomationService(),
};

async function body(req: Request): Promise<Record<string, unknown>> {
  return await parseRequestBody(req) as Record<string, unknown>;
}

export async function handleAutomationRequest(
  req: Request,
  dependencies: AutomationHandlerDependencies = productionDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCORS();
  try {
    const url = new URL(req.url);
    const route = match(url.pathname);
    if (route.name === "worker-run") {
      if (req.method !== "POST") {
        return jsonResponse({
          success: false,
          contract_version: AUTOMATION_CONTRACT_VERSION,
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "HTTP method is not supported for this automation route.",
          },
        }, 405);
      }
      (dependencies.authenticateWorker ??
        (() => {
          throw new Error("Automation worker authentication is unavailable.");
        }))(req);
      const service = dependencies.createService();
      return jsonResponse(
        automationSuccess(await service.runScheduledCycle()),
      );
    }
    if (route.name === "oauth-callback" && req.method === "GET") {
      assertQueryParameters(url, [
        "code",
        "state",
        "error",
        "error_description",
        "error_uri",
        "scope",
        "authuser",
        "prompt",
        "session_state",
      ]);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const providerError = url.searchParams.get("error");
      const provider = route.params.id;
      if (
        req.url.length > 8_192 ||
        !state || !/^[A-Za-z0-9_-]{32,256}$/.test(state) ||
        (provider !== "gmail" && provider !== "microsoft") ||
        (code !== null &&
          (code.length === 0 || code.length > 4_096 ||
            Array.from(code).some((character) => {
              const value = character.charCodeAt(0);
              return value <= 31 || value === 127;
            }))) ||
        (providerError !== null &&
          (providerError.length === 0 || providerError.length > 128))
      ) {
        throw new ValidationError("OAuth callback is invalid.");
      }
      const service = dependencies.createService();
      if (providerError !== null) {
        await service.rejectOAuth(provider, state);
      }
      if (!code) throw new ValidationError("OAuth callback is invalid.");
      return jsonResponse(automationSuccess(
        await service.completeOAuth(provider, state, code),
      ));
    }
    const companyId = extractCompanyId(req);
    const auth = await dependencies.authenticate(req, companyId);
    const service = dependencies.createService();

    if (route.name === "overview" && req.method === "GET") {
      assertQueryParameters(url, []);
      return jsonResponse(automationSuccess(await service.overview(auth)));
    }
    if (route.name === "settings" && req.method === "GET") {
      assertQueryParameters(url, []);
      return jsonResponse(automationSuccess(await service.getSettings(auth)));
    }
    if (route.name === "settings" && req.method === "PATCH") {
      return jsonResponse(
        automationSuccess(await service.updateSettings(auth, await body(req))),
      );
    }
    if (route.name === "sales-representatives" && req.method === "GET") {
      assertQueryParameters(url, ["page", "page_size", "is_active"]);
      const activeText = url.searchParams.get("is_active");
      const active = activeText === null
        ? undefined
        : activeText === "true"
        ? true
        : activeText === "false"
        ? false
        : (() => {
          throw new ValidationError("is_active must be true or false.");
        })();
      const result = await service.listSalesRepresentatives(
        auth,
        parsePage(url),
        active,
      );
      return jsonResponse(automationSuccess(result.rows, result.meta));
    }
    if (route.name === "sales-representatives" && req.method === "POST") {
      return jsonResponse(
        automationSuccess(
          await service.createSalesRepresentative(auth, await body(req)),
        ),
        201,
      );
    }
    if (route.name === "sales-representative" && req.method === "PATCH") {
      return jsonResponse(automationSuccess(
        await service.updateSalesRepresentative(
          auth,
          route.params.id,
          await body(req),
        ),
      ));
    }
    if (route.name === "customer-owner" && req.method === "GET") {
      assertQueryParameters(url, []);
      return jsonResponse(automationSuccess(
        await service.getCustomerSalesRepresentative(auth, route.params.id),
      ));
    }
    if (route.name === "customer-owner-assign" && req.method === "POST") {
      return jsonResponse(automationSuccess(
        await service.assignSalesRepresentative(
          auth,
          route.params.id,
          await body(req),
        ),
      ));
    }
    if (route.name === "customer-owner-history" && req.method === "GET") {
      assertQueryParameters(url, ["page", "page_size"]);
      const result = await service.listAssignmentHistory(
        auth,
        route.params.id,
        parsePage(url),
      );
      return jsonResponse(automationSuccess(result.rows, result.meta));
    }
    if (route.name === "collection" && req.method === "GET") {
      const table = COLLECTIONS[route.params.collection];
      if (!table) {
        throw new NotFoundError(
          "AutomationCollection",
          route.params.collection,
        );
      }
      const allowedFilters = COLLECTION_FILTERS[route.params.collection] ?? [];
      assertQueryParameters(url, ["page", "page_size", ...allowedFilters]);
      const filters: Record<string, string | boolean | undefined> = {};
      for (const field of allowedFilters) {
        const value = url.searchParams.get(field);
        if (value !== null) {
          filters[field] = validateCollectionFilter(
            route.params.collection,
            field,
            value,
          );
        }
      }
      const result = route.params.collection === "documents"
        ? await service.listDocumentDecisions(
          auth,
          parsePage(url),
          filters as Record<string, string | undefined>,
        )
        : await service.listTable(
          auth,
          table,
          parsePage(url),
          filters,
        );
      return jsonResponse(automationSuccess(result.rows, result.meta));
    }
    if (
      route.name === "collection" && route.params.collection === "mailboxes" &&
      req.method === "POST"
    ) {
      return jsonResponse(
        automationSuccess(await service.createMailbox(auth, await body(req))),
        201,
      );
    }
    if (route.name === "mailbox" && req.method === "PATCH") {
      return jsonResponse(automationSuccess(
        await service.updateMailbox(
          auth,
          route.params.id,
          await body(req),
        ),
      ));
    }
    if (route.name === "mailbox-sync" && req.method === "POST") {
      return jsonResponse(
        automationSuccess(await service.syncMailbox(auth, route.params.id)),
      );
    }
    if (route.name === "oauth-start" && req.method === "POST") {
      const request = await body(req);
      assertExactKeys(request, ["capability"], ["capability"]);
      if (
        request.capability !== "ingestion" &&
        request.capability !== "delivery"
      ) {
        throw new ValidationError(
          "capability must be ingestion or delivery.",
        );
      }
      return jsonResponse(automationSuccess(
        await service.beginOAuth(
          auth,
          route.params.id,
          request.capability,
        ),
      ));
    }
    if (route.name === "oauth-disconnect" && req.method === "POST") {
      const request = await body(req);
      assertExactKeys(request, ["capability"], ["capability"]);
      if (
        request.capability !== "ingestion" &&
        request.capability !== "delivery" && request.capability !== "all"
      ) {
        throw new ValidationError(
          "capability must be ingestion, delivery, or all.",
        );
      }
      return jsonResponse(automationSuccess(
        await service.disconnectMailboxOAuth(
          auth,
          route.params.id,
          request.capability,
        ),
      ));
    }
    if (route.name === "document-process" && req.method === "POST") {
      return jsonResponse(
        automationSuccess(
          await service.processAttachment(auth, route.params.id),
        ),
      );
    }
    if (route.name === "command-execute" && req.method === "POST") {
      return jsonResponse(
        automationSuccess(await service.executeCommand(auth, route.params.id)),
      );
    }
    if (route.name === "command-allocate" && req.method === "POST") {
      const request = await body(req);
      assertExactKeys(request, []);
      return jsonResponse(
        automationSuccess(
          await service.allocateCommand(auth, route.params.id),
        ),
      );
    }
    if (route.name === "exception-retry" && req.method === "POST") {
      return jsonResponse(
        automationSuccess(await service.retryException(auth, route.params.id)),
      );
    }
    if (
      (route.name === "exception-resolve" ||
        route.name === "exception-dismiss") &&
      req.method === "POST"
    ) {
      const request = await body(req);
      assertExactKeys(request, ["resolution_note"], ["resolution_note"]);
      if (typeof request.resolution_note !== "string") {
        throw new ValidationError("resolution_note is required.");
      }
      return jsonResponse(automationSuccess(
        await service.closeException(
          auth,
          route.params.id,
          route.name === "exception-resolve" ? "resolved" : "dismissed",
          request.resolution_note,
        ),
      ));
    }
    if (route.name === "reminder-evaluate" && req.method === "POST") {
      const request = await body(req);
      assertExactKeys(request, ["evaluation_date"], ["evaluation_date"]);
      if (typeof request.evaluation_date !== "string") {
        throw new ValidationError("evaluation_date is required.");
      }
      return jsonResponse(automationSuccess(
        await service.evaluateReminders(auth, request.evaluation_date),
      ));
    }
    if (route.name === "reminder-deliver" && req.method === "POST") {
      const request = await body(req);
      assertExactKeys(request, ["mailbox_id"], ["mailbox_id"]);
      if (typeof request.mailbox_id !== "string") {
        throw new ValidationError("mailbox_id is required.");
      }
      return jsonResponse(automationSuccess(
        await service.deliverReminder(
          auth,
          route.params.id,
          request.mailbox_id,
        ),
      ));
    }
    if (route.name !== "not-found") {
      return jsonResponse({
        success: false,
        contract_version: AUTOMATION_CONTRACT_VERSION,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "HTTP method is not supported for this automation route.",
        },
      }, 405);
    }
    return jsonResponse({
      success: false,
      contract_version: AUTOMATION_CONTRACT_VERSION,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Automation route not found.",
      },
    }, 404);
  } catch (error) {
    if (
      !(error instanceof ValidationError) &&
      !(error instanceof BusinessError) &&
      !(error instanceof AuthenticationError) &&
      !(error instanceof AuthorizationError) &&
      !(error instanceof NotFoundError) &&
      !(error instanceof ConflictError)
    ) {
      console.error("[AUTOMATION_INTERNAL_ERROR]", {
        code: "UNEXPECTED_AUTOMATION_FAILURE",
      });
      return jsonResponse({
        success: false,
        contract_version: AUTOMATION_CONTRACT_VERSION,
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      }, 500);
    }
    const response = errorResponse(error);
    return jsonResponse({
      ...response.body,
      contract_version: AUTOMATION_CONTRACT_VERSION,
    }, response.status);
  }
}

export const handler = (req: Request) => handleAutomationRequest(req);

if (import.meta.main) Deno.serve(handler);

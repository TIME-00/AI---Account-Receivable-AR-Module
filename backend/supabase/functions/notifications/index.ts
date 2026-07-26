// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: notifications
// Cursor-paginated derived import alerts with per-user acknowledgement state.
// ============================================================================

import { handleCORS, jsonResponse } from "../_shared/cors.ts";
import {
  extractCompanyId,
  getAuthContext,
  requireOperationalReadRole,
} from "../_shared/auth.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/db.ts";
import {
  errorResponse,
  successResponse,
  ValidationError,
} from "../_shared/errors.ts";
import { parseRequestBody } from "../_shared/validators.ts";
import {
  parseNotificationListParams,
  parseReadAllBody,
  parseReadOneBody,
} from "./contract.ts";
import { NotificationService } from "./service.ts";
import type { NotificationServiceContract } from "./service.ts";

type Route = "list" | "unreadCount" | "readOne" | "readAll" | "notFound";

function getSubPath(pathname: string): string {
  const index = pathname.indexOf("/notifications");
  if (index === -1) return pathname;
  return pathname.slice(index + "/notifications".length) || "/";
}

function matchRoute(pathname: string): Route {
  const subPath = getSubPath(pathname);
  if (/^\/?$/.test(subPath)) return "list";
  if (/^\/unread-count\/?$/.test(subPath)) return "unreadCount";
  if (/^\/read\/?$/.test(subPath)) return "readOne";
  if (/^\/read-all\/?$/.test(subPath)) return "readAll";
  return "notFound";
}

function notificationCors(): Response {
  const response = handleCORS();
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return response;
}

async function optionalJsonBody(
  req: Request,
): Promise<Record<string, unknown>> {
  if (req.body === null) return {};
  return await parseRequestBody<Record<string, unknown>>(req);
}

export interface NotificationHandlerDependencies {
  authenticate(req: Request, companyId: string): Promise<AuthContext>;
  createService(): NotificationServiceContract;
}

const productionDependencies: NotificationHandlerDependencies = {
  authenticate: getAuthContext,
  createService: () => new NotificationService(getAdminClient()),
};

export async function handleNotificationRequest(
  req: Request,
  dependencies: NotificationHandlerDependencies = productionDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return notificationCors();

  try {
    const url = new URL(req.url);
    const route = matchRoute(url.pathname);
    const companyId = extractCompanyId(req);
    const auth = await dependencies.authenticate(req, companyId);
    requireOperationalReadRole(auth);
    const service = dependencies.createService();

    if (route === "list" && req.method === "GET") {
      const result = await service.list(auth, parseNotificationListParams(url));
      return jsonResponse({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    }

    if (route === "unreadCount" && req.method === "GET") {
      if ([...url.searchParams.keys()].length > 0) {
        throw new ValidationError(
          "The unread-count endpoint does not accept query parameters.",
        );
      }
      const unreadCount = await service.unreadCount(auth);
      return jsonResponse(successResponse({ unread_count: unreadCount }));
    }

    if (route === "readOne" && req.method === "POST") {
      const body = await parseRequestBody<Record<string, unknown>>(req);
      const result = await service.readOne(auth, parseReadOneBody(body));
      return jsonResponse(successResponse(result));
    }

    if (route === "readAll" && req.method === "POST") {
      const body = await optionalJsonBody(req);
      const result = await service.readAll(auth, parseReadAllBody(body).type);
      return jsonResponse(successResponse(result));
    }

    return jsonResponse({
      success: false,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: `No route matches ${req.method} ${url.pathname}`,
      },
    }, 404);
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
}

export function createNotificationHandler(
  dependencies: NotificationHandlerDependencies = productionDependencies,
): (req: Request) => Promise<Response> {
  return (req) => handleNotificationRequest(req, dependencies);
}

export const handler = createNotificationHandler();

if (import.meta.main) {
  Deno.serve(handler);
}

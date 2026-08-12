import { handleCORS, jsonResponse } from "../_shared/cors.ts";
import {
  extractCompanyId,
  getAuthContext,
  requireAnyRole,
} from "../_shared/auth.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/db.ts";
import {
  errorResponse,
  successResponse,
  ValidationError,
} from "../_shared/errors.ts";
import { parseAuditListParams, validateAuditEventId } from "./contract.ts";
import { AuditReadService } from "./service.ts";
import type { AuditReadServiceContract } from "./service.ts";

type Route = { type: "list" } | { type: "detail"; eventId: string } | {
  type: "notFound";
};

function getSubPath(pathname: string): string {
  const index = pathname.indexOf("/audit-trail");
  if (index === -1) return pathname;
  return pathname.slice(index + "/audit-trail".length) || "/";
}

function matchRoute(pathname: string): Route {
  const subPath = getSubPath(pathname);
  if (/^\/?$/.test(subPath)) return { type: "list" };
  const match = /^\/([^/]+)\/?$/.exec(subPath);
  return match ? { type: "detail", eventId: match[1] } : { type: "notFound" };
}

export function requireAuditReadAccess(auth: AuthContext): void {
  requireAnyRole(auth, ["Finance Manager", "Auditor"]);
}

export interface AuditReadHandlerDependencies {
  authenticate(req: Request, companyId: string): Promise<AuthContext>;
  createService(): AuditReadServiceContract;
}

const productionDependencies: AuditReadHandlerDependencies = {
  authenticate: getAuthContext,
  createService: () => new AuditReadService(getAdminClient()),
};

export async function handleAuditReadRequest(
  req: Request,
  dependencies: AuditReadHandlerDependencies = productionDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCORS();
  try {
    const url = new URL(req.url);
    const route = matchRoute(url.pathname);
    const companyId = extractCompanyId(req);
    const auth = await dependencies.authenticate(req, companyId);
    requireAuditReadAccess(auth);
    if (req.method !== "GET") {
      return jsonResponse({
        success: false,
        error: {
          code: "ROUTE_NOT_FOUND",
          message: `No route matches ${req.method} ${url.pathname}`,
        },
      }, 404);
    }
    const service = dependencies.createService();
    if (route.type === "list") {
      const result = await service.list(auth, parseAuditListParams(url));
      return jsonResponse({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    }
    if (route.type === "detail") {
      if ([...url.searchParams.keys()].length > 0) {
        throw new ValidationError(
          "Audit detail does not accept query parameters.",
        );
      }
      validateAuditEventId(route.eventId);
      return jsonResponse(
        successResponse(await service.detail(auth, route.eventId)),
      );
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

export function createAuditReadHandler(
  dependencies: AuditReadHandlerDependencies = productionDependencies,
): (req: Request) => Promise<Response> {
  return (req) => handleAuditReadRequest(req, dependencies);
}

export const handler = createAuditReadHandler();
if (import.meta.main) Deno.serve(handler);

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
import { validateUUID } from "../_shared/validators.ts";
import { parseJournalListParams } from "./contract.ts";
import { JournalReadService } from "./read-service.ts";
import type { JournalReadServiceContract } from "./read-service.ts";

type Route = { type: "list" } | { type: "detail"; id: string } | {
  type: "notFound";
};

function getSubPath(pathname: string): string {
  const index = pathname.indexOf("/journal-entries");
  if (index === -1) return pathname;
  return pathname.slice(index + "/journal-entries".length) || "/";
}

function matchRoute(pathname: string): Route {
  const subPath = getSubPath(pathname);
  if (/^\/?$/.test(subPath)) return { type: "list" };
  const match = /^\/([^/]+)\/?$/.exec(subPath);
  return match ? { type: "detail", id: match[1] } : { type: "notFound" };
}

export function requireJournalReadAccess(auth: AuthContext): void {
  requireAnyRole(auth, ["AR Supervisor", "Finance Manager", "Auditor"]);
}

export interface JournalReadHandlerDependencies {
  authenticate(req: Request, companyId: string): Promise<AuthContext>;
  createService(): JournalReadServiceContract;
}

const productionDependencies: JournalReadHandlerDependencies = {
  authenticate: getAuthContext,
  createService: () => new JournalReadService(getAdminClient()),
};

export async function handleJournalReadRequest(
  req: Request,
  dependencies: JournalReadHandlerDependencies = productionDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCORS();
  try {
    const url = new URL(req.url);
    const route = matchRoute(url.pathname);
    const companyId = extractCompanyId(req);
    const auth = await dependencies.authenticate(req, companyId);
    requireJournalReadAccess(auth);
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
      const result = await service.list(auth, parseJournalListParams(url));
      return jsonResponse({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    }
    if (route.type === "detail") {
      if ([...url.searchParams.keys()].length > 0) {
        throw new ValidationError(
          "Journal detail does not accept query parameters.",
        );
      }
      validateUUID(route.id, "journal_entry_id");
      return jsonResponse(
        successResponse(await service.detail(auth, route.id)),
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

export function createJournalReadHandler(
  dependencies: JournalReadHandlerDependencies = productionDependencies,
): (req: Request) => Promise<Response> {
  return (req) => handleJournalReadRequest(req, dependencies);
}

export const handler = createJournalReadHandler();
if (import.meta.main) Deno.serve(handler);

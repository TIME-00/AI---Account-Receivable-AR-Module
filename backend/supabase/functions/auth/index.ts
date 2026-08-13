// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: auth
// Authenticated company/role context plus account-level UI preferences.
// ============================================================================

import { handleCORS, jsonResponse } from "../_shared/cors.ts";
import {
  extractCompanyId,
  extractUser,
  getAuthContext,
} from "../_shared/auth.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/db.ts";
import {
  errorResponse,
  successResponse,
  ValidationError,
} from "../_shared/errors.ts";
import type { UserRole } from "../_shared/types.ts";
import { readUiThemePatch } from "./contract.ts";
import {
  UiPreferenceService,
  type UiPreferenceServiceContract,
} from "./preference-service.ts";

function getSubPath(pathname: string): string {
  const index = pathname.indexOf("/auth");
  return index === -1
    ? pathname
    : pathname.slice(index + "/auth".length) || "/";
}

function hasAnyRole(roles: UserRole[], allowed: UserRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

export interface AuthHandlerDependencies {
  authenticateCompany(req: Request, companyId: string): Promise<AuthContext>;
  authenticateUser(
    req: Request,
  ): Promise<{ userId: string; email: string | null }>;
  createPreferenceService(): UiPreferenceServiceContract;
  loadCompany(companyId: string): Promise<Record<string, unknown> | null>;
}

const productionDependencies: AuthHandlerDependencies = {
  authenticateCompany: getAuthContext,
  authenticateUser: extractUser,
  createPreferenceService: () => new UiPreferenceService(),
  async loadCompany(companyId) {
    const { data, error } = await getAdminClient()
      .from("companies")
      .select(
        "id, company_code, company_name, base_currency, country, is_active",
      )
      .eq("id", companyId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load company context: ${error.message}`);
    }
    return data as Record<string, unknown> | null;
  },
};

function capabilitiesFor(roles: UserRole[]): Record<string, boolean> {
  const operationalRoles: UserRole[] = [
    "AR Clerk",
    "AR Supervisor",
    "Finance Manager",
  ];
  const operationalReadRoles: UserRole[] = [
    "AR Clerk",
    "AR Supervisor",
    "Finance Manager",
    "Auditor",
  ];
  const supervisorRoles: UserRole[] = ["AR Supervisor", "Finance Manager"];
  return {
    can_read_operational_data: hasAnyRole(roles, operationalReadRoles),
    can_create_customer: hasAnyRole(roles, operationalRoles),
    can_update_customer: hasAnyRole(roles, operationalRoles),
    can_create_invoice: hasAnyRole(roles, operationalRoles),
    can_update_draft_invoice: hasAnyRole(roles, operationalRoles),
    can_post_invoice: hasAnyRole(roles, operationalRoles),
    can_cancel_invoice: hasAnyRole(roles, supervisorRoles),
    can_create_receipt: hasAnyRole(roles, operationalRoles),
    can_post_receipt: hasAnyRole(roles, operationalRoles),
    can_cancel_receipt: hasAnyRole(roles, supervisorRoles),
    can_allocate_receipt: hasAnyRole(roles, operationalRoles),
    can_reverse_allocation: hasAnyRole(roles, supervisorRoles),
    can_handle_bounced_cheque: hasAnyRole(roles, ["Finance Manager"]),
    can_read_reports: hasAnyRole(roles, operationalReadRoles),
    can_execute_imports: hasAnyRole(roles, operationalRoles),
    can_review_import_rows: hasAnyRole(roles, operationalRoles),
    can_read_config: hasAnyRole(roles, [
      "System Admin",
      ...operationalReadRoles,
    ]),
    can_write_config: hasAnyRole(roles, ["System Admin"]),
    is_read_only: !hasAnyRole(roles, operationalRoles),
    is_system_admin_only: roles.includes("System Admin") &&
      !hasAnyRole(roles, operationalReadRoles),
  };
}

export async function handleAuthRequest(
  req: Request,
  dependencies: AuthHandlerDependencies = productionDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCORS();
  try {
    const url = new URL(req.url);
    const subPath = getSubPath(url.pathname);

    if (/^\/ui-preferences\/?$/i.test(subPath)) {
      if (url.search !== "") {
        throw new ValidationError(
          "UI preference routes do not accept query parameters.",
        );
      }
      if (req.method !== "GET" && req.method !== "PATCH") {
        return jsonResponse({
          success: false,
          error: {
            code: "ROUTE_NOT_FOUND",
            message: `No route matches ${req.method} ${url.pathname}`,
          },
        }, 404);
      }
      const { userId } = await dependencies.authenticateUser(req);
      const service = dependencies.createPreferenceService();
      const preference = req.method === "GET"
        ? await service.get(userId)
        : await service.update(userId, await readUiThemePatch(req));
      return jsonResponse(successResponse(preference));
    }

    if (req.method !== "GET" || !/^\/me\/?$/i.test(subPath)) {
      return jsonResponse({
        success: false,
        error: {
          code: "ROUTE_NOT_FOUND",
          message: `No route matches ${req.method} ${url.pathname}`,
        },
      }, 404);
    }

    const companyId = extractCompanyId(req);
    const auth = await dependencies.authenticateCompany(req, companyId);
    const company = await dependencies.loadCompany(auth.companyId);
    return jsonResponse(successResponse({
      user: { id: auth.userId, email: auth.email },
      company: company
        ? {
          id: company.id,
          code: company.company_code,
          name: company.company_name,
          base_currency: company.base_currency,
          country: company.country,
        }
        : {
          id: auth.companyId,
          code: null,
          name: null,
          base_currency: null,
          country: null,
        },
      roles: auth.roles,
      highest_role: auth.highestRole,
      capabilities: capabilitiesFor(auth.roles),
    }));
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
}

export function createAuthHandler(
  dependencies: AuthHandlerDependencies = productionDependencies,
): (req: Request) => Promise<Response> {
  return (req) => handleAuthRequest(req, dependencies);
}

export const handler = createAuthHandler();
if (import.meta.main) Deno.serve(handler);

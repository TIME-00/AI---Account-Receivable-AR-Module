// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: bank-accounts
// Read-only API for active company bank accounts used by receipt creation and
// mailbox receiving-account configuration.
// ============================================================================

import { handleCORS, jsonResponse } from "../_shared/cors.ts";
import { extractCompanyId, getAuthContext } from "../_shared/auth.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/db.ts";
import {
  AuthorizationError,
  errorResponse,
  successResponse,
} from "../_shared/errors.ts";

const BANK_ACCOUNT_READ_ROLES = new Set([
  "AR Clerk",
  "AR Supervisor",
  "Finance Manager",
  "Auditor",
  "System Admin",
]);

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf("/bank-accounts");
  if (idx !== -1) {
    return pathname.slice(idx + "/bank-accounts".length) || "/";
  }
  return pathname;
}

/**
 * Endpoint-local read boundary. System Admin is intentionally included because
 * that role may configure Automation mailboxes and must be able to select the
 * company receiving account. This does not broaden the shared operational-read
 * helper or grant any financial/write authority.
 */
export function requireBankAccountReadAccess(auth: AuthContext): void {
  if (!auth.roles.some((role) => BANK_ACCOUNT_READ_ROLES.has(role))) {
    throw new AuthorizationError(
      "Bank account lookup requires an authorized AR read or mailbox configuration role.",
      { user_roles: auth.roles },
    );
  }
}

/**
 * Production query boundary. The admin client is used only after authentication
 * and endpoint authorization; tenant authority is the authenticated company id,
 * never a row/filter supplied by the caller. The endpoint remains read-only.
 */
export async function listActiveCompanyBankAccounts(
  companyId: string,
  client = getAdminClient(),
): Promise<Record<string, unknown>[]> {
  const { data, error } = await client
    .from("bank_accounts")
    .select(`
      id,
      company_id,
      bank_name,
      account_name,
      account_no,
      swift_code,
      currency,
      gl_account_id,
      is_active,
      created_at,
      updated_at
    `)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("bank_name", { ascending: true })
    .order("account_no", { ascending: true });

  if (error) {
    throw new Error(`Failed to list bank accounts: ${error.message}`);
  }
  return (data ?? []) as Record<string, unknown>[];
}

export interface BankAccountsHandlerDependencies {
  authenticate(req: Request, companyId: string): Promise<AuthContext>;
  listActive(companyId: string): Promise<Record<string, unknown>[]>;
}

const productionDependencies: BankAccountsHandlerDependencies = {
  authenticate: getAuthContext,
  listActive: (companyId) => listActiveCompanyBankAccounts(companyId),
};

export async function handleBankAccountsRequest(
  req: Request,
  dependencies: BankAccountsHandlerDependencies = productionDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCORS();

  try {
    const url = new URL(req.url);
    const subPath = getSubPath(url.pathname);
    const requestedCompanyId = extractCompanyId(req);
    const auth = await dependencies.authenticate(req, requestedCompanyId);
    requireBankAccountReadAccess(auth);

    if (subPath !== "/" || req.method !== "GET") {
      return jsonResponse(
        {
          success: false,
          error: {
            code: "ROUTE_NOT_FOUND",
            message: `No route matches ${req.method} ${url.pathname}`,
          },
        },
        404,
      );
    }

    const data = await dependencies.listActive(auth.companyId);
    return jsonResponse(successResponse(data));
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
}

export function createBankAccountsHandler(
  dependencies: BankAccountsHandlerDependencies = productionDependencies,
): (req: Request) => Promise<Response> {
  return (req) => handleBankAccountsRequest(req, dependencies);
}

export const handler = createBankAccountsHandler();

if (import.meta.main) {
  Deno.serve(handler);
}

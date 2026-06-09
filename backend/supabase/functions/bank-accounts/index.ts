// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: bank-accounts
// Read-only API for active company bank accounts used by receipt creation.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { extractCompanyId, getAuthContext } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';
import { AuthorizationError, errorResponse, successResponse } from '../_shared/errors.ts';

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/bank-accounts');
  if (idx !== -1) {
    return pathname.slice(idx + '/bank-accounts'.length) || '/';
  }
  return pathname;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const subPath = getSubPath(url.pathname);
    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);

    if (subPath !== '/' || req.method !== 'GET') {
      return jsonResponse(
        { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
        404,
      );
    }

    const allowedRoles = ['AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor'];
    const hasReadRole = auth.roles.some(role => allowedRoles.includes(role));
    if (!hasReadRole) {
      throw new AuthorizationError(
        'Bank account lookup requires AR Clerk, AR Supervisor, Finance Manager, or Auditor access.',
        { user_roles: auth.roles },
      );
    }

    const client = getAdminClient();
    const { data, error } = await client
      .from('bank_accounts')
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
      .eq('company_id', auth.companyId)
      .eq('is_active', true)
      .order('bank_name', { ascending: true })
      .order('account_no', { ascending: true });

    if (error) {
      throw new Error(`Failed to list bank accounts: ${error.message}`);
    }

    return jsonResponse(successResponse(data ?? []));
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});

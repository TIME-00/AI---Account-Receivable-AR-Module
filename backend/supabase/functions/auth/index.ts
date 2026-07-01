// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: auth
// Read-only authenticated user/company/role context for honest frontend RBAC.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { extractCompanyId, getAuthContext } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';
import { errorResponse, successResponse } from '../_shared/errors.ts';
import type { UserRole } from '../_shared/types.ts';

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/auth');
  if (idx !== -1) {
    return pathname.slice(idx + '/auth'.length) || '/';
  }
  return pathname;
}

function hasAnyRole(roles: UserRole[], allowed: UserRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const subPath = getSubPath(url.pathname);

    if (req.method !== 'GET' || !/^\/me\/?$/i.test(subPath)) {
      return jsonResponse(
        { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
        404,
      );
    }

    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    const client = getAdminClient();

    const { data: company, error } = await client
      .from('companies')
      .select('id, company_code, company_name, base_currency, country, is_active')
      .eq('id', auth.companyId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load company context: ${error.message}`);
    }

    const operationalRoles: UserRole[] = ['AR Clerk', 'AR Supervisor', 'Finance Manager'];
    const operationalReadRoles: UserRole[] = ['AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor'];
    const supervisorRoles: UserRole[] = ['AR Supervisor', 'Finance Manager'];

    const capabilities = {
      can_read_operational_data: hasAnyRole(auth.roles, operationalReadRoles),
      can_create_customer: hasAnyRole(auth.roles, operationalRoles),
      can_update_customer: hasAnyRole(auth.roles, operationalRoles),
      can_create_invoice: hasAnyRole(auth.roles, operationalRoles),
      can_update_draft_invoice: hasAnyRole(auth.roles, operationalRoles),
      can_post_invoice: hasAnyRole(auth.roles, operationalRoles),
      can_cancel_invoice: hasAnyRole(auth.roles, supervisorRoles),
      can_create_receipt: hasAnyRole(auth.roles, operationalRoles),
      can_post_receipt: hasAnyRole(auth.roles, operationalRoles),
      can_cancel_receipt: hasAnyRole(auth.roles, supervisorRoles),
      can_allocate_receipt: hasAnyRole(auth.roles, operationalRoles),
      can_reverse_allocation: hasAnyRole(auth.roles, supervisorRoles),
      can_handle_bounced_cheque: hasAnyRole(auth.roles, ['Finance Manager']),
      can_read_reports: hasAnyRole(auth.roles, operationalReadRoles),
      can_execute_imports: hasAnyRole(auth.roles, operationalRoles),
      can_review_import_rows: hasAnyRole(auth.roles, operationalRoles),
      can_read_config: hasAnyRole(auth.roles, ['System Admin', 'Finance Manager', 'AR Supervisor', 'AR Clerk', 'Auditor']),
      can_write_config: hasAnyRole(auth.roles, ['System Admin']),
      is_read_only: !hasAnyRole(auth.roles, operationalRoles),
      is_system_admin_only: auth.roles.includes('System Admin') && !hasAnyRole(auth.roles, operationalReadRoles),
    };

    return jsonResponse(successResponse({
      user: {
        id: auth.userId,
        email: auth.email,
      },
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
      capabilities,
    }));
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});

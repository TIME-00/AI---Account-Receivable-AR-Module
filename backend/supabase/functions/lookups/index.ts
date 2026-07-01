// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: lookups
// Read-only authenticated lookup API for real invoice configuration values.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { extractCompanyId, getAuthContext } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';
import { errorResponse, successResponse, ValidationError } from '../_shared/errors.ts';

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/lookups');
  if (idx !== -1) {
    return pathname.slice(idx + '/lookups'.length) || '/';
  }
  return pathname;
}

function optionalDate(value: string | null, field: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD format.`, { field });
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} must be a valid calendar date.`, { field });
  }
  return value;
}

function optionalCountry(value: string | null): string | null {
  if (!value) return null;
  const country = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ValidationError('country must be a two-letter ISO country code.', { field: 'country' });
  }
  return country;
}

function optionalTaxType(value: string | null): 'Output' | 'Input' | null {
  if (!value) return null;
  const taxType = value.trim();
  if (taxType !== 'Output' && taxType !== 'Input') {
    throw new ValidationError('tax_type must be Output or Input.', { field: 'tax_type' });
  }
  return taxType;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const subPath = getSubPath(url.pathname);
    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    const client = getAdminClient();

    if (req.method !== 'GET') {
      return jsonResponse(
        { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
        404,
      );
    }

    if (/^\/tax-codes\/?$/i.test(subPath)) {
      const country = optionalCountry(url.searchParams.get('country'));
      const taxType = optionalTaxType(url.searchParams.get('tax_type'));
      const effectiveDate = optionalDate(url.searchParams.get('effective_date'), 'effective_date')
        ?? new Date().toISOString().slice(0, 10);

      let query = client
        .from('tax_codes')
        .select('id, company_id, tax_code, tax_name, tax_type, rate, effective_from, effective_to, country, gl_account_id, is_active')
        .eq('company_id', auth.companyId)
        .eq('is_active', true)
        .lte('effective_from', effectiveDate)
        .or(`effective_to.is.null,effective_to.gte.${effectiveDate}`)
        .order('tax_code', { ascending: true })
        .order('effective_from', { ascending: false });

      if (country) query = query.eq('country', country);
      if (taxType) query = query.eq('tax_type', taxType);

      const { data, error } = await query;
      if (error) throw new Error(`Failed to list tax codes: ${error.message}`);

      return jsonResponse(successResponse(data ?? [], {
        total: data?.length ?? 0,
      }));
    }

    if (/^\/payment-terms\/?$/i.test(subPath)) {
      const { data, error } = await client
        .from('payment_terms')
        .select('id, company_id, term_code, term_name, term_type, days, description, is_active')
        .eq('company_id', auth.companyId)
        .eq('is_active', true)
        .order('term_code', { ascending: true });

      if (error) throw new Error(`Failed to list payment terms: ${error.message}`);

      return jsonResponse(successResponse(data ?? [], {
        total: data?.length ?? 0,
      }));
    }

    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
      404,
    );
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});

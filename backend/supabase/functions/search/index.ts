// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: search
// Read-only scoped global search across safe AR objects.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { extractCompanyId, getAuthContext, getCustomerAccessFilter, requireOperationalReadRole } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';
import { errorResponse, successResponse, ValidationError } from '../_shared/errors.ts';

type SearchResult = {
  type: 'customer' | 'invoice' | 'receipt';
  id: string;
  title: string;
  subtitle: string;
  route: string;
  metadata: Record<string, string | number | null>;
};

type CustomerSearchRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  status: string;
  default_currency: string;
};

type InvoiceSearchRow = {
  id: string;
  invoice_no: string;
  doc_type: string;
  customer_id: string;
  customer_name: string;
  status: string;
  total_amount: number;
  outstanding: number;
  currency: string;
};

type ReceiptSearchRow = {
  id: string;
  receipt_no: string;
  customer_id: string;
  customer_name: string;
  status: string;
  receipt_amount: number;
  unallocated_amount: number;
  currency: string;
};

function normalizeLimit(value: string | null): number {
  if (!value) return 10;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new ValidationError('limit must be an integer from 1 to 20.', { field: 'limit' });
  }
  return parsed;
}

function likeTerm(q: string): string {
  return `%${q.replace(/[%_]/g, '\\$&')}%`;
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    if (req.method !== 'GET') {
      const url = new URL(req.url);
      return jsonResponse(
        { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
        404,
      );
    }

    const url = new URL(req.url);
    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    requireOperationalReadRole(auth);

    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) {
      throw new ValidationError('q must contain at least 2 characters.', { field: 'q' });
    }
    if (q.length > 80) {
      throw new ValidationError('q must be 80 characters or fewer.', { field: 'q' });
    }

    const limit = normalizeLimit(url.searchParams.get('limit'));
    const perTypeLimit = Math.min(limit, 10);
    const term = likeTerm(q);
    const client = getAdminClient();
    const customerFilter = await getCustomerAccessFilter(auth);

    const candidateLimit = Math.min(perTypeLimit * 3, 30);
    const noCustomerMatch = ['00000000-0000-0000-0000-000000000000'];
    const scopedCustomerIds = customerFilter && customerFilter.length === 0
      ? noCustomerMatch
      : customerFilter;

    const searchCustomersBy = async (field: 'customer_id' | 'customer_name' | 'short_name' | 'registration_no') => {
      let query = client
        .from('customers')
        .select('id, customer_id, customer_name, status, default_currency')
        .eq('company_id', auth.companyId)
        .eq('is_deleted', false)
        .eq('is_hidden', false)
        .ilike(field, term)
        .order('customer_name', { ascending: true })
        .limit(perTypeLimit);

      if (scopedCustomerIds) query = query.in('id', scopedCustomerIds);

      const { data, error } = await query;
      if (error) throw new Error(`Customer search failed: ${error.message}`);
      return (data ?? []) as CustomerSearchRow[];
    };

    const searchInvoicesBy = async (field: 'invoice_no' | 'customer_name' | 'reference_no') => {
      let query = client
        .from('invoices')
        .select('id, invoice_no, doc_type, customer_id, customer_name, status, total_amount, outstanding, currency')
        .eq('company_id', auth.companyId)
        .ilike(field, term)
        .order('created_at', { ascending: false })
        .limit(candidateLimit);

      if (scopedCustomerIds) query = query.in('customer_id', scopedCustomerIds);

      const { data, error } = await query;
      if (error) throw new Error(`Invoice search failed: ${error.message}`);
      return (data ?? []) as InvoiceSearchRow[];
    };

    const searchReceiptsBy = async (field: 'receipt_no' | 'customer_name' | 'reference_no') => {
      let query = client
        .from('receipts')
        .select('id, receipt_no, customer_id, customer_name, status, receipt_amount, unallocated_amount, currency')
        .eq('company_id', auth.companyId)
        .ilike(field, term)
        .order('created_at', { ascending: false })
        .limit(candidateLimit);

      if (scopedCustomerIds) query = query.in('customer_id', scopedCustomerIds);

      const { data, error } = await query;
      if (error) throw new Error(`Receipt search failed: ${error.message}`);
      return (data ?? []) as ReceiptSearchRow[];
    };

    const [
      customerIdRows,
      customerNameRows,
      customerShortNameRows,
      customerRegistrationRows,
      invoiceNoRows,
      invoiceCustomerRows,
      invoiceReferenceRows,
      receiptNoRows,
      receiptCustomerRows,
      receiptReferenceRows,
    ] = await Promise.all([
      searchCustomersBy('customer_id'),
      searchCustomersBy('customer_name'),
      searchCustomersBy('short_name'),
      searchCustomersBy('registration_no'),
      searchInvoicesBy('invoice_no'),
      searchInvoicesBy('customer_name'),
      searchInvoicesBy('reference_no'),
      searchReceiptsBy('receipt_no'),
      searchReceiptsBy('customer_name'),
      searchReceiptsBy('reference_no'),
    ]);

    const customerRows = dedupeById([
      ...customerIdRows,
      ...customerNameRows,
      ...customerShortNameRows,
      ...customerRegistrationRows,
    ]).slice(0, perTypeLimit);

    const invoiceRows = dedupeById([
      ...invoiceNoRows,
      ...invoiceCustomerRows,
      ...invoiceReferenceRows,
    ]);

    const receiptRows = dedupeById([
      ...receiptNoRows,
      ...receiptCustomerRows,
      ...receiptReferenceRows,
    ]);

    const transactionCustomerIds = Array.from(new Set([
      ...(invoiceRows.map((row) => row.customer_id).filter(Boolean)),
      ...(receiptRows.map((row) => row.customer_id).filter(Boolean)),
    ]));

    let visibleTransactionCustomerIds = new Set<string>();
    if (transactionCustomerIds.length > 0) {
      const { data: visibleCustomers, error: visibilityError } = await client
        .from('customers')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('is_deleted', false)
        .eq('is_hidden', false)
        .in('id', transactionCustomerIds);

      if (visibilityError) {
        throw new Error(`Failed to verify search result customer visibility: ${visibilityError.message}`);
      }
      visibleTransactionCustomerIds = new Set((visibleCustomers ?? []).map((customer) => customer.id));
    }

    const visibleInvoices = invoiceRows
      .filter((row) => visibleTransactionCustomerIds.has(row.customer_id))
      .slice(0, perTypeLimit);
    const visibleReceipts = receiptRows
      .filter((row) => visibleTransactionCustomerIds.has(row.customer_id))
      .slice(0, perTypeLimit);

    const results: SearchResult[] = [
      ...(customerRows.map((row): SearchResult => ({
        type: 'customer',
        id: row.id,
        title: row.customer_name,
        subtitle: `${row.customer_id} - ${row.status}`,
        route: `/customers/${row.id}`,
        metadata: {
          customer_code: row.customer_id,
          status: row.status,
          currency: row.default_currency,
        },
      }))),
      ...(visibleInvoices.map((row): SearchResult => ({
        type: 'invoice',
        id: row.id,
        title: `${row.doc_type} ${row.invoice_no}`,
        subtitle: `${row.customer_name} - ${row.status}`,
        route: `/invoices/${row.id}`,
        metadata: {
          customer_id: row.customer_id,
          status: row.status,
          amount: row.total_amount,
          outstanding: row.outstanding,
          currency: row.currency,
        },
      }))),
      ...(visibleReceipts.map((row): SearchResult => ({
        type: 'receipt',
        id: row.id,
        title: `Receipt ${row.receipt_no}`,
        subtitle: `${row.customer_name} - ${row.status}`,
        route: `/receipts/${row.id}`,
        metadata: {
          customer_id: row.customer_id,
          status: row.status,
          amount: row.receipt_amount,
          unallocated: row.unallocated_amount,
          currency: row.currency,
        },
      }))),
    ].slice(0, limit);

    return jsonResponse(successResponse(results, { total: results.length }));
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});

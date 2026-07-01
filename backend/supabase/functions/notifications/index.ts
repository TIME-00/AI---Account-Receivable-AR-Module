// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: notifications
// Read-only derived notification signals. No fake messages, no mutations.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { extractCompanyId, getAuthContext, requireOperationalReadRole } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';
import { errorResponse, successResponse, ValidationError } from '../_shared/errors.ts';

type NotificationItem = {
  id: string;
  type: 'import_review' | 'import_error' | 'overdue_ar';
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  route: string;
  created_at: string | null;
  metadata: Record<string, string | number | null>;
};

type ImportBatchRow = {
  id: string;
  batch_name: string;
  import_type: 'invoice' | 'receipt';
  status: string;
  error_rows: number | null;
  unmatched_count: number | null;
  created_at: string | null;
};

function normalizeLimit(value: string | null): number {
  if (!value) return 10;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new ValidationError('limit must be an integer from 1 to 20.', { field: 'limit' });
  }
  return parsed;
}

function importRoute(importType: 'invoice' | 'receipt'): string {
  return importType === 'receipt' ? '/receipts/import' : '/invoices/import';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    if (req.method !== 'GET') {
      return jsonResponse(
        { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
        404,
      );
    }

    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    requireOperationalReadRole(auth);

    const limit = normalizeLimit(url.searchParams.get('limit'));
    const client = getAdminClient();

    const { data: importBatches, error: importError } = await client
      .from('import_batches')
      .select('id, batch_name, import_type, status, error_rows, unmatched_count, created_at')
      .eq('company_id', auth.companyId)
      .in('status', ['Parsed', 'Validated', 'Completed'])
      .or('error_rows.gt.0,unmatched_count.gt.0')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (importError) {
      throw new Error(`Failed to derive import notifications: ${importError.message}`);
    }

    const importNotifications: NotificationItem[] = ((importBatches ?? []) as ImportBatchRow[]).map((batch): NotificationItem => {
      const needsReview = Number(batch.unmatched_count ?? 0) > 0;
      return {
        id: `import-${batch.id}`,
        type: needsReview ? 'import_review' : 'import_error',
        severity: needsReview ? 'warning' : 'error',
        title: needsReview ? 'Import rows need review' : 'Import completed with errors',
        message: `${batch.batch_name} (${batch.import_type}) has ${batch.unmatched_count ?? 0} unmatched/review rows and ${batch.error_rows ?? 0} error rows.`,
        route: importRoute(batch.import_type),
        created_at: batch.created_at,
        metadata: {
          batch_id: batch.id,
          import_type: batch.import_type,
          status: batch.status,
          error_rows: batch.error_rows ?? 0,
          unmatched_count: batch.unmatched_count ?? 0,
        },
      };
    });

    return jsonResponse(successResponse(importNotifications.slice(0, limit), {
      total: importNotifications.length,
    }));
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});

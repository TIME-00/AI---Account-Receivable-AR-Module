// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Report Service
// Implements PRD Part 4: Aging Analysis & Customer Statement
// Wraps database views/functions for API consumption
// ============================================================================

import { SupabaseClient } from 'supabase';
import { getAdminClient } from '../_shared/db.ts';
import {
  AuthorizationError,
  BusinessError,
} from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
import {
  requireAnyRole,
  requireOperationalReadRole,
} from '../_shared/auth.ts';
import { validateUUID, validateDate } from '../_shared/validators.ts';
import type { PaginationParams } from '../_shared/types.ts';
import { validateDashboardMetricsResponse } from './dashboard-types.ts';
import type { LiveDashboardMetrics } from './dashboard-types.ts';
import {
  CURRENT_BALANCE_BOOKED_RATE_BASIS,
  STORED_BOOKED_BASE_SNAPSHOT_BASIS,
} from './monetary-contracts.ts';
import type {
  CurrencyTotal,
  MonetaryAggregationMeta,
  StatementCurrencyBalance,
} from './monetary-contracts.ts';

const DASHBOARD_READ_ROLES = [
  'AR Clerk',
  'AR Supervisor',
  'Finance Manager',
  'Auditor',
] as const;

const DASHBOARD_COMPANY_SCOPE_ROLES = new Set([
  'AR Supervisor',
  'Finance Manager',
  'Auditor',
]);

interface DashboardRpcError {
  code?: string;
  message?: string;
}

function mapDashboardRpcError(error: DashboardRpcError): Error {
  const message = error.message ?? '';

  if (error.code === '42501' || message.startsWith('AUTH:')) {
    return new AuthorizationError('Dashboard access is not permitted.');
  }

  if (message.startsWith('NOT_FOUND:')) {
    return new BusinessError('NOT_FOUND', 'Active company not found.', 404);
  }

  if (message.startsWith('BR-DASH-001:')) {
    return new BusinessError(
      'BR-DASH-001',
      message.slice('BR-DASH-001:'.length).trim(),
      400,
    );
  }

  console.error('[reports/dashboard] RPC failed:', {
    code: error.code,
    message: error.message,
  });
  return new Error('Failed to load dashboard metrics.');
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgingBucketResult {
  bucket_name: string;
  from_days: number;
  to_days: number | null;
  invoice_count: number;
  /**
   * Backward-compatible alias now populated with company-base current outstanding.
   * Use base_total + by_currency for multi-currency aware presentation.
   */
  total_outstanding: number;
  base_total: number;
  base_currency: string;
  by_currency: CurrencyTotal[];
  normalization_basis: typeof CURRENT_BALANCE_BOOKED_RATE_BASIS;
  percentage: number;
}

export interface CustomerAgingRow {
  customer_id: string;
  customer_name: string;
  customer_code: string;
  credit_limit: number;
  credit_rating: string;
  /**
   * Backward-compatible alias now populated with company-base current outstanding.
   */
  total_outstanding: number;
  base_total: number;
  base_currency: string;
  by_currency: CurrencyTotal[];
  meta: MonetaryAggregationMeta;
  current_amount: number;
  bucket_1_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_over_90: number;
}

export interface StatementLine {
  date: string;
  doc_type: string;
  doc_no: string;
  description: string;
  currency: string;
  exchange_rate: number;
  transaction_debit: number;
  transaction_credit: number;
  transaction_balance: number | null;
  debit: number;
  credit: number;
  balance: number | null;
  base_currency: string;
  base_debit: number;
  base_credit: number;
  base_balance: number;
  amount_basis: typeof STORED_BOOKED_BASE_SNAPSHOT_BASIS;
}

export interface CustomerStatement {
  customer_id: string;
  customer_name: string;
  customer_code: string;
  address: string;
  period_from: string;
  period_to: string;
  opening_balance: number | null;
  lines: StatementLine[];
  closing_balance: number | null;
  total_debit: number | null;
  total_credit: number | null;
  base_currency: string;
  opening_balance_base: number;
  closing_balance_base: number;
  total_debit_base: number;
  total_credit_base: number;
  by_currency: StatementCurrencyBalance[];
  meta: MonetaryAggregationMeta;
  legacy_amount_basis: 'transaction_currency_legacy';
  legacy_transaction_fields_valid: boolean;
  legacy_transaction_currency: string | null;
}

export interface ARSummary {
  total_customers: number;
  /**
   * Backward-compatible alias now populated with company-base current outstanding.
   */
  total_outstanding: number;
  total_overdue: number;
  overdue_percentage: number;
  base_total: number;
  base_currency: string;
  by_currency: CurrencyTotal[];
  meta: MonetaryAggregationMeta;
  aging_summary: AgingBucketResult[];
}

// ─── Report Service ─────────────────────────────────────────────────────────

export class ReportService {
  private client: SupabaseClient;
  private readClient: SupabaseClient | null;

  /**
   * @param client Trusted client retained only for the established dashboard RPC.
   * @param readClient JWT-scoped authenticated client required by migration-027 reads.
   */
  constructor(client?: SupabaseClient, readClient: SupabaseClient | null = null) {
    this.client = client ?? getAdminClient();
    this.readClient = readClient;
  }

  private requireReadClient(): SupabaseClient {
    if (!this.readClient) {
      throw new Error('Authenticated read client is required for report user-domain reads.');
    }
    return this.readClient;
  }

  private readScopeMode(auth: AuthContext): 'company' | 'assigned' {
    return auth.roles.some(role => DASHBOARD_COMPANY_SCOPE_ROLES.has(role))
      ? 'company'
      : 'assigned';
  }

  private async callAuthoritativeRead<T>(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const readClient = this.requireReadClient();
    const { data, error } = await readClient.rpc(functionName, params);
    if (error) {
      const message = error.message ?? '';
      if (error.code === '42501' || message.startsWith('AUTH:')) {
        throw new AuthorizationError('Report access is not permitted.');
      }
      if (message.startsWith('NOT_FOUND:')) {
        throw new BusinessError('NOT_FOUND', message.slice('NOT_FOUND:'.length).trim(), 404);
      }
      console.error(`[reports/${functionName}] RPC failed:`, { code: error.code, message: error.message });
      throw new Error('Failed to load authoritative report data.');
    }
    if (!data || typeof data !== 'object') {
      throw new Error('Authoritative report RPC returned an invalid response.');
    }
    return data as T;
  }

  // ════════════════════════════════════════════════════════════════════════
  // AGING REPORT — SUMMARY (PRD Part 4 §2.1)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get company-wide AR aging summary.
   * Groups all outstanding invoices into aging buckets (Current, 1-30, 31-60, 61-90, 90+).
   */
  async getAgingSummary(
    auth: AuthContext,
    asOfDate?: string,
  ): Promise<ARSummary> {
    requireOperationalReadRole(auth);
    const refDate = asOfDate ?? new Date().toISOString().slice(0, 10);
    return await this.callAuthoritativeRead<ARSummary>('ar_aging_summary', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_scope_mode: this.readScopeMode(auth),
      p_as_of_date: refDate,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // AGING REPORT — BY CUSTOMER (PRD Part 4 §2.2)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Get aging breakdown per customer.
   */
  async getAgingByCustomer(
    auth: AuthContext,
    asOfDate?: string,
    pagination?: PaginationParams,
  ): Promise<{ rows: CustomerAgingRow[]; total: number }> {
    requireOperationalReadRole(auth);
    const refDate = asOfDate ?? new Date().toISOString().slice(0, 10);
    return await this.callAuthoritativeRead<{ rows: CustomerAgingRow[]; total: number }>(
      'ar_aging_by_customer',
      {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
        p_scope_mode: this.readScopeMode(auth),
        p_as_of_date: refDate,
        p_page: pagination?.page ?? 1,
        p_page_size: pagination?.page_size ?? 200,
      },
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // CUSTOMER STATEMENT (PRD Part 4 §3)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Generate a customer statement for a given period.
   * Shows all transactions (invoices, CNs, DNs, receipts) chronologically
   * with running balance.
   */
  async getCustomerStatement(
    auth: AuthContext,
    customerId: string,
    periodFrom: string,
    periodTo: string,
  ): Promise<CustomerStatement> {
    requireOperationalReadRole(auth);
    validateUUID(customerId, 'customer_id');
    validateDate(periodFrom, 'period_from');
    validateDate(periodTo, 'period_to');

    return await this.callAuthoritativeRead<CustomerStatement>('ar_customer_statement', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_scope_mode: this.readScopeMode(auth),
      p_customer_id: customerId,
      p_period_from: periodFrom,
      p_period_to: periodTo,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // AR DASHBOARD SUMMARY
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Return the live, base-currency dashboard contract plus deprecated aliases.
   */
  async getDashboardMetrics(
    auth: AuthContext,
    businessDate: string,
    trendMonths = 6,
  ): Promise<LiveDashboardMetrics> {
    requireAnyRole(auth, [...DASHBOARD_READ_ROLES]);
    validateDate(businessDate, 'business_date');

    if (!Number.isInteger(trendMonths) || trendMonths < 1 || trendMonths > 12) {
      throw new BusinessError(
        'BR-DASH-001',
        'trend_months must be between 1 and 12',
      );
    }

    const hasCompanyScope = auth.roles.some(role =>
      DASHBOARD_COMPANY_SCOPE_ROLES.has(role)
    );
    const scopeMode = hasCompanyScope ? 'company' : 'assigned';

    const { data, error } = await this.client.rpc(
      'get_ar_dashboard_metrics',
      {
        p_company_id: auth.companyId,
        p_user_id: auth.userId,
        p_scope_mode: scopeMode,
        p_as_of_date: businessDate,
        p_trend_months: trendMonths,
      },
    );

    if (error) {
      throw mapDashboardRpcError(error);
    }

    return validateDashboardMetricsResponse(data);
  }
}

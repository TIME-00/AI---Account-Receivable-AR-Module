// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Report Service
// Implements PRD Part 4: Aging Analysis & Customer Statement
// Wraps database views/functions for API consumption
// ============================================================================

import { SupabaseClient } from 'supabase';
import { getAdminClient, fetchById } from '../_shared/db.ts';
import {
  AuthorizationError,
  BusinessError,
  NotFoundError,
} from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
import {
  requireAnyRole,
  requireRole,
  requireCustomerAccess,
  getCustomerAccessFilter,
} from '../_shared/auth.ts';
import { validateUUID, validateDate } from '../_shared/validators.ts';
import type { PaginationParams } from '../_shared/types.ts';
import { roundTo2 } from '../invoices/calculator.ts';
import { assertCustomerVisible, getVisibleCustomerIds } from '../_shared/visibility.ts';
import { validateDashboardMetricsResponse } from './dashboard-types.ts';
import type { LiveDashboardMetrics } from './dashboard-types.ts';

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
  total_outstanding: number;
  percentage: number;
}

export interface CustomerAgingRow {
  customer_id: string;
  customer_name: string;
  customer_code: string;
  credit_limit: number;
  credit_rating: string;
  total_outstanding: number;
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
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerStatement {
  customer_id: string;
  customer_name: string;
  customer_code: string;
  address: string;
  period_from: string;
  period_to: string;
  opening_balance: number;
  lines: StatementLine[];
  closing_balance: number;
  total_debit: number;
  total_credit: number;
}

export interface ARSummary {
  total_customers: number;
  total_outstanding: number;
  total_overdue: number;
  overdue_percentage: number;
  aging_summary: AgingBucketResult[];
}

// ─── Report Service ─────────────────────────────────────────────────────────

export class ReportService {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
  }

  private async getReadableVisibleCustomerIds(auth: AuthContext): Promise<string[]> {
    const visibleCustomerIds = await getVisibleCustomerIds(this.client, auth.companyId);
    if (visibleCustomerIds.length === 0) return [];

    const allowedCustomerIds = await getCustomerAccessFilter(auth);
    if (allowedCustomerIds === null) return visibleCustomerIds;

    return visibleCustomerIds.filter(id => allowedCustomerIds.includes(id));
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
    requireRole(auth, 'AR Clerk');
    const refDate = asOfDate ?? new Date().toISOString().slice(0, 10);
    const visibleCustomerIds = await this.getReadableVisibleCustomerIds(auth);
    if (visibleCustomerIds.length === 0) {
      return {
        total_customers: 0,
        total_outstanding: 0,
        total_overdue: 0,
        overdue_percentage: 0,
        aging_summary: [
          { bucket_name: 'Current', from_days: 0, to_days: 0, invoice_count: 0, total_outstanding: 0, percentage: 0 },
          { bucket_name: '1-30', from_days: 1, to_days: 30, invoice_count: 0, total_outstanding: 0, percentage: 0 },
          { bucket_name: '31-60', from_days: 31, to_days: 60, invoice_count: 0, total_outstanding: 0, percentage: 0 },
          { bucket_name: '61-90', from_days: 61, to_days: 90, invoice_count: 0, total_outstanding: 0, percentage: 0 },
          { bucket_name: 'Over 90', from_days: 91, to_days: null, invoice_count: 0, total_outstanding: 0, percentage: 0 },
        ],
      };
    }

    // Use the v_customer_ar_summary view supplemented with direct queries
    const { data: summaryData, error: sumErr } = await this.client
      .from('v_customer_ar_summary')
      .select('*')
      .eq('company_id', auth.companyId)
      .in('id', visibleCustomerIds);

    if (sumErr) throw new Error(`Failed to get AR summary: ${sumErr.message}`);

    const rows = (summaryData ?? []);
    const totalCustomers = rows.length;
    const totalOutstanding = rows.reduce((s, r) => s + Number(r.total_ar_balance ?? 0), 0);
    const totalOverdue = rows.reduce((s, r) => s + Number(r.overdue_ar_balance ?? 0), 0);

    // Calculate aging buckets from outstanding invoices
    const { data: invoices } = await this.client
      .from('invoices')
      .select('total_amount, outstanding, due_date')
      .eq('company_id', auth.companyId)
      .in('customer_id', visibleCustomerIds)
      .in('status', ['Open', 'Overdue', 'Partially Paid'])
      .in('doc_type', ['Invoice', 'Debit Note'])
      .gt('outstanding', 0);

    const buckets: AgingBucketResult[] = [
      { bucket_name: 'Current',  from_days: 0,  to_days: 0,    invoice_count: 0, total_outstanding: 0, percentage: 0 },
      { bucket_name: '1-30',     from_days: 1,  to_days: 30,   invoice_count: 0, total_outstanding: 0, percentage: 0 },
      { bucket_name: '31-60',    from_days: 31, to_days: 60,   invoice_count: 0, total_outstanding: 0, percentage: 0 },
      { bucket_name: '61-90',    from_days: 61, to_days: 90,   invoice_count: 0, total_outstanding: 0, percentage: 0 },
      { bucket_name: 'Over 90',  from_days: 91, to_days: null, invoice_count: 0, total_outstanding: 0, percentage: 0 },
    ];

    const today = new Date(refDate);

    for (const inv of (invoices ?? [])) {
      if (!inv.due_date) continue;
      const dueDate = new Date(inv.due_date);
      const daysPast = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const amount = Number(inv.outstanding);

      let bucketIdx: number;
      if (daysPast <= 0) {
        bucketIdx = 0; // Current
      } else if (daysPast <= 30) {
        bucketIdx = 1;
      } else if (daysPast <= 60) {
        bucketIdx = 2;
      } else if (daysPast <= 90) {
        bucketIdx = 3;
      } else {
        bucketIdx = 4;
      }

      buckets[bucketIdx].invoice_count++;
      buckets[bucketIdx].total_outstanding = roundTo2(buckets[bucketIdx].total_outstanding + amount);
    }

    // Calculate percentages
    const grandTotal = buckets.reduce((s, b) => s + b.total_outstanding, 0);
    for (const bucket of buckets) {
      bucket.percentage = grandTotal > 0 ? roundTo2((bucket.total_outstanding / grandTotal) * 100) : 0;
    }

    return {
      total_customers: totalCustomers,
      total_outstanding: roundTo2(totalOutstanding),
      total_overdue: roundTo2(totalOverdue),
      overdue_percentage: totalOutstanding > 0 ? roundTo2((totalOverdue / totalOutstanding) * 100) : 0,
      aging_summary: buckets,
    };
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
    requireRole(auth, 'AR Clerk');
    const refDate = asOfDate ?? new Date().toISOString().slice(0, 10);
    const today = new Date(refDate);

    const allowedIds = await getCustomerAccessFilter(auth);

    // Get all customers with outstanding invoices
    let customerQuery = this.client
      .from('customers')
      .select('id, customer_id, customer_name, credit_limit, credit_rating')
      .eq('company_id', auth.companyId)
      .eq('is_deleted', false)
      .eq('is_hidden', false);

    if (allowedIds !== null) {
      customerQuery = customerQuery.in('id', allowedIds);
    }

    const { data: customers, error: custErr } = await customerQuery;
    if (custErr) throw new Error(`Failed to get customers: ${custErr.message}`);

    const rows: CustomerAgingRow[] = [];

    for (const cust of (customers ?? [])) {
      const { data: invoices } = await this.client
        .from('invoices')
        .select('outstanding, due_date')
        .eq('customer_id', cust.id)
        .in('status', ['Open', 'Overdue', 'Partially Paid'])
        .in('doc_type', ['Invoice', 'Debit Note'])
        .gt('outstanding', 0);

      if (!invoices || invoices.length === 0) continue;

      let current = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0;

      for (const inv of invoices) {
        const dueDate = inv.due_date ? new Date(inv.due_date) : today;
        const daysPast = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const amt = Number(inv.outstanding);

        if (daysPast <= 0) current += amt;
        else if (daysPast <= 30) b1 += amt;
        else if (daysPast <= 60) b2 += amt;
        else if (daysPast <= 90) b3 += amt;
        else b4 += amt;
      }

      const total = roundTo2(current + b1 + b2 + b3 + b4);
      if (total <= 0) continue;

      rows.push({
        customer_id: cust.id,
        customer_name: cust.customer_name,
        customer_code: cust.customer_id,
        credit_limit: Number(cust.credit_limit),
        credit_rating: cust.credit_rating,
        total_outstanding: total,
        current_amount: roundTo2(current),
        bucket_1_30: roundTo2(b1),
        bucket_31_60: roundTo2(b2),
        bucket_61_90: roundTo2(b3),
        bucket_over_90: roundTo2(b4),
      });
    }

    // Sort by total outstanding descending
    rows.sort((a, b) => b.total_outstanding - a.total_outstanding);

    const total = rows.length;
    if (pagination) {
      const from = (pagination.page - 1) * pagination.page_size;
      const to = from + pagination.page_size;
      return { rows: rows.slice(from, to), total };
    }
    return { rows, total };
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
    requireRole(auth, 'AR Clerk');
    validateUUID(customerId, 'customer_id');
    validateDate(periodFrom, 'period_from');
    validateDate(periodTo, 'period_to');
    await requireCustomerAccess(auth, customerId);
    await assertCustomerVisible(this.client, auth.companyId, customerId);

    const customer = await fetchById<Record<string, unknown>>(this.client, 'customers', customerId);
    if (customer.company_id !== auth.companyId) throw new NotFoundError('Customer', customerId);

    // ── Calculate opening balance (outstanding as of periodFrom) ──
    // Sum all invoices/DNs posted before periodFrom minus receipts allocated before periodFrom
    const { data: invBefore } = await this.client
      .from('invoices')
      .select('total_amount, doc_type')
      .eq('customer_id', customerId)
      .in('doc_type', ['Invoice', 'Debit Note'])
      .neq('status', 'Draft')
      .neq('status', 'Cancelled')
      .lt('invoice_date', periodFrom);

    const { data: cnBefore } = await this.client
      .from('invoices')
      .select('total_amount')
      .eq('customer_id', customerId)
      .eq('doc_type', 'Credit Note')
      .neq('status', 'Draft')
      .neq('status', 'Cancelled')
      .lt('invoice_date', periodFrom);

    const { data: rctBefore } = await this.client
      .from('receipts')
      .select('receipt_amount')
      .eq('customer_id', customerId)
      .neq('status', 'Draft')
      .neq('status', 'Cancelled')
      .neq('status', 'Bounced')
      .lt('receipt_date', periodFrom);

    const invTotal = (invBefore ?? []).reduce((s, i) => s + Number(i.total_amount), 0);
    const cnTotal = (cnBefore ?? []).reduce((s, c) => s + Number(c.total_amount), 0);
    const rctTotal = (rctBefore ?? []).reduce((s, r) => s + Number(r.receipt_amount), 0);
    const openingBalance = roundTo2(invTotal - cnTotal - rctTotal);

    // ── Fetch transactions within the statement period ──
    const { data: invoicesInPeriod } = await this.client
      .from('invoices')
      .select('invoice_no, invoice_date, doc_type, total_amount, status')
      .eq('customer_id', customerId)
      .neq('status', 'Draft')
      .neq('status', 'Cancelled')
      .gte('invoice_date', periodFrom)
      .lte('invoice_date', periodTo)
      .order('invoice_date');

    const { data: receiptsInPeriod } = await this.client
      .from('receipts')
      .select('receipt_no, receipt_date, receipt_amount, payment_method, status')
      .eq('customer_id', customerId)
      .neq('status', 'Draft')
      .neq('status', 'Cancelled')
      .neq('status', 'Bounced')
      .gte('receipt_date', periodFrom)
      .lte('receipt_date', periodTo)
      .order('receipt_date');

    // ── Build statement lines ──
    const lines: StatementLine[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    // Add invoices and debit notes (debit side)
    for (const inv of (invoicesInPeriod ?? [])) {
      const isCredit = inv.doc_type === 'Credit Note';
      const amount = Number(inv.total_amount);

      lines.push({
        date: inv.invoice_date,
        doc_type: inv.doc_type,
        doc_no: inv.invoice_no,
        description: `${inv.doc_type}: ${inv.invoice_no}`,
        debit: isCredit ? 0 : amount,
        credit: isCredit ? amount : 0,
        balance: 0, // Calculated after sorting
      });

      if (isCredit) totalCredit += amount;
      else totalDebit += amount;
    }

    // Add receipts (credit side)
    for (const rct of (receiptsInPeriod ?? [])) {
      const amount = Number(rct.receipt_amount);
      lines.push({
        date: rct.receipt_date,
        doc_type: 'Receipt',
        doc_no: rct.receipt_no,
        description: `Receipt: ${rct.receipt_no} (${rct.payment_method})`,
        debit: 0,
        credit: amount,
        balance: 0,
      });
      totalCredit += amount;
    }

    // Sort by date, then doc_no
    lines.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.doc_no.localeCompare(b.doc_no);
    });

    // Calculate running balance
    let runningBalance = openingBalance;
    for (const line of lines) {
      runningBalance = roundTo2(runningBalance + line.debit - line.credit);
      line.balance = runningBalance;
    }

    const closingBalance = roundTo2(openingBalance + totalDebit - totalCredit);

    // Build address
    const addr = [
      customer.bill_addr_line1,
      customer.bill_addr_line2,
      customer.bill_city,
      customer.bill_state,
      customer.bill_postal,
      customer.bill_country,
    ].filter(Boolean).join(', ');

    return {
      customer_id: customerId,
      customer_name: customer.customer_name as string,
      customer_code: customer.customer_id as string,
      address: addr,
      period_from: periodFrom,
      period_to: periodTo,
      opening_balance: openingBalance,
      lines,
      closing_balance: closingBalance,
      total_debit: roundTo2(totalDebit),
      total_credit: roundTo2(totalCredit),
    };
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

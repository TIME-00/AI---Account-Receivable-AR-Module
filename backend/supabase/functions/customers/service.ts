// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Customer Master Data Service
// Implements ALL business rules from PRD Part 1 (BR-CUS, BR-CM, BR-AM, BR-PT)
// ============================================================================

import { SupabaseClient } from 'supabase';
import { getAdminClient, getNextSequence, getConfigValue, getGLAccountId, fetchById } from '../_shared/db.ts';
import {
  BusinessError,
  NotFoundError,
  BRErrors,
  ValidationError,
} from '../_shared/errors.ts';
import {
  CUSTOMER_STATUS_TRANSITIONS,
  CREDIT_LIMIT_ADJUSTMENT,
  CREDIT_RATING_ORDER,
  COUNTRY_DEFAULTS,
  CUSTOMER_TYPE_ACCOUNT_MAP,
  CONFIG_KEYS,
} from '../_shared/constants.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { requireRole, requireCustomerAccess, getCustomerAccessFilter } from '../_shared/auth.ts';
import { validateUUID, requireString, validateMinLength } from '../_shared/validators.ts';
import type {
  Customer,
  CustomerCreditUtilization,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  UpdateCreditLimitRequest,
  UpdateCreditRatingRequest,
  UpdateCustomerStatusRequest,
  CustomerListFilters,
  CustomerChangeLog,
  PaginationParams,
} from '../_shared/types.ts';

// ─── Customer Service ───────────────────────────────────────────────────────

export class CustomerService {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREATE CUSTOMER
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Create a new customer master record.
   * PRD Part 1 §2, §5 (Account Mapping)
   */
  async createCustomer(
    auth: AuthContext,
    data: CreateCustomerRequest,
  ): Promise<Customer> {
    // Permission: AR Clerk+
    requireRole(auth, 'AR Clerk');

    const customerName = normalizeCustomerName(data.customer_name);

    // Generate unique customer ID: CUST-NNNNN
    const customerId = await getNextSequence(this.client, auth.companyId, 'CUST');

    // Resolve default currency from country (BR-CUS-004)
    const defaultCurrency = data.default_currency
      ?? COUNTRY_DEFAULTS[data.bill_country]?.currency
      ?? 'MYR';

    // Resolve GL accounts using fallback chain (BR-AM-001):
    // Customer-level → Customer Type → System Default
    const resolvedAccounts = await this.resolveAccountMappings(
      auth.companyId,
      data.customer_type,
      data,
    );

    // Build insert payload
    const insertData = {
      company_id: auth.companyId,
      customer_id: customerId,
      customer_name: customerName,
      short_name: data.short_name ?? null,
      customer_type: data.customer_type,
      registration_no: data.registration_no ?? null,
      tax_id: data.tax_id ?? null,
      status: 'Active' as const,    // New customers always start Active
      customer_group_id: data.customer_group_id ?? null,
      parent_id: data.parent_id ?? null,
      is_deleted: false,
      is_hidden: false,

      // Contact
      bill_addr_line1: data.bill_addr_line1,
      bill_addr_line2: data.bill_addr_line2 ?? null,
      bill_city: data.bill_city,
      bill_state: data.bill_state,
      bill_postal: data.bill_postal,
      bill_country: data.bill_country,
      contact_name: data.contact_name,
      contact_phone: data.contact_phone,
      contact_email: data.contact_email,
      shipping_addresses: data.shipping_addresses ?? [],
      alt_contacts: data.alt_contacts ?? [],

      // Finance
      default_currency: defaultCurrency,
      ar_control_acct_id: resolvedAccounts.ar_control_acct_id,
      revenue_acct_id: resolvedAccounts.revenue_acct_id,
      tax_output_acct_id: data.tax_output_acct_id ?? null,
      discount_acct_id: data.discount_acct_id ?? null,
      bad_debt_acct_id: data.bad_debt_acct_id ?? null,
      allowance_acct_id: data.allowance_acct_id ?? null,
      forex_gain_acct_id: data.forex_gain_acct_id ?? null,
      forex_loss_acct_id: data.forex_loss_acct_id ?? null,
      payment_term_id: data.payment_term_id ?? null,
      credit_limit: data.credit_limit ?? 0,
      credit_rating: data.credit_rating ?? 'A',
      e_invoice_enabled: data.e_invoice_enabled ?? false,

      // Audit
      created_by: auth.userId,
      updated_by: auth.userId,
    };

    const { data: created, error } = await this.client
      .from('customers')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const existing = await this.findVisibleCustomerByNormalizedName(auth.companyId, customerName);
        if (existing) {
          throw new BusinessError(
            'DUPLICATE_CUSTOMER_NAME',
            `A visible customer named "${customerName}" already exists.`,
            409,
            { customer_id: existing.id },
          );
        }
        throw new BusinessError('DUPLICATE_CUSTOMER',
          `Customer ID ${customerId} already exists. Please retry.`, 409);
      }
      throw new Error(`Failed to create customer: ${error.message}`);
    }

    // Log creation in change log
    await this.logChange(created.id, 'CREATED', null, customerId, auth.userId, 'New customer record created');
    await this.assignCreatedCustomerToClerk(auth, created.id);

    return created as Customer;
  }

  /**
   * Client-facing inline create for invoice and receipt workbenches.
   * Returns an authorized visible match when one exists, otherwise creates a
   * visible customer through the standard customer master-data path.
   */
  async createInlineCustomer(
    auth: AuthContext,
    data: CreateCustomerRequest,
  ): Promise<{ customer: Customer; created: boolean }> {
    requireRole(auth, 'AR Clerk');

    const normalizedName = normalizeCustomerName(data.customer_name);
    const existing = await this.findVisibleCustomerByNormalizedName(auth.companyId, normalizedName);
    if (existing) {
      await requireCustomerAccess(auth, existing.id);
      return { customer: existing, created: false };
    }

    const paymentTermId = data.payment_term_id ?? await this.getDefaultPaymentTermId(auth.companyId);

    try {
      const customer = await this.createCustomer(auth, {
        ...data,
        customer_name: normalizedName,
        payment_term_id: paymentTermId ?? undefined,
      });
      return { customer, created: true };
    } catch (error) {
      // The visible-name index closes the race between lookup and insert.
      if (error instanceof BusinessError && error.code === 'DUPLICATE_CUSTOMER_NAME') {
        const racedCustomer = await this.findVisibleCustomerByNormalizedName(auth.companyId, normalizedName);
        if (racedCustomer) {
          await requireCustomerAccess(auth, racedCustomer.id);
          return { customer: racedCustomer, created: false };
        }
      }
      throw error;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET CUSTOMER BY ID
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Fetch a single customer by internal UUID.
   * Includes credit utilization summary.
   */
  async getCustomerById(
    auth: AuthContext,
    customerId: string, // UUID
  ): Promise<Customer & { _credit?: CustomerCreditUtilization }> {
    validateUUID(customerId, 'id');
    await requireCustomerAccess(auth, customerId);

    const customer = await fetchById<Customer>(this.client, 'customers', customerId);

    if (customer.company_id !== auth.companyId) {
      throw new NotFoundError('Customer', customerId);
    }

    if (customer.is_deleted) {
      throw new NotFoundError('Customer', customerId);
    }
    if (customer.is_hidden) {
      throw new NotFoundError('Customer', customerId);
    }

    // Attach credit utilization from view (BR-CUS-005)
    const { data: creditData } = await this.client
      .from('v_customer_credit_utilization')
      .select('*')
      .eq('id', customerId)
      .single();

    return {
      ...customer,
      _credit: creditData as CustomerCreditUtilization | undefined,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // LIST CUSTOMERS (Paginated + Filtered)
  // ════════════════════════════════════════════════════════════════════════

  async listCustomers(
    auth: AuthContext,
    filters: CustomerListFilters,
    pagination: PaginationParams,
  ): Promise<{ customers: Customer[]; total: number }> {
    // Get customer access filter for AR Clerks (PRD Part 5 §5.2)
    const allowedIds = await getCustomerAccessFilter(auth);

    let query = this.client
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .eq('is_hidden', false);

    // Soft-delete filter
    if (!filters.include_deleted) {
      query = query.eq('is_deleted', false);
    }

    // AR Clerk scope filter
    if (allowedIds !== null) {
      query = query.in('id', allowedIds);
    }

    // Apply filters
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.customer_type) query = query.eq('customer_type', filters.customer_type);
    if (filters.customer_group_id) query = query.eq('customer_group_id', filters.customer_group_id);
    if (filters.bill_country) query = query.eq('bill_country', filters.bill_country);
    if (filters.credit_rating) query = query.eq('credit_rating', filters.credit_rating);

    // Search across name, short_name, customer_id
    if (filters.search) {
      const search = `%${filters.search}%`;
      query = query.or(
        `customer_name.ilike.${search},short_name.ilike.${search},customer_id.ilike.${search}`,
      );
    }

    // Pagination
    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;
    query = query
      .order('customer_id', { ascending: true })
      .range(from, to);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to list customers: ${error.message}`);
    }

    return {
      customers: (data ?? []) as Customer[],
      total: count ?? 0,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // UPDATE CUSTOMER
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Update customer master data fields.
   * Automatically logs all field changes to customer_change_logs (PRD Part 1 §6.1).
   * Sensitive fields require change_reason (PRD Part 1 §6.2).
   */
  async updateCustomer(
    auth: AuthContext,
    customerId: string,
    data: UpdateCustomerRequest,
  ): Promise<Customer> {
    validateUUID(customerId, 'id');
    requireRole(auth, 'AR Clerk');
    await requireCustomerAccess(auth, customerId);

    // Fetch current record
    const current = await fetchById<Customer>(this.client, 'customers', customerId);
    if (current.company_id !== auth.companyId) throw new NotFoundError('Customer', customerId);
    if (current.is_deleted) throw new NotFoundError('Customer', customerId);

    // Check status restrictions (BR-CUS-002)
    if (current.status === 'Blocked') {
      throw BRErrors.CUS_002_BLOCKED(current.customer_name);
    }

    // Build update payload (omit undefined fields)
    const updatePayload: Record<string, unknown> = { updated_by: auth.userId };
    const changes: Array<{ field: string; old_value: string | null; new_value: string | null }> = [];

    // Cast current to generic Record type to avoid Deno type-checking errors
    const currentData = current as unknown as Record<string, unknown>;

    for (const [key, newValue] of Object.entries(data)) {
      if (newValue === undefined) continue;

      // Use the pre-cast currentData to avoid further type assertions
      const oldValue = currentData[key];

      // Compare old and new values (serialize objects/arrays for comparison)
      const oldStr = oldValue === null || oldValue === undefined
        ? null
        : typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue);

      const newStr = newValue === null || newValue === undefined
        ? null
        : typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue);

      if (oldStr !== newStr) {
        // Add to update payload and change log
        updatePayload[key] = newValue;
        changes.push({
          field: key,
          old_value: oldStr,
          new_value: newStr
        });
      }
    }

    if (changes.length === 0) {
      return current; // No actual changes
    }

    // Perform update
    const { data: updated, error } = await this.client
      .from('customers')
      .update(updatePayload)
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update customer: ${error.message}`);
    }

    // Log all changes to audit trail (PRD Part 1 §6.1)
    for (const change of changes) {
      await this.logChange(
        customerId,
        change.field,
        change.old_value,
        change.new_value,
        auth.userId,
      );
    }

    return updated as Customer;
  }

  // ════════════════════════════════════════════════════════════════════════
  // DELETE CUSTOMER (Soft Delete)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Logically delete a customer (BR-CUS-003).
   * Pre-conditions:
   * - No outstanding balance (invoices + receipts)
   * - Finance Manager role required
   */
  async deleteCustomer(
    auth: AuthContext,
    customerId: string,
  ): Promise<void> {
    validateUUID(customerId, 'id');
    requireRole(auth, 'Finance Manager');

    const customer = await fetchById<Customer>(this.client, 'customers', customerId);
    if (customer.company_id !== auth.companyId) throw new NotFoundError('Customer', customerId);
    if (customer.is_deleted) throw new NotFoundError('Customer', customerId);

    // Check for outstanding balances (BR-CUS-003)
    const { data: creditData } = await this.client
      .from('v_customer_credit_utilization')
      .select('total_outstanding, total_unallocated_receipts')
      .eq('id', customerId)
      .single();

    if (creditData) {
      const outstanding = Number(creditData.total_outstanding) || 0;
      const unallocated = Number(creditData.total_unallocated_receipts) || 0;
      if (outstanding > 0 || unallocated > 0) {
        throw BRErrors.CUS_003_CANNOT_DELETE(
          customer.customer_name,
          outstanding,
        );
      }
    }

    // Soft delete
    const { error } = await this.client
      .from('customers')
      .update({
        is_deleted: true,
        status: 'Inactive',
        updated_by: auth.userId,
      })
      .eq('id', customerId);

    if (error) {
      throw new Error(`Failed to delete customer: ${error.message}`);
    }

    await this.logChange(customerId, 'is_deleted', 'false', 'true', auth.userId, 'Logical deletion');
    await this.logChange(customerId, 'status', customer.status, 'Inactive', auth.userId, 'Logical deletion triggered status change');
  }

  // ════════════════════════════════════════════════════════════════════════
  // UPDATE CUSTOMER STATUS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Change customer status with transition validation (PRD Part 1 §2.1).
   * Special rules:
   * - Blocked → Active: Finance Manager only
   * - Active → Blocked: AR Supervisor+
   */
  async updateStatus(
    auth: AuthContext,
    customerId: string,
    request: UpdateCustomerStatusRequest,
  ): Promise<Customer> {
    validateUUID(customerId, 'id');
    requireRole(auth, 'AR Clerk');

    const customer = await fetchById<Customer>(this.client, 'customers', customerId);
    if (customer.company_id !== auth.companyId) throw new NotFoundError('Customer', customerId);
    if (customer.is_deleted) throw new NotFoundError('Customer', customerId);

    const { new_status, reason } = request;
    requireString(reason, 'reason');
    validateMinLength(reason, 5, 'reason');

    // Validate transition is allowed
    const allowed = CUSTOMER_STATUS_TRANSITIONS[customer.status];
    if (!allowed || !allowed.includes(new_status)) {
      throw BRErrors.CUS_INVALID_STATUS_TRANSITION(customer.status, new_status);
    }

    // Blocked → Active: Finance Manager only
    if (customer.status === 'Blocked' && new_status === 'Active') {
      requireRole(auth, 'Finance Manager');
    }

    // → Blocked: AR Supervisor+
    if (new_status === 'Blocked') {
      requireRole(auth, 'AR Supervisor');
    }

    // → On Hold: AR Supervisor+
    if (new_status === 'On Hold') {
      requireRole(auth, 'AR Supervisor');
    }

    const { data: updated, error } = await this.client
      .from('customers')
      .update({ status: new_status, updated_by: auth.userId })
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update customer status: ${error.message}`);
    }

    // Audit log
    await this.logChange(customerId, 'status', customer.status, new_status, auth.userId, reason);

    // Credit control log for hold/block actions
    if (['Blocked', 'On Hold'].includes(new_status)) {
      await this.logCreditControl(
        auth.companyId,
        customerId,
        new_status === 'Blocked' ? 'Manual Block' : 'Manual Hold',
        reason,
        auth.userId,
      );
    } else if (customer.status === 'Blocked' && new_status === 'Active') {
      await this.logCreditControl(
        auth.companyId,
        customerId,
        'Manual Unblock',
        reason,
        auth.userId,
      );
    }

    return updated as Customer;
  }

  // ════════════════════════════════════════════════════════════════════════
  // UPDATE CREDIT LIMIT (BR-CM-002)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Modify customer credit limit with authorization checks.
   * - AR Supervisor: ±20% of current limit
   * - Finance Manager: unlimited
   */
  async updateCreditLimit(
    auth: AuthContext,
    customerId: string,
    request: UpdateCreditLimitRequest,
  ): Promise<Customer> {
    validateUUID(customerId, 'id');
    requireRole(auth, 'AR Supervisor');

    const customer = await fetchById<Customer>(this.client, 'customers', customerId);
    if (customer.company_id !== auth.companyId) throw new NotFoundError('Customer', customerId);
    if (customer.is_deleted) throw new NotFoundError('Customer', customerId);

    const { new_credit_limit, reason } = request;
    requireString(reason, 'reason');
    validateMinLength(reason, 10, 'reason');

    if (new_credit_limit < 0) {
      throw new ValidationError('Credit limit cannot be negative.', { field: 'new_credit_limit' });
    }

    // Check if AR Supervisor's adjustment is within ±20% (BR-CM-002)
    const isSupervisorOnly = auth.highestRole === 'AR Supervisor';
    if (isSupervisorOnly && customer.credit_limit > 0) {
      const diff = Math.abs(new_credit_limit - customer.credit_limit);
      const pct = (diff / customer.credit_limit) * 100;
      if (pct > CREDIT_LIMIT_ADJUSTMENT.AR_SUPERVISOR_MAX_PCT) {
        throw BRErrors.CM_002_ADJUSTMENT_EXCEEDS_AUTHORITY(
          pct,
          CREDIT_LIMIT_ADJUSTMENT.AR_SUPERVISOR_MAX_PCT,
        );
      }
    }

    const { data: updated, error } = await this.client
      .from('customers')
      .update({ credit_limit: new_credit_limit, updated_by: auth.userId })
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update credit limit: ${error.message}`);
    }

    // Audit logs
    await this.logChange(
      customerId,
      'credit_limit',
      String(customer.credit_limit),
      String(new_credit_limit),
      auth.userId,
      reason,
    );

    await this.logCreditControl(
      auth.companyId,
      customerId,
      'Limit Adjustment',
      `${customer.credit_limit} → ${new_credit_limit}. Reason: ${reason}`,
      auth.userId,
      new_credit_limit,
    );

    return updated as Customer;
  }

  // ════════════════════════════════════════════════════════════════════════
  // UPDATE CREDIT RATING (BR-CM-003)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Modify customer credit rating.
   * Finance Manager only.
   * Downgrade to 'D' triggers automatic block (BR-CM-003).
   */
  async updateCreditRating(
    auth: AuthContext,
    customerId: string,
    request: UpdateCreditRatingRequest,
  ): Promise<Customer> {
    validateUUID(customerId, 'id');
    requireRole(auth, 'Finance Manager');

    const customer = await fetchById<Customer>(this.client, 'customers', customerId);
    if (customer.company_id !== auth.companyId) throw new NotFoundError('Customer', customerId);
    if (customer.is_deleted) throw new NotFoundError('Customer', customerId);

    const { new_credit_rating, reason } = request;
    requireString(reason, 'reason');
    validateMinLength(reason, 10, 'reason');

    const updatePayload: Record<string, unknown> = {
      credit_rating: new_credit_rating,
      updated_by: auth.userId,
    };

    // If downgraded to D, auto-block (BR-CM-003)
    const wasDowngradedToD = new_credit_rating === 'D' && customer.credit_rating !== 'D';
    if (wasDowngradedToD) {
      updatePayload.status = 'Blocked';
      updatePayload.credit_limit = 0;
    }

    const { data: updated, error } = await this.client
      .from('customers')
      .update(updatePayload)
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update credit rating: ${error.message}`);
    }

    // Audit logs
    await this.logChange(customerId, 'credit_rating', customer.credit_rating, new_credit_rating, auth.userId, reason);

    if (wasDowngradedToD) {
      await this.logChange(customerId, 'status', customer.status, 'Blocked', auth.userId, 'Credit rating downgraded to D, system auto-blocked');
      await this.logChange(customerId, 'credit_limit', String(customer.credit_limit), '0', auth.userId, 'Credit rating downgraded to D, system auto-zeroed limit');
    }

    const oldOrder = CREDIT_RATING_ORDER[customer.credit_rating] ?? 99;
    const newOrder = CREDIT_RATING_ORDER[new_credit_rating] ?? 99;
    const direction = newOrder > oldOrder ? 'Downgrade' : 'Upgrade';

    await this.logCreditControl(
      auth.companyId,
      customerId,
      `Rating ${direction}`,
      `${customer.credit_rating} → ${new_credit_rating}. Reason: ${reason}`,
      auth.userId,
    );

    return updated as Customer;
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET CREDIT SUMMARY (BR-CUS-005, BR-CM-005)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Fetch real-time credit utilization for a customer.
   * Computed from v_customer_credit_utilization view — not persisted.
   */
  async getCreditSummary(
    auth: AuthContext,
    customerId: string,
  ): Promise<CustomerCreditUtilization> {
    validateUUID(customerId, 'id');
    await requireCustomerAccess(auth, customerId);

    const { data, error } = await this.client
      .from('v_customer_credit_utilization')
      .select('*')
      .eq('id', customerId)
      .eq('company_id', auth.companyId)
      .single();

    if (error || !data) {
      throw new NotFoundError('Customer Credit Summary', customerId);
    }

    return data as CustomerCreditUtilization;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREDIT CHECK (Called by Invoice Service during posting)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Perform credit check before invoice posting (BR-CM-001).
   * Returns true if allowed, throws BusinessError if blocked.
   * 
   * @param checkAmount - The invoice total to be posted
   * @param allowOverride - If true, Finance Manager can override
   */
  async performCreditCheck(
    companyId: string,
    customerId: string,
    checkAmount: number,
    auth?: AuthContext,
  ): Promise<{ allowed: boolean; utilization: number; limit: number; available: number }> {
    const customer = await fetchById<Customer>(this.client, 'customers', customerId);

    // BR-CM-003: Rating D = absolute block
    if (customer.credit_rating === 'D') {
      throw BRErrors.CM_003_RATING_D_BLOCKED(customer.customer_name);
    }

    // BR-CUS-001: Inactive = no new invoices
    if (customer.status === 'Inactive') {
      throw BRErrors.CUS_001_INACTIVE(customer.customer_name);
    }

    // BR-CUS-002: Blocked = no transactions
    if (customer.status === 'Blocked') {
      throw BRErrors.CUS_002_BLOCKED(customer.customer_name);
    }

    // Get current credit utilization
    const { data: creditData } = await this.client
      .from('v_customer_credit_utilization')
      .select('credit_utilization, credit_limit, available_credit')
      .eq('id', customerId)
      .single();

    if (!creditData) {
      throw new NotFoundError('Customer Credit Data', customerId);
    }

    const utilization = Number(creditData.credit_utilization);
    const limit = Number(creditData.credit_limit);
    const available = Number(creditData.available_credit);

    // credit_limit = 0 means unlimited (common for Government, Intercompany)
    if (limit === 0) {
      return { allowed: true, utilization, limit, available: Infinity };
    }

    // Check if posting this invoice would exceed the limit
    const projectedUtilization = utilization + checkAmount;
    if (projectedUtilization > limit) {
      // Finance Manager can override (BR-CM-001)
      if (auth && auth.highestRole === 'Finance Manager') {
        // Log the override
        await this.logCreditControl(
          companyId,
          customerId,
          'Credit Override',
          `FM credit override. Invoice amount: ${checkAmount}, Current utilization: ${utilization}, Credit limit: ${limit}, Overrun: ${projectedUtilization - limit}`,
          auth.userId,
          checkAmount,
        );
        return { allowed: true, utilization, limit, available };
      }

      throw BRErrors.CM_001_CREDIT_EXCEEDED(
        utilization,
        limit,
        customer.customer_name,
      );
    }

    return { allowed: true, utilization, limit, available };
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET CHANGE LOG (PRD Part 1 §6)
  // ════════════════════════════════════════════════════════════════════════

  async getChangeLog(
    auth: AuthContext,
    customerId: string,
    pagination: PaginationParams,
  ): Promise<{ logs: CustomerChangeLog[]; total: number }> {
    validateUUID(customerId, 'id');
    requireRole(auth, 'AR Supervisor');
    await requireCustomerAccess(auth, customerId);

    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;

    const { data, error, count } = await this.client
      .from('customer_change_logs')
      .select('*', { count: 'exact' })
      .eq('customer_id', customerId)
      .order('changed_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch change log: ${error.message}`);
    }

    return {
      logs: (data ?? []) as CustomerChangeLog[],
      total: count ?? 0,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPER METHODS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Resolve GL account mappings using the 3-level fallback chain (BR-AM-001):
   * 1. Customer-level override
   * 2. Customer Type default mapping
   * 3. System-wide default
   */
  private async findVisibleCustomerByNormalizedName(
    companyId: string,
    customerName: string,
  ): Promise<Customer | null> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('company_id', companyId)
      .eq('normalized_customer_name', normalizeCustomerName(customerName).toLocaleLowerCase())
      .eq('is_deleted', false)
      .eq('is_hidden', false)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to check duplicate customer name: ${error.message}`);
    }

    return data as Customer | null;
  }

  private async getDefaultPaymentTermId(companyId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('payment_terms')
      .select('id')
      .eq('company_id', companyId)
      .eq('term_code', 'NET30')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch default payment term: ${error.message}`);
    }

    return data?.id ?? null;
  }

  private async assignCreatedCustomerToClerk(
    auth: AuthContext,
    customerId: string,
  ): Promise<void> {
    if (auth.highestRole !== 'AR Clerk') {
      return;
    }

    const { error } = await this.client
      .from('user_customer_assignments')
      .upsert({
        user_id: auth.userId,
        customer_id: customerId,
        company_id: auth.companyId,
        assigned_by: auth.userId,
        assigned_at: new Date().toISOString(),
        is_active: true,
      }, { onConflict: 'user_id,customer_id' });

    if (error) {
      throw new Error(`Failed to assign created customer to AR Clerk: ${error.message}`);
    }
  }

  private async resolveAccountMappings(
    companyId: string,
    customerType: string,
    data: CreateCustomerRequest,
  ): Promise<{ ar_control_acct_id: string | null; revenue_acct_id: string | null }> {
    // Level 1: Customer-level (from request)
    let arAcctId = data.ar_control_acct_id ?? null;
    let revAcctId = data.revenue_acct_id ?? null;

    // Level 2: Customer Type mapping (PRD Part 1 §5.3)
    if (!arAcctId) {
      const typeMap = CUSTOMER_TYPE_ACCOUNT_MAP[customerType];
      if (typeMap) {
        arAcctId = await getGLAccountId(this.client, companyId, typeMap.ar);
      }
    }
    if (!revAcctId) {
      const typeMap = CUSTOMER_TYPE_ACCOUNT_MAP[customerType];
      if (typeMap) {
        revAcctId = await getGLAccountId(this.client, companyId, typeMap.revenue);
      }
    }

    // Level 3: System default (ar_system_config)
    if (!arAcctId) {
      const defaultCode = await getConfigValue(this.client, companyId, CONFIG_KEYS.DEFAULT_AR_CONTROL_ACCT);
      if (defaultCode) {
        arAcctId = await getGLAccountId(this.client, companyId, defaultCode);
      }
    }
    if (!revAcctId) {
      const defaultCode = await getConfigValue(this.client, companyId, CONFIG_KEYS.DEFAULT_REVENUE_ACCT);
      if (defaultCode) {
        revAcctId = await getGLAccountId(this.client, companyId, defaultCode);
      }
    }

    return { ar_control_acct_id: arAcctId, revenue_acct_id: revAcctId };
  }

  /**
   * Write to customer_change_logs audit table.
   */
  private async logChange(
    customerId: string,
    fieldName: string,
    oldValue: string | null,
    newValue: string | null,
    changedBy: string,
    reason?: string,
  ): Promise<void> {
    await this.client
      .from('customer_change_logs')
      .insert({
        customer_id: customerId,
        field_name: fieldName,
        old_value: oldValue,
        new_value: newValue,
        changed_by: changedBy,
        change_reason: reason ?? null,
      });
  }

  /**
   * Write to credit_control_logs audit table.
   */
  private async logCreditControl(
    companyId: string,
    customerId: string,
    action: string,
    details: string,
    createdBy: string,
    amount?: number,
  ): Promise<void> {
    await this.client
      .from('credit_control_logs')
      .insert({
        company_id: companyId,
        customer_id: customerId,
        action,
        details,
        amount: amount ?? null,
        created_by: createdBy,
      });
  }
}

function normalizeCustomerName(customerName: string): string {
  return customerName.trim().replace(/\s+/g, ' ');
}

import { fetchById, getNextSequence } from "../_shared/db.ts";
import {
  BRErrors,
  BusinessError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import {
  COUNTRY_DEFAULTS,
  CUSTOMER_STATUS_TRANSITIONS,
} from "../_shared/constants.ts";
import type { AuthContext } from "../_shared/auth.ts";
import {
  getCustomerAccessFilter,
  requireCustomerAccess,
  requireRole,
} from "../_shared/auth.ts";
import {
  requireString,
  validateMinLength,
  validateUUID,
} from "../_shared/validators.ts";
import type {
  CreateCustomerRequest,
  Customer,
  CustomerCreditUtilization,
  CustomerListFilters,
  PaginationParams,
  UpdateCustomerRequest,
  UpdateCustomerStatusRequest,
} from "../_shared/types.ts";
import {
  type ImportCustomerClassification,
  type ImportCustomerLookup,
  normalizeCustomerName,
} from "./service-base.ts";
import { CustomerServiceBase } from "./service-base.ts";
export abstract class CustomerMasterService extends CustomerServiceBase {
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
    requireRole(auth, "AR Clerk");

    const customerName = normalizeCustomerName(data.customer_name);

    // Generate unique customer ID: CUST-NNNNN
    const customerId = await getNextSequence(
      this.client,
      auth.companyId,
      "CUST",
    );

    // Resolve default currency from country (BR-CUS-004)
    const defaultCurrency = data.default_currency ??
      COUNTRY_DEFAULTS[data.bill_country]?.currency ??
      "MYR";

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
      status: "Active" as const, // New customers always start Active
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
      credit_rating: data.credit_rating ?? "A",
      e_invoice_enabled: data.e_invoice_enabled ?? false,

      // Audit
      created_by: auth.userId,
      updated_by: auth.userId,
    };

    const { data: created, error } = await this.client
      .from("customers")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const existing = await this.findVisibleCustomerByNormalizedName(
          auth.companyId,
          customerName,
        );
        if (existing) {
          throw new BusinessError(
            "DUPLICATE_CUSTOMER_NAME",
            `A visible customer named "${customerName}" already exists.`,
            409,
            { customer_id: existing.id },
          );
        }
        throw new BusinessError(
          "DUPLICATE_CUSTOMER",
          `Customer ID ${customerId} already exists. Please retry.`,
          409,
        );
      }
      throw new Error(`Failed to create customer: ${error.message}`);
    }

    // Log creation in change log
    await this.logChange(
      created.id,
      "CREATED",
      null,
      customerId,
      auth.userId,
      "New customer record created",
    );
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
    requireRole(auth, "AR Clerk");

    const normalizedName = normalizeCustomerName(data.customer_name);
    const existing = await this.findVisibleCustomerByNormalizedName(
      auth.companyId,
      normalizedName,
    );
    if (existing) {
      await requireCustomerAccess(auth, existing.id);
      return { customer: existing, created: false };
    }

    const paymentTermId = data.payment_term_id ??
      await this.getDefaultPaymentTermId(auth.companyId);

    try {
      const customer = await this.createCustomer(auth, {
        ...data,
        customer_name: normalizedName,
        payment_term_id: paymentTermId ?? undefined,
      });
      return { customer, created: true };
    } catch (error) {
      // The visible-name index closes the race between lookup and insert.
      if (
        error instanceof BusinessError &&
        error.code === "DUPLICATE_CUSTOMER_NAME"
      ) {
        const racedCustomer = await this.findVisibleCustomerByNormalizedName(
          auth.companyId,
          normalizedName,
        );
        if (racedCustomer) {
          await requireCustomerAccess(auth, racedCustomer.id);
          return { customer: racedCustomer, created: false };
        }
      }
      throw error;
    }
  }

  /**
   * Read-only import classification. Customer creation is deliberately deferred
   * until the user executes the validated draft-only import batch.
   */
  async classifyImportCustomer(
    auth: AuthContext,
    lookup: ImportCustomerLookup,
  ): Promise<ImportCustomerClassification> {
    const customerCode = lookup.customerCode?.trim();
    const customerName = lookup.customerName
      ? normalizeCustomerName(lookup.customerName)
      : "";
    const registrationNo = lookup.registrationNo?.trim();

    if (customerCode) {
      const customer = await this.findVisibleCustomerByCode(
        auth.companyId,
        customerCode,
      );
      if (!customer) {
        throw new ValidationError(
          `Visible customer_code "${customerCode}" could not be resolved. Leave customer_code blank to create a new customer.`,
          { field: "customer_code", customer_code: customerCode },
        );
      }
      this.assertImportCustomerDataConsistent(
        customer,
        customerName,
        registrationNo,
      );
      return {
        action: "Matched Existing",
        customer,
        matchedBy: "customer_code",
        normalizedCustomerName: normalizeCustomerName(customer.customer_name),
      };
    }

    if (!customerName) {
      throw new ValidationError(
        "customer_name is required when customer_code is blank.",
        { field: "customer_name" },
      );
    }

    const customer = await this.findVisibleCustomerByNormalizedName(
      auth.companyId,
      customerName,
    );
    if (customer) {
      this.assertImportCustomerDataConsistent(
        customer,
        customerName,
        registrationNo,
      );
      return {
        action: "Matched Existing",
        customer,
        matchedBy: "normalized_name",
        normalizedCustomerName: customerName,
      };
    }

    const suggestions = await this.findVisibleCustomerSuggestions(
      auth,
      customerName,
      registrationNo,
    );
    if (suggestions.length > 0) {
      return {
        action: "Review Required",
        customer: null,
        matchedBy: "fuzzy_suggestion",
        normalizedCustomerName: customerName,
        suggestions,
        suggestionReason: suggestions.length > 1
          ? "multiple_customer_candidates"
          : suggestions[0].reason,
        confidence: suggestions[0].confidence,
      };
    }

    return {
      action: "Create New",
      customer: null,
      matchedBy: null,
      normalizedCustomerName: customerName,
    };
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
    validateUUID(customerId, "id");
    await requireCustomerAccess(auth, customerId);

    const customer = await fetchById<Customer>(
      this.client,
      "customers",
      customerId,
    );

    if (customer.company_id !== auth.companyId) {
      throw new NotFoundError("Customer", customerId);
    }

    if (customer.is_deleted) {
      throw new NotFoundError("Customer", customerId);
    }
    if (customer.is_hidden) {
      throw new NotFoundError("Customer", customerId);
    }

    // Attach credit utilization from view (BR-CUS-005)
    const { data: creditData } = await this.client
      .from("v_customer_credit_utilization")
      .select("*")
      .eq("id", customerId)
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
      .from("customers")
      .select("*", { count: "exact" })
      .eq("company_id", auth.companyId)
      .eq("is_hidden", false)
      .eq("is_deleted", false);

    // AR Clerk scope filter
    if (allowedIds !== null) {
      query = query.in("id", allowedIds);
    }

    // Apply filters
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.customer_type) {
      query = query.eq("customer_type", filters.customer_type);
    }
    if (filters.customer_group_id) {
      query = query.eq("customer_group_id", filters.customer_group_id);
    }
    if (filters.bill_country) {
      query = query.eq("bill_country", filters.bill_country);
    }
    if (filters.credit_rating) {
      query = query.eq("credit_rating", filters.credit_rating);
    }

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
      .order("customer_id", { ascending: true })
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
    validateUUID(customerId, "id");
    requireRole(auth, "AR Clerk");
    await requireCustomerAccess(auth, customerId);

    // Fetch current record
    const current = await fetchById<Customer>(
      this.client,
      "customers",
      customerId,
    );
    if (current.company_id !== auth.companyId) {
      throw new NotFoundError("Customer", customerId);
    }
    if (current.is_deleted) throw new NotFoundError("Customer", customerId);

    // Check status restrictions (BR-CUS-002)
    if (current.status === "Blocked") {
      throw BRErrors.CUS_002_BLOCKED(current.customer_name);
    }

    // Build update payload (omit undefined fields)
    const updatePayload: Record<string, unknown> = { updated_by: auth.userId };
    const changes: Array<
      { field: string; old_value: string | null; new_value: string | null }
    > = [];

    // Cast current to generic Record type to avoid Deno type-checking errors
    const currentData = current as unknown as Record<string, unknown>;

    for (const [key, newValue] of Object.entries(data)) {
      if (newValue === undefined) continue;

      // Use the pre-cast currentData to avoid further type assertions
      const oldValue = currentData[key];

      // Compare old and new values (serialize objects/arrays for comparison)
      const oldStr = oldValue === null || oldValue === undefined
        ? null
        : typeof oldValue === "object"
        ? JSON.stringify(oldValue)
        : String(oldValue);

      const newStr = newValue === null || newValue === undefined
        ? null
        : typeof newValue === "object"
        ? JSON.stringify(newValue)
        : String(newValue);

      if (oldStr !== newStr) {
        // Add to update payload and change log
        updatePayload[key] = newValue;
        changes.push({
          field: key,
          old_value: oldStr,
          new_value: newStr,
        });
      }
    }

    if (changes.length === 0) {
      return current; // No actual changes
    }

    // Perform update
    const { data: updated, error } = await this.client
      .from("customers")
      .update(updatePayload)
      .eq("id", customerId)
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
    validateUUID(customerId, "id");
    requireRole(auth, "Finance Manager");

    const customer = await fetchById<Customer>(
      this.client,
      "customers",
      customerId,
    );
    if (customer.company_id !== auth.companyId) {
      throw new NotFoundError("Customer", customerId);
    }
    if (customer.is_deleted) throw new NotFoundError("Customer", customerId);

    // Check for outstanding balances (BR-CUS-003)
    const { data: creditData } = await this.client
      .from("v_customer_credit_utilization")
      .select("total_outstanding, total_unallocated_receipts")
      .eq("id", customerId)
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
      .from("customers")
      .update({
        is_deleted: true,
        status: "Inactive",
        updated_by: auth.userId,
      })
      .eq("id", customerId);

    if (error) {
      throw new Error(`Failed to delete customer: ${error.message}`);
    }

    await this.logChange(
      customerId,
      "is_deleted",
      "false",
      "true",
      auth.userId,
      "Logical deletion",
    );
    await this.logChange(
      customerId,
      "status",
      customer.status,
      "Inactive",
      auth.userId,
      "Logical deletion triggered status change",
    );
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
    validateUUID(customerId, "id");
    requireRole(auth, "AR Clerk");

    const customer = await fetchById<Customer>(
      this.client,
      "customers",
      customerId,
    );
    if (customer.company_id !== auth.companyId) {
      throw new NotFoundError("Customer", customerId);
    }
    if (customer.is_deleted) throw new NotFoundError("Customer", customerId);

    const { new_status, reason } = request;
    requireString(reason, "reason");
    validateMinLength(reason, 5, "reason");

    // Validate transition is allowed
    const allowed = CUSTOMER_STATUS_TRANSITIONS[customer.status];
    if (!allowed || !allowed.includes(new_status)) {
      throw BRErrors.CUS_INVALID_STATUS_TRANSITION(customer.status, new_status);
    }

    // Blocked → Active: Finance Manager only
    if (customer.status === "Blocked" && new_status === "Active") {
      requireRole(auth, "Finance Manager");
    }

    // → Blocked: AR Supervisor+
    if (new_status === "Blocked") {
      requireRole(auth, "AR Supervisor");
    }

    // → On Hold: AR Supervisor+
    if (new_status === "On Hold") {
      requireRole(auth, "AR Supervisor");
    }

    const { data: updated, error } = await this.client
      .from("customers")
      .update({ status: new_status, updated_by: auth.userId })
      .eq("id", customerId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update customer status: ${error.message}`);
    }

    // Audit log
    await this.logChange(
      customerId,
      "status",
      customer.status,
      new_status,
      auth.userId,
      reason,
    );

    // Credit control log for hold/block actions
    if (["Blocked", "On Hold"].includes(new_status)) {
      await this.logCreditControl(
        auth.companyId,
        customerId,
        new_status === "Blocked" ? "Manual Block" : "Manual Hold",
        reason,
        auth.userId,
      );
    } else if (customer.status === "Blocked" && new_status === "Active") {
      await this.logCreditControl(
        auth.companyId,
        customerId,
        "Manual Unblock",
        reason,
        auth.userId,
      );
    }

    return updated as Customer;
  }
}

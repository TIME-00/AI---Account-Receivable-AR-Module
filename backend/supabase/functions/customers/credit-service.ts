import { fetchById } from "../_shared/db.ts";
import { BRErrors, NotFoundError, ValidationError } from "../_shared/errors.ts";
import {
  CREDIT_LIMIT_ADJUSTMENT,
  CREDIT_RATING_ORDER,
} from "../_shared/constants.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { requireCustomerAccess, requireRole } from "../_shared/auth.ts";
import {
  requireString,
  validateMinLength,
  validateUUID,
} from "../_shared/validators.ts";
import type {
  Customer,
  CustomerChangeLog,
  CustomerCreditUtilization,
  PaginationParams,
  UpdateCreditLimitRequest,
  UpdateCreditRatingRequest,
} from "../_shared/types.ts";
import { CustomerMasterService } from "./master-service.ts";
export abstract class CustomerCreditService extends CustomerMasterService {
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
    validateUUID(customerId, "id");
    requireRole(auth, "AR Supervisor");

    const customer = await fetchById<Customer>(
      this.client,
      "customers",
      customerId,
    );
    if (customer.company_id !== auth.companyId) {
      throw new NotFoundError("Customer", customerId);
    }
    if (customer.is_deleted) throw new NotFoundError("Customer", customerId);

    const { new_credit_limit, reason } = request;
    requireString(reason, "reason");
    validateMinLength(reason, 10, "reason");

    if (new_credit_limit < 0) {
      throw new ValidationError("Credit limit cannot be negative.", {
        field: "new_credit_limit",
      });
    }

    // Check if AR Supervisor's adjustment is within ±20% (BR-CM-002)
    const isSupervisorOnly = auth.highestRole === "AR Supervisor";
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
      .from("customers")
      .update({ credit_limit: new_credit_limit, updated_by: auth.userId })
      .eq("id", customerId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update credit limit: ${error.message}`);
    }

    // Audit logs
    await this.logChange(
      customerId,
      "credit_limit",
      String(customer.credit_limit),
      String(new_credit_limit),
      auth.userId,
      reason,
    );

    await this.logCreditControl(
      auth.companyId,
      customerId,
      "Limit Adjustment",
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

    const { new_credit_rating, reason } = request;
    requireString(reason, "reason");
    validateMinLength(reason, 10, "reason");

    const updatePayload: Record<string, unknown> = {
      credit_rating: new_credit_rating,
      updated_by: auth.userId,
    };

    // If downgraded to D, auto-block (BR-CM-003)
    const wasDowngradedToD = new_credit_rating === "D" &&
      customer.credit_rating !== "D";
    if (wasDowngradedToD) {
      updatePayload.status = "Blocked";
      updatePayload.credit_limit = 0;
    }

    const { data: updated, error } = await this.client
      .from("customers")
      .update(updatePayload)
      .eq("id", customerId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update credit rating: ${error.message}`);
    }

    // Audit logs
    await this.logChange(
      customerId,
      "credit_rating",
      customer.credit_rating,
      new_credit_rating,
      auth.userId,
      reason,
    );

    if (wasDowngradedToD) {
      await this.logChange(
        customerId,
        "status",
        customer.status,
        "Blocked",
        auth.userId,
        "Credit rating downgraded to D, system auto-blocked",
      );
      await this.logChange(
        customerId,
        "credit_limit",
        String(customer.credit_limit),
        "0",
        auth.userId,
        "Credit rating downgraded to D, system auto-zeroed limit",
      );
    }

    const oldOrder = CREDIT_RATING_ORDER[customer.credit_rating] ?? 99;
    const newOrder = CREDIT_RATING_ORDER[new_credit_rating] ?? 99;
    const direction = newOrder > oldOrder ? "Downgrade" : "Upgrade";

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
    validateUUID(customerId, "id");
    await requireCustomerAccess(auth, customerId);

    const { data, error } = await this.client
      .from("v_customer_credit_utilization")
      .select("*")
      .eq("id", customerId)
      .eq("company_id", auth.companyId)
      .single();

    if (error || !data) {
      throw new NotFoundError("Customer Credit Summary", customerId);
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
  ): Promise<
    { allowed: boolean; utilization: number; limit: number; available: number }
  > {
    const customer = await fetchById<Customer>(
      this.client,
      "customers",
      customerId,
    );

    // BR-CM-003: Rating D = absolute block
    if (customer.credit_rating === "D") {
      throw BRErrors.CM_003_RATING_D_BLOCKED(customer.customer_name);
    }

    // BR-CUS-001: Inactive = no new invoices
    if (customer.status === "Inactive") {
      throw BRErrors.CUS_001_INACTIVE(customer.customer_name);
    }

    // BR-CUS-002: Blocked = no transactions
    if (customer.status === "Blocked") {
      throw BRErrors.CUS_002_BLOCKED(customer.customer_name);
    }

    // Get current credit utilization
    const { data: creditData } = await this.client
      .from("v_customer_credit_utilization")
      .select("credit_utilization, credit_limit, available_credit")
      .eq("id", customerId)
      .single();

    if (!creditData) {
      throw new NotFoundError("Customer Credit Data", customerId);
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
      if (auth && auth.highestRole === "Finance Manager") {
        // Log the override
        await this.logCreditControl(
          companyId,
          customerId,
          "Credit Override",
          `FM credit override. Invoice amount: ${checkAmount}, Current utilization: ${utilization}, Credit limit: ${limit}, Overrun: ${
            projectedUtilization - limit
          }`,
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
    validateUUID(customerId, "id");
    requireRole(auth, "AR Supervisor");
    await requireCustomerAccess(auth, customerId);

    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;

    const { data, error, count } = await this.client
      .from("customer_change_logs")
      .select("*", { count: "exact" })
      .eq("customer_id", customerId)
      .order("changed_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch change log: ${error.message}`);
    }

    return {
      logs: (data ?? []) as CustomerChangeLog[],
      total: count ?? 0,
    };
  }
}

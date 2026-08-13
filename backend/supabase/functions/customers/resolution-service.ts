import { getConfigValue, getGLAccountId } from "../_shared/db.ts";
import { ValidationError } from "../_shared/errors.ts";
import {
  CONFIG_KEYS,
  CUSTOMER_TYPE_ACCOUNT_MAP,
} from "../_shared/constants.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { getCustomerAccessFilter } from "../_shared/auth.ts";
import {
  FUZZY_CANDIDATE_LIMIT,
  FUZZY_CUSTOMER_REVIEW_THRESHOLD,
  normalizeIdentifier,
  topFuzzyCandidates,
} from "../_shared/fuzzy.ts";
import type { CreateCustomerRequest, Customer } from "../_shared/types.ts";
import {
  type ImportCustomerSuggestion,
  normalizeCustomerName,
  normalizeRegistrationNo,
} from "./service-base.ts";
import { CustomerCreditService } from "./credit-service.ts";
export abstract class CustomerResolutionService extends CustomerCreditService {
  // ════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPER METHODS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Resolve GL account mappings using the 3-level fallback chain (BR-AM-001):
   * 1. Customer-level override
   * 2. Customer Type default mapping
   * 3. System-wide default
   */
  protected async findVisibleCustomerByNormalizedName(
    companyId: string,
    customerName: string,
  ): Promise<Customer | null> {
    const { data, error } = await this.client
      .from("customers")
      .select("*")
      .eq("company_id", companyId)
      .eq(
        "normalized_customer_name",
        normalizeCustomerName(customerName).toLocaleLowerCase(),
      )
      .eq("is_deleted", false)
      .eq("is_hidden", false)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to check duplicate customer name: ${error.message}`,
      );
    }

    return data as Customer | null;
  }

  protected async findVisibleCustomerByCode(
    companyId: string,
    customerCode: string,
  ): Promise<Customer | null> {
    const { data, error } = await this.client
      .from("customers")
      .select("*")
      .eq("company_id", companyId)
      .eq("customer_id", customerCode)
      .eq("is_deleted", false)
      .eq("is_hidden", false)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to check customer code: ${error.message}`);
    }

    return data as Customer | null;
  }

  protected async findVisibleCustomerSuggestions(
    auth: AuthContext,
    customerName: string,
    registrationNo?: string,
  ): Promise<ImportCustomerSuggestion[]> {
    const allowedIds = await getCustomerAccessFilter(auth);
    if (allowedIds !== null && allowedIds.length === 0) return [];

    let query = this.client
      .from("customers")
      .select("id, customer_id, customer_name, registration_no")
      .eq("company_id", auth.companyId)
      .eq("is_deleted", false)
      .eq("is_hidden", false)
      .limit(250);

    if (allowedIds !== null) {
      query = query.in("id", allowedIds);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to find customer suggestions: ${error.message}`);
    }

    const visibleCustomers = (data ?? []) as Array<
      Pick<Customer, "id" | "customer_id" | "customer_name" | "registration_no">
    >;
    const normalizedRegistrationNo = registrationNo
      ? normalizeRegistrationNo(registrationNo)
      : "";

    if (normalizedRegistrationNo) {
      const registrationMatches = visibleCustomers
        .filter((customer) =>
          normalizeRegistrationNo(customer.registration_no ?? "") ===
            normalizedRegistrationNo
        )
        .slice(0, FUZZY_CANDIDATE_LIMIT)
        .map((customer) => ({
          customer_id: customer.id,
          customer_code: customer.customer_id,
          customer_name: customer.customer_name,
          confidence: 0.98,
          reason: "registration_match",
        }));

      if (registrationMatches.length > 0) return registrationMatches;
    }

    return topFuzzyCandidates(
      customerName,
      visibleCustomers,
      (customer) => customer.customer_name,
      FUZZY_CUSTOMER_REVIEW_THRESHOLD,
    ).map((candidate) => ({
      customer_id: candidate.item.id,
      customer_code: candidate.item.customer_id,
      customer_name: candidate.item.customer_name,
      confidence: candidate.confidence,
      reason: candidate.reason,
    })).filter((candidate) =>
      normalizeIdentifier(candidate.customer_name) !==
        normalizeIdentifier(customerName)
    );
  }

  protected assertImportCustomerDataConsistent(
    customer: Customer,
    customerName: string,
    registrationNo?: string,
  ): void {
    if (
      customerName &&
      normalizeCustomerName(customer.customer_name).toLocaleLowerCase() !==
        customerName.toLocaleLowerCase()
    ) {
      throw new ValidationError(
        `customer_name conflicts with resolved customer_code "${customer.customer_id}".`,
        { field: "customer_name", customer_code: customer.customer_id },
      );
    }

    if (
      registrationNo &&
      customer.registration_no &&
      normalizeRegistrationNo(customer.registration_no) !==
        normalizeRegistrationNo(registrationNo)
    ) {
      throw new ValidationError(
        `registration_no conflicts with resolved customer "${customer.customer_name}".`,
        { field: "registration_no", customer_code: customer.customer_id },
      );
    }
  }

  protected async getDefaultPaymentTermId(
    companyId: string,
  ): Promise<string | null> {
    const { data, error } = await this.client
      .from("payment_terms")
      .select("id")
      .eq("company_id", companyId)
      .eq("term_code", "NET30")
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch default payment term: ${error.message}`);
    }

    return data?.id ?? null;
  }

  protected async assignCreatedCustomerToClerk(
    auth: AuthContext,
    customerId: string,
  ): Promise<void> {
    if (auth.highestRole !== "AR Clerk") {
      return;
    }

    const { error } = await this.client
      .from("user_customer_assignments")
      .upsert({
        user_id: auth.userId,
        customer_id: customerId,
        company_id: auth.companyId,
        assigned_by: auth.userId,
        assigned_at: new Date().toISOString(),
        is_active: true,
      }, { onConflict: "user_id,customer_id" });

    if (error) {
      throw new Error(
        `Failed to assign created customer to AR Clerk: ${error.message}`,
      );
    }
  }

  protected async resolveAccountMappings(
    companyId: string,
    customerType: string,
    data: CreateCustomerRequest,
  ): Promise<
    { ar_control_acct_id: string | null; revenue_acct_id: string | null }
  > {
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
        revAcctId = await getGLAccountId(
          this.client,
          companyId,
          typeMap.revenue,
        );
      }
    }

    // Level 3: System default (ar_system_config)
    if (!arAcctId) {
      const defaultCode = await getConfigValue(
        this.client,
        companyId,
        CONFIG_KEYS.DEFAULT_AR_CONTROL_ACCT,
      );
      if (defaultCode) {
        arAcctId = await getGLAccountId(this.client, companyId, defaultCode);
      }
    }
    if (!revAcctId) {
      const defaultCode = await getConfigValue(
        this.client,
        companyId,
        CONFIG_KEYS.DEFAULT_REVENUE_ACCT,
      );
      if (defaultCode) {
        revAcctId = await getGLAccountId(this.client, companyId, defaultCode);
      }
    }

    return { ar_control_acct_id: arAcctId, revenue_acct_id: revAcctId };
  }

  /**
   * Write to customer_change_logs audit table.
   */
  protected async logChange(
    customerId: string,
    fieldName: string,
    oldValue: string | null,
    newValue: string | null,
    changedBy: string,
    reason?: string,
  ): Promise<void> {
    await this.client
      .from("customer_change_logs")
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
  protected async logCreditControl(
    companyId: string,
    customerId: string,
    action: string,
    details: string,
    createdBy: string,
    amount?: number,
  ): Promise<void> {
    await this.client
      .from("credit_control_logs")
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

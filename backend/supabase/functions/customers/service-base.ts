import { SupabaseClient } from "supabase";
import { getAdminClient } from "../_shared/db.ts";
import type { AuthContext } from "../_shared/auth.ts";
import type {
  CreateCustomerRequest,
  Customer,
  CustomerChangeLog,
  CustomerCreditUtilization,
  CustomerListFilters,
  PaginationParams,
  UpdateCreditLimitRequest,
  UpdateCreditRatingRequest,
  UpdateCustomerRequest,
  UpdateCustomerStatusRequest,
} from "../_shared/types.ts";

export interface ImportCustomerLookup {
  customerCode?: string;
  customerName?: string;
  registrationNo?: string;
}

export interface ImportCustomerClassification {
  action: "Matched Existing" | "Create New" | "Review Required";
  customer: Customer | null;
  matchedBy: "customer_code" | "normalized_name" | "fuzzy_suggestion" | null;
  normalizedCustomerName: string;
  suggestions?: ImportCustomerSuggestion[];
  suggestionReason?: string;
  confidence?: number;
}

export interface ImportCustomerSuggestion {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  confidence: number;
  reason: string;
}
export abstract class CustomerServiceBase {
  protected client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
  }

  abstract createCustomer(
    auth: AuthContext,
    data: CreateCustomerRequest,
  ): Promise<Customer>;

  abstract createInlineCustomer(
    auth: AuthContext,
    data: CreateCustomerRequest,
  ): Promise<{ customer: Customer; created: boolean }>;

  abstract classifyImportCustomer(
    auth: AuthContext,
    lookup: ImportCustomerLookup,
  ): Promise<ImportCustomerClassification>;

  abstract getCustomerById(
    auth: AuthContext,
    customerId: string, // UUID
  ): Promise<Customer & { _credit?: CustomerCreditUtilization }>;

  abstract listCustomers(
    auth: AuthContext,
    filters: CustomerListFilters,
    pagination: PaginationParams,
  ): Promise<{ customers: Customer[]; total: number }>;

  abstract updateCustomer(
    auth: AuthContext,
    customerId: string,
    data: UpdateCustomerRequest,
  ): Promise<Customer>;

  abstract deleteCustomer(
    auth: AuthContext,
    customerId: string,
  ): Promise<void>;

  abstract updateStatus(
    auth: AuthContext,
    customerId: string,
    request: UpdateCustomerStatusRequest,
  ): Promise<Customer>;

  abstract updateCreditLimit(
    auth: AuthContext,
    customerId: string,
    request: UpdateCreditLimitRequest,
  ): Promise<Customer>;

  abstract updateCreditRating(
    auth: AuthContext,
    customerId: string,
    request: UpdateCreditRatingRequest,
  ): Promise<Customer>;

  abstract getCreditSummary(
    auth: AuthContext,
    customerId: string,
  ): Promise<CustomerCreditUtilization>;

  abstract performCreditCheck(
    companyId: string,
    customerId: string,
    checkAmount: number,
    auth?: AuthContext,
  ): Promise<
    { allowed: boolean; utilization: number; limit: number; available: number }
  >;

  abstract getChangeLog(
    auth: AuthContext,
    customerId: string,
    pagination: PaginationParams,
  ): Promise<{ logs: CustomerChangeLog[]; total: number }>;

  protected abstract findVisibleCustomerByNormalizedName(
    companyId: string,
    customerName: string,
  ): Promise<Customer | null>;

  protected abstract findVisibleCustomerByCode(
    companyId: string,
    customerCode: string,
  ): Promise<Customer | null>;

  protected abstract findVisibleCustomerSuggestions(
    auth: AuthContext,
    customerName: string,
    registrationNo?: string,
  ): Promise<ImportCustomerSuggestion[]>;

  protected abstract assertImportCustomerDataConsistent(
    customer: Customer,
    customerName: string,
    registrationNo?: string,
  ): void;

  protected abstract getDefaultPaymentTermId(
    companyId: string,
  ): Promise<string | null>;

  protected abstract assignCreatedCustomerToClerk(
    auth: AuthContext,
    customerId: string,
  ): Promise<void>;

  protected abstract resolveAccountMappings(
    companyId: string,
    customerType: string,
    data: CreateCustomerRequest,
  ): Promise<
    { ar_control_acct_id: string | null; revenue_acct_id: string | null }
  >;

  protected abstract logChange(
    customerId: string,
    fieldName: string,
    oldValue: string | null,
    newValue: string | null,
    changedBy: string,
    reason?: string,
  ): Promise<void>;

  protected abstract logCreditControl(
    companyId: string,
    customerId: string,
    action: string,
    details: string,
    createdBy: string,
    amount?: number,
  ): Promise<void>;
}

export function normalizeCustomerName(customerName: string): string {
  return customerName.trim().replace(/\s+/g, " ");
}

export function normalizeRegistrationNo(registrationNo: string): string {
  return registrationNo.trim().toLocaleUpperCase();
}

import { SupabaseClient } from "supabase";
import { getAdminClient } from "../_shared/db.ts";
import type { AuthContext } from "../_shared/auth.ts";
import type {
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  PaginationParams,
} from "../_shared/types.ts";
import type {
  CancelInvoiceInput,
  CreateInvoiceInput,
  CreateInvoiceLineInput,
  PostInvoiceInput,
} from "./validators.ts";
import { CustomerService } from "../customers/service.ts";
import type { MonetaryCollectionSummary } from "../reports/monetary-contracts.ts";

export interface CreateInvoiceOptions {
  importOrigin?: Record<string, unknown>;
  automationCommandId?: string;
  /**
   * Gate E worker-only boundary. When an automation command is supplied, the
   * service-role client invokes a database wrapper that completes creation,
   * optional posting, and command linkage in one PostgreSQL transaction.
   */
  postAtomically?: boolean;
}

export interface FxDecisionSummaryRow {
  id: string;
  source_category: string;
  approval_status: string;
  lifecycle_status: string;
  decision_version: number;
  root_decision_id: string;
  supersedes_decision_id: string | null;
  import_origin: Record<string, unknown> | null;
  booked_rate: number;
  deviation_pct: number | null;
  stale_reference: boolean;
}

export const LINKED_CREDIT_NOTE_REFERENCE_STATUSES: InvoiceStatus[] = [
  "Open",
  "Overdue",
  "Partially Paid",
];
export abstract class InvoiceServiceBase {
  protected client: SupabaseClient;
  protected readClient: SupabaseClient | null;
  protected customerService: CustomerService;

  /**
   * @param client Trusted mutation client.
   * @param readClient JWT-scoped authenticated client, or null for mutation-only composition.
   */
  constructor(
    client?: SupabaseClient,
    readClient: SupabaseClient | null = null,
  ) {
    this.client = client ?? getAdminClient();
    this.readClient = readClient;
    this.customerService = new CustomerService(this.client);
  }

  protected abstract requireReadClient(): SupabaseClient;

  protected abstract readScopeMode(auth: AuthContext): "company" | "assigned";

  protected abstract collectionReadParams(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
  ): Record<string, unknown>;

  protected abstract getAuthoritativeCollection(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<
    { rows: Invoice[]; total: number; summary: MonetaryCollectionSummary }
  >;

  protected abstract getReadableCustomerIds(
    auth: AuthContext,
  ): Promise<string[]>;

  protected abstract requireWritableCustomer(
    auth: AuthContext,
    customerId: string,
  ): Promise<void>;

  protected abstract validateLinkedCreditNoteReference(
    data: Pick<
      CreateInvoiceInput,
      "doc_type" | "cn_type" | "ref_invoice_id" | "customer_id" | "currency"
    >,
    companyId: string,
    documentId?: string,
  ): Promise<void>;

  protected abstract attachFxDecisionReadSummary<T extends Invoice>(
    companyId: string,
    invoices: T[],
  ): Promise<T[]>;

  protected abstract resolveTaxRateForInvoiceLine(
    companyId: string,
    taxCodeId: string,
    invoiceDate: string,
  ): Promise<number>;

  abstract createInvoice(
    auth: AuthContext,
    data: CreateInvoiceInput,
    lines?: CreateInvoiceLineInput[],
    options?: CreateInvoiceOptions,
  ): Promise<Invoice & { lines: InvoiceLine[] }>;

  abstract addLines(
    auth: AuthContext,
    invoiceId: string,
    lines: CreateInvoiceLineInput[],
    exchangeRate?: number,
  ): Promise<InvoiceLine[]>;

  abstract updateLine(
    auth: AuthContext,
    invoiceId: string,
    lineId: string,
    data: Partial<CreateInvoiceLineInput>,
  ): Promise<InvoiceLine>;

  abstract deleteLine(
    auth: AuthContext,
    invoiceId: string,
    lineId: string,
  ): Promise<void>;

  abstract postInvoice(
    auth: AuthContext,
    invoiceId: string,
    input?: PostInvoiceInput,
  ): Promise<Invoice & { je_no?: string }>;

  abstract cancelInvoice(
    auth: AuthContext,
    invoiceId: string,
    input: CancelInvoiceInput,
  ): Promise<Invoice>;

  abstract getInvoiceById(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<Invoice & { lines: InvoiceLine[] }>;

  abstract listInvoices(
    auth: AuthContext,
    filters: Record<string, string | undefined>,
    pagination: PaginationParams,
  ): Promise<
    { invoices: Invoice[]; total: number; summary: MonetaryCollectionSummary }
  >;

  abstract updateDraftInvoice(
    auth: AuthContext,
    invoiceId: string,
    data: Partial<CreateInvoiceInput>,
  ): Promise<Invoice>;

  abstract correctPostedReference(
    auth: AuthContext,
    invoiceId: string,
    referenceNo: string | null,
  ): Promise<Invoice>;

  abstract deleteDraftInvoice(
    auth: AuthContext,
    invoiceId: string,
  ): Promise<void>;

  protected abstract requireDraftInvoice(
    invoiceId: string,
    companyId: string,
  ): Promise<Invoice>;

  protected abstract fetchInvoiceOrThrow(invoiceId: string): Promise<Invoice>;

  protected abstract fetchInvoiceLineOrThrow(
    lineId: string,
  ): Promise<InvoiceLine>;

  protected abstract applyLinkedCNDeduction(
    refInvoiceId: string,
    cnAmount: number,
    cnId: string,
    userId: string,
  ): Promise<void>;
}

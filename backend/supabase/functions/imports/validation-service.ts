import {
  AuthorizationError,
  BusinessError,
  ValidationError,
} from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { requireCustomerAccess } from "../_shared/auth.ts";
import {
  validateDate,
  validateOperationalCurrencyForWrite,
} from "../_shared/validators.ts";
import type { CreateCustomerRequest } from "../_shared/types.ts";
import {
  validateCreateInvoice,
  validateInvoiceLines,
} from "../invoices/validators.ts";
import { validateCreateReceipt } from "../receipts/validators.ts";
import { COUNTRY_DEFAULTS } from "../_shared/constants.ts";
import {
  asString,
  errorToRowErrors,
  hasImportValue,
  type ImportBatch,
  importFxGovernanceFields,
  type ImportType,
  NIL_UUID,
  parseNumber,
  requireImportWrite,
  type RowValidationResult,
} from "./service-base.ts";
import { ImportReviewService } from "./review-service.ts";
export abstract class ImportValidationService extends ImportReviewService {
  protected async getWritableBatch(
    auth: AuthContext,
    batchId: string,
  ): Promise<ImportBatch> {
    requireImportWrite(auth);
    const batch = await this.getBatch(auth, batchId);
    if (
      batch.created_by && batch.created_by !== auth.userId &&
      auth.highestRole === "AR Clerk"
    ) {
      throw new AuthorizationError(
        "AR Clerk can only execute their own import batches.",
      );
    }
    if (batch.status === "Cancelled") {
      throw new BusinessError(
        "IMPORT_CANCELLED",
        "Cancelled import batches cannot be modified.",
        400,
      );
    }
    return batch;
  }

  protected async validateRow(
    auth: AuthContext,
    importType: ImportType,
    raw: Record<string, unknown>,
  ): Promise<RowValidationResult> {
    return importType === "receipt"
      ? await this.validateReceiptRow(auth, raw)
      : await this.validateInvoiceRow(auth, raw);
  }

  protected async validateInvoiceRow(
    auth: AuthContext,
    raw: Record<string, unknown>,
  ): Promise<RowValidationResult> {
    const errors: Array<Record<string, unknown>> = [];
    let mappedData: Record<string, unknown> | undefined;

    try {
      const classification = await this.customerService.classifyImportCustomer(
        auth,
        {
          customerCode: asString(raw, "customer_code") || undefined,
          customerName: asString(raw, "customer_name") || undefined,
          registrationNo: asString(raw, "registration_no") || undefined,
        },
      );
      const customer = classification.customer;
      let customerInput: CreateCustomerRequest | undefined;
      const invoiceDate = asString(raw, "invoice_date");
      const rawCurrency = asString(raw, "currency");
      const description = asString(raw, "description");
      const quantity = parseNumber(
        asString(raw, "quantity") || "1",
        "quantity",
      );
      const unitPrice = parseNumber(asString(raw, "unit_price"), "unit_price");
      const referenceNo = asString(raw, "reference_no") || undefined;
      const taxCodeId = await this.resolveTaxCode(auth.companyId, raw);
      const fxGovernanceFields = importFxGovernanceFields(raw);

      if (classification.action === "Review Required") {
        const currency = (rawCurrency || "MYR").toUpperCase();
        validateDate(invoiceDate, "invoice_date");
        validateOperationalCurrencyForWrite(currency, "currency");
        validateInvoiceLines([{
          description,
          quantity,
          unit_price: unitPrice,
          tax_code_id: taxCodeId,
        }]);

        mappedData = {
          doc_type: "Invoice",
          invoice_date: invoiceDate,
          customer_id: null,
          customer_input: null,
          customer_resolution: this.toCustomerResolutionDetails(classification),
          currency,
          ...fxGovernanceFields,
          reference_no: referenceNo,
          internal_remarks: "Created by Sprint F4 import draft-only flow",
          invoice_remarks: asString(raw, "invoice_remarks") || undefined,
          lines: [{
            description,
            quantity,
            unit_price: unitPrice,
            tax_code_id: taxCodeId,
          }],
          ...this.customerSuggestionDiagnostics(classification),
        };

        return { mappedData, errors, status: "Unmatched" };
      }

      if (customer) {
        await requireCustomerAccess(auth, customer.id);
      } else {
        customerInput = this.validateNewCustomerInput(raw);
      }

      const currency = (
        rawCurrency ||
        customer?.default_currency ||
        COUNTRY_DEFAULTS[customerInput!.bill_country]?.currency ||
        "MYR"
      ).toUpperCase();

      mappedData = {
        doc_type: "Invoice",
        invoice_date: invoiceDate,
        customer_id: customer?.id,
        customer_input: customerInput,
        customer_resolution: this.toCustomerResolutionDetails(classification),
        currency,
        ...fxGovernanceFields,
        reference_no: referenceNo,
        internal_remarks: "Created by Sprint F4 import draft-only flow",
        invoice_remarks: asString(raw, "invoice_remarks") || undefined,
        lines: [{
          description,
          quantity,
          unit_price: unitPrice,
          tax_code_id: taxCodeId,
        }],
      };

      if (customer) {
        validateCreateInvoice(mappedData);
      } else {
        validateDate(invoiceDate, "invoice_date");
        validateOperationalCurrencyForWrite(currency, "currency");
      }
      validateInvoiceLines(mappedData.lines);

      if (referenceNo && customer) {
        await this.assertNoDuplicateReference(
          auth.companyId,
          customer.id,
          referenceNo,
        );
      }
    } catch (error) {
      errors.push(...errorToRowErrors(error));
    }

    return { mappedData, errors };
  }

  protected async validateReceiptRow(
    auth: AuthContext,
    raw: Record<string, unknown>,
  ): Promise<RowValidationResult> {
    const errors: Array<Record<string, unknown>> = [];
    let mappedData: Record<string, unknown> | undefined;

    try {
      const classification = await this.customerService.classifyImportCustomer(
        auth,
        {
          customerCode: asString(raw, "customer_code") || undefined,
          customerName: asString(raw, "customer_name") || undefined,
          registrationNo: asString(raw, "registration_no") || undefined,
        },
      );
      const customer = classification.customer;
      let customerInput: CreateCustomerRequest | undefined;

      const bankAccount = await this.resolveBankAccount(auth.companyId, raw);
      const receiptDate = asString(raw, "receipt_date");
      const rawCurrency = asString(raw, "currency");
      const currency = (
        rawCurrency ||
        customer?.default_currency ||
        "MYR"
      ).toUpperCase();
      const receiptAmount = parseNumber(asString(raw, "amount"), "amount");
      const fxGovernanceFields = importFxGovernanceFields(raw);
      const referenceNo = asString(raw, "receipt_reference") || undefined;
      const chequeDate = asString(raw, "cheque_date") || undefined;
      const valueDate = asString(raw, "value_date") || undefined;
      const remarks = asString(raw, "remarks") || undefined;
      const invoiceReference = asString(raw, "invoice_reference") || undefined;
      const allocationAmountText = asString(raw, "allocation_amount");
      const allocationAmount = allocationAmountText
        ? parseNumber(allocationAmountText, "allocation_amount")
        : undefined;
      const discountAmount = hasImportValue(raw, "discount_amount")
        ? parseNumber(asString(raw, "discount_amount"), "discount_amount")
        : undefined;
      const bankChargeAmount = hasImportValue(raw, "bank_charge_amount")
        ? parseNumber(asString(raw, "bank_charge_amount"), "bank_charge_amount")
        : undefined;
      const shortPaymentReason =
        asString(raw, "short_payment_reason").toLowerCase() || undefined;

      if (classification.action === "Review Required") {
        validateDate(receiptDate, "receipt_date");
        validateOperationalCurrencyForWrite(currency, "currency");

        mappedData = {
          receipt_date: receiptDate,
          customer_id: null,
          customer_input: null,
          customer_resolution: this.toCustomerResolutionDetails(classification),
          payment_method: asString(raw, "payment_method"),
          currency,
          ...fxGovernanceFields,
          receipt_amount: receiptAmount,
          bank_account_id: bankAccount.bank_account_id,
          bank_account_resolution: bankAccount,
          reference_no: referenceNo,
          cheque_date: chequeDate,
          value_date: valueDate,
          remarks,
          invoice_reference: invoiceReference,
          allocation_amount: allocationAmount,
          discount_amount: discountAmount,
          bank_charge_amount: bankChargeAmount,
          short_payment_reason: shortPaymentReason,
          allocation_status: invoiceReference ? "Pending Review" : "None",
          internal_remarks: "Created by Sprint F4 receipt import flow",
          ...this.customerSuggestionDiagnostics(classification),
        };

        validateCreateReceipt({
          ...mappedData,
          customer_id: NIL_UUID,
        });

        return { mappedData, errors, status: "Unmatched" };
      }

      if (customer) {
        await requireCustomerAccess(auth, customer.id);
      } else {
        customerInput = this.validateNewCustomerInput(raw);
      }

      const resolvedCurrency = (
        rawCurrency ||
        customer?.default_currency ||
        COUNTRY_DEFAULTS[customerInput!.bill_country]?.currency ||
        "MYR"
      ).toUpperCase();

      if (!invoiceReference && allocationAmount !== undefined) {
        throw new ValidationError(
          "allocation_amount requires invoice_reference.",
          {
            field: "allocation_amount",
          },
        );
      }
      if (!invoiceReference && discountAmount !== undefined) {
        throw new ValidationError(
          "discount_amount requires invoice_reference.",
          {
            field: "discount_amount",
          },
        );
      }
      if (allocationAmount !== undefined && allocationAmount <= 0) {
        throw new ValidationError("allocation_amount must be greater than 0.", {
          field: "allocation_amount",
        });
      }
      if (discountAmount !== undefined && discountAmount < 0) {
        throw new ValidationError("discount_amount cannot be negative.", {
          field: "discount_amount",
        });
      }
      if (bankChargeAmount !== undefined && bankChargeAmount < 0) {
        throw new ValidationError("bank_charge_amount cannot be negative.", {
          field: "bank_charge_amount",
        });
      }
      if (
        allocationAmount !== undefined &&
        allocationAmount > receiptAmount + 0.01
      ) {
        throw new ValidationError(
          "allocation_amount cannot exceed receipt amount.",
          {
            field: "allocation_amount",
            allocation_amount: allocationAmount,
            receipt_amount: receiptAmount,
          },
        );
      }

      mappedData = {
        receipt_date: receiptDate,
        customer_id: customer?.id,
        customer_input: customerInput,
        customer_resolution: this.toCustomerResolutionDetails(classification),
        payment_method: asString(raw, "payment_method"),
        currency: resolvedCurrency,
        ...fxGovernanceFields,
        receipt_amount: receiptAmount,
        bank_account_id: bankAccount.bank_account_id,
        bank_account_resolution: bankAccount,
        reference_no: referenceNo,
        cheque_date: chequeDate,
        value_date: valueDate,
        remarks,
        invoice_reference: invoiceReference,
        allocation_amount: allocationAmount,
        discount_amount: discountAmount,
        bank_charge_amount: bankChargeAmount,
        short_payment_reason: shortPaymentReason,
        allocation_status: invoiceReference ? "Pending" : "None",
        internal_remarks: "Created by Sprint F4 receipt import flow",
      };

      validateCreateReceipt({
        ...mappedData,
        customer_id: customer?.id ?? NIL_UUID,
      });

      if (invoiceReference && customer) {
        const invoiceReview = await this.invoiceReferenceSuggestionDiagnostics(
          auth.companyId,
          customer.id,
          resolvedCurrency,
          invoiceReference,
          mappedData,
        );
        if (invoiceReview) {
          return {
            mappedData: invoiceReview.mappedData,
            errors,
            status: invoiceReview.status,
          };
        }
      }
    } catch (error) {
      errors.push(...errorToRowErrors(error));
    }

    return { mappedData, errors };
  }
}

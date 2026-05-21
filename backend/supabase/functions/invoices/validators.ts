// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Invoice Request Validators
// Validates and sanitizes incoming API request data for invoice operations
// ============================================================================

import { ValidationError } from '../_shared/errors.ts';
import {
  requireString,
  optionalString,
  optionalUUID,
  validateUUID,
  validateMaxLength,
  validateDate,
  validateCurrency,
  requirePositiveNumber,
  requireNonNegativeNumber,
  validateEnum,
} from '../_shared/validators.ts';
import {
  DOC_TYPES,
  CN_TYPES,
  REASON_CODES,
} from '../_shared/constants.ts';
import type {
  DocType,
  CNType,
  ReasonCode,
} from '../_shared/types.ts';

// ─── Input Types ────────────────────────────────────────────────────────────

export interface CreateInvoiceInput {
  doc_type: DocType;
  invoice_date: string;
  customer_id: string;
  currency: string;
  exchange_rate?: number;
  reference_no?: string;
  internal_remarks?: string;
  invoice_remarks?: string;
  // CN-specific
  cn_type?: CNType;
  ref_invoice_id?: string;
  reason_code?: ReasonCode;
  reason_desc?: string;
}

export interface CreateInvoiceLineInput {
  description: string;
  quantity: number;
  unit_price: number;
  item_code?: string;
  product_id?: string;
  uom?: string;
  discount_pct?: number;
  discount_amt?: number;
  tax_code_id?: string;
  gl_account_id?: string;
  cost_center?: string;
  line_remarks?: string;
}

export interface PostInvoiceInput {
  posting_period?: string;
}

export interface CancelInvoiceInput {
  cancel_reason: string;
}

// ─── Create Invoice Validation ──────────────────────────────────────────────

export function validateCreateInvoice(body: Record<string, unknown>): CreateInvoiceInput {
  const doc_type = validateEnum(
    requireString(body.doc_type, 'doc_type'),
    DOC_TYPES,
    'doc_type',
  ) as DocType;

  const invoice_date = requireString(body.invoice_date, 'invoice_date');
  validateDate(invoice_date, 'invoice_date');

  const customer_id = requireString(body.customer_id, 'customer_id');
  validateUUID(customer_id, 'customer_id');

  const currency = requireString(body.currency, 'currency');
  validateCurrency(currency, 'currency');

  const result: CreateInvoiceInput = {
    doc_type,
    invoice_date,
    customer_id,
    currency,
  };

  // Optional fields
  if (body.exchange_rate !== undefined) {
    result.exchange_rate = requirePositiveNumber(body.exchange_rate, 'exchange_rate');
  }

  result.reference_no = optionalString(body.reference_no) ?? undefined;
  if (result.reference_no) validateMaxLength(result.reference_no, 50, 'reference_no');

  result.internal_remarks = optionalString(body.internal_remarks) ?? undefined;
  result.invoice_remarks = optionalString(body.invoice_remarks) ?? undefined;

  // CN/DN-specific fields
  if (doc_type === 'Credit Note') {
    if (body.cn_type) {
      result.cn_type = validateEnum(String(body.cn_type), CN_TYPES, 'cn_type') as CNType;
    }

    if (body.reason_code) {
      result.reason_code = validateEnum(String(body.reason_code), REASON_CODES, 'reason_code') as ReasonCode;
    }
    result.reason_desc = optionalString(body.reason_desc) ?? undefined;

    // If reason_code is 'Other', reason_desc is required
    if (result.reason_code === 'Other' && !result.reason_desc) {
      throw new ValidationError(
        'When reason_code is "Other", reason_desc is required.',
        { field: 'reason_desc', reason_code: 'Other' },
      );
    }

    // Linked CN must have ref_invoice_id
    if (result.cn_type === 'Linked') {
      result.ref_invoice_id = requireString(body.ref_invoice_id, 'ref_invoice_id');
      validateUUID(result.ref_invoice_id, 'ref_invoice_id');
    } else if (body.ref_invoice_id) {
      result.ref_invoice_id = optionalUUID(body.ref_invoice_id, 'ref_invoice_id') ?? undefined;
    }
  }

  return result;
}

// ─── Create Invoice Line Validation ─────────────────────────────────────────

export function validateCreateInvoiceLine(body: Record<string, unknown>): CreateInvoiceLineInput {
  const description = requireString(body.description, 'description');
  validateMaxLength(description, 200, 'description');

  const quantity = requirePositiveNumber(body.quantity, 'quantity');
  const unit_price = requireNonNegativeNumber(body.unit_price, 'unit_price');

  const result: CreateInvoiceLineInput = {
    description,
    quantity,
    unit_price,
  };

  result.item_code = optionalString(body.item_code) ?? undefined;
  if (result.item_code) validateMaxLength(result.item_code, 30, 'item_code');

  result.product_id = optionalUUID(body.product_id, 'product_id') ?? undefined;

  result.uom = optionalString(body.uom) ?? undefined;
  if (result.uom) validateMaxLength(result.uom, 10, 'uom');

  result.discount_pct = body.discount_pct !== undefined
    ? requireNonNegativeNumber(body.discount_pct, 'discount_pct')
    : 0;

  result.discount_amt = body.discount_amt !== undefined
    ? requireNonNegativeNumber(body.discount_amt, 'discount_amt')
    : 0;

  result.tax_code_id = optionalUUID(body.tax_code_id, 'tax_code_id') ?? undefined;
  result.gl_account_id = optionalUUID(body.gl_account_id, 'gl_account_id') ?? undefined;

  result.cost_center = optionalString(body.cost_center) ?? undefined;
  if (result.cost_center) validateMaxLength(result.cost_center, 20, 'cost_center');

  result.line_remarks = optionalString(body.line_remarks) ?? undefined;
  if (result.line_remarks) validateMaxLength(result.line_remarks, 200, 'line_remarks');

  return result;
}

// ─── Batch Line Validation ──────────────────────────────────────────────────

export function validateInvoiceLines(bodyArray: unknown): CreateInvoiceLineInput[] {
  if (!Array.isArray(bodyArray)) {
    throw new ValidationError('lines must be an array.', { field: 'lines' });
  }
  if (bodyArray.length === 0) {
    throw new ValidationError('Invoice must have at least 1 line item.', { field: 'lines' });
  }

  return bodyArray.map((line, idx) => {
    if (!line || typeof line !== 'object') {
      throw new ValidationError(`lines[${idx}] must be an object.`);
    }
    try {
      return validateCreateInvoiceLine(line as Record<string, unknown>);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(
          `Line ${idx + 1}: ${error.message}`,
          { line_index: idx, ...error.details },
        );
      }
      throw error;
    }
  });
}

// ─── Post Invoice Validation ────────────────────────────────────────────────

export function validatePostInvoice(body: Record<string, unknown>): PostInvoiceInput {
  const result: PostInvoiceInput = {};
  if (body.posting_period) {
    const period = String(body.posting_period);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new ValidationError('posting_period must be in YYYY-MM format.', { field: 'posting_period' });
    }
    result.posting_period = period;
  }
  return result;
}

// ─── Cancel Invoice Validation ──────────────────────────────────────────────

export function validateCancelInvoice(body: Record<string, unknown>): CancelInvoiceInput {
  const cancel_reason = requireString(body.cancel_reason, 'cancel_reason');
  if (cancel_reason.length < 10) {
    throw new ValidationError(
      'Cancel reason must be at least 10 characters (BR-INV-003).',
      { field: 'cancel_reason', min_length: 10, actual_length: cancel_reason.length },
    );
  }
  return { cancel_reason };
}

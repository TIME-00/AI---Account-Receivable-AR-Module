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
  validateOperationalCurrencyForWrite,
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
  fx_reference_rate_id?: string;
  exchange_rate?: number;
  fx_override_reason?: string;
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

export interface CorrectPostedReferenceInput {
  reference_no: string | null;
}

// ─── Create Invoice Validation ──────────────────────────────────────────────

export function validateCreateInvoice(body: Record<string, unknown>): CreateInvoiceInput {
  if (body.base_total !== undefined) {
    throw new ValidationError(
      'base_total is server-calculated and must not be supplied.',
      { field: 'base_total' },
    );
  }

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
  validateOperationalCurrencyForWrite(currency, 'currency');

  const result: CreateInvoiceInput = {
    doc_type,
    invoice_date,
    customer_id,
    currency,
  };

  // Optional fields
  result.fx_reference_rate_id = optionalUUID(
    body.fx_reference_rate_id,
    'fx_reference_rate_id',
  ) ?? undefined;
  if (body.exchange_rate !== undefined) {
    result.exchange_rate = requirePositiveNumber(body.exchange_rate, 'exchange_rate');
  }
  if (body.fx_override_reason !== undefined) {
    result.fx_override_reason = requireString(body.fx_override_reason, 'fx_override_reason');
    if (result.fx_override_reason.trim().length < 5) {
      throw new ValidationError(
        'fx_override_reason must be at least 5 characters.',
        { field: 'fx_override_reason' },
      );
    }
    validateMaxLength(result.fx_override_reason, 500, 'fx_override_reason');
  }
  if (
    result.fx_reference_rate_id !== undefined
    && (result.exchange_rate !== undefined || result.fx_override_reason !== undefined)
  ) {
    throw new ValidationError(
      'fx_reference_rate_id cannot be combined with exchange_rate or fx_override_reason.',
      {
        field: 'fx_reference_rate_id',
        conflicting_fields: ['exchange_rate', 'fx_override_reason'],
      },
    );
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
    } else if (body.ref_invoice_id !== undefined && body.ref_invoice_id !== null) {
      throw new ValidationError(
        'ref_invoice_id is only permitted for Linked Credit Notes.',
        { field: 'ref_invoice_id' },
      );
    }
  } else if (doc_type === 'Debit Note') {
    if (body.cn_type !== undefined && body.cn_type !== null) {
      throw new ValidationError(
        'cn_type is only permitted for Credit Notes.',
        { field: 'cn_type' },
      );
    }
    result.ref_invoice_id = optionalUUID(body.ref_invoice_id, 'ref_invoice_id') ?? undefined;
  } else if (body.cn_type != null || body.ref_invoice_id != null) {
    throw new ValidationError(
      'Credit/Debit Note reference fields are not permitted for a normal Invoice.',
      { field: body.cn_type != null ? 'cn_type' : 'ref_invoice_id' },
    );
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

export function validateCorrectPostedReference(
  body: Record<string, unknown>,
): CorrectPostedReferenceInput {
  const unsupportedFields = Object.keys(body).filter((field) => field !== 'reference_no');
  if (unsupportedFields.length > 0) {
    throw new ValidationError(
      `Unsupported field(s): ${unsupportedFields.join(', ')}. Only reference_no is permitted.`,
      { fields: unsupportedFields },
    );
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'reference_no')) {
    throw new ValidationError('reference_no is required.', { field: 'reference_no' });
  }

  const referenceNo = body.reference_no;
  if (referenceNo === null) return { reference_no: null };
  if (typeof referenceNo !== 'string') {
    throw new ValidationError('reference_no must be a string or null.', {
      field: 'reference_no',
    });
  }
  if (referenceNo.trim().length === 0) {
    throw new ValidationError('reference_no must be non-blank or null.', {
      field: 'reference_no',
    });
  }
  validateMaxLength(referenceNo, 50, 'reference_no');
  return { reference_no: referenceNo };
}

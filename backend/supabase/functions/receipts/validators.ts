// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Receipt Request Validators
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
  validateEnum,
} from '../_shared/validators.ts';
import { PAYMENT_METHODS } from '../_shared/constants.ts';
import type { PaymentMethod } from '../_shared/types.ts';

// ─── Input Types ────────────────────────────────────────────────────────────

export interface CreateReceiptInput {
  receipt_date: string;
  customer_id: string;
  payment_method: PaymentMethod;
  currency: string;
  fx_reference_rate_id?: string;
  exchange_rate?: number;
  fx_override_reason?: string;
  receipt_amount: number;
  bank_account_id: string;
  reference_no?: string;
  cheque_date?: string;
  value_date?: string;
  remarks?: string;
}

export interface UpdateDraftReceiptFxInput {
  currency?: string;
  receipt_date?: string;
  fx_reference_rate_id?: string;
  exchange_rate?: number;
  fx_override_reason?: string;
}

export interface PostReceiptInput {
  posting_period?: string;
}

export interface CancelReceiptInput {
  cancel_reason: string;
}

export interface ClearReceiptInput {
  clearance_date?: string;
}

// ─── Create Receipt Validation ──────────────────────────────────────────────

export function validateCreateReceipt(body: Record<string, unknown>): CreateReceiptInput {
  if (body.base_amount !== undefined) {
    throw new ValidationError(
      'base_amount is server-calculated and must not be supplied.',
      { field: 'base_amount' },
    );
  }

  const receipt_date = requireString(body.receipt_date, 'receipt_date');
  validateDate(receipt_date, 'receipt_date');

  const customer_id = requireString(body.customer_id, 'customer_id');
  validateUUID(customer_id, 'customer_id');

  const payment_method = validateEnum(
    requireString(body.payment_method, 'payment_method'),
    PAYMENT_METHODS,
    'payment_method',
  ) as PaymentMethod;

  const currency = requireString(body.currency, 'currency');
  validateOperationalCurrencyForWrite(currency, 'currency');

  const receipt_amount = requirePositiveNumber(body.receipt_amount, 'receipt_amount');

  const bank_account_id = requireString(body.bank_account_id, 'bank_account_id');
  validateUUID(bank_account_id, 'bank_account_id');

  const result: CreateReceiptInput = {
    receipt_date,
    customer_id,
    payment_method,
    currency,
    receipt_amount,
    bank_account_id,
  };

  // Optional exchange rate
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

  result.remarks = optionalString(body.remarks) ?? undefined;

  // CHQ-specific: cheque_date is required
  if (payment_method === 'CHQ') {
    if (!body.cheque_date) {
      throw new ValidationError(
        'Cheque payment method (CHQ) requires cheque_date (cheque date).',
        { field: 'cheque_date', payment_method: 'CHQ' },
      );
    }
    result.cheque_date = requireString(body.cheque_date, 'cheque_date');
    validateDate(result.cheque_date, 'cheque_date');

    // reference_no is also mandatory for cheques (cheque number)
    if (!result.reference_no) {
      throw new ValidationError(
        'Cheque payment method (CHQ) requires reference_no (cheque number).',
        { field: 'reference_no', payment_method: 'CHQ' },
      );
    }
  }

  if (body.value_date) {
    result.value_date = requireString(body.value_date, 'value_date');
    validateDate(result.value_date, 'value_date');
  }

  return result;
}

export function validateUpdateDraftReceiptFx(
  body: Record<string, unknown>,
): UpdateDraftReceiptFxInput {
  if (body.base_amount !== undefined) {
    throw new ValidationError(
      'base_amount is server-calculated and must not be supplied.',
      { field: 'base_amount' },
    );
  }

  const allowedFields = new Set([
    'currency',
    'receipt_date',
    'fx_reference_rate_id',
    'exchange_rate',
    'fx_override_reason',
  ]);
  const unsupportedFields = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) {
    throw new ValidationError(
      'Receipt Draft FX update contains unsupported fields.',
      { unsupported_fields: unsupportedFields.sort() },
    );
  }

  const result: UpdateDraftReceiptFxInput = {};
  if (body.currency !== undefined) {
    result.currency = requireString(body.currency, 'currency');
    validateOperationalCurrencyForWrite(result.currency, 'currency');
  }
  if (body.receipt_date !== undefined) {
    result.receipt_date = requireString(body.receipt_date, 'receipt_date');
    validateDate(result.receipt_date, 'receipt_date');
  }
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
  if (Object.keys(result).every((field) => result[field as keyof UpdateDraftReceiptFxInput] === undefined)) {
    throw new ValidationError(
      'At least one governed Receipt FX field is required.',
      { fields: [...allowedFields] },
    );
  }

  return result;
}

// ─── Post Receipt Validation ────────────────────────────────────────────────

export function validatePostReceipt(body: Record<string, unknown>): PostReceiptInput {
  const result: PostReceiptInput = {};
  if (body.posting_period) {
    const period = String(body.posting_period);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new ValidationError('posting_period must be in YYYY-MM format.', { field: 'posting_period' });
    }
    result.posting_period = period;
  }
  return result;
}

// ─── Cancel Receipt Validation ──────────────────────────────────────────────

export function validateCancelReceipt(body: Record<string, unknown>): CancelReceiptInput {
  const cancel_reason = requireString(body.cancel_reason, 'cancel_reason');
  if (cancel_reason.length < 10) {
    throw new ValidationError(
      'Cancel reason must be at least 10 characters.',
      { field: 'cancel_reason', min_length: 10, actual_length: cancel_reason.length },
    );
  }
  return { cancel_reason };
}

export function validateClearReceipt(body: Record<string, unknown>): ClearReceiptInput {
  const result: ClearReceiptInput = {};
  if (body.clearance_date !== undefined && body.clearance_date !== null) {
    result.clearance_date = requireString(body.clearance_date, 'clearance_date');
    validateDate(result.clearance_date, 'clearance_date');
  }
  return result;
}

// ─── Bounce Receipt Validation ──────────────────────────────────────────────

export interface BounceReceiptInput {
  bounce_reason: string;
  bounce_date?: string;
}

export function validateBounceReceipt(body: Record<string, unknown>): BounceReceiptInput {
  const bounce_reason = requireString(body.bounce_reason, 'bounce_reason');
  if (bounce_reason.length < 10) {
    throw new ValidationError(
      'Bounce reason must be at least 10 characters.',
      { field: 'bounce_reason', min_length: 10, actual_length: bounce_reason.length },
    );
  }

  const result: BounceReceiptInput = { bounce_reason };

  if (body.bounce_date !== undefined && body.bounce_date !== null) {
    result.bounce_date = requireString(body.bounce_date, 'bounce_date');
    validateDate(result.bounce_date, 'bounce_date');
  }

  return result;
}

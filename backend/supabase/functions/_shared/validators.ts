// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Common Validators
// Implements field-level validation rules from PRD Part 1-5
// ============================================================================

import { BusinessError, ValidationError } from './errors.ts';
import { CUSTOMER_NAME_ALLOWED_SPECIAL, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants.ts';
import type { PaginationParams } from './types.ts';

// ─── String Validators ──────────────────────────────────────────────────────

/**
 * Validate that a required string field is present and non-empty.
 */
export function requireString(value: unknown, fieldName: string): string {
  if (value === null || value === undefined || typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`Field "${fieldName}" is required and cannot be empty.`, { field: fieldName });
  }
  return value.trim();
}

/**
 * Validate optional string field (return null if empty/missing).
 */
export function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate string max length.
 */
export function validateMaxLength(value: string, maxLen: number, fieldName: string): void {
  if (value.length > maxLen) {
    throw new ValidationError(
      `Field "${fieldName}" length (${value.length}) exceeds maximum allowed (${maxLen}).`,
      { field: fieldName, max_length: maxLen, actual_length: value.length },
    );
  }
}

/**
 * Validate minimum length (for reasons, remarks, etc.).
 */
export function validateMinLength(value: string, minLen: number, fieldName: string): void {
  if (value.length < minLen) {
    throw new ValidationError(
      `Field "${fieldName}" is too short. Minimum ${minLen} characters required.`,
      { field: fieldName, min_length: minLen, actual_length: value.length },
    );
  }
}

// ─── Customer Name Validation (PRD Part 1 §2.1 #2) ─────────────────────────

/**
 * Validate customer name.
 * Rules:
 * - Not purely numeric
 * - Only allowed special characters: & . , - ( )
 * - Max 200 characters
 */
export function validateCustomerName(name: string): void {
  const normalized = name.trim().replace(/\s+/g, ' ');
  const compact = normalized.replace(/\s+/g, '');

  // Check max length
  validateMaxLength(normalized, 200, 'customer_name');

  if (normalized.length < 3) {
    throw new ValidationError(
      'Customer name must be at least 3 characters.',
      { field: 'customer_name', value: normalized },
    );
  }

  // Not purely numeric
  if (/^\d+$/.test(compact)) {
    throw new ValidationError(
      'Customer name cannot be purely numeric.',
      { field: 'customer_name', value: normalized },
    );
  }

  if (!/[a-zA-Z\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF]/.test(normalized)) {
    throw new ValidationError(
      'Customer name must include letters.',
      { field: 'customer_name', value: normalized },
    );
  }

  if (isMostlyRepeatedCustomerName(compact)) {
    throw new ValidationError(
      'Customer name cannot be mostly repeated characters.',
      { field: 'customer_name', value: normalized },
    );
  }

  // Check for disallowed special characters
  const allowedPattern = new RegExp(
    `^[a-zA-Z0-9\\s${CUSTOMER_NAME_ALLOWED_SPECIAL.map(c => '\\' + c).join('')}\\u4e00-\\u9fff\\u3400-\\u4dbf\\uF900-\\uFAFF]+$`
  );

  if (!allowedPattern.test(normalized)) {
    throw new ValidationError(
      `Customer name contains disallowed special characters. Allowed: ${CUSTOMER_NAME_ALLOWED_SPECIAL.join(' ')}`,
      { field: 'customer_name', allowed_special: CUSTOMER_NAME_ALLOWED_SPECIAL },
    );
  }
}

function isMostlyRepeatedCustomerName(value: string): boolean {
  const alphanumeric = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (alphanumeric.length < 3) return false;

  return new Set(alphanumeric.split('')).size === 1;
}

// ─── Email Validation ───────────────────────────────────────────────────────

/**
 * Validate email format.
 */
export function validateEmail(email: string, fieldName: string = 'email'): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError(
      `Field "${fieldName}" is not a valid email address.`,
      { field: fieldName, value: email },
    );
  }
}

// ─── Phone Validation ───────────────────────────────────────────────────────

/**
 * Validate phone number (basic: allow digits, +, -, spaces, parens).
 */
export function validatePhone(phone: string, fieldName: string = 'phone'): void {
  const phoneRegex = /^[+\d\s\-()]+$/;
  if (!phoneRegex.test(phone) || phone.replace(/[^\d]/g, '').length < 7) {
    throw new ValidationError(
      `Field "${fieldName}" is not a valid phone number. Include country code.`,
      { field: fieldName, value: phone },
    );
  }
}

// ─── Currency Validation ────────────────────────────────────────────────────



export const SUPPORTED_OPERATIONAL_CURRENCIES = ['MYR', 'SGD', 'USD', 'EUR', 'GBP', 'CNY'] as const;
export type SupportedOperationalCurrency = typeof SUPPORTED_OPERATIONAL_CURRENCIES[number];

/**
 * Currencies authorised for NEW AR Invoice-family and Receipt creation.
 *
 * Keep this narrower than SUPPORTED_OPERATIONAL_CURRENCIES: the latter is a
 * historical read/report vocabulary and must continue to represent retained
 * legacy USD/EUR/GBP/CNY documents.
 */
export const SUPPORTED_TRANSACTION_CURRENCIES = ['MYR', 'SGD'] as const;
export type SupportedTransactionCurrency = typeof SUPPORTED_TRANSACTION_CURRENCIES[number];

/**
 * Validate ISO 4217-style currency code shape (3 uppercase letters).
 */
export function validateCurrency(code: string, fieldName: string = 'currency'): void {
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ValidationError(
      `Field "${fieldName}" must be a 3-letter uppercase ISO 4217 currency code (e.g., MYR, USD, SGD).`,
      { field: fieldName, value: code },
    );
  }
}

/**
 * Validate Batch 9D-D operational currency code for new transaction writes.
 *
 * Historical reads may still expose other valid three-letter legacy codes.
 */
export function validateOperationalCurrencyForWrite(code: string, fieldName: string = 'currency'): void {
  validateCurrency(code, fieldName);
  if (!SUPPORTED_TRANSACTION_CURRENCIES.includes(code as SupportedTransactionCurrency)) {
    throw new BusinessError(
      'UNSUPPORTED_TRANSACTION_CURRENCY',
      `Field "${fieldName}" currency "${code}" is not supported for new AR transactions. Supported currencies: ${SUPPORTED_TRANSACTION_CURRENCIES.join(', ')}.`,
      400,
      {
        field: fieldName,
        value: code,
        supported_currencies: SUPPORTED_TRANSACTION_CURRENCIES,
      },
    );
  }
}

// ─── Country Validation ─────────────────────────────────────────────────────

/**
 * Validate ISO 3166-1 alpha-2 country code.
 */
export function validateCountryCode(code: string, fieldName: string = 'country'): void {
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new ValidationError(
      `Field "${fieldName}" must be a 2-letter uppercase ISO 3166-1 country code (e.g., MY, SG).`,
      { field: fieldName, value: code },
    );
  }
}

// ─── Number Validators ──────────────────────────────────────────────────────

/**
 * Validate a positive number (> 0).
 */
export function requirePositiveNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    throw new ValidationError(
      `Field "${fieldName}" must be a positive number.`,
      { field: fieldName, value },
    );
  }
  return num;
}

/**
 * Validate a non-negative number (>= 0).
 */
export function requireNonNegativeNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    throw new ValidationError(
      `Field "${fieldName}" cannot be negative.`,
      { field: fieldName, value },
    );
  }
  return num;
}

// ─── UUID Validation ────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format.
 */
export function validateUUID(value: string, fieldName: string = 'id'): void {
  if (!UUID_REGEX.test(value)) {
    throw new ValidationError(
      `Field "${fieldName}" is not a valid UUID.`,
      { field: fieldName, value },
    );
  }
}

/**
 * Validate optional UUID — returns null if empty.
 */
export function optionalUUID(value: unknown, fieldName: string = 'id'): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`Field "${fieldName}" must be a valid UUID string.`, { field: fieldName });
  }
  validateUUID(value, fieldName);
  return value;
}

// ─── Date Validation ────────────────────────────────────────────────────────

/**
 * Validate date string (YYYY-MM-DD format).
 */
export function validateDate(value: string, fieldName: string): void {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(value)) {
    throw new ValidationError(
      `Field "${fieldName}" must be in YYYY-MM-DD format.`,
      { field: fieldName, value },
    );
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new ValidationError(
      `Field "${fieldName}" is not a valid date.`,
      { field: fieldName, value },
    );
  }
}

// ─── Enum Validation ────────────────────────────────────────────────────────

/**
 * Validate that a value is in the allowed set.
 */
export function validateEnum<T extends string>(
  value: string,
  allowedValues: readonly T[],
  fieldName: string,
): T {
  if (!allowedValues.includes(value as T)) {
    throw new ValidationError(
      `Field "${fieldName}" value "${value}" is invalid. Allowed values: ${allowedValues.join(', ')}`,
      { field: fieldName, value, allowed: allowedValues },
    );
  }
  return value as T;
}

// ─── Pagination ─────────────────────────────────────────────────────────────

/**
 * Parse and validate pagination parameters from URL query string.
 */
export function parsePagination(url: URL): PaginationParams {
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const rawSize = parseInt(url.searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const page_size = Math.min(Math.max(1, rawSize), MAX_PAGE_SIZE);

  return { page, page_size };
}

// ─── Registration Number Validation (BR-CUS-004) ───────────────────────────

/**
 * Validate company registration number format by country.
 * Malaysia: alphanumeric + hyphen, e.g., "123456-A" or "202001012345"
 * Singapore: alphanumeric + suffix, e.g., "200512345C"
 */
export function validateRegistrationNo(regNo: string, country: string): void {
  if (country === 'MY') {
    // Malaysian format: various formats accepted
    if (!/^[A-Za-z0-9\-]+$/.test(regNo)) {
      throw new ValidationError(
        'Malaysian registration number format is invalid. Only letters, digits, and hyphens are allowed.',
        { field: 'registration_no', country, value: regNo },
      );
    }
  } else if (country === 'SG') {
    // Singapore format: typically starts with year, ends with alpha
    if (!/^[A-Za-z0-9]+$/.test(regNo)) {
      throw new ValidationError(
        'Singapore registration number format is invalid.',
        { field: 'registration_no', country, value: regNo },
      );
    }
  }
  // Other countries: basic alphanumeric check
}

// ─── Tax ID Validation ──────────────────────────────────────────────────────

/**
 * Validate tax ID format by country (PRD Part 1 §2.1 #6).
 * MY: alphanumeric mix (SST/GST)
 * SG: digits + check character (GST)
 */
export function validateTaxId(taxId: string, country: string): void {
  if (country === 'MY') {
    if (!/^[A-Za-z0-9\-]+$/.test(taxId)) {
      throw new ValidationError(
        'Malaysian tax registration number format is invalid.',
        { field: 'tax_id', country },
      );
    }
  } else if (country === 'SG') {
    if (!/^[A-Za-z0-9]+$/.test(taxId)) {
      throw new ValidationError(
        'Singapore tax registration number format is invalid.',
        { field: 'tax_id', country },
      );
    }
  }
}

// ─── Postal Code Validation ─────────────────────────────────────────────────

export function validatePostalCode(postal: string, _country: string): void {
  validateMaxLength(postal, 10, 'bill_postal');
  if (!/^[A-Za-z0-9\s\-]+$/.test(postal)) {
    throw new ValidationError('Postal code format is invalid.', { field: 'bill_postal' });
  }
}

// ─── Request Body Parser ───────────────────────────────────────────────────

/**
 * Parse JSON request body with validation.
 */
export async function parseRequestBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const contentType = req.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) {
    throw new ValidationError('Content-Type must be application/json');
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body must be a JSON object');
    }
    return body as T;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid JSON in request body');
  }
}

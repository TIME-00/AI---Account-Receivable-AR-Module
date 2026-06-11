// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Customer Request Validators
// Validates and sanitizes incoming API request data for customer operations
// ============================================================================

import { ValidationError } from '../_shared/errors.ts';
import {
  requireString,
  optionalString,
  optionalUUID,
  validateMaxLength,
  validateCustomerName,
  validateEmail,
  validatePhone,
  validateCurrency,
  validateCountryCode,
  requireNonNegativeNumber,
  validateRegistrationNo,
  validateTaxId,
  validatePostalCode,
  validateEnum,
} from '../_shared/validators.ts';
import {
  CUSTOMER_TYPES,
  CREDIT_RATINGS,
} from '../_shared/constants.ts';
import type {
  CustomerType,
  CreditRating,
  ShippingAddress,
  AltContact,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from '../_shared/types.ts';

const INCOMPLETE_CUSTOMER_NAME_MESSAGE =
  'Customer name looks incomplete or invalid. Please enter a proper company name such as ABC Trading Sdn Bhd, or provide a registration number.';

const WEAK_SINGLE_TOKEN_NAMES = new Set([
  'abcde',
  'asdfgh',
  'customer',
  'dedaed',
  'demo',
  'dwadae',
  'lkjhg',
  'qweasd',
  'qwerty',
  'random',
  'sample',
  'test',
  'testing',
  'unknown',
]);

const BUSINESS_NAME_KEYWORDS = [
  'agency',
  'berhad',
  'bhd',
  'co',
  'company',
  'construction',
  'corp',
  'corporation',
  'enterprise',
  'engineering',
  'group',
  'holdings',
  'industries',
  'llp',
  'logistics',
  'ltd',
  'manufacturing',
  'marketing',
  'plt',
  'pte',
  'resources',
  'retail',
  'sdn',
  'services',
  'solutions',
  'supplies',
  'technology',
  'trading',
  'transport',
  'wholesale',
];

// ─── Create Customer Validation ─────────────────────────────────────────────

export function validateCreateCustomer(body: Record<string, unknown>): CreateCustomerRequest {
  // Required fields
  const customer_name = requireString(body.customer_name, 'customer_name');
  validateCustomerName(customer_name);

  const customer_type = validateEnum(
    requireString(body.customer_type, 'customer_type'),
    CUSTOMER_TYPES,
    'customer_type',
  ) as CustomerType;

  // Registration number required for Corporate
  const registration_no = optionalString(body.registration_no);
  validateCreateCustomerNameQuality(customer_name, registration_no);

  if (customer_type === 'Corporate' && !registration_no) {
    throw new ValidationError(
      'Registration number (registration_no) is required for Corporate customer type.',
      { field: 'registration_no', customer_type },
    );
  }

  // Address
  const bill_addr_line1 = requireString(body.bill_addr_line1, 'bill_addr_line1');
  validateMaxLength(bill_addr_line1, 200, 'bill_addr_line1');
  const bill_city = requireString(body.bill_city, 'bill_city');
  const bill_state = requireString(body.bill_state, 'bill_state');
  const bill_postal = requireString(body.bill_postal, 'bill_postal');
  const bill_country = requireString(body.bill_country, 'bill_country');
  validateCountryCode(bill_country, 'bill_country');
  validatePostalCode(bill_postal, bill_country);

  // Contact
  const contact_name = requireString(body.contact_name, 'contact_name');
  const contact_phone = requireString(body.contact_phone, 'contact_phone');
  validatePhone(contact_phone, 'contact_phone');
  const contact_email = requireString(body.contact_email, 'contact_email');
  validateEmail(contact_email, 'contact_email');

  const result: CreateCustomerRequest = {
    customer_name,
    customer_type,
    bill_addr_line1,
    bill_city,
    bill_state,
    bill_postal,
    bill_country,
    contact_name,
    contact_phone,
    contact_email,
  };

  // Optional fields
  result.short_name = optionalString(body.short_name) ?? undefined;
  if (result.short_name) validateMaxLength(result.short_name, 50, 'short_name');

  if (registration_no) {
    validateRegistrationNo(registration_no, bill_country);
    result.registration_no = registration_no;
  }

  const tax_id = optionalString(body.tax_id);
  if (tax_id) {
    validateTaxId(tax_id, bill_country);
    result.tax_id = tax_id;
  }

  result.bill_addr_line2 = optionalString(body.bill_addr_line2) ?? undefined;

  // Finance
  if (body.default_currency) {
    result.default_currency = requireString(body.default_currency, 'default_currency');
    validateCurrency(result.default_currency, 'default_currency');
  }

  // GL accounts
  result.ar_control_acct_id = optionalUUID(body.ar_control_acct_id, 'ar_control_acct_id') ?? undefined;
  result.revenue_acct_id = optionalUUID(body.revenue_acct_id, 'revenue_acct_id') ?? undefined;
  result.tax_output_acct_id = optionalUUID(body.tax_output_acct_id, 'tax_output_acct_id') ?? undefined;
  result.discount_acct_id = optionalUUID(body.discount_acct_id, 'discount_acct_id') ?? undefined;
  result.bad_debt_acct_id = optionalUUID(body.bad_debt_acct_id, 'bad_debt_acct_id') ?? undefined;
  result.allowance_acct_id = optionalUUID(body.allowance_acct_id, 'allowance_acct_id') ?? undefined;
  result.forex_gain_acct_id = optionalUUID(body.forex_gain_acct_id, 'forex_gain_acct_id') ?? undefined;
  result.forex_loss_acct_id = optionalUUID(body.forex_loss_acct_id, 'forex_loss_acct_id') ?? undefined;
  result.payment_term_id = optionalUUID(body.payment_term_id, 'payment_term_id') ?? undefined;

  if (body.credit_limit !== undefined) {
    result.credit_limit = requireNonNegativeNumber(body.credit_limit, 'credit_limit');
  }

  if (body.credit_rating) {
    result.credit_rating = validateEnum(
      String(body.credit_rating), CREDIT_RATINGS, 'credit_rating',
    ) as CreditRating;
  }

  if (body.e_invoice_enabled !== undefined) {
    result.e_invoice_enabled = Boolean(body.e_invoice_enabled);
  }

  // Group & parent
  result.customer_group_id = optionalUUID(body.customer_group_id, 'customer_group_id') ?? undefined;
  result.parent_id = optionalUUID(body.parent_id, 'parent_id') ?? undefined;

  // JSONB arrays
  result.shipping_addresses = validateShippingAddresses(body.shipping_addresses);
  result.alt_contacts = validateAltContacts(body.alt_contacts);

  return result;
}

// ─── Update Customer Validation ─────────────────────────────────────────────

export function validateUpdateCustomer(body: Record<string, unknown>): UpdateCustomerRequest {
  const result: UpdateCustomerRequest = {};

  if (body.customer_name !== undefined) {
    result.customer_name = requireString(body.customer_name, 'customer_name');
    validateCustomerName(result.customer_name);
  }

  if (body.short_name !== undefined) {
    result.short_name = optionalString(body.short_name) ?? undefined;
  }

  if (body.customer_type !== undefined) {
    result.customer_type = validateEnum(
      requireString(body.customer_type, 'customer_type'),
      CUSTOMER_TYPES, 'customer_type',
    ) as CustomerType;
  }

  if (body.registration_no !== undefined) result.registration_no = optionalString(body.registration_no) ?? undefined;
  if (body.tax_id !== undefined) result.tax_id = optionalString(body.tax_id) ?? undefined;

  // Address
  if (body.bill_addr_line1 !== undefined) result.bill_addr_line1 = requireString(body.bill_addr_line1, 'bill_addr_line1');
  if (body.bill_addr_line2 !== undefined) result.bill_addr_line2 = optionalString(body.bill_addr_line2) ?? undefined;
  if (body.bill_city !== undefined) result.bill_city = requireString(body.bill_city, 'bill_city');
  if (body.bill_state !== undefined) result.bill_state = requireString(body.bill_state, 'bill_state');
  if (body.bill_postal !== undefined) result.bill_postal = requireString(body.bill_postal, 'bill_postal');
  if (body.bill_country !== undefined) {
    result.bill_country = requireString(body.bill_country, 'bill_country');
    validateCountryCode(result.bill_country);
  }

  // Contact
  if (body.contact_name !== undefined) result.contact_name = requireString(body.contact_name, 'contact_name');
  if (body.contact_phone !== undefined) {
    result.contact_phone = requireString(body.contact_phone, 'contact_phone');
    validatePhone(result.contact_phone);
  }
  if (body.contact_email !== undefined) {
    result.contact_email = requireString(body.contact_email, 'contact_email');
    validateEmail(result.contact_email);
  }

  // Finance
  if (body.default_currency !== undefined) {
    result.default_currency = requireString(body.default_currency, 'default_currency');
    validateCurrency(result.default_currency);
  }

  // GL accounts
  if (body.ar_control_acct_id !== undefined) result.ar_control_acct_id = optionalUUID(body.ar_control_acct_id, 'ar_control_acct_id') ?? undefined;
  if (body.revenue_acct_id !== undefined) result.revenue_acct_id = optionalUUID(body.revenue_acct_id, 'revenue_acct_id') ?? undefined;
  if (body.tax_output_acct_id !== undefined) result.tax_output_acct_id = optionalUUID(body.tax_output_acct_id, 'tax_output_acct_id') ?? undefined;
  if (body.discount_acct_id !== undefined) result.discount_acct_id = optionalUUID(body.discount_acct_id, 'discount_acct_id') ?? undefined;
  if (body.bad_debt_acct_id !== undefined) result.bad_debt_acct_id = optionalUUID(body.bad_debt_acct_id, 'bad_debt_acct_id') ?? undefined;
  if (body.allowance_acct_id !== undefined) result.allowance_acct_id = optionalUUID(body.allowance_acct_id, 'allowance_acct_id') ?? undefined;
  if (body.forex_gain_acct_id !== undefined) result.forex_gain_acct_id = optionalUUID(body.forex_gain_acct_id, 'forex_gain_acct_id') ?? undefined;
  if (body.forex_loss_acct_id !== undefined) result.forex_loss_acct_id = optionalUUID(body.forex_loss_acct_id, 'forex_loss_acct_id') ?? undefined;
  if (body.payment_term_id !== undefined) result.payment_term_id = optionalUUID(body.payment_term_id, 'payment_term_id') ?? undefined;

  if (body.e_invoice_enabled !== undefined) result.e_invoice_enabled = Boolean(body.e_invoice_enabled);
  if (body.customer_group_id !== undefined) result.customer_group_id = optionalUUID(body.customer_group_id, 'customer_group_id') ?? undefined;
  if (body.parent_id !== undefined) result.parent_id = optionalUUID(body.parent_id, 'parent_id') ?? undefined;

  // JSONB arrays
  if (body.shipping_addresses !== undefined) result.shipping_addresses = validateShippingAddresses(body.shipping_addresses);
  if (body.alt_contacts !== undefined) result.alt_contacts = validateAltContacts(body.alt_contacts);

  return result;
}

// ─── JSONB Validators ───────────────────────────────────────────────────────

function validateShippingAddresses(raw: unknown): ShippingAddress[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ValidationError('shipping_addresses must be an array.', { field: 'shipping_addresses' });
  }
  return raw.map((addr, idx) => {
    if (!addr || typeof addr !== 'object') {
      throw new ValidationError(`shipping_addresses[${idx}] must be an object.`);
    }
    const a = addr as Record<string, unknown>;
    return {
      addr_line1: requireString(a.addr_line1, `shipping_addresses[${idx}].addr_line1`),
      addr_line2: optionalString(a.addr_line2) ?? undefined,
      city: requireString(a.city, `shipping_addresses[${idx}].city`),
      state: requireString(a.state, `shipping_addresses[${idx}].state`),
      postal: requireString(a.postal, `shipping_addresses[${idx}].postal`),
      country: requireString(a.country, `shipping_addresses[${idx}].country`),
      is_default: a.is_default === true,
    } as ShippingAddress;
  });
}

function validateAltContacts(raw: unknown): AltContact[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ValidationError('alt_contacts must be an array.', { field: 'alt_contacts' });
  }
  return raw.map((contact, idx) => {
    if (!contact || typeof contact !== 'object') {
      throw new ValidationError(`alt_contacts[${idx}] must be an object.`);
    }
    const c = contact as Record<string, unknown>;
    const name = requireString(c.contact_name, `alt_contacts[${idx}].contact_name`);
    const phone = requireString(c.phone, `alt_contacts[${idx}].phone`);
    const email = requireString(c.email, `alt_contacts[${idx}].email`);
    validateEmail(email, `alt_contacts[${idx}].email`);

    return {
      contact_name: name,
      phone,
      email,
      position: optionalString(c.position) ?? undefined,
    } as AltContact;
  });
}

function validateCreateCustomerNameQuality(customerName: string, registrationNo: string | null): void {
  // Prototype rule-set: tuned for MY/SG English-language company names.
  // A future official customer master workflow can replace this with jurisdiction-specific reference data.
  if (isBlockedSingleTokenCustomerName(customerName)) {
    throw new ValidationError(INCOMPLETE_CUSTOMER_NAME_MESSAGE, { field: 'customer_name' });
  }

  if (registrationNo) return;

  if (!hasBusinessNameSignal(customerName)) {
    throw new ValidationError(INCOMPLETE_CUSTOMER_NAME_MESSAGE, { field: 'customer_name' });
  }
}

function hasBusinessNameSignal(value: string): boolean {
  const words = getMeaningfulCustomerNameWords(value);
  if (words.length >= 2) return true;

  return words.some((word) => BUSINESS_NAME_KEYWORDS.includes(word.toLowerCase()));
}

function isBlockedSingleTokenCustomerName(value: string): boolean {
  const words = getMeaningfulCustomerNameWords(value);
  if (words.length !== 1) return false;

  return WEAK_SINGLE_TOKEN_NAMES.has(words[0].toLowerCase());
}

function getMeaningfulCustomerNameWords(value: string): string[] {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF]/g, ''))
    .filter((word) => word.length > 0);
}

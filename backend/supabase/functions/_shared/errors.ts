// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Error Classes & Business Rule Error Factory
// Implements standardized error handling for PRD Part 1-5
// ============================================================================

import type { APIMeta, APIResponse } from './types.ts';

// ─── Base Error Classes ─────────────────────────────────────────────────────

/**
 * Validation error — field-level or request-level validation failures.
 * HTTP 400
 */
export class ValidationError extends Error {
  public code = 'VALIDATION_ERROR';
  public status = 400;
  public details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * Business rule violation — domain logic errors.
 * HTTP 400 (or custom status)
 */
export class BusinessError extends Error {
  public code: string;
  public status: number;
  public details: Record<string, unknown>;

  constructor(code: string, message: string, status: number = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Authentication error — invalid or missing credentials.
 * HTTP 401
 */
export class AuthenticationError extends Error {
  public code = 'AUTHENTICATION_ERROR';
  public status = 401;

  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error — insufficient permissions.
 * HTTP 403
 */
export class AuthorizationError extends Error {
  public code = 'AUTHORIZATION_ERROR';
  public status = 403;
  public details: Record<string, unknown>;

  constructor(message: string = 'Insufficient permissions', details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AuthorizationError';
    this.details = details;
  }
}

/**
 * Not found error — resource does not exist or is inaccessible.
 * HTTP 404
 */
export class NotFoundError extends Error {
  public code = 'NOT_FOUND';
  public status = 404;
  public resource: string;
  public resourceId: string;

  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
    this.resource = resource;
    this.resourceId = id;
  }
}

/**
 * Conflict error — optimistic locking failure or duplicate.
 * HTTP 409
 */
export class ConflictError extends Error {
  public code = 'CONFLICT';
  public status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// ─── Business Rule Error Factory ────────────────────────────────────────────

/**
 * Pre-defined business rule errors from PRD Parts 1-5.
 * Each factory function returns a BusinessError with:
 * - Standardized BR-xxx code
 * - Human-readable English message
 * - Appropriate HTTP status
 */
export const BRErrors = {
  // ── Customer Errors (BR-CUS) ──

  CUS_001_INACTIVE: (customerName: string) =>
    new BusinessError('BR-CUS-001',
      `Customer "${customerName}" is Inactive. New transactions are not allowed for inactive customers.`,
      400, { customer_name: customerName }),

  CUS_002_BLOCKED: (customerName: string) =>
    new BusinessError('BR-CUS-002',
      `Customer "${customerName}" is Blocked. All transactions are frozen. Contact Finance Manager.`,
      400, { customer_name: customerName }),

  CUS_003_CANNOT_DELETE: (customerName: string, outstanding: number) =>
    new BusinessError('BR-CUS-003',
      `Customer "${customerName}" cannot be deleted. Outstanding balance: ${outstanding}. All balances must be cleared before deletion.`,
      400, { customer_name: customerName, outstanding }),

  CUS_INVALID_STATUS_TRANSITION: (from: string, to: string) =>
    new BusinessError('BR-CUS-STATUS',
      `Status transition from "${from}" to "${to}" is not allowed. Check the allowed transition rules.`,
      400, { from_status: from, to_status: to }),

  // ── Credit Management Errors (BR-CM) ──

  CM_001_CREDIT_EXCEEDED: (utilization: number, limit: number, customerName: string) =>
    new BusinessError('BR-CM-001',
      `Credit limit exceeded for "${customerName}". Current utilization: ${utilization}, Limit: ${limit}. Finance Manager override required.`,
      400, { utilization, limit, customer_name: customerName }),

  CM_002_ADJUSTMENT_EXCEEDS_AUTHORITY: (pct: number, maxPct: number) =>
    new BusinessError('BR-CM-002',
      `Credit limit adjustment of ${pct.toFixed(1)}% exceeds AR Supervisor authority (max ±${maxPct}%). Finance Manager approval required.`,
      403, { adjustment_pct: pct, max_pct: maxPct }),

  CM_003_RATING_D_BLOCKED: (customerName: string) =>
    new BusinessError('BR-CM-003',
      `Customer "${customerName}" has credit rating D (highest risk). All new transactions are frozen until rating is upgraded.`,
      400, { customer_name: customerName }),

  // ── Invoice Errors (BR-INV) ──

  INV_001_IMMUTABLE: (field: string) =>
    new BusinessError('BR-INV-001',
      `Cannot modify "${field}". Only Draft invoices can be edited. Posted invoices are immutable.`,
      400, { field }),

  INV_002_VALIDATION_FAILED: (failures: string[]) =>
    new BusinessError('BR-INV-002',
      `Invoice validation failed: ${failures.join('; ')}`,
      400, { validation_failures: failures }),

  INV_003_CANNOT_CANCEL: (invoiceNo: string) =>
    new BusinessError('BR-INV-003',
      `Invoice ${invoiceNo} cannot be cancelled. It has active allocations or partial payments. Reverse allocations first.`,
      400, { invoice_no: invoiceNo }),

  INV_004_PARTIALLY_PAID: (invoiceNo: string) =>
    new BusinessError('BR-INV-004',
      `Invoice ${invoiceNo} is Partially Paid and cannot be cancelled directly. Reverse all allocations first.`,
      400, { invoice_no: invoiceNo }),

  // ── Credit Note Errors (BR-CN) ──

  CN_001_EXCEEDS_OUTSTANDING: (cnAmount: number, outstanding: number, invoiceNo: string) =>
    new BusinessError('BR-CN-001',
      `Credit Note amount (${cnAmount}) exceeds the outstanding balance (${outstanding}) of Invoice ${invoiceNo}.`,
      400, { cn_amount: cnAmount, outstanding, invoice_no: invoiceNo }),

  CN_002_CUMULATIVE_EXCEEDED: (cumulative: number, totalAmount: number, invoiceNo: string) =>
    new BusinessError('BR-CN-002',
      `Cumulative Credit Note total (${cumulative}) exceeds the original invoice total (${totalAmount}) for Invoice ${invoiceNo}.`,
      400, { cumulative, total_amount: totalAmount, invoice_no: invoiceNo }),

  // ── Receipt Errors (BR-REC) ──

  REC_001_DUPLICATE_REF: (refNo: string, customerId: string) =>
    new BusinessError('BR-REC-001',
      `Duplicate reference number "${refNo}" for this customer. Each reference number must be unique per customer to prevent duplicate entries.`,
      409, { reference_no: refNo, customer_id: customerId }),

  REC_002_ALREADY_POSTED: (receiptNo: string) =>
    new BusinessError('BR-REC-002',
      `Receipt ${receiptNo} is already posted and cannot be posted again.`,
      400, { receipt_no: receiptNo }),

  REC_003_CANNOT_REVERSE: (receiptNo: string) =>
    new BusinessError('BR-REC-003',
      `Receipt ${receiptNo} cannot be reversed. It has active allocations. Reverse allocations first.`,
      400, { receipt_no: receiptNo }),

  // ── Allocation Errors (BR-ALLOC) ──

  ALLOC_001_EXCEEDS_RECEIPT: (allocTotal: number, available: number) =>
    new BusinessError('BR-ALLOC-001',
      `Total allocation (${allocTotal}) exceeds receipt available balance (${available}).`,
      400, { alloc_total: allocTotal, available }),

  ALLOC_002_EXCEEDS_INVOICE: (amount: number, outstanding: number, invoiceNo: string) =>
    new BusinessError('BR-ALLOC-002',
      `Allocation amount (${amount}) exceeds invoice outstanding (${outstanding}) for ${invoiceNo}.`,
      400, { amount, outstanding, invoice_no: invoiceNo }),

  ALLOC_003_CURRENCY_MISMATCH: (receiptCurrency: string, invoiceCurrency: string) =>
    new BusinessError('BR-ALLOC-003',
      `Currency mismatch. Receipt currency (${receiptCurrency}) does not match invoice currency (${invoiceCurrency}).`,
      400, { receipt_currency: receiptCurrency, invoice_currency: invoiceCurrency }),

  ALLOC_004_ALREADY_REVERSED: (allocId: string) =>
    new BusinessError('BR-ALLOC-004',
      `Allocation ${allocId} has already been reversed.`,
      400, { allocation_id: allocId }),

  // ── Journal Entry Errors (BR-JE) ──

  JE_007_PERIOD_CLOSED: (period: string) =>
    new BusinessError('BR-JE-007',
      `Fiscal period "${period}" is closed. Cannot post to a closed period. Contact Finance Manager to reopen.`,
      400, { period }),
};

// ─── Error Response Helpers ─────────────────────────────────────────────────

/**
 * Convert any error into a standardized API error response.
 */
export function errorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ValidationError) {
    return {
      status: error.status,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  if (error instanceof BusinessError) {
    return {
      status: error.status,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  if (error instanceof AuthenticationError) {
    return {
      status: error.status,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      status: error.status,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  if (error instanceof NotFoundError) {
    return {
      status: error.status,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  if (error instanceof ConflictError) {
    return {
      status: error.status,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  // Unknown error
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  console.error('[UNHANDLED_ERROR]', error);
  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message,
      },
    },
  };
}

/**
 * Create a standardized success response.
 */
export function successResponse<T, TSummary = never>(
  data: T,
  meta?: APIMeta<TSummary>,
): APIResponse<T, TSummary> {
  const response: APIResponse<T, TSummary> = {
    success: true,
    data,
  };
  if (meta) {
    response.meta = meta;
  }
  return response;
}

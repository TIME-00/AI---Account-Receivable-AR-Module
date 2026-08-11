import { ValidationError } from "./_shared/errors.ts";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./_shared/constants.ts";
import {
  calculateStaleState,
  FX_REFERENCE_STALE_AFTER_BUSINESS_DAYS,
} from "./fx-rate-sync/validation.ts";
import { validateCreateInvoice } from "./invoices/validators.ts";
import { validateCreateReceipt } from "./receipts/validators.ts";

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(
  actual: T,
  expected: T,
  message = "Values differ",
): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertIncludes(actual: string, expected: string): void {
  assert(actual.includes(expected), `Expected source to include: ${expected}`);
}

function assertNotIncludes(actual: string, expected: string): void {
  assert(!actual.includes(expected), `Expected source not to include: ${expected}`);
}

function expectValidationError(action: () => unknown): ValidationError {
  try {
    action();
  } catch (error) {
    assert(error instanceof ValidationError, "Expected ValidationError");
    return error;
  }
  throw new Error("Expected validation to reject");
}

const referenceId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const bankAccountId = "33333333-3333-4333-8333-333333333333";

Deno.test("Gate A migration installs one guarded forward contract without booked-data restatement", async () => {
  const migration = await read(
    "../../../database/031_post_batch_9d_gate_a_governed_fx_reference_booking.sql",
  );

  assertIncludes(migration, "BEGIN;");
  assertIncludes(migration, "COMMIT;");
  assertIncludes(migration, "SET LOCAL lock_timeout = '5s'");
  assertIncludes(migration, "SET LOCAL statement_timeout = '60s'");
  assertIncludes(migration, "GATE_A_FX_REFERENCE: governed RPC baseline signature drift");
  assertIncludes(migration, "reference-aware governed wrapper already exists or catalog drifted");
  assertIncludes(migration, "expected exactly three unambiguous Invoice create signatures");
  assertIncludes(migration, "expected exactly three unambiguous Receipt create signatures");
  assertIncludes(migration, "pronargdefaults");

  for (const prohibited of [
    "LEGACY_UNVERIFIED",
    "LegacyBackfilled",
    "UPDATE public.fx_booking_rate_decisions",
    "UPDATE public.journal_entries",
    "UPDATE public.journal_lines",
    "DELETE FROM public.",
  ]) {
    assertNotIncludes(migration, prohibited);
  }
});

Deno.test("Gate A migration covers all four reference-aware governed wrappers and old callers", async () => {
  const migration = await read(
    "../../../database/031_post_batch_9d_gate_a_governed_fx_reference_booking.sql",
  );

  for (const signature of [
    "fx_create_governed_invoice_draft",
    "fx_create_governed_receipt_draft",
    "fx_update_governed_invoice_fx",
    "fx_update_governed_receipt_fx",
  ]) {
    assertIncludes(migration, `FUNCTION public.${signature}(`);
  }

  const referenceArgumentCount =
    migration.match(/p_fx_reference_rate_id UUID/g)?.length ?? 0;
  assert(
    referenceArgumentCount >= 6,
    "Reference id must be present in the helper, four canonical wrappers, and reference selector",
  );
  assertIncludes(migration, "p_import_origin,\n    p_lines,");
  assertIncludes(migration, "p_override_reason,\n    NULL\n  );");
  assertIncludes(migration, "p_fx_reference_rate_id,\n    p_override_reason,");
  assertIncludes(migration, "WHEN p_fx_reference_rate_id IS NOT NULL THEN 'REFERENCE_SELECTED'");

  // Compatibility signatures retain their existing owner/ACL identity through
  // CREATE OR REPLACE; exact reference-aware signatures are additive and
  // non-defaulted, so PostgreSQL cannot confuse old and new positional calls.
  assertIncludes(migration, "CREATE OR REPLACE FUNCTION public.fx_create_governed_invoice_draft(");
  assertIncludes(migration, "CREATE OR REPLACE FUNCTION public.fx_create_governed_receipt_draft(");
  assertIncludes(migration, "p_lines JSONB DEFAULT '[]'::jsonb");
  assertIncludes(migration, "p_explicit_rate_supplied BOOLEAN DEFAULT false");
  assertIncludes(migration, "p_override_reason TEXT DEFAULT NULL");
  assertIncludes(migration, "Invoice overload defaults would permit ambiguous resolution");
  assertIncludes(migration, "Receipt overload defaults would permit ambiguous resolution");
});

Deno.test("Gate A migration preserves security mode, owner, search path, and service-only execution", async () => {
  const migration = await read(
    "../../../database/031_post_batch_9d_gate_a_governed_fx_reference_booking.sql",
  );

  assertIncludes(migration, "owner_role.rolname <> 'postgres'");
  assertIncludes(migration, "p.prosecdef IS DISTINCT FROM true");
  assertIncludes(migration, "p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::TEXT[]");
  assertIncludes(migration, "OWNER TO postgres");
  assertIncludes(migration, "SECURITY DEFINER");
  assertIncludes(migration, "SET search_path = public");
  assertIncludes(migration, "SET search_path = ''");
  assertIncludes(migration, "FROM PUBLIC, anon, authenticated");
  assertIncludes(migration, "TO service_role");
  assertIncludes(migration, "governed wrapper security/search_path postcondition failed");
});

Deno.test("Gate A reference validator is tenant, pair, direction, date, latest-active, and stale bound", async () => {
  const migration = await read(
    "../../../database/031_post_batch_9d_gate_a_governed_fx_reference_booking.sql",
  );

  for (const predicate of [
    "r.id = p_fx_reference_rate_id",
    "r.company_id = p_company_id",
    "r.from_currency = p_from_currency",
    "r.to_currency = p_to_currency",
    "r.effective_date <= p_transaction_date",
    "r.status = 'Active'",
    "p_to_currency IS DISTINCT FROM v_company_base",
    "v_latest_id IS DISTINCT FROM v_reference.id",
    "(p_transaction_date - v_reference.effective_date) > 3",
  ]) {
    assertIncludes(migration, predicate);
  }

  assertIncludes(migration, "r.effective_date DESC");
  assertIncludes(migration, "r.fetched_at DESC");
  assertIncludes(migration, "r.created_at DESC");
  assertIncludes(migration, "r.id DESC");
  assertIncludes(migration, "selected reference rate is stale; use governed manual override");
});

Deno.test("Gate A SQL owns rate selection, NUMERIC base snapshots, parity, and manual governance", async () => {
  const migration = await read(
    "../../../database/031_post_batch_9d_gate_a_governed_fx_reference_booking.sql",
  );
  const core = await read(
    "../../../database/024_fx_booking_decision_runtime_fix.sql",
  );
  const governance = await read(
    "../../../database/023_fx_booking_rate_rpcs_and_immutability.sql",
  );

  assertIncludes(migration, "v_reference_rate := public.fx_require_bookable_reference_rate(");
  assertIncludes(migration, "to_jsonb(v_reference_rate)");
  assertIncludes(migration, "ROUND(");
  assertIncludes(migration, "* (v_invoice->>'exchange_rate')::NUMERIC");
  assertIncludes(migration, "* (v_receipt->>'exchange_rate')::NUMERIC");
  assertIncludes(migration, "base_total = ROUND(total_amount * v_rate, 2)");
  assertIncludes(migration, "base_amount = ROUND(receipt_amount * v_rate, 2)");
  assertIncludes(migration, "BASE_PARITY must not use an FX reference");

  // Migration 031 delegates all non-reference decisions to the accepted core;
  // these are the locked maker-checker and threshold contracts it preserves.
  assertIncludes(core, "length(trim(p_override_reason)) < 5");
  assertIncludes(core, "v_source_category := 'BASE_PARITY'");
  assertIncludes(core, "v_source_category := 'MANUAL_OVERRIDE'");
  assertIncludes(core, "v_source_category := 'CATALOG'");
  assertIncludes(governance, "p_deviation_pct <= 0.50");
  assertIncludes(governance, "p_deviation_pct <= 5.00");
  assertIncludes(governance, "v_decision.deviation_pct > 2.00");
  assertIncludes(governance, "maker cannot approve own decision");
  assertIncludes(governance, "ARRAY['AR Supervisor', 'Finance Manager']");
  assertIncludes(governance, "ARRAY['Finance Manager']");
});

Deno.test("Gate A Invoice and Receipt validators accept reference ids and reject mixed authority", () => {
  const invoice = validateCreateInvoice({
    doc_type: "Invoice",
    invoice_date: "2026-07-24",
    customer_id: customerId,
    currency: "SGD",
    fx_reference_rate_id: referenceId,
  });
  assertEquals(invoice.fx_reference_rate_id, referenceId);
  assertEquals(invoice.exchange_rate, undefined);

  const receipt = validateCreateReceipt({
    receipt_date: "2026-07-24",
    customer_id: customerId,
    payment_method: "TT",
    currency: "SGD",
    fx_reference_rate_id: referenceId,
    receipt_amount: 12.34,
    bank_account_id: bankAccountId,
  });
  assertEquals(receipt.fx_reference_rate_id, referenceId);
  assertEquals(receipt.exchange_rate, undefined);

  for (const action of [
    () =>
      validateCreateInvoice({
        doc_type: "Invoice",
        invoice_date: "2026-07-24",
        customer_id: customerId,
        currency: "SGD",
        fx_reference_rate_id: referenceId,
        exchange_rate: 4.5,
      }),
    () =>
      validateCreateReceipt({
        receipt_date: "2026-07-24",
        customer_id: customerId,
        payment_method: "TT",
        currency: "SGD",
        fx_reference_rate_id: referenceId,
        fx_override_reason: "manual",
        receipt_amount: 12.34,
        bank_account_id: bankAccountId,
      }),
  ]) {
    const error = expectValidationError(action);
    assertEquals(
      error.message,
      "fx_reference_rate_id cannot be combined with exchange_rate or fx_override_reason.",
    );
  }

  assertEquals(
    expectValidationError(() =>
      validateCreateInvoice({
        doc_type: "Invoice",
        invoice_date: "2026-07-24",
        customer_id: customerId,
        currency: "SGD",
        base_total: 123,
      })
    ).message,
    "base_total is server-calculated and must not be supplied.",
  );
  assertEquals(
    expectValidationError(() =>
      validateCreateReceipt({
        receipt_date: "2026-07-24",
        customer_id: customerId,
        payment_method: "TT",
        currency: "SGD",
        receipt_amount: 12.34,
        base_amount: 99,
        bank_account_id: bankAccountId,
      })
    ).message,
    "base_amount is server-calculated and must not be supplied.",
  );
});

Deno.test("Gate A Edge services use the exact reference-aware RPC parameters", async () => {
  const invoiceService = await read("invoices/service.ts");
  const receiptService = await read("receipts/service.ts");
  const invoiceValidator = await read("invoices/validators.ts");
  const receiptValidator = await read("receipts/validators.ts");

  for (const source of [invoiceService, receiptService]) {
    assertIncludes(source, "p_fx_reference_rate_id:");
    assertIncludes(source, "p_import_origin:");
    assertIncludes(source, "must not select an FX reference rate");
    assertIncludes(source, "require an exchange rate of exactly 1");
  }
  for (const source of [invoiceValidator, receiptValidator]) {
    assertIncludes(source, "fx_reference_rate_id cannot be combined");
  }
  assertIncludes(invoiceService, "updatePayload.fx_reference_rate_id = reference.id");
  assertIncludes(receiptService, "p_fx_reference_rate_id: selectedReferenceRateId");
  assertIncludes(invoiceService, "p_fx_reference_rate_id: selectedReferenceRateId");
});

Deno.test("Gate A lookup and booking use one three-business-day stale basis and deterministic latest ordering", async () => {
  const lookupService = await read("fx-rates/service.ts");
  const migration043 = await read(
    "../../../database/043_post_gate_e_fx_currency_freshness_authority.sql",
  );

  assertEquals(FX_REFERENCE_STALE_AFTER_BUSINESS_DAYS, 3);
  assertEquals(calculateStaleState("2026-07-21", "2026-07-24").is_stale, false);
  assertEquals(calculateStaleState("2026-07-20", "2026-07-24").is_stale, true);
  assertIncludes(lookupService, ".order('effective_date', { ascending: false })");
  assertIncludes(lookupService, ".order('fetched_at', { ascending: false })");
  assertIncludes(lookupService, ".order('created_at', { ascending: false })");
  assertIncludes(lookupService, ".order('id', { ascending: false })");
  assertIncludes(migration043, "public.fx_reference_business_day_age(");
  assertIncludes(migration043, ") > 3 THEN");
});

Deno.test("Gate A pagination remains bounded at public 100 and internal RPC 200", async () => {
  const migration027 = await read(
    "../../../database/027_batch_9d_d_authoritative_monetary_aggregation.sql",
  );
  const invoiceService = await read("invoices/service.ts");
  const receiptService = await read("receipts/service.ts");

  assertEquals(DEFAULT_PAGE_SIZE, 20);
  assertEquals(MAX_PAGE_SIZE, 100);
  const internalMaxCount =
    migration027.match(/p_page_size > 200/g)?.length ?? 0;
  assert(
    internalMaxCount >= 3,
    "All internal collection/report RPCs must retain the 200-row ceiling",
  );
  assertIncludes(invoiceService, "p_page_size: pagination.page_size");
  assertIncludes(receiptService, "p_page_size: pagination.page_size");
  assertNotIncludes(invoiceService, "page_size: Number.MAX_SAFE_INTEGER");
  assertNotIncludes(receiptService, "page_size: Number.MAX_SAFE_INTEGER");
});

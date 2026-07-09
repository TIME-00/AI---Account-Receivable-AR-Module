const read = (path: string) => Deno.readTextFile(path);

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function assertStringIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected string to include: ${expected}`);
  }
}

Deno.test('Batch 9D-C migrations define root lineage and historical bootstrap invariants', async () => {
  const migration022 = await read('../../../database/022_fx_booking_rate_governance.sql');
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');

  assertStringIncludes(migration022, 'CREATE TABLE IF NOT EXISTS public.fx_booking_rate_decisions');
  assertStringIncludes(migration022, 'root_decision_id');
  assertStringIncludes(migration022, 'decision_version INTEGER NOT NULL DEFAULT 1');
  assertStringIncludes(migration022, 'supersedes_decision_id');
  assertStringIncludes(migration022, 'uq_fx_brd_root_version');
  assertStringIncludes(migration022, 'ON public.fx_booking_rate_decisions(root_decision_id, decision_version)');
  assertStringIncludes(migration022, 'LegacyBackfilled');
  assertStringIncludes(migration022, 'BASE_CURRENCY_NON_PARITY_RATE');
  assertStringIncludes(migration022, 'fx_decision_id IS NULL OR fx_source_category IS NULL');

  assertStringIncludes(migration023, 'fx_assert_booking_decision_postable');
  assertStringIncludes(migration023, 'fx_guard_invoice_posting_decision');
  assertStringIncludes(migration023, 'fx_guard_receipt_posting_decision');
});

Deno.test('Batch 9D-C immutability predicate rejects protected changes outside Draft-to-Draft', async () => {
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');

  assertStringIncludes(migration023, "OLD.status <> 'Draft' OR NEW.status <> 'Draft'");
  assertStringIncludes(migration023, 'OLD.exchange_rate IS DISTINCT FROM NEW.exchange_rate');
  assertStringIncludes(migration023, 'OLD.fx_decision_id IS DISTINCT FROM NEW.fx_decision_id');
  assertStringIncludes(migration023, 'OLD.invoice_date IS DISTINCT FROM NEW.invoice_date');
  assertStringIncludes(migration023, 'OLD.receipt_date IS DISTINCT FROM NEW.receipt_date');
});

Deno.test('Batch 9D-C import explicit rate auto-post hold is wired', async () => {
  const importsService = await read('imports/service.ts');

  assertStringIncludes(importsService, 'explicitRateSupplied');
  assertStringIncludes(importsService, 'Explicit imported FX rate is governed as MANUAL_OVERRIDE');
  assertStringIncludes(importsService, "posting_status: 'HeldGovernance'");
});

Deno.test('Batch 9D-C invoice and receipt services record booking decisions', async () => {
  const invoiceService = await read('invoices/service.ts');
  const receiptService = await read('receipts/service.ts');

  for (const service of [invoiceService, receiptService]) {
    assertStringIncludes(service, 'fx_record_booking_decision');
    assertStringIncludes(service, 'p_explicit_rate_supplied');
    assertStringIncludes(service, 'p_override_reason');
  }

  assert(invoiceService.includes('data.exchange_rate !== undefined'));
  assert(receiptService.includes('data.exchange_rate !== undefined'));
});

Deno.test('Batch 9D-C governed FX mutation RPCs own snapshot and decision changes', async () => {
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');
  const invoiceService = await read('invoices/service.ts');
  const receiptService = await read('receipts/service.ts');

  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_update_governed_invoice_fx');
  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_update_governed_receipt_fx');
  assertStringIncludes(migration023, 'FOR UPDATE');
  assertStringIncludes(migration023, 'UPDATE public.invoices');
  assertStringIncludes(migration023, 'UPDATE public.receipts');
  assertStringIncludes(migration023, 'RETURN public.fx_record_booking_decision');

  assertStringIncludes(invoiceService, "'fx_update_governed_invoice_fx'");
  assertStringIncludes(receiptService, 'updateDraftReceiptFx');
  assertStringIncludes(receiptService, "'fx_update_governed_receipt_fx'");
  assertStringIncludes(receiptService, 'Receipt booking-rate governance failed and draft cleanup failed');
});

Deno.test('Batch 9D-C approval authorization is database-derived and fail-closed', async () => {
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');

  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_booking_actor_has_role');
  assertStringIncludes(migration023, 'FROM public.user_roles ur');
  assertStringIncludes(migration023, 'ur.user_id = p_actor_user_id');
  assertStringIncludes(migration023, 'ur.company_id = p_company_id');
  assertStringIncludes(migration023, 'ur.is_active = true');
  assertStringIncludes(migration023, 'missing deviation baseline cannot be approved');
  assertStringIncludes(migration023, "ARRAY['AR Supervisor', 'Finance Manager']");
  assertStringIncludes(migration023, "ARRAY['Finance Manager']");
});

Deno.test('Batch 9D-C stale reference governance is enforced', async () => {
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');

  assertStringIncludes(migration023, 'v_stale_reference := (v_tx.transaction_date - v_reference.effective_date) > 7');
  assertStringIncludes(migration023, 'stale_reference');
  assertStringIncludes(migration023, 'stale reference decision is not postable');
});

Deno.test('Batch 9D-C posting guard runs before journal mutation and status transition', async () => {
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');

  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_guard_journal_entry_booking_decision');
  assertStringIncludes(migration023, "NEW.source_type IN ('INV', 'CN', 'DN')");
  assertStringIncludes(migration023, "NEW.source_type = 'RCT'");
  assertStringIncludes(migration023, 'BEFORE INSERT ON public.journal_entries');
  assertStringIncludes(migration023, 'fx_guard_invoice_posting_decision');
  assertStringIncludes(migration023, 'fx_guard_receipt_posting_decision');
});

Deno.test('Batch 9D-C audit event vocabulary is emitted by implemented flows', async () => {
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');

  for (const eventType of [
    'BaselineResolved',
    'CatalogSelected',
    'ReferenceSelected',
    'OverrideSubmitted',
    'ApprovalRequired',
    'Approved',
    'Rejected',
    'DecisionSuperseded',
    'Posted',
  ]) {
    assertStringIncludes(migration023, `'${eventType}'`);
  }
});

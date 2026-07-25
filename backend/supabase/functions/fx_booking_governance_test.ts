const read = (path: string) => Deno.readTextFile(path);

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function assertStringIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected string to include: ${expected}`);
  }
}

function assertOrdered(actual: string, fragments: string[]): void {
  let previous = -1;
  for (const fragment of fragments) {
    const next = actual.indexOf(fragment, previous + 1);
    if (next === -1) {
      throw new Error(`Expected ordered fragment not found after index ${previous}: ${fragment}`);
    }
    previous = next;
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

Deno.test('Batch 9D-C migration 022 installs incompatible ALTERs before backfill DML', async () => {
  const migration022 = await read('../../../database/022_fx_booking_rate_governance.sql');

  assertOrdered(migration022, [
    'ADD CONSTRAINT fk_invoices_fx_decision',
    'ADD CONSTRAINT fk_receipts_fx_decision',
    'ALTER TABLE public.fx_booking_rate_decisions ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE public.fx_booking_rate_decision_events ENABLE ROW LEVEL SECURITY',
    '-- 7. Historical bootstrap backfill',
    'INSERT INTO public.fx_booking_rate_decisions',
    'UPDATE public.invoices i',
    'INSERT INTO public.fx_booking_rate_decision_events',
    'UPDATE public.receipts r',
  ]);
});

Deno.test('Batch 9D-C migration 024 hardens optional source provenance records', async () => {
  const migration024 = await read('../../../database/024_fx_booking_decision_runtime_fix.sql');

  assertStringIncludes(migration024, 'CREATE OR REPLACE FUNCTION public.fx_record_booking_decision(');
  assertStringIncludes(migration024, 'p_company_id UUID');
  assertStringIncludes(migration024, 'p_transaction_type TEXT');
  assertStringIncludes(migration024, 'p_transaction_id UUID');
  assertStringIncludes(migration024, 'p_actor_user_id UUID');
  assertStringIncludes(migration024, 'p_explicit_rate_supplied BOOLEAN DEFAULT false');
  assertStringIncludes(migration024, 'p_source_category TEXT DEFAULT NULL');
  assertStringIncludes(migration024, 'p_fx_reference_rate_id UUID DEFAULT NULL');
  assertStringIncludes(migration024, 'p_override_reason TEXT DEFAULT NULL');
  assertStringIncludes(migration024, 'p_import_origin JSONB DEFAULT NULL');
  assertStringIncludes(migration024, 'SECURITY DEFINER');
  assertStringIncludes(migration024, 'SET search_path = public');

  assertStringIncludes(migration024, 'v_source_exchange_rate_id UUID := NULL');
  assertStringIncludes(migration024, 'v_source_fx_reference_rate_id UUID := NULL');
  assertStringIncludes(migration024, 'v_source_exchange_rate_id := v_exchange.id');
  assertStringIncludes(migration024, 'v_source_fx_reference_rate_id := v_reference.id');
  assertStringIncludes(migration024, 'GRANT EXECUTE ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) TO service_role');

  assert(
    !migration024.includes("CASE WHEN v_source_category = 'CATALOG' THEN v_exchange.id ELSE NULL"),
    'migration 024 must not dereference optional v_exchange RECORD in CATALOG CASE expressions',
  );
  assert(
    !migration024.includes("CASE WHEN v_source_category = 'REFERENCE_SELECTED' THEN v_reference.id ELSE NULL"),
    'migration 024 must not dereference optional v_reference RECORD in REFERENCE_SELECTED CASE expressions',
  );

  const functionReplacementCount = migration024.match(/CREATE OR REPLACE FUNCTION public\./g)?.length ?? 0;
  assert(functionReplacementCount === 1, 'migration 024 should replace only fx_record_booking_decision');
});

Deno.test('Batch 9D-C migration 025 narrows supersession validation without broad bypass', async () => {
  const migration025 = await read('../../../database/025_fx_booking_decision_supersession_validation_fix.sql');

  assertStringIncludes(migration025, 'CREATE OR REPLACE FUNCTION public.fx_validate_booking_rate_decision()');
  assertStringIncludes(migration025, 'SECURITY DEFINER');
  assertStringIncludes(migration025, 'SET search_path = public');
  assertStringIncludes(migration025, "AND NEW.lifecycle_status = 'Superseded'");
  assertStringIncludes(migration025, "OLD.lifecycle_status NOT IN ('Draft', 'Pending', 'Approved', 'Rejected')");
  assertStringIncludes(migration025, 'Superseded transition may only change lifecycle_status and updated_at');
  assertStringIncludes(migration025, 'v_lifecycle_only_supersession BOOLEAN := false');
  assertStringIncludes(migration025, 'v_lifecycle_only_supersession := true');

  for (const protectedField of [
    'OLD.id IS DISTINCT FROM NEW.id',
    'OLD.company_id IS DISTINCT FROM NEW.company_id',
    'OLD.invoice_id IS DISTINCT FROM NEW.invoice_id',
    'OLD.receipt_id IS DISTINCT FROM NEW.receipt_id',
    'OLD.root_decision_id IS DISTINCT FROM NEW.root_decision_id',
    'OLD.decision_version IS DISTINCT FROM NEW.decision_version',
    'OLD.supersedes_decision_id IS DISTINCT FROM NEW.supersedes_decision_id',
    'OLD.source_category IS DISTINCT FROM NEW.source_category',
    'OLD.exchange_rate_id IS DISTINCT FROM NEW.exchange_rate_id',
    'OLD.fx_reference_rate_id IS DISTINCT FROM NEW.fx_reference_rate_id',
    'OLD.baseline_kind IS DISTINCT FROM NEW.baseline_kind',
    'OLD.baseline_rate IS DISTINCT FROM NEW.baseline_rate',
    'OLD.baseline_exchange_rate_id IS DISTINCT FROM NEW.baseline_exchange_rate_id',
    'OLD.baseline_fx_reference_rate_id IS DISTINCT FROM NEW.baseline_fx_reference_rate_id',
    'OLD.from_currency IS DISTINCT FROM NEW.from_currency',
    'OLD.to_currency IS DISTINCT FROM NEW.to_currency',
    'OLD.transaction_date IS DISTINCT FROM NEW.transaction_date',
    'OLD.booked_rate IS DISTINCT FROM NEW.booked_rate',
    'OLD.deviation_pct IS DISTINCT FROM NEW.deviation_pct',
    'OLD.approval_status IS DISTINCT FROM NEW.approval_status',
    'OLD.checker_user_id IS DISTINCT FROM NEW.checker_user_id',
    'OLD.approved_by IS DISTINCT FROM NEW.approved_by',
    'OLD.approved_at IS DISTINCT FROM NEW.approved_at',
    'OLD.import_origin IS DISTINCT FROM NEW.import_origin',
    'OLD.metadata IS DISTINCT FROM NEW.metadata',
  ]) {
    assertStringIncludes(migration025, protectedField);
  }

  assertStringIncludes(migration025, 'IF NOT v_lifecycle_only_supersession');
  assertStringIncludes(migration025, 'BR-FX-GOVERNANCE: invoice decision currency mismatch');
  assertStringIncludes(migration025, 'BR-FX-GOVERNANCE: receipt decision currency mismatch');
  assertStringIncludes(migration025, 'BR-FX-GOVERNANCE: invalid catalog source');
  assertStringIncludes(migration025, 'BR-FX-GOVERNANCE: invalid reference source');
  assertStringIncludes(migration025, 'BR-FX-GOVERNANCE: invalid supersession lineage');
  assertStringIncludes(migration025, 'BR-FX-GOVERNANCE: BASE_PARITY requires booked_rate = 1.0');

  assert(!migration025.includes("IF NEW.lifecycle_status = 'Superseded' THEN\n    RETURN NEW;"));
  assert(!migration025.includes("IF NEW.lifecycle_status = 'Superseded' THEN\r\n    RETURN NEW;"));
  assert(!/^\s*(INSERT|UPDATE|DELETE)\s+/m.test(migration025), 'migration 025 must not contain top-level transaction data DML');

  const functionReplacementCount = migration025.match(/CREATE OR REPLACE FUNCTION public\./g)?.length ?? 0;
  assert(functionReplacementCount === 1, 'migration 025 should replace only fx_validate_booking_rate_decision');
});

Deno.test('Batch 9D-C migration 026 preserves trusted import-origin provenance', async () => {
  const migration026 = await read('../../../database/026_fx_booking_decision_import_origin_provenance_fix.sql');
  const importsService = await read('imports/service.ts');
  const invoiceService = await read('invoices/service.ts');
  const receiptService = await read('receipts/service.ts');

  assertStringIncludes(migration026, 'CREATE OR REPLACE FUNCTION public.fx_preserve_import_origin_on_supersession()');
  assertStringIncludes(migration026, 'SECURITY DEFINER');
  assertStringIncludes(migration026, 'SET search_path = public');
  assertStringIncludes(migration026, 'NEW.import_origin IS NULL AND NEW.supersedes_decision_id IS NOT NULL');
  assertStringIncludes(migration026, 'NEW.import_origin := v_prior_import_origin');
  assertStringIncludes(migration026, 'CREATE TRIGGER trg_fx_brd_preserve_import_origin');
  assertStringIncludes(migration026, 'BEFORE INSERT ON public.fx_booking_rate_decisions');

  assertStringIncludes(migration026, 'CREATE OR REPLACE FUNCTION public.fx_create_governed_invoice_draft(');
  assertStringIncludes(migration026, 'p_import_origin JSONB');
  assertStringIncludes(migration026, 'p_lines JSONB DEFAULT');
  assertStringIncludes(migration026, 'CREATE OR REPLACE FUNCTION public.fx_create_governed_receipt_draft(');
  assertStringIncludes(migration026, 'IF p_import_origin IS NOT NULL AND jsonb_typeof(p_import_origin) <> \'object\'');
  assertStringIncludes(migration026, 'p_import_origin');
  assertStringIncludes(migration026, 'GRANT EXECUTE ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT) TO service_role');
  assertStringIncludes(migration026, 'GRANT EXECUTE ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) TO service_role');

  assert(!migration026.includes('LegacyBackfilled'), 'migration 026 must not rerun historical backfill');
  assert(!migration026.includes('UPDATE public.invoices i'), 'migration 026 must not rewrite existing invoice pointers');
  assert(!migration026.includes('UPDATE public.receipts r'), 'migration 026 must not rewrite existing receipt pointers');
  assert(!migration026.includes('post_invoice'), 'migration 026 must not replace posting functions');
  assert(!migration026.includes('post_receipt'), 'migration 026 must not replace posting functions');

  const createFunctionCount = migration026.match(/CREATE OR REPLACE FUNCTION public\./g)?.length ?? 0;
  assert(createFunctionCount === 3, 'migration 026 should replace only import-origin helper and import-aware create overloads');

  assertStringIncludes(importsService, 'function importOriginPayload(batch: ImportBatch, row: ImportRow)');
  for (const trustedField of [
    "source: 'csv_xlsx_import'",
    'batch_id: batch.id',
    'row_id: row.id',
    'row_number: row.row_number',
    'batch_name: batch.batch_name',
    'import_type: batch.import_type',
    'file_type: batch.file_type',
    'file_name: batch.file_name',
    'file_path: batch.file_path',
  ]) {
    assertStringIncludes(importsService, trustedField);
  }

  assertOrdered(importsService, [
    'const importOrigin = importOriginPayload(batch, row);',
    'created = await this.invoiceService.createInvoice(auth, header, lines, { importOrigin });',
  ]);
  assertOrdered(importsService, [
    'const importOrigin = importOriginPayload(batch, row);',
    'created = await this.receiptService.createReceipt(auth, receiptInput, { importOrigin });',
  ]);

  assertStringIncludes(invoiceService, 'export interface CreateInvoiceOptions');
  assertStringIncludes(invoiceService, 'importOrigin?: Record<string, unknown>');
  assertStringIncludes(invoiceService, 'options: CreateInvoiceOptions = {}');
  assertStringIncludes(invoiceService, 'p_import_origin: options.importOrigin ?? null');
  assertStringIncludes(invoiceService, 'p_fx_reference_rate_id: data.fx_reference_rate_id ?? null');

  assertStringIncludes(receiptService, 'export interface CreateReceiptOptions');
  assertStringIncludes(receiptService, 'importOrigin?: Record<string, unknown>');
  assertStringIncludes(receiptService, 'options: CreateReceiptOptions = {}');
  assertStringIncludes(receiptService, 'p_import_origin: options.importOrigin ?? null');
  assertStringIncludes(receiptService, 'p_fx_reference_rate_id: data.fx_reference_rate_id ?? null');
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

Deno.test('Batch 9D-C imports preserve explicit FX governance fields into create inputs', async () => {
  const importsService = await read('imports/service.ts');

  assertStringIncludes(importsService, 'function importFxGovernanceFields');
  assertStringIncludes(importsService, "hasImportValue(raw, 'exchange_rate')");
  assertStringIncludes(importsService, "fields.exchange_rate = parseNumber(asString(raw, 'exchange_rate'), 'exchange_rate')");
  assertStringIncludes(importsService, 'fields.exchange_rate <= 0');
  assertStringIncludes(importsService, "hasImportValue(raw, 'fx_override_reason')");
  assertStringIncludes(importsService, "fields.fx_override_reason = asString(raw, 'fx_override_reason')");

  const helperAssignments = importsService.match(/const fxGovernanceFields = importFxGovernanceFields\(raw\);/g)?.length ?? 0;
  assert(helperAssignments === 2, 'invoice and receipt validation must both derive import FX governance fields');

  const mappedDataSpreads = importsService.match(/\.\.\.fxGovernanceFields/g)?.length ?? 0;
  assert(
    mappedDataSpreads >= 4,
    'invoice and receipt mapped_data, including review-required branches, must preserve explicit FX governance fields',
  );

  assertOrdered(importsService, [
    'if (batch.import_type === \'invoice\')',
    'mappedData = {',
    '...row.mapped_data',
    'const header = validateCreateInvoice(mappedData)',
    'created = await this.invoiceService.createInvoice(auth, header, lines, { importOrigin })',
  ]);

  assertOrdered(importsService, [
    '} else {',
    'mappedData = {',
    '...row.mapped_data',
    'const receiptInput = validateCreateReceipt(mappedData)',
    'created = await this.receiptService.createReceipt(auth, receiptInput, { importOrigin })',
  ]);
});

Deno.test('Batch 9D-C invoice and receipt create paths use atomic governed create RPCs', async () => {
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');
  const invoiceService = await read('invoices/service.ts');
  const receiptService = await read('receipts/service.ts');

  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_create_governed_invoice_draft');
  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_create_governed_receipt_draft');
  assertStringIncludes(migration023, 'INSERT INTO public.invoices');
  assertStringIncludes(migration023, 'INSERT INTO public.invoice_lines');
  assertStringIncludes(migration023, 'INSERT INTO public.receipts');
  assertStringIncludes(migration023, "v_decision_id := public.fx_record_booking_decision");

  assertStringIncludes(invoiceService, "'fx_create_governed_invoice_draft'");
  assertStringIncludes(receiptService, "'fx_create_governed_receipt_draft'");
  assert(!invoiceService.includes('Invoice creation failed and cleanup was incomplete'));
  assert(!receiptService.includes('Receipt booking-rate governance failed and draft cleanup failed'));

  assert(invoiceService.includes('data.exchange_rate !== undefined'));
  assert(receiptService.includes('data.exchange_rate !== undefined'));
});

Deno.test('Batch 9D-C governed FX mutation RPCs own snapshot and decision changes', async () => {
  const migration023 = await read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');
  const migration028 = await read('../../../database/028_linked_credit_note_reference_integrity.sql');
  const invoiceService = await read('invoices/service.ts');
  const receiptService = await read('receipts/service.ts');

  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_update_governed_invoice_fx');
  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_update_governed_receipt_fx');
  assertStringIncludes(migration023, 'CREATE OR REPLACE FUNCTION public.fx_recalculate_invoice_draft_totals');
  assertStringIncludes(migration023, 'FOR UPDATE');
  assertStringIncludes(migration023, 'UPDATE public.invoices');
  assertStringIncludes(migration023, 'UPDATE public.receipts');
  assertStringIncludes(migration023, 'RETURN public.fx_record_booking_decision');

  assertStringIncludes(invoiceService, "'update_draft_invoice'");
  assertStringIncludes(invoiceService, "'add_draft_invoice_lines'");
  assertStringIncludes(invoiceService, "'update_draft_invoice_line'");
  assertStringIncludes(invoiceService, "'delete_draft_invoice_line'");
  assertStringIncludes(migration028, 'CREATE FUNCTION public.update_draft_invoice');
  assertStringIncludes(migration028, 'PERFORM public.fx_update_governed_invoice_fx');
  assertStringIncludes(migration028, 'PERFORM public.fx_recalculate_invoice_draft_totals');
  assertStringIncludes(receiptService, 'updateDraftReceiptFx');
  assertStringIncludes(receiptService, "'fx_update_governed_receipt_fx'");
  assertStringIncludes(migration023, "current_setting('app.fx_governed_mutation', true) IS DISTINCT FROM 'on'");
  assertStringIncludes(migration023, "PERFORM set_config('app.fx_governed_mutation', 'on', true)");
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

  assertOrdered(migration023, [
    'CREATE OR REPLACE FUNCTION post_invoice',
    'FOR UPDATE;',
    'PERFORM public.fx_assert_booking_decision_postable',
    'UPDATE invoices SET',
    'INSERT INTO journal_entries',
  ]);

  assertOrdered(migration023, [
    'CREATE OR REPLACE FUNCTION post_receipt',
    'FOR UPDATE;',
    'PERFORM public.fx_assert_booking_decision_postable',
    'INSERT INTO journal_entries',
  ]);

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

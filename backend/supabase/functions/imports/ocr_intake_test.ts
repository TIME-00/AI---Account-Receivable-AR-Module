// ============================================================================
// Batch 9B-I1: PDF/Image OCR intake file safety and provider tests
// ============================================================================

import { ValidationError } from '../_shared/errors.ts';
import { validateOcrIntakeFile, OCR_FILE_LIMITS } from './file_validation.ts';
import { DisabledOcrProvider } from './ocr_provider.ts';
import { validateOcrIntakeImportType } from './intake_validation.ts';
import { ImportService } from './service.ts';
import type { AuthContext } from '../_shared/auth.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejectsValidation(
  action: () => unknown | Promise<unknown>,
  expectedMessagePart: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ValidationError, 'Expected ValidationError');
    assert(
      error.message.includes(expectedMessagePart),
      `Expected message to include "${expectedMessagePart}", got "${error.message}"`,
    );
    return;
  }
  throw new Error(`Expected ValidationError containing "${expectedMessagePart}"`);
}

function makePdf(pageCount = 1, extra = ''): Uint8Array {
  const pages = Array.from({ length: pageCount }, (_, idx) =>
    `${idx + 1} 0 obj\n<< /Type /Page /Parent 9 0 R >>\nendobj\n`
  ).join('');
  return new TextEncoder().encode(`%PDF-1.4\n${pages}${extra}\n%%EOF`);
}

function part(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function makePng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function makeJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function makeWebp(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
  ]);
}

type Operation = {
  table: string;
  action: 'insert' | 'update' | 'delete' | 'select';
  payload?: unknown;
};

type Filter = {
  column: string;
  value: unknown;
};

class FakeQuery {
  private action: Operation['action'] = 'select';
  private payload: unknown;
  private filters: Filter[] = [];

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string,
  ) {}

  insert(payload: unknown): FakeQuery {
    this.action = 'insert';
    this.payload = payload;
    this.client.operations.push({ table: this.table, action: 'insert', payload });
    return this;
  }

  update(payload: unknown): FakeQuery {
    this.action = 'update';
    this.payload = payload;
    this.client.operations.push({ table: this.table, action: 'update', payload });
    return this;
  }

  delete(): FakeQuery {
    this.action = 'delete';
    this.client.operations.push({ table: this.table, action: 'delete' });
    return this;
  }

  select(): FakeQuery {
    return this;
  }

  eq(column: string, value: unknown): FakeQuery {
    this.filters.push({ column, value });
    return this;
  }

  order(): FakeQuery {
    return this;
  }

  limit(): FakeQuery {
    return this;
  }

  async single(): Promise<{ data: unknown; error: null }> {
    return { data: this.client.resolveSingle(this.table, this.action, this.payload, this.filters), error: null };
  }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    return { data: this.client.resolveSingle(this.table, this.action, this.payload, this.filters), error: null };
  }

  async then(
    resolve: (value: { data: unknown[]; error: null }) => unknown,
    reject?: (reason?: unknown) => unknown,
  ): Promise<unknown> {
    try {
      return await Promise.resolve(resolve({ data: this.client.resolveList(this.table), error: null }));
    } catch (error) {
      if (reject) return reject(error);
      throw error;
    }
  }
}

class FakeStorageBucket {
  constructor(private readonly client: FakeSupabaseClient) {}

  async upload(path: string): Promise<{ data: { path: string }; error: null }> {
    this.client.uploadedPaths.push(path);
    return { data: { path }, error: null };
  }

  async createSignedUrl(path: string): Promise<{ data: { signedUrl: string }; error: null }> {
    return { data: { signedUrl: `https://signed.example/${encodeURIComponent(path)}` }, error: null };
  }

  async download(): Promise<{ data: Blob; error: null }> {
    return { data: new Blob([]), error: null };
  }
}

class FakeSupabaseClient {
  operations: Operation[] = [];
  uploadedPaths: string[] = [];
  batches = new Map<string, Record<string, unknown>>();
  files = new Map<string, Record<string, unknown>>();
  rows = new Map<string, Record<string, unknown>>();

  constructor(private readonly guardBatch?: Record<string, unknown>) {
    if (guardBatch?.id) {
      this.batches.set(String(guardBatch.id), guardBatch);
    }
  }

  storage = {
    from: () => new FakeStorageBucket(this),
  };

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  resolveSingle(
    table: string,
    action: Operation['action'],
    payload: unknown,
    filters: Filter[],
  ): Record<string, unknown> {
    if (action === 'insert' && table === 'import_batches') {
      const row = {
        id: '11111111-1111-1111-1111-111111111111',
        file_path: null,
        ...(Array.isArray(payload) ? payload[0] : payload as Record<string, unknown>),
      };
      this.batches.set(String(row.id), row);
      return row;
    }

    if (action === 'update' && table === 'import_batches') {
      const id = String(filters.find((filter) => filter.column === 'id')?.value ?? '11111111-1111-1111-1111-111111111111');
      const existing = this.batches.get(id) ?? { id };
      const row = { ...existing, ...(payload as Record<string, unknown>) };
      this.batches.set(id, row);
      return row;
    }

    if (action === 'insert' && table === 'import_files') {
      const row = {
        id: '22222222-2222-2222-2222-222222222222',
        ...(Array.isArray(payload) ? payload[0] : payload as Record<string, unknown>),
      };
      this.files.set(String(row.id), row);
      return row;
    }

    if (action === 'insert' && table === 'import_rows') {
      const row = {
        id: '33333333-3333-3333-3333-333333333333',
        ...(Array.isArray(payload) ? payload[0] : payload as Record<string, unknown>),
      };
      this.rows.set(String(row.id), row);
      return row;
    }

    if (table === 'import_batches') {
      const id = String(filters.find((filter) => filter.column === 'id')?.value ?? this.guardBatch?.id ?? '11111111-1111-1111-1111-111111111111');
      return this.batches.get(id) ?? this.guardBatch ?? {};
    }

    if (table === 'import_rows') {
      const id = String(filters.find((filter) => filter.column === 'id')?.value ?? '33333333-3333-3333-3333-333333333333');
      return this.rows.get(id) ?? {};
    }

    return {};
  }

  resolveList(table: string): Record<string, unknown>[] {
    if (table === 'import_rows') return Array.from(this.rows.values());
    if (table === 'import_files') return Array.from(this.files.values());
    if (table === 'import_batches') return Array.from(this.batches.values());
    return [];
  }
}

function makeAuth(): AuthContext {
  return {
    userId: '99999999-9999-9999-9999-999999999999',
    companyId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'finance.manager@example.test',
    roles: ['Finance Manager'],
    highestRole: 'Finance Manager',
  };
}

function makeReceiptPdfIntakeBatch(): Record<string, unknown> {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    company_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    batch_name: 'B9C receipt PDF intake',
    import_type: 'receipt',
    file_type: 'pdf',
    file_name: 'receipt.pdf',
    file_path: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/receipt.pdf',
    status: 'NeedsReview',
    total_rows: 1,
    valid_rows: 0,
    error_rows: 0,
    created_count: 0,
    posted_count: 0,
    allocated_count: 0,
    auto_post: false,
    auto_allocate: false,
    created_by: '99999999-9999-9999-9999-999999999999',
  };
}

function assertNoProtectedFinancialMutation(client: FakeSupabaseClient): void {
  const protectedTables = new Set(['allocation_details', 'invoices', 'receipts', 'journal_entries', 'journal_entry_lines']);
  const mutations = client.operations.filter((operation) =>
    protectedTables.has(operation.table) && ['insert', 'update', 'delete'].includes(operation.action)
  );
  assert(mutations.length === 0, `Expected zero protected financial mutations, got ${JSON.stringify(mutations)}`);
}

function objectData(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `Expected object ${label}`);
  return value as Record<string, unknown>;
}

Deno.test('OCR intake accepts a valid synthetic PDF within page cap', async () => {
  const result = await validateOcrIntakeFile(
    new File([part(makePdf(2))], 'b9b-smoke.pdf', { type: 'application/pdf' }),
    'pdf',
  );

  assert(result.fileType === 'pdf', 'Expected PDF file type');
  assert(result.detectedMime === 'application/pdf', 'Expected PDF MIME');
  assert(result.pageCount === 2, 'Expected two pages');
  assert(result.scanStatus === 'unavailable', 'Expected conservative scan fallback');
  assert(result.sha256.length === 64, 'Expected SHA-256 hex digest');
});

Deno.test('OCR intake accepts PNG/JPEG/WebP raster images', async () => {
  const png = await validateOcrIntakeFile(
    new File([part(makePng())], 'b9b-smoke.png', { type: 'image/png' }),
    'image',
  );
  const jpg = await validateOcrIntakeFile(
    new File([part(makeJpeg())], 'b9b-smoke.jpg', { type: 'image/jpeg' }),
    'image',
  );
  const webp = await validateOcrIntakeFile(
    new File([part(makeWebp())], 'b9b-smoke.webp', { type: 'image/webp' }),
    'image',
  );

  assert(png.detectedMime === 'image/png', 'Expected PNG MIME');
  assert(jpg.detectedMime === 'image/jpeg', 'Expected JPEG MIME');
  assert(webp.detectedMime === 'image/webp', 'Expected WebP MIME');
});

Deno.test('OCR intake rejects SVG and SVGZ files', async () => {
  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File(['<svg></svg>'], 'b9b-smoke.svg', { type: 'image/svg+xml' }),
      'image',
    ),
    'SVG files are not supported',
  );

  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File(['not really gzip'], 'b9b-smoke.svgz', { type: 'image/svg+xml' }),
      'image',
    ),
    'SVG files are not supported',
  );
});

Deno.test('OCR intake rejects double extensions', async () => {
  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File([part(makePdf())], 'invoice.pdf.exe.pdf', { type: 'application/pdf' }),
      'pdf',
    ),
    'Double-extension',
  );
});

Deno.test('OCR intake rejects MIME spoof and magic-number mismatch', async () => {
  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File([part(makePdf())], 'invoice.png', { type: 'image/png' }),
      'image',
    ),
    'Requested file_type does not match',
  );

  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File(['plain text'], 'invoice.pdf', { type: 'application/pdf' }),
      'pdf',
    ),
    'magic number',
  );
});

Deno.test('OCR intake rejects zero-byte and oversized files', async () => {
  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File([], 'empty.pdf', { type: 'application/pdf' }),
      'pdf',
    ),
    'empty',
  );

  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File([part(makePdf(1)), part(new Uint8Array(OCR_FILE_LIMITS.pdfMaxBytes + 1))], 'oversized.pdf', { type: 'application/pdf' }),
      'pdf',
    ),
    'exceeds',
  );
});

Deno.test('OCR intake rejects PDF above page cap and active/encrypted PDFs', async () => {
  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File([part(makePdf(OCR_FILE_LIMITS.pdfMaxPages + 1))], 'too-many-pages.pdf', { type: 'application/pdf' }),
      'pdf',
    ),
    'page',
  );

  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File([part(makePdf(1, '/Encrypt 99 0 R'))], 'encrypted.pdf', { type: 'application/pdf' }),
      'pdf',
    ),
    'Encrypted PDFs',
  );

  await assertRejectsValidation(
    () => validateOcrIntakeFile(
      new File([part(makePdf(1, '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'))], 'active.pdf', { type: 'application/pdf' }),
      'pdf',
    ),
    'active content',
  );
});

Deno.test('disabled OCR provider returns manual fallback response without secrets', async () => {
  const provider = new DisabledOcrProvider();
  const result = await provider.extract();

  assert(provider.isEnabled() === false, 'Expected provider to be disabled');
  assert(result.status === 'disabled', 'Expected disabled status');
  assert(result.metadata.manual_fallback === true, 'Expected manual fallback metadata');
  assert(result.rawText === null, 'Expected no raw OCR text');
  assert(result.fields.length === 0, 'Expected no extracted fields');
});

Deno.test('OCR upload route-level import_type validation accepts invoice and receipt only', async () => {
  assert(validateOcrIntakeImportType('invoice') === 'invoice', 'Expected invoice to be accepted');
  assert(validateOcrIntakeImportType('receipt') === 'receipt', 'Expected receipt to be accepted');

  await assertRejectsValidation(
    () => validateOcrIntakeImportType('journal'),
    'invoice or import_type=receipt',
  );
});

Deno.test('receipt PDF/Image upload creates review-only metadata with receipt review kind', async () => {
  const client = new FakeSupabaseClient();
  const service = new ImportService(client as never);
  const result = await service.uploadOcrIntakeFile(makeAuth(), {
    file: new File([part(makePdf(1))], 'b9c-receipt.pdf', { type: 'application/pdf' }),
    fileType: 'pdf',
    importType: 'receipt',
    batchName: 'B9C Receipt PDF Intake',
  });

  assert(result.batch.import_type === 'receipt', 'Expected receipt import batch');
  assert(result.batch.status === 'NeedsReview', 'Expected review-only batch status');
  const rawData = objectData(result.row.raw_data, 'raw_data');
  const mappedData = objectData(result.row.mapped_data, 'mapped_data');
  assert(rawData.import_type === 'receipt', 'Expected receipt row raw import type');
  assert(mappedData.review_kind === 'ocr_receipt_manual_entry', 'Expected receipt review kind');
  assert(mappedData.review_required === true, 'Expected manual review requirement');
  assert(mappedData.financial_mutation !== true, 'Expected no financial mutation flag');
  assert(!String(mappedData.message).includes('invoice fields'), 'Expected generalized manual fallback message');
  assert(result.manual_fallback === true, 'Expected manual fallback response');
  assertNoProtectedFinancialMutation(client);
});

Deno.test('receipt raster uploads accept PNG/JPEG/WebP and keep review-only metadata', async () => {
  const cases = [
    { file: new File([part(makePng())], 'b9c-receipt.png', { type: 'image/png' }), label: 'PNG' },
    { file: new File([part(makeJpeg())], 'b9c-receipt.jpg', { type: 'image/jpeg' }), label: 'JPEG' },
    { file: new File([part(makeWebp())], 'b9c-receipt.webp', { type: 'image/webp' }), label: 'WebP' },
  ];

  for (const testCase of cases) {
    const client = new FakeSupabaseClient();
    const service = new ImportService(client as never);
    const result = await service.uploadOcrIntakeFile(makeAuth(), {
      file: testCase.file,
      fileType: 'image',
      importType: 'receipt',
      batchName: `B9C Receipt ${testCase.label} Intake`,
    });

    assert(result.batch.import_type === 'receipt', `Expected receipt import batch for ${testCase.label}`);
    assert(result.batch.file_type === 'image', `Expected image file type for ${testCase.label}`);
    assert(result.row.status === 'NeedsReview', `Expected NeedsReview row for ${testCase.label}`);
    const mappedData = objectData(result.row.mapped_data, 'mapped_data');
    assert(mappedData.review_kind === 'ocr_receipt_manual_entry', `Expected receipt review kind for ${testCase.label}`);
    assertNoProtectedFinancialMutation(client);
  }
});

Deno.test('invoice PDF/Image upload still creates invoice review metadata', async () => {
  const client = new FakeSupabaseClient();
  const service = new ImportService(client as never);
  const result = await service.uploadOcrIntakeFile(makeAuth(), {
    file: new File([part(makePdf(1))], 'b9c-invoice-regression.pdf', { type: 'application/pdf' }),
    fileType: 'pdf',
    importType: 'invoice',
    batchName: 'B9C Invoice Regression Intake',
  });

  assert(result.batch.import_type === 'invoice', 'Expected invoice import batch');
  const rawData = objectData(result.row.raw_data, 'raw_data');
  const mappedData = objectData(result.row.mapped_data, 'mapped_data');
  assert(rawData.import_type === 'invoice', 'Expected invoice row raw import type');
  assert(mappedData.review_kind === 'ocr_invoice_manual_entry', 'Expected invoice review kind');
  assert(result.row.status === 'NeedsReview', 'Expected invoice review-only row');
  assertNoProtectedFinancialMutation(client);
});

Deno.test('receipt CSV upload path still accepts existing CSV/Excel import channel', async () => {
  const client = new FakeSupabaseClient();
  const service = new ImportService(client as never);
  const result = await service.uploadFile(makeAuth(), {
    file: new File(['receipt_number,customer_name,amount\nR-1,Test Customer,10.00\n'], 'b9c-receipts.csv', { type: 'text/csv' }),
    fileType: 'csv',
    importType: 'receipt',
    batchName: 'B9C Receipt CSV Regression',
  });

  assert(result.import_type === 'receipt', 'Expected existing receipt CSV import type to remain supported');
  assert(result.file_type === 'csv', 'Expected CSV file type');
  assert(result.status === 'Uploaded', 'Expected standard CSV upload status');
  assertNoProtectedFinancialMutation(client);
});

Deno.test('receipt PDF/Image intake batch cannot enter parse/validate/execute CSV paths', async () => {
  const methods = [
    {
      name: 'parse',
      run: (service: ImportService) => service.parseBatch(makeAuth(), '44444444-4444-4444-4444-444444444444'),
    },
    {
      name: 'validate',
      run: (service: ImportService) => service.validateBatch(makeAuth(), '44444444-4444-4444-4444-444444444444'),
    },
    {
      name: 'execute',
      run: (service: ImportService) => service.executeDraftCreation(makeAuth(), '44444444-4444-4444-4444-444444444444', { autoPost: true }),
    },
  ];

  for (const method of methods) {
    const client = new FakeSupabaseClient(makeReceiptPdfIntakeBatch());
    const service = new ImportService(client as never);
    await assertRejectsValidation(
      () => method.run(service),
      'csv and xlsx',
    );
    assertNoProtectedFinancialMutation(client);
  }
});

// ============================================================================
// Batch 8F2: CSV/XLSX parser security and compatibility tests
// ============================================================================

import { parseCsv } from './csv.ts';
import { parseXlsx } from './xlsx.ts';
import { ImportService } from './service.ts';
import { ValidationError } from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
// @deno-types="./vendor/sheetjs-0.20.3/types/index.d.ts"
import { utils, write } from './vendor/sheetjs-0.20.3/xlsx.mjs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Uint8Array) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer;
  }
  throw new Error(`Unexpected SheetJS output type: ${typeof value}`);
}

function makeWorkbook(rows: unknown[][]): ArrayBuffer {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), 'Import');
  return toArrayBuffer(write(workbook, { type: 'array', bookType: 'xlsx' }));
}

async function assertRejects(
  action: () => unknown | Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}

Deno.test('CSV parser retains valid import behavior', () => {
  const parsed = parseCsv(
    'customer_code,invoice_date,description,quantity,unit_price\n'
      + 'CUST-001,2026-06-23,Security regression,1,10.50\n',
  );

  assert(parsed.rows.length === 1, 'Expected one parsed CSV row');
  assert(parsed.rows[0].customer_code === 'CUST-001', 'Expected customer code');
  assert(parsed.rows[0].unit_price === '10.50', 'Expected unchanged CSV value');
});

Deno.test('vendored SheetJS parses a valid XLSX workbook', () => {
  const parsed = parseXlsx(makeWorkbook([
    ['customer_code', 'invoice_date', 'description', 'quantity', 'unit_price'],
    ['CUST-001', '2026-06-23', 'Security regression', 1, 10.5],
  ]));

  assert(parsed.rows.length === 1, 'Expected one parsed XLSX row');
  assert(parsed.rows[0].customer_code === 'CUST-001', 'Expected customer code');
  assert(parsed.rows[0].quantity === '1', 'Expected normalized quantity');
  assert(parsed.rows[0].unit_price === '10.5', 'Expected normalized unit price');
});

Deno.test('XLSX parser rejects malformed or truncated workbook data', async () => {
  const workbook = new Uint8Array(makeWorkbook([
    ['customer_code', 'description'],
    ['CUST-001', 'Truncated workbook'],
  ]));
  const truncated = workbook.slice(0, Math.min(128, workbook.length));

  await assertRejects(
    () => parseXlsx(truncated.buffer),
    'Expected truncated XLSX data to be rejected',
  );
});

Deno.test('XLSX parser rejects an empty sheet', async () => {
  await assertRejects(
    () => parseXlsx(makeWorkbook([])),
    'Expected empty XLSX sheet to be rejected',
  );
});

Deno.test('XLSX parser rejects duplicate normalized headers', async () => {
  try {
    parseXlsx(makeWorkbook([
      ['Customer Code', 'customer-code'],
      ['CUST-001', 'CUST-002'],
    ]));
  } catch (error) {
    assert(error instanceof ValidationError, 'Expected ValidationError');
    assert(
      error.message.includes('duplicate header'),
      'Expected duplicate-header validation message',
    );
    return;
  }
  throw new Error('Expected duplicate XLSX headers to be rejected');
});

Deno.test('XLSX upload rejects files above the 10 MB limit before persistence', async () => {
  const service = new ImportService({} as never);
  const auth: AuthContext = {
    userId: 'b8f20000-0000-4000-8000-000000000001',
    companyId: 'b8f20000-0000-4000-8000-000000000002',
    roles: ['AR Clerk'],
    highestRole: 'AR Clerk',
    email: 'batch8f2@example.test',
  };
  const oversized = new File(
    [new Uint8Array((10 * 1024 * 1024) + 1)],
    'oversized.xlsx',
    {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  );

  try {
    await service.uploadFile(auth, {
      file: oversized,
      fileType: 'xlsx',
      importType: 'invoice',
    });
  } catch (error) {
    assert(error instanceof ValidationError, 'Expected ValidationError');
    assert(
      error.message.includes('10 MB'),
      'Expected the existing 10 MB XLSX limit',
    );
    return;
  }
  throw new Error('Expected oversized XLSX upload to be rejected');
});

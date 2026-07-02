// ============================================================================
// Batch 9B-I1: PDF/Image OCR intake file safety and provider tests
// ============================================================================

import { ValidationError } from '../_shared/errors.ts';
import { validateOcrIntakeFile, OCR_FILE_LIMITS } from './file_validation.ts';
import { DisabledOcrProvider } from './ocr_provider.ts';

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

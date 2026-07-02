import { ValidationError } from '../_shared/errors.ts';

export type OcrFileType = 'pdf' | 'image';
export type OcrDetectedMime =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

export interface OcrFileValidationResult {
  fileType: OcrFileType;
  extension: 'pdf' | 'png' | 'jpg' | 'jpeg' | 'webp';
  detectedMime: OcrDetectedMime;
  contentMime: string;
  sha256: string;
  pageCount: number | null;
  scanStatus: 'passed' | 'rejected' | 'quarantined' | 'unavailable';
  scanResult: Record<string, unknown>;
  retentionExpiresAt: string;
}

const PDF_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const PDF_MAX_PAGES = 3;
const RETENTION_DAYS = 30;

const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'] as const;
const EXTENSION_TO_MIME: Record<string, OcrDetectedMime> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const MIME_TO_FILE_TYPE: Record<OcrDetectedMime, OcrFileType> = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
};

function extensionFromName(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const parts = trimmed.split('.');
  if (parts.length < 2 || parts.some((part) => part === '')) {
    throw new ValidationError('OCR intake file must have a supported extension.', {
      file_name: fileName,
    });
  }

  const extension = parts.at(-1) ?? '';
  if (extension === 'svg' || extension === 'svgz') {
    throw new ValidationError('SVG files are not supported for OCR intake v1.', {
      file_name: fileName,
      extension,
    });
  }
  if (!ALLOWED_EXTENSIONS.includes(extension as typeof ALLOWED_EXTENSIONS[number])) {
    throw new ValidationError('Unsupported OCR intake file extension.', {
      file_name: fileName,
      extension,
      allowed_extensions: ALLOWED_EXTENSIONS,
    });
  }

  if (parts.length > 2) {
    throw new ValidationError('Double-extension filenames are rejected for OCR intake.', {
      file_name: fileName,
      extension,
    });
  }

  return extension;
}

function detectMime(bytes: Uint8Array): OcrDetectedMime {
  if (
    bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  throw new ValidationError('OCR intake file magic number is not supported.', {
    detected_mime_type: null,
  });
}

function assertMimeCompatible(extension: string, browserMime: string, detectedMime: OcrDetectedMime): void {
  const expectedMime = EXTENSION_TO_MIME[extension];
  if (expectedMime !== detectedMime) {
    throw new ValidationError('File extension does not match detected file content.', {
      extension,
      expected_mime: expectedMime,
      detected_mime: detectedMime,
    });
  }
  if (!browserMime) {
    throw new ValidationError('OCR intake upload must include a browser MIME type.', {
      detected_mime: detectedMime,
    });
  }
  if (browserMime !== expectedMime) {
    throw new ValidationError('Browser MIME type does not match the file extension/content.', {
      browser_mime: browserMime,
      expected_mime: expectedMime,
      detected_mime: detectedMime,
    });
  }
}

function countPdfPages(pdfText: string): number {
  const matches = pdfText.match(/\/Type\s*\/Page\b/g);
  return Math.max(1, matches?.length ?? 0);
}

function assertPdfSafety(bytes: Uint8Array): number {
  const text = new TextDecoder('iso-8859-1').decode(bytes);
  if (/\/Encrypt\b/i.test(text)) {
    throw new ValidationError('Encrypted PDFs are not supported for OCR intake v1.', {
      reason: 'encrypted_pdf',
    });
  }
  if (/\/(JavaScript|JS|OpenAction|AA)\b/i.test(text)) {
    throw new ValidationError('PDF active content is not supported for OCR intake v1.', {
      reason: 'pdf_active_content',
    });
  }

  const pageCount = countPdfPages(text);
  if (pageCount > PDF_MAX_PAGES) {
    throw new ValidationError(`PDF exceeds the ${PDF_MAX_PAGES}-page OCR intake limit.`, {
      page_count: pageCount,
      max_pages: PDF_MAX_PAGES,
    });
  }
  return pageCount;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function retentionExpiry(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + RETENTION_DAYS);
  return date.toISOString();
}

export async function validateOcrIntakeFile(
  file: File,
  requestedFileType: string,
): Promise<OcrFileValidationResult> {
  if (requestedFileType !== 'pdf' && requestedFileType !== 'image') {
    throw new ValidationError('OCR intake supports file_type=pdf or file_type=image only.', {
      file_type: requestedFileType,
    });
  }
  if (file.size <= 0) {
    throw new ValidationError('OCR intake file is empty.');
  }

  const extension = extensionFromName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedMime = detectMime(bytes);
  const detectedFileType = MIME_TO_FILE_TYPE[detectedMime];

  if (requestedFileType !== detectedFileType) {
    throw new ValidationError('Requested file_type does not match detected file content.', {
      requested_file_type: requestedFileType,
      detected_file_type: detectedFileType,
      detected_mime: detectedMime,
    });
  }

  assertMimeCompatible(extension, file.type, detectedMime);

  const maxBytes = detectedFileType === 'pdf' ? PDF_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > maxBytes) {
    throw new ValidationError(`OCR intake file exceeds the ${maxBytes / 1024 / 1024} MB limit.`, {
      file_size_bytes: file.size,
      max_bytes: maxBytes,
      file_type: detectedFileType,
    });
  }

  const pageCount = detectedMime === 'application/pdf' ? assertPdfSafety(bytes) : null;

  return {
    fileType: detectedFileType,
    extension: extension as OcrFileValidationResult['extension'],
    detectedMime,
    contentMime: file.type,
    sha256: await sha256Hex(bytes),
    pageCount,
    scanStatus: 'unavailable',
    scanResult: {
      mode: 'conservative_validation_fallback',
      passed: true,
      residual_risk: 'No malware scanner is integrated in Batch 9B-I1; strict type/size/magic/PDF safety validation is used before OCR/manual fallback.',
    },
    retentionExpiresAt: retentionExpiry(),
  };
}

export const OCR_FILE_LIMITS = {
  pdfMaxBytes: PDF_MAX_BYTES,
  imageMaxBytes: IMAGE_MAX_BYTES,
  pdfMaxPages: PDF_MAX_PAGES,
  retentionDays: RETENTION_DAYS,
} as const;

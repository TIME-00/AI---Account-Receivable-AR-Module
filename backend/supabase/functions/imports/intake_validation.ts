import { ValidationError } from '../_shared/errors.ts';

export const OCR_INTAKE_IMPORT_TYPES = ['invoice', 'receipt'] as const;

export type OcrIntakeImportType = typeof OCR_INTAKE_IMPORT_TYPES[number];

export function validateOcrIntakeImportType(importType: string): OcrIntakeImportType {
  if (!OCR_INTAKE_IMPORT_TYPES.includes(importType as OcrIntakeImportType)) {
    throw new ValidationError('PDF/Image import supports import_type=invoice or import_type=receipt only.', {
      field: 'import_type',
      allowed: OCR_INTAKE_IMPORT_TYPES,
    });
  }

  return importType as OcrIntakeImportType;
}

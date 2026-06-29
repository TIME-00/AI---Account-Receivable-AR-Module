// ============================================================================
// Sprint F4 Phase B - XLSX parsing helpers
// Excel Invoice Import, Draft Only
// ============================================================================

// @deno-types="./vendor/sheetjs-0.20.3/types/index.d.ts"
import { read, utils, SSF } from './vendor/sheetjs-0.20.3/xlsx.mjs';
import { ValidationError } from '../_shared/errors.ts';

export interface ParsedXlsx {
  headers: string[];
  rows: Record<string, string>[];
}

const DATE_COLUMNS = new Set(['invoice_date']);
const NUMERIC_COLUMNS = new Set(['quantity', 'unit_price', 'tax_rate']);

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isEmptyCell(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every(isEmptyCell);
}

function excelSerialDateToISO(serial: number): string {
  const parsed = SSF.parse_date_code(serial);
  if (!parsed || parsed.y < 1900 || parsed.y > 2100) {
    throw new ValidationError('Invalid Excel date serial.', { field: 'invoice_date', value: serial });
  }

  const month = String(parsed.m).padStart(2, '0');
  const day = String(parsed.d).padStart(2, '0');
  return `${parsed.y}-${month}-${day}`;
}

function dateToISO(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new ValidationError('Invalid Excel date value.', { field: 'invoice_date' });
  }
  return value.toISOString().slice(0, 10);
}

function normalizeNumber(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`Field "${field}" must be numeric.`, { field, value });
    }
    return Number(value.toFixed(6)).toString();
  }

  const text = String(value ?? '').trim();
  if (!text) return '';

  const normalized = text.replace(/,/g, '');
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Field "${field}" must be numeric.`, { field, value: text });
  }
  return Number(num.toFixed(6)).toString();
}

function normalizeValue(header: string, value: unknown): string {
  if (isEmptyCell(value)) return '';

  if (DATE_COLUMNS.has(header)) {
    if (value instanceof Date) return dateToISO(value);
    if (typeof value === 'number') return excelSerialDateToISO(value);
    return String(value).trim();
  }

  if (NUMERIC_COLUMNS.has(header)) {
    return normalizeNumber(value, header);
  }

  return String(value).trim();
}

export function parseXlsx(buffer: ArrayBuffer): ParsedXlsx {
  const workbook = read(buffer, {
    type: 'array',
    cellDates: true,
    raw: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ValidationError('XLSX workbook does not contain any sheets.');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  }) as unknown[][];

  const nonEmptyRows = matrix.filter((row): row is unknown[] => Array.isArray(row) && !isEmptyRow(row));
  if (nonEmptyRows.length < 2) {
    throw new ValidationError('XLSX must include a header row and at least one data row.');
  }

  const headers = nonEmptyRows[0].map((cell) => normalizeHeader(String(cell ?? '')));
  if (headers.some((h) => !h)) {
    throw new ValidationError('XLSX contains an empty header name.');
  }

  const duplicate = headers.find((h, idx) => headers.indexOf(h) !== idx);
  if (duplicate) {
    throw new ValidationError(`XLSX contains duplicate header "${duplicate}".`);
  }

  const rows = nonEmptyRows.slice(1).map((row, idx) => {
    if (row.length > headers.length) {
      throw new ValidationError(`XLSX row ${idx + 2} has more values than headers.`);
    }

    const parsedRow: Record<string, string> = {};
    headers.forEach((header, colIdx) => {
      parsedRow[header] = normalizeValue(header, row[colIdx]);
    });
    return parsedRow;
  });

  return { headers, rows };
}

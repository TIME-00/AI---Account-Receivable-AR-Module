// ============================================================================
// Sprint F4 Phase A - CSV parsing helpers
// ============================================================================

import { ValidationError } from '../_shared/errors.ts';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (inQuotes) {
    throw new ValidationError('CSV contains an unterminated quoted value.');
  }

  values.push(current.trim());
  return values;
}

export function parseCsv(text: string): ParsedCsv {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new ValidationError('CSV must include a header row and at least one data row.');
  }

  const headers = parseLine(lines[0]).map(normalizeHeader);
  if (headers.some((h) => !h)) {
    throw new ValidationError('CSV contains an empty header name.');
  }

  const duplicate = headers.find((h, idx) => headers.indexOf(h) !== idx);
  if (duplicate) {
    throw new ValidationError(`CSV contains duplicate header "${duplicate}".`);
  }

  const rows = lines.slice(1).map((line, idx) => {
    const values = parseLine(line);
    if (values.length > headers.length) {
      throw new ValidationError(`CSV row ${idx + 2} has more values than headers.`);
    }

    const row: Record<string, string> = {};
    headers.forEach((header, colIdx) => {
      row[header] = values[colIdx]?.trim() ?? '';
    });
    return row;
  });

  return { headers, rows };
}


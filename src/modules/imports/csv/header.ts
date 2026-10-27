import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { CsvValidationError } from './csv-error';

const MAX_COLUMNS = 200;
const MAX_HEADER_LENGTH = 200;

/**
 * Case, spacing and punctuation are ignored so "Order ID", "order_id" and
 * "Order-Id" all compare equal when suggesting a mapping.
 */
export function normalizeHeaderKey(value: string): string {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

/** Streams only the first line so a large upload never has to be fully parsed here. */
export async function readCsvHeader(buffer: Buffer): Promise<string[]> {
  const parser = Readable.from([buffer]).pipe(
    parse({
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );

  try {
    for await (const record of parser) {
      return (record as unknown[]).map((value) => String(value));
    }
  } catch {
    throw new CsvValidationError('The header row could not be parsed as CSV.');
  }

  return [];
}

export function normalizeDetectedHeaders(raw: readonly string[]): string[] {
  if (raw.length === 0) {
    throw new CsvValidationError('The file has no header row.');
  }
  if (raw.length > MAX_COLUMNS) {
    throw new CsvValidationError(`The file has more than ${MAX_COLUMNS} columns.`);
  }

  const seen = new Set<string>();
  const headers = raw.map((value) => value.replace(/^\uFEFF/, '').trim());

  for (const header of headers) {
    if (header.length === 0) {
      throw new CsvValidationError('Every column needs a header.');
    }
    if (header.length > MAX_HEADER_LENGTH) {
      throw new CsvValidationError('A column header is too long.');
    }

    const key = normalizeHeaderKey(header);
    if (!key) {
      throw new CsvValidationError('Every column needs a header.');
    }
    if (seen.has(key)) {
      throw new CsvValidationError('Duplicate column headers are not allowed.');
    }
    seen.add(key);
  }

  return headers;
}

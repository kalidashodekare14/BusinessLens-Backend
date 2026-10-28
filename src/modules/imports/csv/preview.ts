import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import type { ImportType } from '../../../generated/prisma/client';
import { CsvValidationError } from './csv-error';
import type { CanonicalMapping } from './mapping';
import { createRowMapper } from './row-mapper';
import { validateOrderRow, validateProductRow, type RowIssue } from './row-validator';

export const PREVIEW_ROW_LIMIT = 20;

export interface CsvPreviewRow {
  /** 1-based data row number; the header row is excluded. */
  rowNumber: number;
  values: Record<string, string | null>;
  valid: boolean;
  errors: RowIssue[];
}

export interface CsvPreview {
  rows: CsvPreviewRow[];
  truncated: boolean;
}

function headersMatch(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

/**
 * Reads the beginning of the stored upload and validates each row with the
 * supplied mapping. The file is re-checked against the headers recorded at
 * upload so a changed temp file cannot silently produce a wrong preview.
 */
export async function readCsvPreview(
  storagePath: string,
  detectedHeaders: readonly string[],
  type: ImportType,
  mapping: CanonicalMapping,
): Promise<CsvPreview> {
  const source = createReadStream(storagePath);
  const parser = source.pipe(
    parse({
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );
  source.on('error', (error) => parser.destroy(error));

  const mapRow = createRowMapper(type, detectedHeaders, mapping);

  const rows: CsvPreviewRow[] = [];
  let headerSeen = false;
  let truncated = false;

  try {
    for await (const record of parser) {
      const cells = (record as unknown[]).map((value) => String(value ?? ''));

      if (!headerSeen) {
        if (!headersMatch(cells, detectedHeaders)) {
          throw new CsvValidationError('The uploaded file changed after upload.');
        }
        headerSeen = true;
        continue;
      }

      if (rows.length >= PREVIEW_ROW_LIMIT) {
        truncated = true;
        break;
      }

      const values = mapRow(cells);
      const result = type === 'ORDERS' ? validateOrderRow(values) : validateProductRow(values);
      rows.push({
        rowNumber: rows.length + 1,
        values,
        valid: result.valid,
        errors: result.valid ? [] : result.errors,
      });
    }
  } finally {
    source.destroy();
    parser.destroy();
  }

  return { rows, truncated };
}

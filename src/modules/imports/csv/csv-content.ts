import { CsvValidationError } from './csv-error';

export const MAX_CSV_BYTES = 5 * 1024 * 1024;

// Tab, newline and carriage return are the only control characters CSV text needs.
function hasDisallowedControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const allowed = code === 9 || code === 10 || code === 13;
    if (!allowed && (code < 32 || code === 127)) {
      return true;
    }
  }
  return false;
}

/**
 * Sniffs an upload before it is written to disk. The extension check alone is not
 * enough: a binary file renamed to .csv must be rejected (PROJECT_ARCHITECTURE.md A15).
 */
export function assertCsvContent(buffer: Buffer): void {
  if (buffer.length === 0) {
    throw new CsvValidationError('The file is empty.');
  }
  if (buffer.length > MAX_CSV_BYTES) {
    throw new CsvValidationError('The file is larger than 5 MB.');
  }
  if (buffer.includes(0)) {
    throw new CsvValidationError('The file does not look like text CSV.');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new CsvValidationError('The file must be UTF-8 encoded CSV text.');
  }

  if (hasDisallowedControlCharacters(text)) {
    throw new CsvValidationError('The file does not look like text CSV.');
  }
  if (text.trim().length === 0) {
    throw new CsvValidationError('The file is empty.');
  }
}

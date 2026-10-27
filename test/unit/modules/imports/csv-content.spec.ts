import { assertCsvContent, MAX_CSV_BYTES } from '../../../../src/modules/imports/csv/csv-content';
import { CsvValidationError } from '../../../../src/modules/imports/csv/csv-error';

describe('assertCsvContent', () => {
  it('accepts plain UTF-8 CSV text', () => {
    expect(() => assertCsvContent(Buffer.from('orderId,quantity\n1,2'))).not.toThrow();
  });

  it('accepts a UTF-8 BOM', () => {
    expect(() => assertCsvContent(Buffer.from('\uFEFForderId,quantity\n1,2'))).not.toThrow();
  });

  it('accepts tabs, newlines and non-ASCII text', () => {
    expect(() => assertCsvContent(Buffer.from('name\tprice\r\nCafé,9.99\n'))).not.toThrow();
  });

  it('rejects an empty file', () => {
    expect(() => assertCsvContent(Buffer.alloc(0))).toThrow(CsvValidationError);
  });

  it('rejects whitespace-only content', () => {
    expect(() => assertCsvContent(Buffer.from(' \r\n\t'))).toThrow('The file is empty.');
  });

  it('rejects NUL bytes even when the rest is text', () => {
    expect(() => assertCsvContent(Buffer.from('a\0b'))).toThrow(
      'The file does not look like text CSV.',
    );
  });

  it('rejects invalid UTF-8', () => {
    expect(() => assertCsvContent(Buffer.from([0xc3, 0x28]))).toThrow(
      'The file must be UTF-8 encoded CSV text.',
    );
  });

  it('rejects binary control characters', () => {
    expect(() => assertCsvContent(Buffer.from('a\u0001b'))).toThrow(
      'The file does not look like text CSV.',
    );
  });

  it('rejects files above the 5 MB limit', () => {
    expect(() => assertCsvContent(Buffer.alloc(MAX_CSV_BYTES + 1, 0x61))).toThrow(
      'The file is larger than 5 MB.',
    );
  });
});

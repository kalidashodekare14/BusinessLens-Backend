import { CsvValidationError } from '../../../../src/modules/imports/csv/csv-error';
import {
  normalizeDetectedHeaders,
  normalizeHeaderKey,
  readCsvHeader,
} from '../../../../src/modules/imports/csv/header';

describe('readCsvHeader', () => {
  it('reads the first row only', async () => {
    await expect(readCsvHeader(Buffer.from('orderId,qty\n1,2\n3,4\n'))).resolves.toEqual([
      'orderId',
      'qty',
    ]);
  });

  it('handles CRLF, BOM and quoted headers', async () => {
    await expect(
      readCsvHeader(Buffer.from('\uFEFF"Order ID","Unit Price"\r\n1,9.99\r\n')),
    ).resolves.toEqual(['Order ID', 'Unit Price']);
  });

  it('skips leading blank lines', async () => {
    await expect(readCsvHeader(Buffer.from('\n\nname,price\nA,1\n'))).resolves.toEqual([
      'name',
      'price',
    ]);
  });

  it('returns an empty list for a blank file', async () => {
    await expect(readCsvHeader(Buffer.from('\n\n'))).resolves.toEqual([]);
  });

  it('rejects malformed CSV', async () => {
    await expect(readCsvHeader(Buffer.from('"unterminated,header\n'))).rejects.toBeInstanceOf(
      CsvValidationError,
    );
  });
});

describe('normalizeHeaderKey', () => {
  it.each([
    ['Order ID', 'order id'],
    ['order_id', 'order id'],
    ['  ORDER-ID  ', 'order id'],
    ['Unit Price ($)', 'unit price'],
    ['Café', 'café'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeHeaderKey(input)).toBe(expected);
  });
});

describe('normalizeDetectedHeaders', () => {
  it('trims headers and strips a leading BOM', () => {
    expect(normalizeDetectedHeaders(['\uFEFF name ', ' price'])).toEqual(['name', 'price']);
  });

  it('rejects a file without a header row', () => {
    expect(() => normalizeDetectedHeaders([])).toThrow('The file has no header row.');
  });

  it('rejects empty headers', () => {
    expect(() => normalizeDetectedHeaders(['name', '  '])).toThrow('Every column needs a header.');
  });

  it('rejects headers that normalize to the same key', () => {
    expect(() => normalizeDetectedHeaders(['Order ID', 'order_id'])).toThrow(
      'Duplicate column headers are not allowed.',
    );
  });

  it('rejects too many columns', () => {
    const headers = Array.from({ length: 201 }, (_, index) => `column${index}`);
    expect(() => normalizeDetectedHeaders(headers)).toThrow('more than 200 columns');
  });

  it('rejects an overlong header', () => {
    expect(() => normalizeDetectedHeaders(['x'.repeat(201)])).toThrow(
      'A column header is too long.',
    );
  });
});

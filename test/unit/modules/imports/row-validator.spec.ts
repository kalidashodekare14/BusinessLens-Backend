import {
  validateImportRow,
  validateOrderRow,
  validateProductRow,
  type RawRow,
  type RowIssue,
  type RowValidationResult,
} from '../../../../src/modules/imports/csv/row-validator';

function valueOf<T>(result: RowValidationResult<T>): T {
  if (!result.valid) {
    throw new Error(`Expected a valid row, got ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function errorsOf<T>(result: RowValidationResult<T>): RowIssue[] {
  if (result.valid) {
    throw new Error('Expected an invalid row');
  }
  return result.errors;
}

const VALID_ORDER: RawRow = {
  orderId: 'A-1001',
  orderedAt: '2026-01-01T10:00:00Z',
  status: 'completed',
  productName: 'Widget',
  sku: 'SKU-1',
  quantity: '2',
  unitPrice: '19.99',
};

describe('validateOrderRow', () => {
  it('returns typed values, an exact Decimal and a UTC date', () => {
    const value = valueOf(validateOrderRow(VALID_ORDER));

    expect(value).toMatchObject({
      orderId: 'A-1001',
      status: 'completed',
      productName: 'Widget',
      sku: 'SKU-1',
      quantity: 2,
    });
    expect(value.orderedAt.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(value.unitPrice.toFixed(2)).toBe('19.99');
  });

  it('defaults status to completed and sku to null', () => {
    const value = valueOf(
      validateOrderRow({
        orderId: 'A-1',
        orderedAt: '2026-01-01',
        productName: 'Widget',
        quantity: '1',
        unitPrice: '0',
      }),
    );

    expect(value.status).toBe('completed');
    expect(value.sku).toBeNull();
  });

  it('trims text and preserves the status casing', () => {
    const value = valueOf(
      validateOrderRow({
        ...VALID_ORDER,
        orderId: '  A-1001  ',
        productName: '  Café Widget  ',
        sku: '  SKU-9  ',
        status: '  Cancelled  ',
      }),
    );

    expect(value.orderId).toBe('A-1001');
    expect(value.productName).toBe('Café Widget');
    expect(value.sku).toBe('SKU-9');
    expect(value.status).toBe('Cancelled');
  });

  it('reports every missing required field in one pass', () => {
    const errors = errorsOf(validateOrderRow({}));

    expect(errors.map((error) => error.field)).toEqual([
      'orderId',
      'orderedAt',
      'productName',
      'quantity',
      'unitPrice',
    ]);
    expect(errors.every((error) => error.reason === 'is required')).toBe(true);
  });

  it('rejects invalid date, quantity and money values', () => {
    const errors = errorsOf(
      validateOrderRow({
        ...VALID_ORDER,
        orderedAt: '2026-02-30',
        quantity: '0',
        unitPrice: '-1',
      }),
    );

    expect(errors).toEqual([
      { field: 'orderedAt', reason: 'must be a date or datetime (YYYY-MM-DD or ISO 8601)' },
      { field: 'quantity', reason: 'must be a positive integer' },
      {
        field: 'unitPrice',
        reason: 'must be a non-negative amount with at most 2 decimal places',
      },
    ]);
  });

  it('collects text errors without throwing', () => {
    const errors = errorsOf(
      validateOrderRow({
        ...VALID_ORDER,
        orderId: 'x'.repeat(129),
        productName: 'bad\u0001name',
        sku: 's'.repeat(101),
        status: 's'.repeat(33),
      }),
    );

    expect(errors.map((error) => error.field)).toEqual(['orderId', 'status', 'productName', 'sku']);
  });

  it.each([
    ['1', true],
    ['2147483647', true],
    ['0', false],
    ['2147483648', false],
  ])('validates the quantity boundary %s', (quantity, expectedValid) => {
    const result = validateOrderRow({ ...VALID_ORDER, quantity });
    expect(result.valid).toBe(expectedValid);
  });

  it.each([
    ['0', true],
    ['9999999999.99', true],
    ['10000000000.00', false],
    ['1.234', false],
  ])('validates the money boundary %s', (unitPrice, expectedValid) => {
    const result = validateOrderRow({ ...VALID_ORDER, unitPrice });
    expect(result.valid).toBe(expectedValid);
  });

  it.each([
    ['2024-02-29', true],
    ['2026-02-29', false],
  ])('validates the date boundary %s', (orderedAt, expectedValid) => {
    const result = validateOrderRow({ ...VALID_ORDER, orderedAt });
    expect(result.valid).toBe(expectedValid);
  });

  it.each([
    ['orderId', 128, true],
    ['orderId', 129, false],
    ['productName', 200, true],
    ['productName', 201, false],
    ['sku', 100, true],
    ['sku', 101, false],
    ['status', 32, true],
    ['status', 33, false],
  ] as const)('validates %s at %s characters', (field, length, expectedValid) => {
    const result = validateOrderRow({ ...VALID_ORDER, [field]: 's'.repeat(length) });
    expect(result.valid).toBe(expectedValid);
  });
});

describe('validateProductRow', () => {
  it('returns name, sku and an exact price', () => {
    const value = valueOf(validateProductRow({ name: '  Widget ', sku: 'SKU-1', price: '9.99' }));

    expect(value.name).toBe('Widget');
    expect(value.sku).toBe('SKU-1');
    expect(value.price?.toFixed(2)).toBe('9.99');
  });

  it('allows optional sku and price to be absent', () => {
    const value = valueOf(validateProductRow({ name: 'Widget' }));

    expect(value.sku).toBeNull();
    expect(value.price).toBeNull();
  });

  it('requires a name and rejects an invalid price', () => {
    const missing = errorsOf(validateProductRow({}));
    expect(missing).toEqual([{ field: 'name', reason: 'is required' }]);

    const negative = errorsOf(validateProductRow({ name: 'Widget', price: '-0.01' }));
    expect(negative).toEqual([
      {
        field: 'price',
        reason: 'must be a non-negative amount with at most 2 decimal places',
      },
    ]);
  });

  it('validates the sku length boundary', () => {
    expect(validateProductRow({ name: 'Widget', sku: 's'.repeat(100) }).valid).toBe(true);
    expect(validateProductRow({ name: 'Widget', sku: 's'.repeat(101) }).valid).toBe(false);
  });
});

describe('validateImportRow', () => {
  it('dispatches by import type', () => {
    const order = valueOf(validateImportRow('ORDERS', VALID_ORDER));
    const product = valueOf(validateImportRow('PRODUCTS', { name: 'Widget' }));

    expect('orderId' in order && order.orderId).toBe('A-1001');
    expect('name' in product && product.name).toBe('Widget');
  });
});

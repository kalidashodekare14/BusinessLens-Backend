import { validateMapping } from '../../../../src/modules/imports/csv/mapping';

const ORDER_HEADERS = ['Order ID', 'Order Date', 'Status', 'Product', 'SKU', 'Qty', 'Unit Price'];

const VALID_ORDER_MAPPING = {
  orderId: 'Order ID',
  orderedAt: 'Order Date',
  status: 'Status',
  productName: 'Product',
  sku: 'SKU',
  quantity: 'Qty',
  unitPrice: 'Unit Price',
};

function issuesOf(result: ReturnType<typeof validateMapping>) {
  if (result.valid) {
    throw new Error('Expected an invalid mapping');
  }
  return result.issues;
}

describe('validateMapping', () => {
  it('accepts a complete ORDERS mapping', () => {
    expect(validateMapping('ORDERS', ORDER_HEADERS, VALID_ORDER_MAPPING)).toEqual({
      valid: true,
      mapping: VALID_ORDER_MAPPING,
    });
  });

  it('treats omitted or empty optional fields as unmapped', () => {
    const result = validateMapping('ORDERS', ORDER_HEADERS, {
      ...VALID_ORDER_MAPPING,
      status: null,
      sku: '',
    });

    expect(result).toEqual({
      valid: true,
      mapping: { ...VALID_ORDER_MAPPING, status: null, sku: null },
    });
  });

  it('reports every missing required field in canonical order', () => {
    const issues = issuesOf(validateMapping('ORDERS', ORDER_HEADERS, {}));

    expect(issues).toEqual([
      { field: 'mapping.orderId', message: 'is required' },
      { field: 'mapping.orderedAt', message: 'is required' },
      { field: 'mapping.productName', message: 'is required' },
      { field: 'mapping.quantity', message: 'is required' },
      { field: 'mapping.unitPrice', message: 'is required' },
    ]);
  });

  it('rejects canonical fields that do not belong to the import type', () => {
    const issues = issuesOf(
      validateMapping('PRODUCTS', ['Name'], { name: 'Name', quantity: 'Name' }),
    );

    expect(issues).toEqual([
      {
        field: 'mapping.quantity',
        message: 'is not a field for PRODUCTS imports',
      },
    ]);
  });

  it('rejects a header that was not detected at upload', () => {
    const issues = issuesOf(
      validateMapping('ORDERS', ORDER_HEADERS, {
        ...VALID_ORDER_MAPPING,
        orderId: 'Missing Header',
      }),
    );

    expect(issues).toEqual([
      {
        field: 'mapping.orderId',
        message: 'must be one of the detected headers',
      },
    ]);
  });

  it('rejects non-string mapping values', () => {
    const issues = issuesOf(
      validateMapping('ORDERS', ORDER_HEADERS, {
        ...VALID_ORDER_MAPPING,
        quantity: 7,
      }),
    );

    expect(issues).toEqual([
      {
        field: 'mapping.quantity',
        message: 'must be a column header or null',
      },
    ]);
  });

  it('rejects two fields mapped to the same column', () => {
    const issues = issuesOf(
      validateMapping('ORDERS', ORDER_HEADERS, {
        ...VALID_ORDER_MAPPING,
        sku: 'Product',
      }),
    );

    expect(issues).toEqual([
      {
        field: 'mapping.sku',
        message: 'is already mapped to productName',
      },
    ]);
  });

  it('accepts a PRODUCTS mapping with only the required name', () => {
    expect(validateMapping('PRODUCTS', ['Name', 'SKU', 'Price'], { name: 'Name' })).toEqual({
      valid: true,
      mapping: { name: 'Name', sku: null, price: null },
    });
  });
});

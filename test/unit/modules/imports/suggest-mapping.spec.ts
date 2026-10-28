import { suggestMapping } from '../../../../src/modules/imports/csv/suggest-mapping';

describe('suggestMapping', () => {
  it('maps common ORDER synonyms from §8', () => {
    expect(
      suggestMapping('ORDERS', [
        'Order ID',
        'Order Date',
        'Order Status',
        'Product',
        'SKU',
        'Qty',
        'Unit Price',
      ]),
    ).toEqual({
      orderId: 'Order ID',
      orderedAt: 'Order Date',
      status: 'Order Status',
      productName: 'Product',
      sku: 'SKU',
      quantity: 'Qty',
      unitPrice: 'Unit Price',
    });
  });

  it('matches canonical field names and ignores case and punctuation', () => {
    expect(
      suggestMapping('ORDERS', ['ORDER_ID', 'ordered-at', 'PRODUCT_NAME', 'quantity', 'price']),
    ).toEqual({
      orderId: 'ORDER_ID',
      orderedAt: 'ordered-at',
      status: null,
      productName: 'PRODUCT_NAME',
      sku: null,
      quantity: 'quantity',
      unitPrice: 'price',
    });
  });

  it('maps PRODUCT columns', () => {
    expect(suggestMapping('PRODUCTS', ['Title', 'Item SKU', 'List Price'])).toEqual({
      name: 'Title',
      sku: 'Item SKU',
      price: 'List Price',
    });
  });

  it('returns null for unknown headers and never reuses a header', () => {
    expect(suggestMapping('ORDERS', ['Product', 'Mystery'])).toEqual({
      orderId: null,
      orderedAt: null,
      status: null,
      productName: 'Product',
      sku: null,
      quantity: null,
      unitPrice: null,
    });
  });

  it('does not match a synonym inside a longer header', () => {
    expect(suggestMapping('PRODUCTS', ['Product Description'])).toEqual({
      name: null,
      sku: null,
      price: null,
    });
  });
});

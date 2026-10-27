import type { ImportType } from '../../../generated/prisma/client';

export type CanonicalFieldType = 'text' | 'date' | 'status' | 'positiveInteger' | 'money';

export interface CanonicalField {
  /** Matches the property names used by the import processors. */
  readonly key: string;
  readonly required: boolean;
  /** The value shape the row validator expects after mapping (§8). */
  readonly type: CanonicalFieldType;
  readonly synonyms: readonly string[];
}

export interface ImportSchema {
  readonly fields: readonly CanonicalField[];
}

const ORDER_FIELDS: readonly CanonicalField[] = [
  {
    key: 'orderId',
    required: true,
    type: 'text',
    synonyms: ['order id', 'orderid', 'order number', 'order no', 'id'],
  },
  {
    key: 'orderedAt',
    required: true,
    type: 'date',
    synonyms: ['ordered at', 'order date', 'date', 'created at', 'ordered on', 'timestamp'],
  },
  {
    key: 'status',
    required: false,
    type: 'status',
    synonyms: ['status', 'order status'],
  },
  {
    key: 'productName',
    required: true,
    type: 'text',
    synonyms: ['product name', 'product', 'item name', 'item', 'description'],
  },
  {
    key: 'sku',
    required: false,
    type: 'text',
    synonyms: ['sku', 'product sku', 'item sku'],
  },
  {
    key: 'quantity',
    required: true,
    type: 'positiveInteger',
    synonyms: ['quantity', 'qty', 'units', 'count'],
  },
  {
    key: 'unitPrice',
    required: true,
    type: 'money',
    synonyms: ['unit price', 'price', 'unit cost', 'item price'],
  },
] as const;

const PRODUCT_FIELDS: readonly CanonicalField[] = [
  {
    key: 'name',
    required: true,
    type: 'text',
    synonyms: ['name', 'product name', 'product', 'title'],
  },
  {
    key: 'sku',
    required: false,
    type: 'text',
    synonyms: ['sku', 'product sku', 'item sku'],
  },
  {
    key: 'price',
    required: false,
    type: 'money',
    synonyms: ['price', 'unit price', 'list price'],
  },
] as const;

const SCHEMAS: Record<ImportType, ImportSchema> = {
  ORDERS: { fields: ORDER_FIELDS },
  PRODUCTS: { fields: PRODUCT_FIELDS },
};

export function schemaFor(type: ImportType): ImportSchema {
  return SCHEMAS[type];
}

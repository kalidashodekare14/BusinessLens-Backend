import type { ImportType, Prisma } from '../../../generated/prisma/client';
import {
  containsControlCharacters,
  parseNonNegativeMoney,
  parseOrderedAt,
  parsePositiveInteger,
} from './value-parsers';

export interface RowIssue {
  field: string;
  reason: string;
}

/** A mapped row: canonical field keys in, raw CSV strings out. */
export type RawRow = Readonly<Record<string, string | null | undefined>>;

export interface ValidatedOrderRow {
  orderId: string;
  orderedAt: Date;
  status: string;
  productName: string;
  sku: string | null;
  quantity: number;
  unitPrice: Prisma.Decimal;
}

export interface ValidatedProductRow {
  name: string;
  sku: string | null;
  price: Prisma.Decimal | null;
}

export type ValidatedImportRow = ValidatedOrderRow | ValidatedProductRow;

export type RowValidationResult<T> =
  { valid: true; value: T; errors: [] } | { valid: false; value: null; errors: RowIssue[] };

const ORDER_ID_MAX_LENGTH = 128;
const PRODUCT_NAME_MAX_LENGTH = 200;
const SKU_MAX_LENGTH = 100;
const STATUS_MAX_LENGTH = 32;

function read(raw: RawRow, field: string): string {
  const value = raw[field];
  return typeof value === 'string' ? value.trim() : '';
}

function textValue(
  raw: RawRow,
  field: string,
  maxLength: number,
  required: boolean,
  errors: RowIssue[],
): string | null {
  const value = read(raw, field);

  if (value.length === 0) {
    if (required) {
      errors.push({ field, reason: 'is required' });
    }
    return null;
  }
  if (containsControlCharacters(value)) {
    errors.push({ field, reason: 'must not contain control characters' });
    return null;
  }
  if (value.length > maxLength) {
    errors.push({ field, reason: `must be at most ${maxLength} characters` });
    return null;
  }

  return value;
}

function dateValue(raw: RawRow, field: string, required: boolean, errors: RowIssue[]): Date | null {
  const value = read(raw, field);

  if (value.length === 0) {
    if (required) {
      errors.push({ field, reason: 'is required' });
    }
    return null;
  }

  const parsed = parseOrderedAt(value);
  if (!parsed) {
    errors.push({
      field,
      reason: 'must be a date or datetime (YYYY-MM-DD or ISO 8601)',
    });
    return null;
  }

  return parsed;
}

function integerValue(
  raw: RawRow,
  field: string,
  required: boolean,
  errors: RowIssue[],
): number | null {
  const value = read(raw, field);

  if (value.length === 0) {
    if (required) {
      errors.push({ field, reason: 'is required' });
    }
    return null;
  }

  const parsed = parsePositiveInteger(value);
  if (parsed === null) {
    errors.push({ field, reason: 'must be a positive integer' });
    return null;
  }

  return parsed;
}

function moneyValue(
  raw: RawRow,
  field: string,
  required: boolean,
  errors: RowIssue[],
): Prisma.Decimal | null {
  const value = read(raw, field);

  if (value.length === 0) {
    if (required) {
      errors.push({ field, reason: 'is required' });
    }
    return null;
  }

  const parsed = parseNonNegativeMoney(value);
  if (!parsed) {
    errors.push({
      field,
      reason: 'must be a non-negative amount with at most 2 decimal places',
    });
    return null;
  }

  return parsed;
}

function statusValue(raw: RawRow, errors: RowIssue[]): string {
  const value = read(raw, 'status');

  if (value.length === 0) {
    return 'completed';
  }
  if (containsControlCharacters(value)) {
    errors.push({ field: 'status', reason: 'must not contain control characters' });
    return value;
  }
  if (value.length > STATUS_MAX_LENGTH) {
    errors.push({
      field: 'status',
      reason: `must be at most ${STATUS_MAX_LENGTH} characters`,
    });
  }

  return value;
}

export function validateOrderRow(raw: RawRow): RowValidationResult<ValidatedOrderRow> {
  const errors: RowIssue[] = [];

  const orderId = textValue(raw, 'orderId', ORDER_ID_MAX_LENGTH, true, errors);
  const orderedAt = dateValue(raw, 'orderedAt', true, errors);
  const status = statusValue(raw, errors);
  const productName = textValue(raw, 'productName', PRODUCT_NAME_MAX_LENGTH, true, errors);
  const sku = textValue(raw, 'sku', SKU_MAX_LENGTH, false, errors);
  const quantity = integerValue(raw, 'quantity', true, errors);
  const unitPrice = moneyValue(raw, 'unitPrice', true, errors);

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: {
      orderId: orderId as string,
      orderedAt: orderedAt as Date,
      status,
      productName: productName as string,
      sku,
      quantity: quantity as number,
      unitPrice: unitPrice as Prisma.Decimal,
    },
    errors: [],
  };
}

export function validateProductRow(raw: RawRow): RowValidationResult<ValidatedProductRow> {
  const errors: RowIssue[] = [];

  const name = textValue(raw, 'name', PRODUCT_NAME_MAX_LENGTH, true, errors);
  const sku = textValue(raw, 'sku', SKU_MAX_LENGTH, false, errors);
  const price = moneyValue(raw, 'price', false, errors);

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  return {
    valid: true,
    value: {
      name: name as string,
      sku,
      price,
    },
    errors: [],
  };
}

export function validateImportRow(
  type: 'ORDERS',
  raw: RawRow,
): RowValidationResult<ValidatedOrderRow>;
export function validateImportRow(
  type: 'PRODUCTS',
  raw: RawRow,
): RowValidationResult<ValidatedProductRow>;
export function validateImportRow(
  type: ImportType,
  raw: RawRow,
): RowValidationResult<ValidatedImportRow> {
  return type === 'ORDERS' ? validateOrderRow(raw) : validateProductRow(raw);
}

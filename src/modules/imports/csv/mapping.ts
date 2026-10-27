import type { ImportType } from '../../../generated/prisma/client';
import { schemaFor } from './canonical-fields';

export type CanonicalMapping = Record<string, string | null>;

export interface MappingIssue {
  field: string;
  message: string;
}

export type MappingValidationResult =
  { valid: true; mapping: CanonicalMapping } | { valid: false; issues: MappingIssue[] };

/**
 * Validates a client-supplied mapping against the imported type and the headers
 * actually detected at upload. Required fields must be mapped, every target must
 * be a real header, and two fields may not share one column.
 */
export function validateMapping(
  type: ImportType,
  detectedHeaders: readonly string[],
  input: Record<string, unknown>,
): MappingValidationResult {
  const schema = schemaFor(type);
  const canonicalKeys = new Set(schema.fields.map((field) => field.key));
  const headerSet = new Set(detectedHeaders);
  const usedHeaders = new Map<string, string>();
  const issues: MappingIssue[] = [];
  const mapping: CanonicalMapping = {};

  for (const key of Object.keys(input)) {
    if (!canonicalKeys.has(key)) {
      issues.push({
        field: `mapping.${key}`,
        message: `is not a field for ${type} imports`,
      });
    }
  }

  for (const field of schema.fields) {
    const value = input[field.key];

    if (value === undefined || value === null || value === '') {
      mapping[field.key] = null;
      if (field.required) {
        issues.push({ field: `mapping.${field.key}`, message: 'is required' });
      }
      continue;
    }

    if (typeof value !== 'string') {
      mapping[field.key] = null;
      issues.push({
        field: `mapping.${field.key}`,
        message: 'must be a column header or null',
      });
      continue;
    }

    if (!headerSet.has(value)) {
      mapping[field.key] = null;
      issues.push({
        field: `mapping.${field.key}`,
        message: 'must be one of the detected headers',
      });
      continue;
    }

    const alreadyMappedTo = usedHeaders.get(value);
    if (alreadyMappedTo) {
      issues.push({
        field: `mapping.${field.key}`,
        message: `is already mapped to ${alreadyMappedTo}`,
      });
    } else {
      usedHeaders.set(value, field.key);
    }

    mapping[field.key] = value;
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, mapping };
}

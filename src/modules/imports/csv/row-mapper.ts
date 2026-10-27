import type { ImportType } from '../../../generated/prisma/client';
import { schemaFor } from './canonical-fields';
import type { CanonicalMapping } from './mapping';

export type RowMapper = (cells: readonly string[]) => Record<string, string | null>;

/**
 * Builds the canonical-field -> cell lookup once per file. Unmapped fields are
 * returned as null so the validators apply their normal required/optional rules.
 */
export function createRowMapper(
  type: ImportType,
  detectedHeaders: readonly string[],
  mapping: CanonicalMapping,
): RowMapper {
  const fields = schemaFor(type).fields;
  const headerIndexes = new Map<string, number>();
  detectedHeaders.forEach((header, index) => headerIndexes.set(header, index));

  return (cells) => {
    const values: Record<string, string | null> = {};

    for (const field of fields) {
      const header = mapping[field.key];
      if (!header) {
        values[field.key] = null;
        continue;
      }

      const index = headerIndexes.get(header);
      const cell = index === undefined ? undefined : cells[index];
      values[field.key] = typeof cell === 'string' ? cell : null;
    }

    return values;
  };
}

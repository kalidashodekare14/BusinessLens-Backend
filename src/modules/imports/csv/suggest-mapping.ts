import type { ImportType } from '../../../generated/prisma/client';
import { schemaFor } from './canonical-fields';
import { normalizeHeaderKey } from './header';

/** Canonical field -> detected header, or null when no header looked like it. */
export type SuggestedMapping = Record<string, string | null>;

/**
 * Suggests a mapping from the §8 synonym table. Suggestions are never trusted:
 * T3.4 validates the mapping the client saves before any row is processed.
 */
export function suggestMapping(type: ImportType, headers: readonly string[]): SuggestedMapping {
  const mapping: SuggestedMapping = {};
  const usedHeaders = new Set<string>();

  for (const field of schemaFor(type).fields) {
    const candidates = new Set(
      [field.key, ...field.synonyms].map((value) => normalizeHeaderKey(value)),
    );
    const match = headers.find(
      (header) => !usedHeaders.has(header) && candidates.has(normalizeHeaderKey(header)),
    );

    mapping[field.key] = match ?? null;
    if (match) {
      usedHeaders.add(match);
    }
  }

  return mapping;
}

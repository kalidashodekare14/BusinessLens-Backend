import type { ExplanationContent } from './explanation.schema';

/**
 * Number validator (TASKS.md T5.5, §10).
 *
 * Every number in the generated text must be supported by a value the backend
 * itself produced: the finding's evidence, plus the finding title (which we
 * generate from the same evidence and hand to the model anyway). A number with
 * no support means the model invented it, and the whole explanation is rejected.
 *
 * Matching is done at the precision the model wrote: a token claiming two
 * decimals must be within half a unit at two decimals of an allowed value, so
 * "2,000" may round 1999.99 but "2,000.00" may not.
 */
export interface NumberIssue {
  /** JSON path of the offending field, e.g. observedFacts[0]. */
  readonly field: string;
  /** The unsupported token as the model wrote it. */
  readonly token: string;
}

export interface NumberValidationResult {
  readonly valid: boolean;
  readonly issues: NumberIssue[];
}

const NUMERIC_STRING = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?)?$/;

/**
 * A number token: not glued to letters or other digits (so "vitamin12" and
 * "SKU-2x" are words, not claims), optionally followed by % or "percent".
 */
const NUMBER_TOKEN =
  /(?<![\p{L}\p{N}_])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|percent\b))?(?![\p{L}])/giu;

interface AllowedNumbers {
  /** Signed values from evidence and title. */
  readonly values: number[];
  /** Values stored under keys containing "percent" (changePercent, ...). */
  readonly percentValues: number[];
  /** ISO date strings (and their date part) to mask before extracting numbers. */
  readonly dateTokens: string[];
}

function pushValue(bucket: AllowedNumbers, value: number, key: string | null): void {
  if (!Number.isFinite(value)) {
    return;
  }
  bucket.values.push(value);
  if (key !== null && /percent/i.test(key)) {
    bucket.percentValues.push(value);
  }
}

function walk(node: unknown, key: string | null, out: AllowedNumbers): void {
  if (typeof node === 'number') {
    pushValue(out, node, key);
    return;
  }
  if (typeof node === 'string') {
    if (ISO_DATE.test(node)) {
      out.dateTokens.push(node);
      out.dateTokens.push(node.slice(0, 10));
      // The year alone is a legitimate reference to an evidence date.
      out.values.push(Number(node.slice(0, 4)));
      return;
    }
    if (NUMERIC_STRING.test(node)) {
      pushValue(out, Number(node.replace(/,/g, '')), key);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, key, out);
    }
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [childKey, childValue] of Object.entries(node)) {
      walk(childValue, childKey, out);
    }
  }
}

export function collectAllowedNumbers(evidence: unknown, title: string): AllowedNumbers {
  const out: AllowedNumbers = { values: [], percentValues: [], dateTokens: [] };
  walk(evidence, null, out);
  // The title is prose, so numbers inside it are tokenized the same way as in
  // generated text: we wrote the title from this evidence and showed it to the
  // model, so a number it repeats from there is not invented.
  for (const match of title.matchAll(NUMBER_TOKEN)) {
    const token = parseToken(match[0]);
    if (token) {
      out.values.push(token.value);
    }
  }
  return out;
}

interface ParsedToken {
  readonly raw: string;
  readonly value: number;
  /** Decimal places the model claimed, which sets the rounding tolerance. */
  readonly decimals: number;
  readonly isPercent: boolean;
}

function parseToken(raw: string): ParsedToken | null {
  const isPercent = /(?:%|percent\b)/i.test(raw);
  const numberPart = raw.match(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/);
  if (!numberPart) {
    return null;
  }
  const value = Number(numberPart[0].replace(/,/g, ''));
  if (!Number.isFinite(value)) {
    return null;
  }
  const dot = numberPart[0].indexOf('.');
  const decimals = dot === -1 ? 0 : numberPart[0].length - dot - 1;
  return { raw, value, decimals, isPercent };
}

function tolerance(decimals: number): number {
  return 0.5 * 10 ** -decimals + 1e-9;
}

function tokenMatches(token: ParsedToken, allowed: AllowedNumbers): boolean {
  const tol = tolerance(token.decimals);
  const near = (candidate: number): boolean => Math.abs(token.value - candidate) <= tol;

  // Exact match, sign included: a drop is not a rise.
  if (allowed.values.some(near)) {
    return true;
  }

  if (token.isPercent) {
    // "20% drop" and "-20%" describe the same change, so percents match by magnitude.
    const magnitude = Math.abs(token.value);
    if (allowed.values.some((candidate) => Math.abs(Math.abs(candidate) - magnitude) <= tol)) {
      return true;
    }
  }

  if (Math.abs(token.value) <= 1) {
    // Ratio forms: "0.2" for a -20% change, "0.8" for revenue at 80% of before.
    const scaledTol = tolerance(token.decimals + 2);
    if (
      allowed.percentValues.some(
        (candidate) => Math.abs(token.value * 100 - Math.abs(candidate)) <= scaledTol,
      )
    ) {
      return true;
    }
    if (
      allowed.percentValues.some(
        (candidate) => Math.abs(token.value - (1 + candidate / 100)) <= tol,
      )
    ) {
      return true;
    }
  }

  return false;
}

function extractTokens(text: string, allowed: AllowedNumbers): ParsedToken[] {
  let masked = text;
  for (const dateToken of allowed.dateTokens) {
    masked = masked.split(dateToken).join(' <date> ');
  }

  const tokens: ParsedToken[] = [];
  for (const match of masked.matchAll(NUMBER_TOKEN)) {
    const token = parseToken(match[0]);
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** Every text field of the content, with the JSON path used in reports. */
function textFields(content: ExplanationContent): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['summary', content.summary],
    ['uncertainty', content.uncertainty],
  ];
  for (const key of [
    'observedFacts',
    'associatedSignals',
    'possibleExplanations',
    'investigationSteps',
  ] as const) {
    content[key].forEach((item, index) => fields.push([`${key}[${index}]`, item]));
  }
  return fields;
}

/**
 * Validates every number in every generated field against the allowed values.
 * Returns the list of unsupported tokens; empty means the text is safe to store.
 */
export function validateExplanationNumbers(
  content: ExplanationContent,
  evidence: unknown,
  title: string,
): NumberValidationResult {
  const allowed = collectAllowedNumbers(evidence, title);
  const issues: NumberIssue[] = [];

  for (const [field, text] of textFields(content)) {
    for (const token of extractTokens(text, allowed)) {
      if (!tokenMatches(token, allowed)) {
        issues.push({ field, token: token.raw });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

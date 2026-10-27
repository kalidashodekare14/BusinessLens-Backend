import type { FindingType, Severity } from '../../../generated/prisma/client';
import type { OrganizationMetrics } from '../../metrics/metrics.types';

/**
 * One period edge in evidence. `value` is a money string for monetary metrics and
 * a number for counts (§9.4: money values are strings). Dates are ISO 8601 UTC and
 * `end` is the inclusive last day of the period.
 */
export type EvidenceValue = {
  value: string | number;
  start: string;
  end: string;
};

export type MetricComparison = {
  current: string | number;
  previous: string | number;
  /** Display value, one decimal; null when the previous value is zero. */
  changePercent: number | null;
};

export type FindingEvidence = {
  metric: string;
  current: EvidenceValue;
  previous: EvidenceValue;
  changePercent: number;
  thresholds: Record<string, number>;
  relatedMetrics: Record<string, MetricComparison>;
  /** Present only for product-scoped findings. */
  product?: { id: string | null; name: string };
};

export type FindingDraft = {
  type: FindingType;
  severity: Severity;
  title: string;
  subjectKey: string | null;
  evidence: FindingEvidence;
  ruleVersion: string;
};

/**
 * A rule is pure: it receives the deterministic metrics for both periods and
 * returns zero or more findings. It never touches the database or the clock, so
 * every threshold and guard is unit-testable.
 */
export interface Rule {
  readonly id: FindingType;
  readonly version: string;
  evaluate(metrics: OrganizationMetrics): FindingDraft[];
}

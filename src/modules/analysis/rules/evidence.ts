import { Prisma } from '../../../generated/prisma/client';
import { displayPercent, percentChange } from '../../metrics/change';
import type { PeriodMetrics } from '../../metrics/metrics.types';
import type { EvidenceValue, MetricComparison } from './rule.interface';

export function moneyValue(value: Prisma.Decimal, period: PeriodMetrics): EvidenceValue {
  return {
    value: value.toFixed(2),
    start: period.start.toISOString(),
    end: period.end.toISOString(),
  };
}

export function countValue(value: number, period: PeriodMetrics): EvidenceValue {
  return {
    value,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
  };
}

/** Money comparison for `relatedMetrics`; both sides stay strings. */
export function moneyComparison(
  current: Prisma.Decimal,
  previous: Prisma.Decimal,
): MetricComparison {
  const change = percentChange(current, previous);
  return {
    current: current.toFixed(2),
    previous: previous.toFixed(2),
    changePercent: change === null ? null : displayPercent(change),
  };
}

/** Count comparison for `relatedMetrics`; both sides stay numbers. */
export function countComparison(current: number, previous: number): MetricComparison {
  const change = percentChange(new Prisma.Decimal(current), new Prisma.Decimal(previous));
  return {
    current,
    previous,
    changePercent: change === null ? null : displayPercent(change),
  };
}

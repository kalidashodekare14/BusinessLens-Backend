import { FindingStatus } from '../../../../src/generated/prisma/client';
import { canTransition, resolvedAtFor } from '../../../../src/modules/findings/finding-status';

const ALL_STATUSES: FindingStatus[] = ['OPEN', 'INVESTIGATING', 'RESOLVED'];

describe('finding status transitions (§11)', () => {
  it('allows exactly the workflow steps and the reopen', () => {
    const allowed: Array<[FindingStatus, FindingStatus]> = [
      ['OPEN', 'INVESTIGATING'],
      ['INVESTIGATING', 'RESOLVED'],
      ['RESOLVED', 'OPEN'],
    ];

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(allowed.some(([a, b]) => a === from && b === to));
      }
    }
  });

  it('rejects skipping steps, reversing steps and no-op transitions', () => {
    expect(canTransition('OPEN', 'RESOLVED')).toBe(false);
    expect(canTransition('INVESTIGATING', 'OPEN')).toBe(false);
    expect(canTransition('RESOLVED', 'INVESTIGATING')).toBe(false);
    expect(canTransition('OPEN', 'OPEN')).toBe(false);
    expect(canTransition('INVESTIGATING', 'INVESTIGATING')).toBe(false);
    expect(canTransition('RESOLVED', 'RESOLVED')).toBe(false);
  });

  it('sets resolvedAt only for RESOLVED and clears it otherwise', () => {
    const now = new Date('2026-10-27T00:00:00.000Z');
    expect(resolvedAtFor('RESOLVED', now)).toBe(now);
    expect(resolvedAtFor('OPEN', now)).toBeNull();
    expect(resolvedAtFor('INVESTIGATING', now)).toBeNull();
  });
});

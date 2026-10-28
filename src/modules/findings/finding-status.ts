import type { FindingStatus } from '../../generated/prisma/client';

/**
 * Allowed transitions of the investigation workflow (TASKS.md T5.1, §11):
 * OPEN -> INVESTIGATING -> RESOLVED, plus RESOLVED -> OPEN (reopen).
 * Every other jump — including a no-op to the current status — is rejected
 * with 409, so status changes are always an explicit step in the workflow.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<FindingStatus, readonly FindingStatus[]>> = {
  OPEN: ['INVESTIGATING'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED: ['OPEN'],
};

export function canTransition(from: FindingStatus, to: FindingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** `resolvedAt` is set when a finding is resolved and cleared on reopen. */
export function resolvedAtFor(target: FindingStatus, now: Date): Date | null {
  return target === 'RESOLVED' ? now : null;
}

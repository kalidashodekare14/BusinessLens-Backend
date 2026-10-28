import { AuditAction } from '../../../src/modules/audit/audit.actions';

/**
 * §6.5 requires an audit log entry for each of these events. The names are part
 * of the API contract once T6.5 freezes it, so they must not silently change.
 */
const REQUIRED_BY_SECTION_6_5 = [
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'user.password_changed',
  'organization.created',
  'organization.updated',
  'import.confirmed',
  'analysis.started',
  'finding.status_changed',
  'explanation.regenerated',
  'demo.data_loaded',
] as const;

describe('audit actions (§6.5)', () => {
  it('defines every event the architecture requires', () => {
    const defined = Object.values(AuditAction);
    for (const action of REQUIRED_BY_SECTION_6_5) {
      expect(defined).toContain(action);
    }
  });

  it('uses stable lowercase dotted action names', () => {
    for (const action of Object.values(AuditAction)) {
      expect(action).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
  });
});

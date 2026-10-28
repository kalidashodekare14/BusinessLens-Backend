/** Stable audit action names; they are part of the API contract once T6.5 freezes it. */
export const AuditAction = {
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  ORGANIZATION_CREATED: 'organization.created',
  ORGANIZATION_UPDATED: 'organization.updated',
  IMPORT_UPLOADED: 'import.uploaded',
  IMPORT_CONFIRMED: 'import.confirmed',
  ANALYSIS_STARTED: 'analysis.started',
  FINDING_STATUS_CHANGED: 'finding.status_changed',
  EXPLANATION_REGENERATED: 'explanation.regenerated',
  DEMO_DATA_LOADED: 'demo.data_loaded',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

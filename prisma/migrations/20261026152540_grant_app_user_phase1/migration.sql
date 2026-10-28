-- Phase 1 prerequisite (owner-approved): TASKS.md assigns app_user grants to T2.1,
-- but the auth/organization code in Phase 1 cannot run without table privileges.
-- This grants only the four non-tenant tables Phase 1 uses. Tenant tables, AuditLog
-- grants and all RLS policies remain part of T2.1.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "User",
  "Organization",
  "Membership",
  "RefreshToken"
TO app_user;

-- T1.8 (owner-approved): Phase 1 writes audit events before T2.1 exists.
-- Only INSERT is granted; AuditLog RLS policies and SELECT grants remain in T2.1.
GRANT INSERT ON TABLE "AuditLog" TO app_user;

-- T2.1: tenant isolation at the database layer (PROJECT_ARCHITECTURE.md §6.3).
--
-- NOTE ON THE EXPRESSION: organizationId columns are TEXT (Prisma String), so a
-- policy comparing them to `current_setting(...)::uuid` fails with
-- "operator does not exist: text = uuid". Comparing text to text keeps the same
-- fail-closed semantics: a missing setting yields NULL and no row matches.
--
-- Every tenant table is ENABLE + FORCE ROW LEVEL SECURITY, with one policy that
-- enforces the same expression for reads (USING) and writes (WITH CHECK).

ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ImportJob"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Product"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Order"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "OrderItem"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AnalysisRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalysisRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AnalysisRun"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Finding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Finding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Finding"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "FindingNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FindingNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "FindingNote"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AiExplanation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiExplanation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AiExplanation"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

-- AuditLog is append-only for the application: SELECT + INSERT only.
-- Reads are tenant-scoped; INSERT also accepts null-organization auth events that
-- are written without a tenant context (and are never readable through the API).
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_select" ON "AuditLog"
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY "audit_log_insert" ON "AuditLog"
  FOR INSERT
  WITH CHECK (
    "organizationId" IS NULL
    OR "organizationId" = current_setting('app.organization_id', true)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "ImportJob",
  "Product",
  "Order",
  "OrderItem",
  "AnalysisRun",
  "Finding",
  "FindingNote",
  "AiExplanation"
TO app_user;

GRANT SELECT, INSERT ON TABLE "AuditLog" TO app_user;

-- Standard tenant isolation for write keys (see ADR-0003). The dashboard
-- manages keys through the RLS-bound app role; only the ingestion service
-- resolves keys cross-tenant, and it does so over the admin connection
-- (single-table lookup — see ADR-0010).

ALTER TABLE "write_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "write_key" FORCE ROW LEVEL SECURITY;
CREATE POLICY "write_key_tenant_isolation" ON "write_key"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

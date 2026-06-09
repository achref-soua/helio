-- Standard tenant isolation for the integration table (see ADR-0003).
-- Connections (and their secrets) are reached through the org-scoped app role;
-- the inbound Shopify webhook resolves the org through the admin client by
-- (provider, external_id), then writes contacts under that org.

ALTER TABLE "integration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration" FORCE ROW LEVEL SECURITY;
CREATE POLICY "integration_tenant_isolation" ON "integration"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

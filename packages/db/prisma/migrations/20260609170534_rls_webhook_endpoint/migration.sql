-- Standard tenant isolation for the outbound webhook endpoint table
-- (see ADR-0003). Endpoints (and their signing secrets) are reached only
-- through the org-scoped app role, so a row only ever resolves within its
-- own tenant.

ALTER TABLE "webhook_endpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY "webhook_endpoint_tenant_isolation" ON "webhook_endpoint"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

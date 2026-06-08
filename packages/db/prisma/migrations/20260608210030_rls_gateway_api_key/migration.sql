-- Standard tenant isolation for the gateway API key table (see ADR-0003).
-- The gateway reads it through the app role scoped to the org embedded in
-- the presented key, so a key only ever resolves within its own tenant.

ALTER TABLE "gateway_api_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gateway_api_key" FORCE ROW LEVEL SECURITY;
CREATE POLICY "gateway_api_key_tenant_isolation" ON "gateway_api_key"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

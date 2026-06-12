-- Standard tenant isolation for the provider-credential vault (ADR-0003,
-- ADR-0019). Rows hold encrypted third-party secrets; the org-scoped app
-- role only ever resolves its own tenant's rows, and the envelope AAD
-- additionally binds each sealed value to its organization and row.

ALTER TABLE "provider_credential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_credential" FORCE ROW LEVEL SECURITY;
CREATE POLICY "provider_credential_tenant_isolation" ON "provider_credential"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

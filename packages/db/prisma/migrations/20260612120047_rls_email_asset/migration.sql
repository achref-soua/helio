-- Standard tenant isolation for email-builder image assets (ADR-0003).
-- Rows are written by the dashboard (app role); the public /a/[id]
-- serving route reads on the admin connection, where the row id is the
-- capability (email clients fetch anonymously).

ALTER TABLE "email_asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_asset" FORCE ROW LEVEL SECURITY;
CREATE POLICY "email_asset_tenant_isolation" ON "email_asset"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

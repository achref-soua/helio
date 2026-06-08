-- Standard tenant isolation for the CDP tables (see ADR-0003): the
-- helio_app role only sees rows whose organization_id matches the
-- transaction-local app.org_id setting.

ALTER TABLE "contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "contact_tenant_isolation" ON "contact"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

ALTER TABLE "contact_list" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_list" FORCE ROW LEVEL SECURITY;
CREATE POLICY "contact_list_tenant_isolation" ON "contact_list"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

ALTER TABLE "contact_list_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_list_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY "contact_list_member_tenant_isolation" ON "contact_list_member"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

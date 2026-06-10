-- Standard tenant isolation for the landing page table (see ADR-0003). Pages
-- are managed through the org-scoped app role; the public page reads one by id
-- through the admin client (the id is the capability, like hosted forms).

ALTER TABLE "landing_page" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "landing_page" FORCE ROW LEVEL SECURITY;
CREATE POLICY "landing_page_tenant_isolation" ON "landing_page"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

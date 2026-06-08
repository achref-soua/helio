-- Standard tenant isolation for forms (see ADR-0003).

ALTER TABLE "form" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form" FORCE ROW LEVEL SECURITY;
CREATE POLICY "form_tenant_isolation" ON "form"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

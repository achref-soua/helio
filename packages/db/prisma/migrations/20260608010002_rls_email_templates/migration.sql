-- Standard tenant isolation for email templates (see ADR-0003).

ALTER TABLE "email_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_template" FORCE ROW LEVEL SECURITY;
CREATE POLICY "email_template_tenant_isolation" ON "email_template"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

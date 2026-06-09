-- Standard tenant isolation for the widget table (see ADR-0003). Widgets are
-- managed through the org-scoped app role; the public embed endpoint reads
-- active widgets through the admin client, scoped by the workspace write key.

ALTER TABLE "widget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "widget" FORCE ROW LEVEL SECURITY;
CREATE POLICY "widget_tenant_isolation" ON "widget"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

-- Standard tenant isolation for operational alerts (ADR-0003). Rows are
-- written by the workers (admin role) and read/dismissed by the org's
-- own members through the app role.

ALTER TABLE "system_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_alert" FORCE ROW LEVEL SECURITY;
CREATE POLICY "system_alert_tenant_isolation" ON "system_alert"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

-- Standard tenant isolation for the subscription table (see ADR-0003).

ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY "subscription_tenant_isolation" ON "subscription"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

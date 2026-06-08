-- Standard tenant isolation for campaigns (see ADR-0003).

ALTER TABLE "campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY "campaign_tenant_isolation" ON "campaign"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

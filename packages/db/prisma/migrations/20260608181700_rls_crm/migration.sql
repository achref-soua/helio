-- Standard tenant isolation for the CRM-lite tables (see ADR-0003).

ALTER TABLE "pipeline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pipeline_tenant_isolation" ON "pipeline"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

ALTER TABLE "pipeline_stage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pipeline_stage_tenant_isolation" ON "pipeline_stage"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

ALTER TABLE "deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal" FORCE ROW LEVEL SECURITY;
CREATE POLICY "deal_tenant_isolation" ON "deal"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

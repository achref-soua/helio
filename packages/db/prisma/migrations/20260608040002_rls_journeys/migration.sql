-- Standard tenant isolation for journeys and runs (see ADR-0003).

ALTER TABLE "journey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journey" FORCE ROW LEVEL SECURITY;
CREATE POLICY "journey_tenant_isolation" ON "journey"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

ALTER TABLE "journey_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journey_run" FORCE ROW LEVEL SECURITY;
CREATE POLICY "journey_run_tenant_isolation" ON "journey_run"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

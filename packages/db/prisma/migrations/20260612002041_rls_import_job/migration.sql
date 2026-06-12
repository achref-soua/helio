-- Standard tenant isolation for import jobs (ADR-0003).

ALTER TABLE "import_job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_job" FORCE ROW LEVEL SECURITY;
CREATE POLICY "import_job_tenant_isolation" ON "import_job"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

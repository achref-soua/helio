-- Standard tenant isolation for segments (see ADR-0003).

ALTER TABLE "segment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "segment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "segment_tenant_isolation" ON "segment"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

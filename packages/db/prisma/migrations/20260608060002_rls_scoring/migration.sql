-- Standard tenant isolation for scoring rules (see ADR-0003).

ALTER TABLE "scoring_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scoring_rule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "scoring_rule_tenant_isolation" ON "scoring_rule"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

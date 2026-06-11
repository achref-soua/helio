-- Standard tenant isolation for CRM notes and companies (ADR-0003).
-- Both are workspace-scoped tenant tables written and read exclusively
-- through the RLS-bound app role.

ALTER TABLE "note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note" FORCE ROW LEVEL SECURITY;
CREATE POLICY "note_tenant_isolation" ON "note"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

ALTER TABLE "company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company" FORCE ROW LEVEL SECURITY;
CREATE POLICY "company_tenant_isolation" ON "company"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

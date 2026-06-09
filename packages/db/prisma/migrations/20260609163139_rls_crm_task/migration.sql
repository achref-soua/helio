-- Standard tenant isolation for the CRM task table (see ADR-0003). Tasks are
-- workspace-scoped to-dos reached only through the org-scoped app role, so a
-- row only ever resolves within its own tenant.

ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "task_tenant_isolation" ON "task"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

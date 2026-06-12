-- Standard tenant isolation for bring-your-own churn models (ADR-0003,
-- ADR-0021). Rows are written by the dashboard (app role) and read by
-- the intelligence service over its RLS-scoped connection.

ALTER TABLE "churn_model" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "churn_model" FORCE ROW LEVEL SECURITY;
CREATE POLICY "churn_model_tenant_isolation" ON "churn_model"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

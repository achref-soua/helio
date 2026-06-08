-- Standard tenant isolation for push subscriptions (see ADR-0003). The
-- ingest subscribe endpoint and the workers send path resolve these over
-- the admin connection (cross-tenant by endpoint; same pattern as
-- write keys / email sends, ADR-0010).

ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY "push_subscription_tenant_isolation" ON "push_subscription"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

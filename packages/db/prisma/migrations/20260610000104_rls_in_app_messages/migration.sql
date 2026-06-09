-- Standard tenant isolation for the in-app messaging tables (see ADR-0003).
-- Content and deliveries are managed through the org-scoped app role; the
-- public fetch endpoint reads a contact's unseen deliveries through the admin
-- client, scoped by the workspace write key and the contact's email.

ALTER TABLE "in_app_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "in_app_message" FORCE ROW LEVEL SECURITY;
CREATE POLICY "in_app_message_tenant_isolation" ON "in_app_message"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

ALTER TABLE "in_app_delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "in_app_delivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY "in_app_delivery_tenant_isolation" ON "in_app_delivery"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

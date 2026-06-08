-- Standard tenant isolation for email sends (see ADR-0003). The tracking
-- service resolves sends cross-tenant over the admin connection
-- (single-table read — same pattern as write keys, ADR-0010).

ALTER TABLE "email_send" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_send" FORCE ROW LEVEL SECURITY;
CREATE POLICY "email_send_tenant_isolation" ON "email_send"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

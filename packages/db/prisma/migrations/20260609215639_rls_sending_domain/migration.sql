-- Standard tenant isolation for the sending domain table (see ADR-0003).
-- Domains (including the DKIM private key) are reached only through the
-- org-scoped app role.

ALTER TABLE "sending_domain" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sending_domain" FORCE ROW LEVEL SECURITY;
CREATE POLICY "sending_domain_tenant_isolation" ON "sending_domain"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

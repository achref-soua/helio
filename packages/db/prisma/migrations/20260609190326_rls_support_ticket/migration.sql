-- Standard tenant isolation for the support ticket table (see ADR-0003).
-- Tickets are filed and triaged through the org-scoped app role only.

ALTER TABLE "support_ticket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_ticket" FORCE ROW LEVEL SECURITY;
CREATE POLICY "support_ticket_tenant_isolation" ON "support_ticket"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

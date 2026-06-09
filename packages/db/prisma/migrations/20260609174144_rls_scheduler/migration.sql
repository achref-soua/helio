-- Standard tenant isolation for the scheduler tables (see ADR-0003). Booking
-- pages and meetings are reached through the org-scoped app role; the public
-- booking page reads a page by id through the admin client (the id is the
-- capability, like hosted forms) and writes a meeting under the page's org.

ALTER TABLE "booking_page" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_page" FORCE ROW LEVEL SECURITY;
CREATE POLICY "booking_page_tenant_isolation" ON "booking_page"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

ALTER TABLE "meeting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting" FORCE ROW LEVEL SECURITY;
CREATE POLICY "meeting_tenant_isolation" ON "meeting"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

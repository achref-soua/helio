-- Instance-level backup bookkeeping (ADR-0020): no tenant column, so RLS
-- is ENABLEd (not FORCEd — the sidecar writes on the admin/owner role,
-- which bypasses policies) with explicit, minimal app-role access: the
-- dashboard reads run metadata and inserts run-now requests; it never
-- writes runs.

ALTER TABLE "backup_run" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backup_run_app_read" ON "backup_run"
  FOR SELECT TO helio_app USING (true);

ALTER TABLE "backup_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backup_request_app_rw" ON "backup_request"
  FOR ALL TO helio_app USING (true) WITH CHECK (true);

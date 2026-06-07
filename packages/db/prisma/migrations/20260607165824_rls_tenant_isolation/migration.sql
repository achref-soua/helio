-- Tenant isolation via row-level security.
--
-- Runtime traffic connects as `helio_app` (no BYPASSRLS). Policies key on
-- the transaction-local `app.org_id` setting, which @helio/db's forTenant()
-- sets via set_config(..., true) at the start of every operation. No tenant
-- context => current_setting(..., true) returns NULL => no rows match.
--
-- The role's password below is a development default; rotate it for any
-- non-local deployment (ALTER ROLE helio_app PASSWORD '...').

-- pgvector: enabled here so later embedding columns are a plain migration.
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'helio_app') THEN
    CREATE ROLE helio_app LOGIN PASSWORD 'helio_app' NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA "public" TO helio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO helio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO helio_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helio_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT USAGE, SELECT ON SEQUENCES TO helio_app;

-- Prisma's bookkeeping table must stay admin-only. Conditional because the
-- table does not exist during shadow-database replay.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_tables
    WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
  ) THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM helio_app;
  END IF;
END
$$;

-- organization: a tenant may only see itself.
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organization_tenant_isolation" ON "organization"
  USING (id = current_setting('app.org_id', true))
  WITH CHECK (id = current_setting('app.org_id', true));

-- workspace
ALTER TABLE "workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_tenant_isolation" ON "workspace"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

-- audit_log
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

-- The SSO plugin's provider table is auth-domain: Better-Auth owns it and
-- connects as the admin role (ADR-0004, ADR-0013). The RLS-bound app role
-- must never touch identity data — and the OIDC client secret lives in
-- `oidc_config` — so revoke the blanket grant it received from the default
-- privileges established in the rls_tenant_isolation migration.

REVOKE ALL ON TABLE "sso_provider" FROM helio_app;

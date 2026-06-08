-- The SCIM token table is auth-domain: it gates identity provisioning and
-- stores a bearer-token hash. Like the SSO providers and the rest of the
-- identity tables, revoke the RLS app role's blanket grant so it is reached
-- only through the admin connection (ADR-0004, ADR-0014).

REVOKE ALL ON TABLE "scim_token" FROM helio_app;

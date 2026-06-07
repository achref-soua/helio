-- The auth kernel owns these tables and connects as the admin role
-- (ADR-0004). The RLS-bound app role must not be able to touch identity
-- data at all: revoke the blanket grants it received from the default
-- privileges established in the rls_tenant_isolation migration.

REVOKE ALL ON TABLE "user" FROM helio_app;
REVOKE ALL ON TABLE "session" FROM helio_app;
REVOKE ALL ON TABLE "account" FROM helio_app;
REVOKE ALL ON TABLE "verification" FROM helio_app;
REVOKE ALL ON TABLE "member" FROM helio_app;
REVOKE ALL ON TABLE "invitation" FROM helio_app;
REVOKE ALL ON TABLE "two_factor" FROM helio_app;
REVOKE ALL ON TABLE "apikey" FROM helio_app;

-- The integration signing secret is now sealed at rest (ADR-0019), and
-- its envelope AAD binds it to the integration row id — so the webhook
-- resolver must surface the id alongside the secret for the gateway to
-- decrypt. Return-type changes require a drop-and-recreate; privileges
-- are re-applied exactly as in ADR-0017.

DROP FUNCTION IF EXISTS webhook_shopify_connection(text);

CREATE FUNCTION webhook_shopify_connection(shop_domain text)
RETURNS TABLE (id text, organization_id text, workspace_id text, secret text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, organization_id, workspace_id, secret
  FROM integration
  WHERE provider = 'SHOPIFY' AND external_id = shop_domain AND enabled
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION webhook_shopify_connection(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_shopify_connection(text) TO helio_app;

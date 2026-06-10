-- Provider webhooks (Stripe, Shopify) authenticate by signature, not by a
-- tenant API key, so the gateway must discover which tenant a payload
-- belongs to before any RLS context exists. With policies keyed on
-- app.org_id, the app role sees no tenant rows until that context is set —
-- plain table lookups in webhook handlers therefore matched nothing, and
-- the writes that followed failed WITH CHECK.
--
-- Each resolver below is a narrow SECURITY DEFINER function owned by the
-- schema owner: it exposes exactly one indexed lookup to the app role and
-- nothing else. The gateway still never holds an admin connection
-- (ADR-0017).

CREATE FUNCTION webhook_shopify_connection(shop_domain text)
RETURNS TABLE (organization_id text, workspace_id text, secret text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id, workspace_id, secret
  FROM integration
  WHERE provider = 'SHOPIFY' AND external_id = shop_domain AND enabled
  LIMIT 1;
$$;

CREATE FUNCTION webhook_stripe_organization(customer_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM subscription
  WHERE stripe_customer_id = customer_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION webhook_shopify_connection(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION webhook_stripe_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_shopify_connection(text) TO helio_app;
GRANT EXECUTE ON FUNCTION webhook_stripe_organization(text) TO helio_app;

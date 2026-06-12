-- Helio is free and open source — there are no billing plans or contact
-- caps. Drop the Stripe-era subscription table and its SECURITY DEFINER
-- webhook resolver (ADR-0017); both are unreferenced after this release.
DROP FUNCTION IF EXISTS webhook_stripe_organization(text);
DROP TABLE IF EXISTS "subscription";

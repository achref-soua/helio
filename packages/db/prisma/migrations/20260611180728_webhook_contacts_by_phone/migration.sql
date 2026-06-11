-- Twilio delivery-status callbacks arrive with only a phone number; like
-- the email suppression webhook (ADR-0017), the gateway resolves the
-- owning tenants through a narrow SECURITY DEFINER lookup — never a raw
-- read on the RLS role. The partial index keeps the lookup cheap.

CREATE INDEX "contact_phone_idx" ON "contact"("phone") WHERE "phone" IS NOT NULL;

CREATE FUNCTION webhook_contacts_by_phone(phone_number text)
RETURNS TABLE (id text, organization_id text, workspace_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, organization_id, workspace_id
  FROM contact
  WHERE phone = phone_number AND status = 'ACTIVE';
$$;

REVOKE ALL ON FUNCTION webhook_contacts_by_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_contacts_by_phone(text) TO helio_app;

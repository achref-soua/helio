-- Email providers report hard bounces and spam complaints by webhook. The
-- recipient address — not any one tenant — is what went bad: continuing to
-- send to it from any workspace damages the deployment's sending
-- reputation for everyone. The gateway therefore suppresses the address in
-- every workspace, resolving the affected contacts through a SECURITY
-- DEFINER resolver like the other webhook families (ADR-0017).

-- CreateIndex (mirrors @@index([email]) on Contact)
CREATE INDEX "contact_email_idx" ON "contact"("email");

CREATE FUNCTION webhook_contacts_by_email(address text)
RETURNS TABLE (id text, organization_id text, workspace_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, organization_id, workspace_id
  FROM contact
  WHERE email = address AND status = 'ACTIVE';
$$;

REVOKE ALL ON FUNCTION webhook_contacts_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_contacts_by_email(text) TO helio_app;

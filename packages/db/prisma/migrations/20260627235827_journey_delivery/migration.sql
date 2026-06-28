-- Idempotency marker for journey SMS / WhatsApp / web-push sends: one contact's
-- pass through one send node maps to one row (deterministic id), so a Temporal
-- retry after a delivered send claims the same row instead of sending again.
-- Tenant-scoped (RLS, ADR-0003).

-- CreateTable
CREATE TABLE "journey_delivery" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "journey_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journey_delivery_organization_id_idx" ON "journey_delivery"("organization_id");

-- AddForeignKey
ALTER TABLE "journey_delivery" ADD CONSTRAINT "journey_delivery_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation: sends run through the org-scoped app role only.
ALTER TABLE "journey_delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journey_delivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY "journey_delivery_tenant_isolation" ON "journey_delivery"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

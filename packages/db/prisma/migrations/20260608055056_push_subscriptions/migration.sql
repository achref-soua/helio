-- CreateTable
CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_organization_id_idx" ON "push_subscription"("organization_id");

-- CreateIndex
CREATE INDEX "push_subscription_workspace_id_idx" ON "push_subscription"("workspace_id");

-- CreateIndex
CREATE INDEX "push_subscription_contact_id_idx" ON "push_subscription"("contact_id");

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

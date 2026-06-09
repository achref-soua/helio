-- CreateTable
CREATE TABLE "in_app_message" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta_label" TEXT,
    "cta_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "in_app_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "in_app_delivery" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_app_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "in_app_message_organization_id_idx" ON "in_app_message"("organization_id");

-- CreateIndex
CREATE INDEX "in_app_message_workspace_id_active_idx" ON "in_app_message"("workspace_id", "active");

-- CreateIndex
CREATE INDEX "in_app_delivery_organization_id_idx" ON "in_app_delivery"("organization_id");

-- CreateIndex
CREATE INDEX "in_app_delivery_contact_id_seen_at_idx" ON "in_app_delivery"("contact_id", "seen_at");

-- AddForeignKey
ALTER TABLE "in_app_message" ADD CONSTRAINT "in_app_message_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_message" ADD CONSTRAINT "in_app_message_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_delivery" ADD CONSTRAINT "in_app_delivery_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_delivery" ADD CONSTRAINT "in_app_delivery_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_delivery" ADD CONSTRAINT "in_app_delivery_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "in_app_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_delivery" ADD CONSTRAINT "in_app_delivery_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

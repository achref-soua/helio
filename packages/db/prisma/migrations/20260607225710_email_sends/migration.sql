-- CreateEnum
CREATE TYPE "email_send_status" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "email_send" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "email_send_status" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_send_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_send_organization_id_idx" ON "email_send"("organization_id");

-- CreateIndex
CREATE INDEX "email_send_workspace_id_created_at_idx" ON "email_send"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "email_send_campaign_id_idx" ON "email_send"("campaign_id");

-- AddForeignKey
ALTER TABLE "email_send" ADD CONSTRAINT "email_send_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_send" ADD CONSTRAINT "email_send_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_send" ADD CONSTRAINT "email_send_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/*
  Warnings:

  - A unique constraint covering the columns `[campaign_id,contact_id]` on the table `email_send` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'FAILED');

-- DropIndex
DROP INDEX "email_send_campaign_id_idx";

-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "segment_id" TEXT,
    "list_id" TEXT,
    "status" "campaign_status" NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_organization_id_idx" ON "campaign"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workspace_id_name_key" ON "campaign"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "email_send_campaign_id_contact_id_key" ON "email_send"("campaign_id", "contact_id");

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "email_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "contact_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_send" ADD CONSTRAINT "email_send_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

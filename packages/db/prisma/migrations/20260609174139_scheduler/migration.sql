-- CreateEnum
CREATE TYPE "meeting_status" AS ENUM ('BOOKED', 'CANCELED');

-- CreateTable
CREATE TABLE "booking_page" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "availability" JSONB NOT NULL DEFAULT '[]',
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "owner_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "booking_page_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "invitee_name" TEXT,
    "contact_id" TEXT,
    "status" "meeting_status" NOT NULL DEFAULT 'BOOKED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_page_organization_id_idx" ON "booking_page"("organization_id");

-- CreateIndex
CREATE INDEX "booking_page_workspace_id_idx" ON "booking_page"("workspace_id");

-- CreateIndex
CREATE INDEX "meeting_organization_id_idx" ON "meeting"("organization_id");

-- CreateIndex
CREATE INDEX "meeting_workspace_id_start_at_idx" ON "meeting"("workspace_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_booking_page_id_start_at_key" ON "meeting"("booking_page_id", "start_at");

-- AddForeignKey
ALTER TABLE "booking_page" ADD CONSTRAINT "booking_page_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_page" ADD CONSTRAINT "booking_page_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_booking_page_id_fkey" FOREIGN KEY ("booking_page_id") REFERENCES "booking_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

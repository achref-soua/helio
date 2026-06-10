-- CreateEnum
CREATE TYPE "support_kind" AS ENUM ('BUG', 'FEEDBACK', 'QUESTION');

-- CreateEnum
CREATE TYPE "support_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "support_ticket" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "reporter_id" TEXT,
    "kind" "support_kind" NOT NULL DEFAULT 'BUG',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "status" "support_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_ticket_organization_id_status_idx" ON "support_ticket"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

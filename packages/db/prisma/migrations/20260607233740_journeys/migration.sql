-- CreateEnum
CREATE TYPE "journey_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "journey_run_status" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "journey" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "journey_status" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_run" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "journey_run_status" NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "journey_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journey_organization_id_idx" ON "journey"("organization_id");

-- CreateIndex
CREATE INDEX "journey_workspace_id_status_idx" ON "journey"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journey_workspace_id_name_key" ON "journey"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "journey_run_journey_id_contact_id_status_idx" ON "journey_run"("journey_id", "contact_id", "status");

-- CreateIndex
CREATE INDEX "journey_run_organization_id_idx" ON "journey_run"("organization_id");

-- AddForeignKey
ALTER TABLE "journey" ADD CONSTRAINT "journey_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey" ADD CONSTRAINT "journey_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_run" ADD CONSTRAINT "journey_run_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_run" ADD CONSTRAINT "journey_run_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

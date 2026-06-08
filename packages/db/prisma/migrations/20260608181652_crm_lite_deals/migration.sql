-- CreateEnum
CREATE TYPE "stage_kind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "deal_status" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "pipeline" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stage" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "stage_kind" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "deal_status" NOT NULL DEFAULT 'OPEN',
    "position" INTEGER NOT NULL DEFAULT 0,
    "contact_id" TEXT,
    "owner_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_organization_id_idx" ON "pipeline"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_workspace_id_name_key" ON "pipeline"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "pipeline_stage_organization_id_idx" ON "pipeline_stage"("organization_id");

-- CreateIndex
CREATE INDEX "pipeline_stage_pipeline_id_position_idx" ON "pipeline_stage"("pipeline_id", "position");

-- CreateIndex
CREATE INDEX "deal_organization_id_idx" ON "deal"("organization_id");

-- CreateIndex
CREATE INDEX "deal_workspace_id_stage_id_position_idx" ON "deal"("workspace_id", "stage_id", "position");

-- AddForeignKey
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

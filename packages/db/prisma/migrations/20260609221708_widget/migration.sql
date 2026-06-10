-- CreateEnum
CREATE TYPE "widget_type" AS ENUM ('BANNER', 'POPUP');

-- CreateTable
CREATE TABLE "widget" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "widget_type" NOT NULL DEFAULT 'BANNER',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta_label" TEXT,
    "cta_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "widget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "widget_organization_id_idx" ON "widget"("organization_id");

-- CreateIndex
CREATE INDEX "widget_workspace_id_active_idx" ON "widget"("workspace_id", "active");

-- AddForeignKey
ALTER TABLE "widget" ADD CONSTRAINT "widget_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget" ADD CONSTRAINT "widget_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

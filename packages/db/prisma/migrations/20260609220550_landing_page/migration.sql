-- CreateTable
CREATE TABLE "landing_page" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_page_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "landing_page_organization_id_idx" ON "landing_page"("organization_id");

-- CreateIndex
CREATE INDEX "landing_page_workspace_id_idx" ON "landing_page"("workspace_id");

-- AddForeignKey
ALTER TABLE "landing_page" ADD CONSTRAINT "landing_page_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_page" ADD CONSTRAINT "landing_page_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

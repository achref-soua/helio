-- CreateTable
CREATE TABLE "email_asset" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_asset_organization_id_idx" ON "email_asset"("organization_id");

-- CreateIndex
CREATE INDEX "email_asset_workspace_id_idx" ON "email_asset"("workspace_id");

-- AddForeignKey
ALTER TABLE "email_asset" ADD CONSTRAINT "email_asset_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_asset" ADD CONSTRAINT "email_asset_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

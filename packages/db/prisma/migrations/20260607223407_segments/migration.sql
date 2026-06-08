-- CreateTable
CREATE TABLE "segment" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rule" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "segment_organization_id_idx" ON "segment"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "segment_workspace_id_name_key" ON "segment"("workspace_id", "name");

-- AddForeignKey
ALTER TABLE "segment" ADD CONSTRAINT "segment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment" ADD CONSTRAINT "segment_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

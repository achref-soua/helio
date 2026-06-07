-- CreateTable
CREATE TABLE "write_key" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "write_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "write_key_key_key" ON "write_key"("key");

-- CreateIndex
CREATE INDEX "write_key_organization_id_idx" ON "write_key"("organization_id");

-- CreateIndex
CREATE INDEX "write_key_workspace_id_idx" ON "write_key"("workspace_id");

-- AddForeignKey
ALTER TABLE "write_key" ADD CONSTRAINT "write_key_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_key" ADD CONSTRAINT "write_key_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

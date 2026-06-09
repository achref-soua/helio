-- CreateTable
CREATE TABLE "gateway_api_key" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "gateway_api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_api_key_key_hash_key" ON "gateway_api_key"("key_hash");

-- CreateIndex
CREATE INDEX "gateway_api_key_organization_id_idx" ON "gateway_api_key"("organization_id");

-- AddForeignKey
ALTER TABLE "gateway_api_key" ADD CONSTRAINT "gateway_api_key_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

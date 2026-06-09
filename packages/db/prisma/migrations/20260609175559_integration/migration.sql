-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('SHOPIFY', 'SALESFORCE');

-- CreateTable
CREATE TABLE "integration" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "external_id" TEXT,
    "secret" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_organization_id_idx" ON "integration"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_organization_id_provider_key" ON "integration"("organization_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "integration_provider_external_id_key" ON "integration"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "integration" ADD CONSTRAINT "integration_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration" ADD CONSTRAINT "integration_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

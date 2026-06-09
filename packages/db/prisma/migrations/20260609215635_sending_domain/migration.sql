-- CreateEnum
CREATE TYPE "domain_status" AS ENUM ('PENDING', 'VERIFIED');

-- CreateTable
CREATE TABLE "sending_domain" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "dkim_selector" TEXT NOT NULL DEFAULT 'helio',
    "dkim_public_key" TEXT NOT NULL,
    "dkim_private_key" TEXT NOT NULL,
    "spf_include" TEXT,
    "status" "domain_status" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sending_domain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sending_domain_organization_id_idx" ON "sending_domain"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sending_domain_workspace_id_domain_key" ON "sending_domain"("workspace_id", "domain");

-- AddForeignKey
ALTER TABLE "sending_domain" ADD CONSTRAINT "sending_domain_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sending_domain" ADD CONSTRAINT "sending_domain_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

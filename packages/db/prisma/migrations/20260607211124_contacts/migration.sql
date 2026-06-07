-- CreateEnum
CREATE TYPE "contact_status" AS ENUM ('ACTIVE', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED');

-- CreateTable
CREATE TABLE "contact" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" "contact_status" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_list" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_list_member" (
    "list_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_list_member_pkey" PRIMARY KEY ("list_id","contact_id")
);

-- CreateIndex
CREATE INDEX "contact_organization_id_idx" ON "contact"("organization_id");

-- CreateIndex
CREATE INDEX "contact_workspace_id_created_at_idx" ON "contact"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_workspace_id_email_key" ON "contact"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "contact_list_organization_id_idx" ON "contact_list"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_list_workspace_id_name_key" ON "contact_list"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "contact_list_member_contact_id_idx" ON "contact_list_member"("contact_id");

-- CreateIndex
CREATE INDEX "contact_list_member_organization_id_idx" ON "contact_list_member"("organization_id");

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list" ADD CONSTRAINT "contact_list_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list" ADD CONSTRAINT "contact_list_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_member" ADD CONSTRAINT "contact_list_member_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "contact_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_member" ADD CONSTRAINT "contact_list_member_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

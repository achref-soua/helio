-- CreateTable
CREATE TABLE "form" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_organization_id_idx" ON "form"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_workspace_id_name_key" ON "form"("workspace_id", "name");

-- AddForeignKey
ALTER TABLE "form" ADD CONSTRAINT "form_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form" ADD CONSTRAINT "form_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

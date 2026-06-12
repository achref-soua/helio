-- CreateEnum
CREATE TYPE "import_job_status" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "import_job" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "import_job_status" NOT NULL DEFAULT 'RUNNING',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "suppressed" INTEGER NOT NULL DEFAULT 0,
    "error_rows" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_job_organization_id_idx" ON "import_job"("organization_id");

-- CreateIndex
CREATE INDEX "import_job_workspace_id_created_at_idx" ON "import_job"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

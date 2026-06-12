-- CreateTable
CREATE TABLE "backup_run" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'scheduled',
    "status" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "sha256" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "app_version" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "backup_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_request" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'manual',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "picked_up_at" TIMESTAMP(3),

    CONSTRAINT "backup_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_run_started_at_idx" ON "backup_run"("started_at");

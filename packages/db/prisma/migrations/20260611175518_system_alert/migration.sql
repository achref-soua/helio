-- CreateTable
CREATE TABLE "system_alert" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_alert_organization_id_created_at_idx" ON "system_alert"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "system_alert" ADD CONSTRAINT "system_alert_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

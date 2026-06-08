-- AlterTable
ALTER TABLE "contact" ADD COLUMN     "score" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "scoring_rule" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scoring_rule_organization_id_idx" ON "scoring_rule"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_rule_workspace_id_event_key" ON "scoring_rule"("workspace_id", "event");

-- AddForeignKey
ALTER TABLE "scoring_rule" ADD CONSTRAINT "scoring_rule_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_rule" ADD CONSTRAINT "scoring_rule_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

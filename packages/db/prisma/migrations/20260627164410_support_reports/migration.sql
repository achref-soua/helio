-- A per-user link from a dashboard bug report to its GitHub issue, so the filer
-- can track its status. The issue is the source of truth; this row is synced
-- from the issue's open/closed state. Tenant-scoped (RLS, ADR-0003).

-- CreateTable
CREATE TABLE "support_report" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "issue_number" INTEGER,
    "issue_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "resolved_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_report_organization_id_user_id_idx" ON "support_report"("organization_id", "user_id");

-- AddForeignKey
ALTER TABLE "support_report" ADD CONSTRAINT "support_report_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation: reports are filed and read through the org-scoped app role
-- only (see ADR-0003). No tenant context => current_setting(..., true) is NULL
-- => no rows match.
ALTER TABLE "support_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY "support_report_tenant_isolation" ON "support_report"
  USING (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true));

-- CreateEnum
CREATE TYPE "ChurnModelFormat" AS ENUM ('ONNX', 'XGBOOST_JSON', 'HTTP');

-- CreateEnum
CREATE TYPE "ChurnModelStatus" AS ENUM ('VALIDATING', 'ACTIVE', 'FAILED', 'DISABLED');

-- CreateTable
CREATE TABLE "churn_model" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" "ChurnModelFormat" NOT NULL,
    "filename" TEXT,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "endpoint_url" TEXT,
    "credential_id" TEXT,
    "feature_mapping" JSONB NOT NULL,
    "status" "ChurnModelStatus" NOT NULL DEFAULT 'VALIDATING',
    "last_error" TEXT,
    "validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "churn_model_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "churn_model_organization_id_idx" ON "churn_model"("organization_id");

-- CreateIndex
CREATE INDEX "churn_model_workspace_id_status_idx" ON "churn_model"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "churn_model_workspace_id_name_key" ON "churn_model"("workspace_id", "name");

-- AddForeignKey
ALTER TABLE "churn_model" ADD CONSTRAINT "churn_model_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

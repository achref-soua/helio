-- AlterTable
ALTER TABLE "gateway_api_key" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['*']::TEXT[];

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "require_2fa" BOOLEAN NOT NULL DEFAULT false;

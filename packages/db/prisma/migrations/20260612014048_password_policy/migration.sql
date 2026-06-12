-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "password_expiry_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "password_expiry_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "password_changed_at" TIMESTAMP(3);

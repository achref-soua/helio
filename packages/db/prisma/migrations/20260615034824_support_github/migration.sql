-- DropTable
DROP TABLE "support_ticket";

-- DropEnum
DROP TYPE "support_kind";

-- DropEnum
DROP TYPE "support_status";

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "support_repo" TEXT,
ADD COLUMN     "support_token" TEXT;

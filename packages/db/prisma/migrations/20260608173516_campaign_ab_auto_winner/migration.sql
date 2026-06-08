-- AlterTable
ALTER TABLE "campaign" ADD COLUMN     "ab_auto_winner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ab_decided_at" TIMESTAMP(3),
ADD COLUMN     "ab_test_percent" INTEGER,
ADD COLUMN     "ab_test_window_seconds" INTEGER,
ADD COLUMN     "ab_winner" TEXT;

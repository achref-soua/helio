-- AlterTable
ALTER TABLE "contact" ADD COLUMN     "churn_risk" DOUBLE PRECISION,
ADD COLUMN     "conversion_probability" DOUBLE PRECISION,
ADD COLUMN     "prediction_computed_at" TIMESTAMP(3),
ADD COLUMN     "prediction_model" TEXT;

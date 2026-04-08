-- CreateEnum
CREATE TYPE "FuelSource" AS ENUM ('MANUAL', 'CAMERA', 'IMPORT');

-- AlterTable
ALTER TABLE "fuel_logs" ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "ocr_data" JSONB,
ADD COLUMN     "source" "FuelSource" NOT NULL DEFAULT 'MANUAL';

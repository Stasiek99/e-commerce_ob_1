-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED', 'COMING_SOON');

-- AlterTable: add status/estimatedRestockDate to products
ALTER TABLE "products" ADD COLUMN "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "products" ADD COLUMN "estimatedRestockDate" TIMESTAMP(3);

-- AlterTable: add emailBounced flag to users
ALTER TABLE "users" ADD COLUMN "emailBounced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "emailBouncedAt" TIMESTAMP(3);

/*
  Warnings:

  - You are about to drop the column `price_in_cents` on the `product_variant_price_history` table. All the data in the column will be lost.
  - You are about to drop the column `recorded_at` on the `product_variant_price_history` table. All the data in the column will be lost.
  - You are about to drop the column `variant_id` on the `product_variant_price_history` table. All the data in the column will be lost.
  - You are about to drop the column `order_id` on the `return_requests` table. All the data in the column will be lost.
  - The primary key for the `review_helpful_votes` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `created_at` on the `review_helpful_votes` table. All the data in the column will be lost.
  - You are about to drop the column `review_id` on the `review_helpful_votes` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `review_helpful_votes` table. All the data in the column will be lost.
  - Added the required column `priceInCents` to the `product_variant_price_history` table without a default value. This is not possible if the table is not empty.
  - Added the required column `variantId` to the `product_variant_price_history` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reviewId` to the `review_helpful_votes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `review_helpful_votes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'FRAUD_REVIEW';

-- DropForeignKey
ALTER TABLE "product_variant_price_history" DROP CONSTRAINT "product_variant_price_history_variant_id_fkey";

-- DropForeignKey
ALTER TABLE "return_requests" DROP CONSTRAINT "return_requests_order_id_fkey";

-- DropForeignKey
ALTER TABLE "review_helpful_votes" DROP CONSTRAINT "review_helpful_votes_review_id_fkey";

-- DropForeignKey
ALTER TABLE "review_helpful_votes" DROP CONSTRAINT "review_helpful_votes_user_id_fkey";

-- DropIndex
DROP INDEX "product_variant_price_history_variant_id_recorded_at_idx";

-- DropIndex
DROP INDEX "return_requests_order_id_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product_variant_price_history" DROP COLUMN "price_in_cents",
DROP COLUMN "recorded_at",
DROP COLUMN "variant_id",
ADD COLUMN     "priceInCents" INTEGER NOT NULL,
ADD COLUMN     "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "variantId" TEXT NOT NULL,
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "allergens" DROP DEFAULT;

-- AlterTable
ALTER TABLE "return_requests" DROP COLUMN "order_id",
ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "review_helpful_votes" DROP CONSTRAINT "review_helpful_votes_pkey",
DROP COLUMN "created_at",
DROP COLUMN "review_id",
DROP COLUMN "user_id",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reviewId" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ADD CONSTRAINT "review_helpful_votes_pkey" PRIMARY KEY ("reviewId", "userId");

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "labelGeneratedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "product_variant_price_history_variantId_recordedAt_idx" ON "product_variant_price_history"("variantId", "recordedAt");

-- CreateIndex
CREATE INDEX "return_requests_orderId_idx" ON "return_requests"("orderId");

-- AddForeignKey
ALTER TABLE "product_variant_price_history" ADD CONSTRAINT "product_variant_price_history_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

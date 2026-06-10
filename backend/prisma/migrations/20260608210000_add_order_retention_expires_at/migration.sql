-- AlterTable
ALTER TABLE "orders" ADD COLUMN "retentionExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_retentionExpiresAt_idx" ON "orders"("retentionExpiresAt");

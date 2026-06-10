-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "snapshotVatRate" INTEGER NOT NULL DEFAULT 2300;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "vatRate" INTEGER NOT NULL DEFAULT 2300;

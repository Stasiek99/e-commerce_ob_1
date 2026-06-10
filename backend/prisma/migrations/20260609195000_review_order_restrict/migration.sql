-- Change Review.orderId FK from SET NULL to RESTRICT
-- Prevents hard-deleting an Order that has linked Reviews, preserving
-- the verifiedPurchase flag accuracy required by EU Omnibus Art. 3a.
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_orderId_fkey";
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

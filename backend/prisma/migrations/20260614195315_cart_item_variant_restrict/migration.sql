-- Change CartItem→ProductVariant FK from CASCADE to RESTRICT.
-- Prevents silent cart truncation when an admin hard-deletes a variant row.
-- OrderItem already uses RESTRICT (correct); this closes the asymmetry.

ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_productVariantId_fkey";

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_productVariantId_fkey"
  FOREIGN KEY ("productVariantId")
  REFERENCES "product_variants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

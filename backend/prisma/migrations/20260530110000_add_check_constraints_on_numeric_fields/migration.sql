-- Stock cannot go negative (refund bugs must not underflow)
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_stock_non_negative"
  CHECK ("stock" >= 0);

-- Ratings must be 1–5; values outside this range corrupt avgRating
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range"
  CHECK ("rating" BETWEEN 1 AND 5);

-- cancelledQuantity must be within [0, quantity]
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_cancelled_quantity_bounds"
  CHECK ("cancelledQuantity" >= 0 AND "cancelledQuantity" <= "quantity");

-- PERCENTAGE coupon value must not exceed 100 (200% discounts would be catastrophic)
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_percentage_value_max_100"
  CHECK ("discountType" <> 'PERCENTAGE' OR "value" <= 100);

-- Purge orphaned carts (no userId, no sessionId) before adding the constraint
DELETE FROM "cart_items" WHERE "cartId" IN (
  SELECT "id" FROM "carts" WHERE "userId" IS NULL AND "sessionId" IS NULL
);
DELETE FROM "carts" WHERE "userId" IS NULL AND "sessionId" IS NULL;

-- A cart must be owned by a user or tied to a session — orphaned carts are illegal
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_owner_required"
  CHECK ("userId" IS NOT NULL OR "sessionId" IS NOT NULL);

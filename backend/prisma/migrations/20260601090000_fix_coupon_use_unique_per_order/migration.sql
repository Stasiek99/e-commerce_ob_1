-- The @@unique([couponId, userId]) constraint incorrectly blocked any coupon
-- with maxUsesPerUser > 1: the second redemption by the same user hit P2002.
-- It also treated all guest users (userId = NULL) as the same identity in some
-- DB engines, making welcome promotions globally single-use.
-- Concurrency is already serialized by the atomic UPDATE in applyInsideTransaction.
ALTER TABLE "coupon_uses" DROP CONSTRAINT "coupon_uses_couponId_userId_key";

-- Replace with per-order uniqueness: the same coupon cannot be applied to the
-- same order twice, which is the actual invariant we need to enforce.
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_couponId_orderId_key" UNIQUE ("couponId", "orderId");

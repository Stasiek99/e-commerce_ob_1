-- Add unique constraint to prevent concurrent per-user coupon abuse
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_couponId_userId_key" UNIQUE ("couponId", "userId");

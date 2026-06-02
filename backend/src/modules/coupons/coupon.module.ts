import { Module } from '@nestjs/common';
import { CouponService } from './coupon.service';
import { CouponController } from './coupon.controller';
import { CouponValidateThrottlerGuard } from './guards/coupon-validate-throttler.guard';

@Module({
  providers: [CouponService, CouponValidateThrottlerGuard],
  controllers: [CouponController],
  exports: [CouponService],
})
export class CouponModule {}

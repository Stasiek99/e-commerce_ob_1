import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { CartModule } from '../cart/cart.module';
import { PaymentsModule } from '../payments/payments.module';
import { EmailModule } from '../email/email.module';
import { CouponModule } from '../coupons/coupon.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
  imports: [CartModule, PaymentsModule, EmailModule, CouponModule, InvoiceModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}

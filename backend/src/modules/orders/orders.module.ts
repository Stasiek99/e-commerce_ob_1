import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersCleanupService } from './orders-cleanup.service';
import { CartModule } from '../cart/cart.module';
import { PaymentsModule } from '../payments/payments.module';
import { EmailModule } from '../email/email.module';
import { CouponModule } from '../coupons/coupon.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [CartModule, PaymentsModule, EmailModule, CouponModule, InvoiceModule, ShippingModule, ProductsModule],
  providers: [OrdersService, OrdersCleanupService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}

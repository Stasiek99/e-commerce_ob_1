import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { CartCleanupService } from './cart-cleanup.service';

@Module({
  providers: [CartService, CartCleanupService],
  controllers: [CartController],
  exports: [CartService],
})
export class CartModule {}

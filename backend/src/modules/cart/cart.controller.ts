import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { User } from '@prisma/client';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Public()
  @Get()
  getCart(
    @CurrentUser() user: User | undefined,
    @Headers('x-session-id') sessionId: string,
  ) {
    return this.cartService.getOrCreate(user?.id, sessionId);
  }

  @Public()
  @Post('items')
  addItem(
    @CurrentUser() user: User | undefined,
    @Headers('x-session-id') sessionId: string,
    @Body() body: { productVariantId: string; quantity: number },
  ) {
    return this.cartService.addItem(
      user?.id,
      sessionId,
      body.productVariantId,
      body.quantity,
    );
  }

  @Public()
  @Patch('items/:variantId')
  updateItem(
    @CurrentUser() user: User | undefined,
    @Headers('x-session-id') sessionId: string,
    @Param('variantId') variantId: string,
    @Body() body: { quantity: number },
  ) {
    return this.cartService.updateItem(user?.id, sessionId, variantId, body.quantity);
  }

  @Public()
  @Delete('items/:variantId')
  removeItem(
    @CurrentUser() user: User | undefined,
    @Headers('x-session-id') sessionId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.cartService.removeItem(user?.id, sessionId, variantId);
  }

  @Post('merge')
  mergeCart(
    @CurrentUser() user: User,
    @Headers('x-session-id') sessionId: string,
  ) {
    return this.cartService.mergeGuestCart(user.id, sessionId);
  }
}

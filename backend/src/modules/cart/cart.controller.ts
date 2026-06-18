import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { User } from '@prisma/client';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { SessionId } from '../../common/decorators/session-id.decorator';
import { TurnstileGuard } from '../../common/guards/turnstile.guard';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Public()
  @Get()
  getCart(
    @CurrentUser() user: User | undefined,
    @SessionId() sessionId: string | undefined,
  ) {
    return this.cartService.getOrCreate(user?.id, sessionId);
  }

  @Public()
  @Post('items')
  @UseGuards(TurnstileGuard)
  // Explicit, intentional cap — without it this bot-sensitive, Turnstile-guarded
  // endpoint falls back to the generic 'burst' floor (5 req/s), letting a scripted
  // client with one valid token hammer addItem and worsen the cart stock-hoarding race.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  addItem(
    @CurrentUser() user: User | undefined,
    @SessionId() sessionId: string | undefined,
    @Body() dto: AddToCartDto,
  ) {
    return this.cartService.addItem(
      user?.id,
      sessionId,
      dto.productVariantId,
      dto.quantity,
    );
  }

  @Public()
  @Patch('items/:variantId')
  updateItem(
    @CurrentUser() user: User | undefined,
    @SessionId() sessionId: string | undefined,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user?.id, sessionId, variantId, dto.quantity);
  }

  @Public()
  @Delete('items/:variantId')
  removeItem(
    @CurrentUser() user: User | undefined,
    @SessionId() sessionId: string | undefined,
    @Param('variantId') variantId: string,
  ) {
    return this.cartService.removeItem(user?.id, sessionId, variantId);
  }

  @Post('merge')
  mergeCart(
    @CurrentUser() user: User,
    @SessionId() sessionId: string | undefined,
  ) {
    if (!sessionId) return this.cartService.getOrCreate(user.id, undefined);
    return this.cartService.mergeGuestCart(user.id, sessionId);
  }
}

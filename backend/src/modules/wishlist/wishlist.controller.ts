import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { WishlistService } from './wishlist.service';
import { MergeWishlistDto } from './dto/merge-wishlist.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('wishlist')
@UseGuards(JwtAuthGuard)
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @Get()
  getWishlist(@CurrentUser() user: User) {
    return this.wishlistService.getItems(user.id);
  }

  // Declare merge before :productId so NestJS doesn't treat "merge" as a UUID param
  @Post('merge')
  @HttpCode(HttpStatus.NO_CONTENT)
  mergeGuest(@CurrentUser() user: User, @Body() dto: MergeWishlistDto) {
    return this.wishlistService.mergeGuestItems(user.id, dto.productIds);
  }

  @Post(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  add(@CurrentUser() user: User, @Param('productId') productId: string) {
    return this.wishlistService.addItem(user.id, productId);
  }

  @Patch(':productId/notify')
  @HttpCode(HttpStatus.NO_CONTENT)
  setNotify(
    @CurrentUser() user: User,
    @Param('productId') productId: string,
    @Body('notify') notify: boolean,
  ) {
    return this.wishlistService.setNotify(user.id, productId, notify);
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: User, @Param('productId') productId: string) {
    return this.wishlistService.removeItem(user.id, productId);
  }
}

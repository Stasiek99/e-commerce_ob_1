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
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: User) {
    const { passwordHash, ...result } = user;
    return result;
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: User,
    @Body() body: { firstName?: string; lastName?: string; phone?: string },
  ) {
    const updated = await this.usersService.update(user.id, body);
    const { passwordHash, ...result } = updated;
    return result;
  }

  @Get('me/addresses')
  getAddresses(@CurrentUser() user: User) {
    return this.usersService.getAddresses(user.id);
  }

  @Post('me/addresses')
  createAddress(@CurrentUser() user: User, @Body() body: any) {
    return this.usersService.createAddress(user.id, body);
  }

  @Patch('me/addresses/:id')
  updateAddress(
    @CurrentUser() user: User,
    @Param('id') addressId: string,
    @Body() body: any,
  ) {
    return this.usersService.updateAddress(user.id, addressId, body);
  }

  @Delete('me/addresses/:id')
  deleteAddress(@CurrentUser() user: User, @Param('id') addressId: string) {
    return this.usersService.deleteAddress(user.id, addressId);
  }
}

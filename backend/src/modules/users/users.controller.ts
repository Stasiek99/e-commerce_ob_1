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
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: User) {
    const { passwordHash, ...result } = user;
    return result;
  }

  @Throttle({ default: { ttl: 3600000, limit: 3 } })
  @Patch('me/email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeEmail(@CurrentUser() user: User, @Body() dto: ChangeEmailDto) {
    await this.authService.requestEmailChange(user.id, dto.email);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.update(user.id, dto);
    const { passwordHash, ...result } = updated;
    return result;
  }

  @Get('me/addresses')
  getAddresses(@CurrentUser() user: User) {
    return this.usersService.getAddresses(user.id);
  }

  @Post('me/addresses')
  createAddress(@CurrentUser() user: User, @Body() dto: CreateAddressDto) {
    return this.usersService.createAddress(user.id, dto);
  }

  @Patch('me/addresses/:id')
  updateAddress(
    @CurrentUser() user: User,
    @Param('id') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.usersService.updateAddress(user.id, addressId, dto);
  }

  @Delete('me/addresses/:id')
  deleteAddress(@CurrentUser() user: User, @Param('id') addressId: string) {
    return this.usersService.deleteAddress(user.id, addressId);
  }
}

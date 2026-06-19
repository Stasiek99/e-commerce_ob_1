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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { Public } from '../auth/decorators/public.decorator';
import { REFRESH_COOKIE } from '../auth/auth.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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

  @Get('me/data-export')
  @Throttle({ default: { ttl: 3600000, limit: 3 } })
  async exportMyData(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.usersService.exportData(user.id, user.email);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="gdpr-export-${date}.json"`);
    res.setHeader('Content-Type', 'application/json');
    return data;
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.usersService.deleteAccount(user.id);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  @Throttle({ default: { ttl: 3600000, limit: 3 } })
  @Patch('me/email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeEmail(@CurrentUser() user: User, @Body() dto: ChangeEmailDto) {
    await this.authService.requestEmailChange(user.id, dto.email, dto.currentPassword);
  }

  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
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

  @Post('consent')
  @Public()
  @UseGuards(OptionalJwtGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordConsent(
    @Body() body: { analytics: boolean },
    @CurrentUser() user: User | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (user) {
      await this.usersService.recordConsent(user.id, body.analytics);
    } else {
      const existingId = (req.cookies as Record<string, string>)?.['consent_id'];
      const consentId = existingId ?? randomUUID();
      if (!existingId) {
        res.cookie('consent_id', consentId, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 5 * 365 * 24 * 60 * 60 * 1000,
          secure: process.env.NODE_ENV === 'production',
        });
      }
      await this.usersService.recordAnonymousConsent(consentId, body.analytics);
    }
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

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role, User } from '@prisma/client';
import { CouponService } from './coupon.service';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CreateCouponDto, UpdateCouponDto } from './dto/create-coupon.dto';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('coupons')
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseGuards(OptionalJwtGuard)
  validate(@Body() dto: ValidateCouponDto, @CurrentUser() user?: User) {
    return this.couponService.validate(
      dto.code,
      dto.cartTotalInCents,
      user?.id,
      dto.variantIds ?? [],
    );
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.couponService.findAll(Number(page) || 1, Number(limit) || 20);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  findOne(@Param('id') id: string) {
    return this.couponService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateCouponDto) {
    return this.couponService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.couponService.update(id, dto);
  }
}

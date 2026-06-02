import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import type { Request } from 'express';
import type IORedis from 'ioredis';
import { Role, User } from '@prisma/client';
import { CouponService } from './coupon.service';
import { CouponValidateThrottlerGuard } from './guards/coupon-validate-throttler.guard';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CreateCouponDto, UpdateCouponDto } from './dto/create-coupon.dto';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

const COUPON_FAIL_THRESHOLD = 5;
const COUPON_FAIL_WINDOW_SECS = 300;

@Controller('coupons')
export class CouponController {
  constructor(
    private readonly couponService: CouponService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ burst: true, sustained: true })
  @UseGuards(CouponValidateThrottlerGuard, OptionalJwtGuard)
  async validate(
    @Req() req: Request,
    @Body() dto: ValidateCouponDto,
    @CurrentUser() user?: User,
  ) {
    const result = await this.couponService.validate(
      dto.code,
      dto.cartTotalInCents,
      user?.id,
      dto.variantIds ?? [],
    );

    // Track consecutive invalid-code attempts per IP for abuse detection.
    const ip = String((req as any).ips?.[0] ?? req.ip ?? 'unknown');
    const key = `coupon:validate:fail:${ip}`;
    if (!result.valid) {
      const count = await this.redis.incr(key);
      await this.redis.expire(key, COUPON_FAIL_WINDOW_SECS);
      if (count >= COUPON_FAIL_THRESHOLD) {
        Sentry.captureMessage(
          `Coupon brute-force suspected: ${count} consecutive failures from IP ${ip}`,
          'warning',
        );
      }
    } else {
      await this.redis.del(key);
    }

    return result;
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

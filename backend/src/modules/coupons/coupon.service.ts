import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DiscountType, Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/create-coupon.dto';

// Converts a possibly naive ISO date string to a UTC Date, interpreting
// naive strings (no Z / no +HH:MM suffix) as local time in `tz`.
// Strings that already carry timezone info are parsed as-is.
function toUtcFromTz(dateStr: string, tz: string): Date {
  const hasOffset = dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr);
  if (hasOffset) return new Date(dateStr);

  // Treat the naive string as UTC to get a reference Date object, then
  // compute the Wall-clock difference between that UTC moment and the
  // same moment rendered in the target timezone. Subtracting that diff
  // gives us the UTC instant that corresponds to the intended local time.
  const normalized = dateStr.includes('T') ? dateStr + 'Z' : dateStr + 'T00:00:00Z';
  const ref = new Date(normalized);
  const utcMs = Date.parse(ref.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzMs = Date.parse(ref.toLocaleString('en-US', { timeZone: tz }));
  return new Date(ref.getTime() - (tzMs - utcMs));
}

export interface CouponValidationResult {
  valid: boolean;
  couponId?: string;
  discountType?: DiscountType;
  discountAmountInCents?: number;
  appliesToItemsOnly?: boolean;
  message?: string;
}

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  async validate(
    code: string,
    cartTotalInCents: number,
    userId?: string,
    variantIds: string[] = [],
    excludeOrderId?: string,
  ): Promise<CouponValidationResult> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    if (!coupon || !coupon.isActive) {
      return { valid: false, message: 'Kod rabatowy jest nieprawidłowy lub nieaktywny.' };
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      return { valid: false, message: 'Ten kod nie jest jeszcze aktywny.' };
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      return { valid: false, message: 'Ten kod wygasł.' };
    }

    // excludeOrderId is passed when re-validating an order's OWN already-reserved
    // coupon use (payment initiation/retry) — that reservation was already counted
    // against the caps atomically at order-creation time, so it must not be counted
    // again here. Without this, the order that consumes the last maxUsesTotal/
    // maxUsesPerUser slot can never pass re-validation, even on its very first
    // payment attempt.
    const ownUse = excludeOrderId
      ? await this.prisma.couponUse.findFirst({ where: { couponId: coupon.id, orderId: excludeOrderId } })
      : null;
    const effectiveCurrentUses = ownUse ? coupon.currentUses - 1 : coupon.currentUses;

    if (coupon.maxUsesTotal !== null && effectiveCurrentUses >= coupon.maxUsesTotal) {
      return { valid: false, message: 'Ten kod osiągnął limit użyć.' };
    }

    if (coupon.maxUsesPerUser !== null) {
      if (!userId) {
        return { valid: false, message: 'Zaloguj się, aby użyć tego kodu rabatowego.' };
      }
      const userUses = await this.prisma.couponUse.count({
        where: { couponId: coupon.id, userId, ...(ownUse && { NOT: { orderId: excludeOrderId } } ) },
      });
      if (userUses >= coupon.maxUsesPerUser) {
        return { valid: false, message: 'Wykorzystałeś już limit użyć tego kodu.' };
      }
    }

    if (coupon.minSpendInCents !== null && cartTotalInCents < coupon.minSpendInCents) {
      const minFormatted = (coupon.minSpendInCents / 100).toFixed(2).replace('.', ',');
      return { valid: false, message: `Minimalna wartość koszyka dla tego kodu to ${minFormatted} zł.` };
    }

    if (coupon.excludedProductIds.length > 0 && variantIds.length > 0) {
      const variants = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { productId: true },
      });
      const productIds = variants.map((v) => v.productId);
      const hasExcluded = productIds.some((pid) => coupon.excludedProductIds.includes(pid));
      if (hasExcluded) {
        return { valid: false, message: 'Kod nie dotyczy jednego lub więcej produktów w koszyku.' };
      }
    }

    const discountAmountInCents = this.calculateDiscount(coupon.discountType, coupon.value, cartTotalInCents);

    const appliesToItemsOnly =
      coupon.discountType === DiscountType.FIXED_AMOUNT && coupon.value >= cartTotalInCents;

    return {
      valid: true,
      couponId: coupon.id,
      discountType: coupon.discountType,
      discountAmountInCents,
      ...(appliesToItemsOnly && { appliesToItemsOnly: true }),
    };
  }

  // Used inside the order transaction — atomically reserves one coupon use.
  // Single SQL UPDATE covers: active, expiry, global cap, and per-user cap.
  // If 0 rows affected, one of those conditions failed — throw immediately.
  async applyInsideTransaction(
    tx: Prisma.TransactionClient,
    couponId: string,
    orderId: string,
    userId: string | undefined,
    discountAppliedInCents: number,
  ): Promise<void> {
    // Column names are quoted camelCase, matching the actual Postgres columns
    // (no @map on Coupon's fields — Prisma's default is camelCase, not snake_case).
    // `id`/`couponId`/`userId` are plain TEXT columns (Coupon.id is a String default,
    // not @db.Uuid), so they must NOT be cast to ::uuid — Postgres has no text = uuid
    // operator and errors immediately if you try.
    const affected = await tx.$executeRaw`
      UPDATE coupons
      SET "currentUses" = "currentUses" + 1
      WHERE id = ${couponId}
        AND "isActive" = true
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
        AND ("maxUsesTotal" IS NULL OR "currentUses" < "maxUsesTotal")
        AND (
          "maxUsesPerUser" IS NULL
          OR ${userId ?? null}::text IS NULL
          OR (
            SELECT COUNT(*) FROM coupon_uses
            WHERE "couponId" = ${couponId}
              AND "userId" = ${userId ?? null}
          ) < "maxUsesPerUser"
        )
    `;

    if (affected === 0) {
      throw new BadRequestException('Kod rabatowy jest nieważny, wygasł lub osiągnął limit użyć.');
    }

    await tx.couponUse.create({
      data: { couponId, orderId, userId: userId ?? null, discountAppliedInCents },
    });
  }

  // Releases a coupon's reserved capacity for an order that never completed —
  // the exact inverse of applyInsideTransaction. Must be called from inside the
  // same transaction as the order's terminal CANCELLED/REFUNDED write, by every
  // call site that ends an order's life, or the slot leaks permanently (it isn't
  // covered by reconcileCurrentUses, which only fixes drift against the
  // CouponUse rows — it can't tell a "leaked" row from a legitimate one).
  async releaseForOrder(tx: Prisma.TransactionClient, orderId: string, couponId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE coupons SET "currentUses" = GREATEST("currentUses" - 1, 0)
      WHERE id = ${couponId}
    `;
    await tx.couponUse.deleteMany({ where: { orderId } });
  }

  calculateDiscount(type: DiscountType, value: number, cartTotalInCents: number): number {
    switch (type) {
      case DiscountType.PERCENTAGE:
        // Math.round: rounds in customer's favor (standard retail practice)
        return Math.round((cartTotalInCents * value) / 100);
      case DiscountType.FIXED_AMOUNT:
        return Math.min(value, cartTotalInCents);
      case DiscountType.FREE_SHIPPING:
        return 0; // actual amount resolved at order creation (= shippingCost)
    }
  }

  async create(dto: CreateCouponDto) {
    if (dto.discountType === DiscountType.PERCENTAGE && dto.value > 100) {
      throw new BadRequestException('PERCENTAGE discount value must be between 0 and 100.');
    }

    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.coupon.findUnique({ where: { code } });
    if (existing) throw new ConflictException(`Coupon code "${code}" already exists.`);

    const tz = 'Europe/Warsaw';
    return this.prisma.coupon.create({
      data: {
        code,
        discountType: dto.discountType,
        value: dto.value,
        couponType: dto.couponType ?? 'CUSTOM',
        minSpendInCents: dto.minSpendInCents ?? null,
        maxUsesTotal: dto.maxUsesTotal ?? null,
        maxUsesPerUser: dto.maxUsesPerUser ?? null,
        isActive: dto.isActive ?? true,
        timezone: tz,
        startsAt: dto.startsAt ? toUtcFromTz(dto.startsAt, tz) : null,
        expiresAt: dto.expiresAt ? toUtcFromTz(dto.expiresAt, tz) : null,
        excludedProductIds: dto.excludedProductIds ?? [],
      },
    });
  }

  async update(id: string, dto: UpdateCouponDto) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');

    const tz = coupon.timezone ?? 'Europe/Warsaw';
    return this.prisma.coupon.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.maxUsesTotal !== undefined && { maxUsesTotal: dto.maxUsesTotal }),
        ...(dto.maxUsesPerUser !== undefined && { maxUsesPerUser: dto.maxUsesPerUser }),
        ...(dto.expiresAt !== undefined && { expiresAt: toUtcFromTz(dto.expiresAt, tz) }),
      },
    });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [coupons, total] = await Promise.all([
      this.prisma.coupon.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.coupon.count(),
    ]);
    return { data: coupons, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  // Reconciles the denormalized currentUses counter against the actual CouponUse
  // rows. Runs hourly so that a crash mid-rollback cannot permanently inflate the
  // counter and silently block otherwise-valid coupon redemptions.
  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'Europe/Warsaw' })
  async reconcileCurrentUses(): Promise<void> {
    const acquired = await this.redis.set('cron:reconcile-coupon-uses:lock', '1', 'EX', 3540, 'NX');
    if (!acquired) return;

    await this.prisma.$executeRaw`
      UPDATE coupons
      SET "currentUses" = (
        SELECT COUNT(*) FROM coupon_uses WHERE "couponId" = coupons.id
      )
    `;
    this.logger.debug('Coupon currentUses reconciliation complete');
  }
}

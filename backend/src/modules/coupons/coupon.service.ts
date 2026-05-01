import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DiscountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/create-coupon.dto';

export interface CouponValidationResult {
  valid: boolean;
  couponId?: string;
  discountType?: DiscountType;
  discountAmountInCents?: number;
  message?: string;
}

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(
    code: string,
    cartTotalInCents: number,
    userId?: string,
    variantIds: string[] = [],
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
    if (coupon.maxUsesTotal !== null && coupon.currentUses >= coupon.maxUsesTotal) {
      return { valid: false, message: 'Ten kod osiągnął limit użyć.' };
    }

    if (coupon.maxUsesPerUser !== null) {
      if (!userId) {
        return { valid: false, message: 'Zaloguj się, aby użyć tego kodu rabatowego.' };
      }
      const userUses = await this.prisma.couponUse.count({
        where: { couponId: coupon.id, userId },
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

    return {
      valid: true,
      couponId: coupon.id,
      discountType: coupon.discountType,
      discountAmountInCents,
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
    const affected = await tx.$executeRaw`
      UPDATE coupons
      SET current_uses = current_uses + 1
      WHERE id = ${couponId}::uuid
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_uses_total IS NULL OR current_uses < max_uses_total)
        AND (
          max_uses_per_user IS NULL
          OR ${userId ?? null}::uuid IS NULL
          OR (
            SELECT COUNT(*) FROM coupon_uses
            WHERE coupon_id = ${couponId}::uuid
              AND user_id = ${userId ?? null}::uuid
          ) < max_uses_per_user
        )
    `;

    if (affected === 0) {
      throw new BadRequestException('Kod rabatowy jest nieważny, wygasł lub osiągnął limit użyć.');
    }

    await tx.couponUse.create({
      data: { couponId, orderId, userId: userId ?? null, discountAppliedInCents },
    });
  }

  calculateDiscount(type: DiscountType, value: number, cartTotalInCents: number): number {
    switch (type) {
      case DiscountType.PERCENTAGE:
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
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        excludedProductIds: dto.excludedProductIds ?? [],
      },
    });
  }

  async update(id: string, dto: UpdateCouponDto) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');

    return this.prisma.coupon.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.maxUsesTotal !== undefined && { maxUsesTotal: dto.maxUsesTotal }),
        ...(dto.maxUsesPerUser !== undefined && { maxUsesPerUser: dto.maxUsesPerUser }),
        ...(dto.expiresAt !== undefined && { expiresAt: new Date(dto.expiresAt) }),
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
}

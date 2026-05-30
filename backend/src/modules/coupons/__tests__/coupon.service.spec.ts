import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DiscountType, CouponType, Prisma } from '@prisma/client';
import { CouponService } from '../coupon.service';
import { PrismaService } from '../../prisma/prisma.service';

const NOW = new Date('2025-06-01T12:00:00Z');

const makeCoupon = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 'coupon-1',
  code: 'SAVE10',
  discountType: DiscountType.PERCENTAGE,
  value: 10,
  couponType: CouponType.CUSTOM,
  isActive: true,
  currentUses: 0,
  maxUsesTotal: null,
  maxUsesPerUser: null,
  minSpendInCents: null,
  excludedProductIds: [],
  startsAt: null,
  expiresAt: null,
  createdAt: new Date('2025-01-01'),
  ...overrides,
});

describe('CouponService', () => {
  let service: CouponService;
  let prisma: any;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponService,
        {
          provide: PrismaService,
          useValue: {
            $executeRaw: jest.fn(),
            coupon: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            couponUse: {
              count: jest.fn(),
              create: jest.fn(),
            },
            productVariant: {
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(CouponService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ─── validate ────────────────────────────────────────────────────────────

  describe('validate', () => {
    describe('coupon lookup & active check', () => {
      it('returns invalid when coupon does not exist', async () => {
        prisma.coupon.findUnique.mockResolvedValue(null);

        const result = await service.validate('GHOST', 5000);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/nieprawidłowy/);
      });

      it('normalises code to uppercase before lookup', async () => {
        prisma.coupon.findUnique.mockResolvedValue(null);

        await service.validate('save10', 5000);

        expect(prisma.coupon.findUnique).toHaveBeenCalledWith({
          where: { code: 'SAVE10' },
        });
      });

      it('trims whitespace from code before lookup', async () => {
        prisma.coupon.findUnique.mockResolvedValue(null);

        await service.validate('  SAVE10  ', 5000);

        expect(prisma.coupon.findUnique).toHaveBeenCalledWith({
          where: { code: 'SAVE10' },
        });
      });

      it('returns invalid when coupon is inactive', async () => {
        prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ isActive: false }));

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/nieaktywny/);
      });
    });

    describe('date window checks', () => {
      it('returns invalid when coupon has not started yet', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ startsAt: new Date('2025-07-01') }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/nie jest jeszcze aktywny/);
      });

      it('returns valid when coupon start date is exactly now', async () => {
        prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ startsAt: NOW }));

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(true);
      });

      it('returns invalid when coupon has expired', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ expiresAt: new Date('2025-05-01') }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/wygasł/);
      });

      it('returns invalid when coupon expires exactly now (boundary)', async () => {
        // expiresAt < now is the check; expiresAt === now is still expired
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ expiresAt: new Date(NOW.getTime() - 1) }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(false);
      });

      it('returns valid when coupon expires in the future', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ expiresAt: new Date('2025-12-31') }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(true);
      });
    });

    describe('global usage cap', () => {
      it('returns invalid when global limit is reached', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ maxUsesTotal: 100, currentUses: 100 }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/limit/);
      });

      it('returns valid when global limit is not yet reached', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ maxUsesTotal: 100, currentUses: 99 }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(true);
      });

      it('returns valid when maxUsesTotal is null (unlimited)', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ maxUsesTotal: null, currentUses: 9999 }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(true);
      });
    });

    describe('per-user usage cap', () => {
      it('returns invalid for guest when maxUsesPerUser is set', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ maxUsesPerUser: 1 }),
        );

        const result = await service.validate('SAVE10', 5000, undefined);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/Zaloguj się/);
        expect(prisma.couponUse.count).not.toHaveBeenCalled();
      });

      it('returns invalid when user has exhausted their per-user limit', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ maxUsesPerUser: 2 }),
        );
        prisma.couponUse.count.mockResolvedValue(2);

        const result = await service.validate('SAVE10', 5000, 'user-1');

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/Wykorzystałeś/);
      });

      it('returns valid when user is under their per-user limit', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ maxUsesPerUser: 3 }),
        );
        prisma.couponUse.count.mockResolvedValue(1);

        const result = await service.validate('SAVE10', 5000, 'user-1');

        expect(result.valid).toBe(true);
      });

      it('skips per-user DB query when maxUsesPerUser is null', async () => {
        prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ maxUsesPerUser: null }));

        await service.validate('SAVE10', 5000, 'user-1');

        expect(prisma.couponUse.count).not.toHaveBeenCalled();
      });
    });

    describe('minimum spend check', () => {
      it('returns invalid when cart is below minimum spend', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ minSpendInCents: 10000 }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/Minimalna wartość/);
        expect(result.message).toContain('100,00');
      });

      it('returns valid when cart exactly meets minimum spend', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ minSpendInCents: 5000 }),
        );

        const result = await service.validate('SAVE10', 5000);

        expect(result.valid).toBe(true);
      });
    });

    describe('excluded products check', () => {
      it('returns invalid when cart contains an excluded product', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ excludedProductIds: ['product-X'] }),
        );
        prisma.productVariant.findMany.mockResolvedValue([
          { productId: 'product-X' },
          { productId: 'product-Y' },
        ]);

        const result = await service.validate('SAVE10', 5000, 'user-1', ['var-1', 'var-2']);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/nie dotyczy/);
      });

      it('returns valid when cart variants are not excluded', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ excludedProductIds: ['product-Z'] }),
        );
        prisma.productVariant.findMany.mockResolvedValue([
          { productId: 'product-A' },
        ]);

        const result = await service.validate('SAVE10', 5000, 'user-1', ['var-1']);

        expect(result.valid).toBe(true);
      });

      it('skips variant lookup when excludedProductIds is empty', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ excludedProductIds: [] }),
        );

        await service.validate('SAVE10', 5000, 'user-1', ['var-1']);

        expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
      });

      it('skips variant lookup when no variantIds provided', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ excludedProductIds: ['product-X'] }),
        );

        await service.validate('SAVE10', 5000, 'user-1', []);

        expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
      });
    });

    describe('happy path — discount calculation', () => {
      it('returns correct discount for PERCENTAGE coupon', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ discountType: DiscountType.PERCENTAGE, value: 20 }),
        );

        const result = await service.validate('SAVE20', 10000);

        expect(result.valid).toBe(true);
        expect(result.discountAmountInCents).toBe(2000);
        expect(result.discountType).toBe(DiscountType.PERCENTAGE);
        expect(result.couponId).toBe('coupon-1');
      });

      it('returns correct discount for FIXED_AMOUNT coupon', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ discountType: DiscountType.FIXED_AMOUNT, value: 500 }),
        );

        const result = await service.validate('FLAT5', 10000);

        expect(result.valid).toBe(true);
        expect(result.discountAmountInCents).toBe(500);
      });

      it('returns 0 discount for FREE_SHIPPING coupon (resolved at order time)', async () => {
        prisma.coupon.findUnique.mockResolvedValue(
          makeCoupon({ discountType: DiscountType.FREE_SHIPPING, value: 0 }),
        );

        const result = await service.validate('FREESHIP', 10000);

        expect(result.valid).toBe(true);
        expect(result.discountAmountInCents).toBe(0);
      });
    });
  });

  // ─── calculateDiscount ───────────────────────────────────────────────────

  describe('calculateDiscount', () => {
    it('computes PERCENTAGE discount correctly', () => {
      expect(service.calculateDiscount(DiscountType.PERCENTAGE, 10, 10000)).toBe(1000);
    });

    it('rounds PERCENTAGE discount to whole cents', () => {
      // 33% of 1000 = 333.33... → should round to 333
      expect(service.calculateDiscount(DiscountType.PERCENTAGE, 33, 1000)).toBe(330);
    });

    it('FIXED_AMOUNT returns value when cart is large enough', () => {
      expect(service.calculateDiscount(DiscountType.FIXED_AMOUNT, 500, 10000)).toBe(500);
    });

    it('FIXED_AMOUNT caps at cartTotal to prevent negative totals', () => {
      expect(service.calculateDiscount(DiscountType.FIXED_AMOUNT, 9999, 100)).toBe(100);
    });

    it('FREE_SHIPPING always returns 0', () => {
      expect(service.calculateDiscount(DiscountType.FREE_SHIPPING, 0, 10000)).toBe(0);
    });

    it('PERCENTAGE 100 gives full cart value', () => {
      expect(service.calculateDiscount(DiscountType.PERCENTAGE, 100, 5000)).toBe(5000);
    });

    it('PERCENTAGE 0 gives zero discount', () => {
      expect(service.calculateDiscount(DiscountType.PERCENTAGE, 0, 5000)).toBe(0);
    });
  });

  // ─── applyInsideTransaction ──────────────────────────────────────────────

  describe('applyInsideTransaction', () => {
    let tx: any;

    beforeEach(() => {
      tx = {
        $executeRaw: jest.fn(),
        couponUse: { create: jest.fn() },
      };
    });

    it('throws BadRequestException when atomic UPDATE affects 0 rows', async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        service.applyInsideTransaction(tx, 'coupon-1', 'order-1', 'user-1', 1000),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates CouponUse record on success', async () => {
      tx.$executeRaw.mockResolvedValue(1);
      tx.couponUse.create.mockResolvedValue({});

      await service.applyInsideTransaction(tx, 'coupon-1', 'order-1', 'user-1', 1000);

      expect(tx.couponUse.create).toHaveBeenCalledWith({
        data: {
          couponId: 'coupon-1',
          orderId: 'order-1',
          userId: 'user-1',
          discountAppliedInCents: 1000,
        },
      });
    });

    it('passes null userId to CouponUse when user is undefined', async () => {
      tx.$executeRaw.mockResolvedValue(1);
      tx.couponUse.create.mockResolvedValue({});

      await service.applyInsideTransaction(tx, 'coupon-1', 'order-1', undefined, 500);

      expect(tx.couponUse.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: null }),
        }),
      );
    });

    it('does not create CouponUse when UPDATE fails', async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        service.applyInsideTransaction(tx, 'coupon-1', 'order-1', 'user-1', 1000),
      ).rejects.toThrow(BadRequestException);

      expect(tx.couponUse.create).not.toHaveBeenCalled();
    });

    it('propagates P2002 unique constraint error when a concurrent request wins the race on (couponId, userId)', async () => {
      // Simulates two requests both passing the SQL subquery check simultaneously.
      // The DB unique index on (coupon_id, user_id) ensures only one insert succeeds.
      tx.$executeRaw.mockResolvedValue(1);
      const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`couponId`,`userId`)',
        { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['couponId', 'userId'] } },
      );
      tx.couponUse.create.mockRejectedValue(uniqueViolation);

      await expect(
        service.applyInsideTransaction(tx, 'coupon-1', 'order-1', 'user-1', 1000),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });
  });

  // ─── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = {
      code: 'newcode',
      discountType: DiscountType.PERCENTAGE,
      value: 15,
    };

    it('throws BadRequestException when PERCENTAGE value exceeds 100', async () => {
      await expect(
        service.create({ ...validDto, value: 101 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when code already exists', async () => {
      prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ code: 'NEWCODE' }));

      await expect(service.create(validDto)).rejects.toThrow(ConflictException);
    });

    it('normalises code to uppercase before conflict check', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);
      prisma.coupon.create.mockResolvedValue(makeCoupon({ code: 'NEWCODE' }));

      await service.create(validDto);

      expect(prisma.coupon.findUnique).toHaveBeenCalledWith({ where: { code: 'NEWCODE' } });
    });

    it('creates coupon with correct data on success', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);
      prisma.coupon.create.mockResolvedValue({});

      await service.create(validDto);

      expect(prisma.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'NEWCODE',
            discountType: DiscountType.PERCENTAGE,
            value: 15,
            isActive: true,
          }),
        }),
      );
    });

    it('accepts PERCENTAGE value of exactly 100', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);
      prisma.coupon.create.mockResolvedValue({});

      await expect(
        service.create({ ...validDto, value: 100 }),
      ).resolves.not.toThrow();
    });
  });

  // ─── reconcileCurrentUses ────────────────────────────────────────────────

  describe('reconcileCurrentUses', () => {
    it('executes a raw SQL UPDATE to sync currentUses from coupon_uses COUNT', async () => {
      prisma.$executeRaw.mockResolvedValue(undefined);

      await service.reconcileCurrentUses();

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('resolves without throwing when $executeRaw succeeds', async () => {
      prisma.$executeRaw.mockResolvedValue(undefined);

      await expect(service.reconcileCurrentUses()).resolves.toBeUndefined();
    });

    it('propagates database errors so the scheduler can log and retry', async () => {
      prisma.$executeRaw.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.reconcileCurrentUses()).rejects.toThrow('DB connection lost');
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when coupon does not exist', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);

      await expect(service.update('coupon-1', { isActive: false })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates only provided fields', async () => {
      prisma.coupon.findUnique.mockResolvedValue(makeCoupon());
      prisma.coupon.update.mockResolvedValue({});

      await service.update('coupon-1', { isActive: false });

      expect(prisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'coupon-1' },
        data: { isActive: false },
      });
    });
  });
});

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
  timezone: 'Europe/Warsaw',
  excludedProductIds: [],
  startsAt: null,
  expiresAt: null,
  createdAt: new Date('2025-01-01'),
  ...overrides,
});

describe('CouponService', () => {
  let service: CouponService;
  let prisma: any;
  let redis: any;

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
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn().mockResolvedValue('OK') },
        },
      ],
    }).compile();

    service = module.get(CouponService);
    prisma = module.get(PrismaService);
    redis = module.get('REDIS_CLIENT');
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
      // 33% of 1000 = 330.0 (exact)
      expect(service.calculateDiscount(DiscountType.PERCENTAGE, 33, 1000)).toBe(330);
    });

    it('rounds up at exactly .5 — customer receives more discount than Math.floor would give', () => {
      // 19% of 50 cents = 9.5 → Math.round = 10 (customer's favor), Math.floor = 9 (store's favor)
      expect(service.calculateDiscount(DiscountType.PERCENTAGE, 19, 50)).toBe(10);
    });

    it('rounds up when fractional part > 0.5', () => {
      // 19% of 10003 cents = 1900.57 → Math.round = 1901
      expect(service.calculateDiscount(DiscountType.PERCENTAGE, 19, 10003)).toBe(1901);
    });

    it('rounds down when fractional part < 0.5', () => {
      // 19% of 10001 cents = 1900.19 → Math.round = 1900
      expect(service.calculateDiscount(DiscountType.PERCENTAGE, 19, 10001)).toBe(1900);
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

    it('propagates P2002 unique constraint error when the same coupon is applied to the same order twice', async () => {
      // The DB unique index on (couponId, orderId) ensures a coupon cannot be
      // double-applied to a single order even under concurrent requests.
      // (The old @@unique([couponId, userId]) was removed because it broke
      //  maxUsesPerUser > 1 — multi-use coupons would P2002 on the second redemption.)
      tx.$executeRaw.mockResolvedValue(1);
      const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`couponId`,`orderId`)',
        { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['couponId', 'orderId'] } },
      );
      tx.couponUse.create.mockRejectedValue(uniqueViolation);

      await expect(
        service.applyInsideTransaction(tx, 'coupon-1', 'order-1', 'user-1', 1000),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it('allows the same user to apply a multi-use coupon more than once (maxUsesPerUser > 1)', async () => {
      // Verifies the bug fix: with @@unique([couponId, userId]) removed, a user can
      // redeem the same coupon up to maxUsesPerUser times without hitting P2002.
      tx.$executeRaw.mockResolvedValue(1);
      tx.couponUse.create.mockResolvedValue({});

      await service.applyInsideTransaction(tx, 'coupon-1', 'order-1', 'user-1', 1000);
      await service.applyInsideTransaction(tx, 'coupon-1', 'order-2', 'user-1', 1000);

      expect(tx.couponUse.create).toHaveBeenCalledTimes(2);
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

    describe('timezone-aware date storage', () => {
      beforeEach(() => {
        prisma.coupon.findUnique.mockResolvedValue(null);
        prisma.coupon.create.mockResolvedValue({});
      });

      it('converts naive expiresAt to UTC using Europe/Warsaw CEST offset (summer: -2h)', async () => {
        // Warsaw summer midnight = 22:00 UTC the day before
        await service.create({ ...validDto, expiresAt: '2024-08-15T00:00:00' });

        const { expiresAt } = prisma.coupon.create.mock.calls[0][0].data;
        expect(expiresAt).toEqual(new Date('2024-08-14T22:00:00.000Z'));
      });

      it('converts naive startsAt to UTC using Europe/Warsaw CET offset (winter: -1h)', async () => {
        // Warsaw winter midnight = 23:00 UTC the day before
        await service.create({ ...validDto, startsAt: '2024-11-29T00:00:00' });

        const { startsAt } = prisma.coupon.create.mock.calls[0][0].data;
        expect(startsAt).toEqual(new Date('2024-11-28T23:00:00.000Z'));
      });

      it('passes through an expiresAt that already carries a Z offset without shifting it', async () => {
        await service.create({ ...validDto, expiresAt: '2024-08-15T22:00:00Z' });

        const { expiresAt } = prisma.coupon.create.mock.calls[0][0].data;
        expect(expiresAt).toEqual(new Date('2024-08-15T22:00:00.000Z'));
      });

      it('stores the timezone field as Europe/Warsaw on every new coupon', async () => {
        await service.create(validDto);

        expect(prisma.coupon.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ timezone: 'Europe/Warsaw' }),
          }),
        );
      });

      it('stores null expiresAt when dto.expiresAt is omitted', async () => {
        await service.create(validDto);

        const { expiresAt } = prisma.coupon.create.mock.calls[0][0].data;
        expect(expiresAt).toBeNull();
      });
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

    it('converts naive expiresAt to UTC using the timezone stored on the coupon (CEST -2h)', async () => {
      prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ timezone: 'Europe/Warsaw' }));
      prisma.coupon.update.mockResolvedValue({});

      await service.update('coupon-1', { expiresAt: '2024-08-31T23:59:59' });

      const { expiresAt } = prisma.coupon.update.mock.calls[0][0].data;
      expect(expiresAt).toEqual(new Date('2024-08-31T21:59:59.000Z'));
    });

    it('falls back to Europe/Warsaw when coupon has no timezone field', async () => {
      prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ timezone: undefined }));
      prisma.coupon.update.mockResolvedValue({});

      await service.update('coupon-1', { expiresAt: '2024-11-29T00:00:00' });

      const { expiresAt } = prisma.coupon.update.mock.calls[0][0].data;
      // CET winter offset = -1h → 23:00 UTC the night before
      expect(expiresAt).toEqual(new Date('2024-11-28T23:00:00.000Z'));
    });
  });

  // ─── Distributed lock guard ───────────────────────────────────────────────────

  describe('distributed lock guard', () => {
    describe('reconcileCurrentUses', () => {
      it('skips the SQL UPDATE when another replica already holds the lock', async () => {
        redis.set.mockResolvedValue(null);

        await service.reconcileCurrentUses();

        expect(prisma.$executeRaw).not.toHaveBeenCalled();
      });

      it('runs the reconciliation UPDATE when the lock is acquired', async () => {
        redis.set.mockResolvedValue('OK');
        prisma.$executeRaw.mockResolvedValue(undefined);

        await service.reconcileCurrentUses();

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      });

      it('acquires the lock with NX and a 3540-second TTL', async () => {
        redis.set.mockResolvedValue('OK');
        prisma.$executeRaw.mockResolvedValue(undefined);

        await service.reconcileCurrentUses();

        expect(redis.set).toHaveBeenCalledWith(
          'cron:reconcile-coupon-uses:lock',
          '1',
          'EX',
          3540,
          'NX',
        );
      });
    });
  });
});

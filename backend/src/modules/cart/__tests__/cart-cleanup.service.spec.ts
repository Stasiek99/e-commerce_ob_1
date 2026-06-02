import { Test, TestingModule } from '@nestjs/testing';
import { CartCleanupService } from '../cart-cleanup.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CartCleanupService', () => {
  let service: CartCleanupService;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartCleanupService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            cart: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            cartItem: {
              deleteMany: jest.fn(),
            },
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn().mockResolvedValue('OK') },
        },
      ],
    }).compile();

    service = module.get(CartCleanupService);
    prisma = module.get(PrismaService);
    redis = module.get('REDIS_CLIENT');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── deleteStaleAnonymousCarts ───────────────────────────────────────────────

  describe('deleteStaleAnonymousCarts', () => {
    it('does nothing when there are no stale anonymous carts', async () => {
      prisma.cart.findMany.mockResolvedValue([]);

      await service.deleteStaleAnonymousCarts();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deletes cart items and carts in a transaction when stale carts exist', async () => {
      prisma.cart.findMany.mockResolvedValue([{ id: 'cart-1' }, { id: 'cart-2' }]);
      prisma.$transaction.mockResolvedValue([{ count: 3 }, { count: 2 }]);

      await service.deleteStaleAnonymousCarts();

      expect(prisma.$transaction).toHaveBeenCalledWith([
        prisma.cartItem.deleteMany({ where: { cartId: { in: ['cart-1', 'cart-2'] } } }),
        prisma.cart.deleteMany({ where: { id: { in: ['cart-1', 'cart-2'] } } }),
      ]);
    });

    it('queries only carts where userId is null (anonymous carts only)', async () => {
      prisma.cart.findMany.mockResolvedValue([]);

      await service.deleteStaleAnonymousCarts();

      expect(prisma.cart.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: null }),
        }),
      );
    });

    it('queries carts older than 30 days', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-06-01T03:00:00Z'));
      prisma.cart.findMany.mockResolvedValue([]);

      await service.deleteStaleAnonymousCarts();

      const call = prisma.cart.findMany.mock.calls[0][0];
      const cutoff: Date = call.where.updatedAt.lt;
      const expectedCutoff = new Date('2025-05-02T03:00:00Z');
      expect(cutoff.getTime()).toBeCloseTo(expectedCutoff.getTime(), -3);

      jest.useRealTimers();
    });
  });

  // ─── expireAuthenticatedCartItems ───────────────────────────────────────────

  describe('expireAuthenticatedCartItems', () => {
    it('skips cart lookup when another replica holds the lock', async () => {
      redis.set.mockResolvedValue(null);

      await service.expireAuthenticatedCartItems();

      expect(prisma.cart.findMany).not.toHaveBeenCalled();
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('runs cleanup when the lock is acquired', async () => {
      redis.set.mockResolvedValue('OK');
      prisma.cart.findMany.mockResolvedValue([]);

      await service.expireAuthenticatedCartItems();

      expect(prisma.cart.findMany).toHaveBeenCalledTimes(1);
    });

    it('acquires the lock with key cron:expire-auth-cart-items:lock, TTL 3540, and NX', async () => {
      redis.set.mockResolvedValue('OK');
      prisma.cart.findMany.mockResolvedValue([]);

      await service.expireAuthenticatedCartItems();

      expect(redis.set).toHaveBeenCalledWith(
        'cron:expire-auth-cart-items:lock',
        '1',
        'EX',
        3540,
        'NX',
      );
    });

    it('does not call cartItem.deleteMany when no authenticated carts exist', async () => {
      redis.set.mockResolvedValue('OK');
      prisma.cart.findMany.mockResolvedValue([]);

      await service.expireAuthenticatedCartItems();

      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('queries only carts where userId is not null (authenticated carts only)', async () => {
      redis.set.mockResolvedValue('OK');
      prisma.cart.findMany.mockResolvedValue([]);

      await service.expireAuthenticatedCartItems();

      expect(prisma.cart.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: { not: null } },
        }),
      );
    });

    it('deletes cart items older than 4 hours from authenticated carts', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-06-01T12:00:00Z'));
      redis.set.mockResolvedValue('OK');
      prisma.cart.findMany.mockResolvedValue([{ id: 'cart-a' }, { id: 'cart-b' }]);
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 3 });

      await service.expireAuthenticatedCartItems();

      const call = prisma.cartItem.deleteMany.mock.calls[0][0];
      expect(call.where.cartId).toEqual({ in: ['cart-a', 'cart-b'] });

      const cutoff: Date = call.where.updatedAt.lt;
      const expectedCutoff = new Date('2025-06-01T08:00:00Z');
      expect(cutoff.getTime()).toBeCloseTo(expectedCutoff.getTime(), -3);

      jest.useRealTimers();
    });

    it('does not delete items from anonymous carts', async () => {
      redis.set.mockResolvedValue('OK');
      // findMany returns only authenticated carts (userId != null already filtered by query)
      prisma.cart.findMany.mockResolvedValue([{ id: 'auth-cart-1' }]);
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.expireAuthenticatedCartItems();

      const call = prisma.cartItem.deleteMany.mock.calls[0][0];
      expect(call.where.cartId).toEqual({ in: ['auth-cart-1'] });
    });
  });

  // ─── @Cron timezone configuration ────────────────────────────────────────────

  describe('@Cron timezone configuration', () => {
    it('deleteStaleAnonymousCarts is configured to fire in Europe/Warsaw timezone', () => {
      const meta = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        CartCleanupService.prototype['deleteStaleAnonymousCarts'],
      );
      expect(meta?.timeZone).toBe('Europe/Warsaw');
    });

    it('expireAuthenticatedCartItems is configured to fire in Europe/Warsaw timezone', () => {
      const meta = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        CartCleanupService.prototype['expireAuthenticatedCartItems'],
      );
      expect(meta?.timeZone).toBe('Europe/Warsaw');
    });
  });

  // ─── Distributed lock guard ───────────────────────────────────────────────────

  describe('distributed lock guard', () => {
    describe('deleteStaleAnonymousCarts', () => {
      it('skips cart lookup when another replica already holds the lock', async () => {
        redis.set.mockResolvedValue(null);

        await service.deleteStaleAnonymousCarts();

        expect(prisma.cart.findMany).not.toHaveBeenCalled();
      });

      it('runs the cleanup when the lock is acquired', async () => {
        redis.set.mockResolvedValue('OK');
        prisma.cart.findMany.mockResolvedValue([]);

        await service.deleteStaleAnonymousCarts();

        expect(prisma.cart.findMany).toHaveBeenCalledTimes(1);
      });

      it('acquires the lock with NX and an 82800-second TTL', async () => {
        redis.set.mockResolvedValue('OK');
        prisma.cart.findMany.mockResolvedValue([]);

        await service.deleteStaleAnonymousCarts();

        expect(redis.set).toHaveBeenCalledWith(
          'cron:cleanup-carts:lock',
          '1',
          'EX',
          82800,
          'NX',
        );
      });
    });
  });
});

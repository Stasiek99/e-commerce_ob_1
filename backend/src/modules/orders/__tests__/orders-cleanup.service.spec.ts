import { Test, TestingModule } from '@nestjs/testing';
import { OrdersCleanupService } from '../orders-cleanup.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('OrdersCleanupService', () => {
  let service: OrdersCleanupService;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersCleanupService,
        {
          provide: PrismaService,
          useValue: {
            order: {
              updateMany: jest.fn(),
            },
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn().mockResolvedValue('OK') },
        },
      ],
    }).compile();

    service = module.get(OrdersCleanupService);
    prisma = module.get(PrismaService);
    redis = module.get('REDIS_CLIENT');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── purgeExpiredOrderRetention ──────────────────────────────────────────────

  describe('purgeExpiredOrderRetention', () => {
    it('skips DB update when another replica holds the lock', async () => {
      redis.set.mockResolvedValue(null);

      await service.purgeExpiredOrderRetention();

      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('runs the anonymisation when the lock is acquired', async () => {
      redis.set.mockResolvedValue('OK');
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await service.purgeExpiredOrderRetention();

      expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
    });

    it('filters only orders where retentionExpiresAt is in the past', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2031-01-01T03:00:00Z'));
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await service.purgeExpiredOrderRetention();

      const call = prisma.order.updateMany.mock.calls[0][0];
      const cutoff: Date = call.where.retentionExpiresAt.lt;
      expect(cutoff.getTime()).toBe(new Date('2031-01-01T03:00:00Z').getTime());

      jest.useRealTimers();
    });

    it('skips orders already anonymised by deleteAccount (sentinel suffix @deleted.invalid)', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await service.purgeExpiredOrderRetention();

      const call = prisma.order.updateMany.mock.calls[0][0];
      expect(call.where.snapshotEmail).toEqual({ not: { endsWith: '@deleted.invalid' } });
    });

    it('writes the correct PII sentinel values', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 3 });

      await service.purgeExpiredOrderRetention();

      const call = prisma.order.updateMany.mock.calls[0][0];
      expect(call.data).toMatchObject({
        snapshotFirstName: '[usunięto]',
        snapshotLastName:  '[usunięto]',
        snapshotEmail:     'retention-expired@deleted.invalid',
        snapshotPhone:     '',
        snapshotNip:       null,
      });
    });

    it('uses a distinct sentinel email that differs from deleteAccount to allow filtering by origin', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await service.purgeExpiredOrderRetention();

      const call = prisma.order.updateMany.mock.calls[0][0];
      expect(call.data.snapshotEmail).toBe('retention-expired@deleted.invalid');
      expect(call.data.snapshotEmail).not.toMatch(/^deleted\+/);
    });
  });

  // ─── Distributed lock guard ───────────────────────────────────────────────────

  describe('distributed lock guard', () => {
    it('acquires the lock with key cron:purge-order-retention:lock, TTL 82800, NX', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await service.purgeExpiredOrderRetention();

      expect(redis.set).toHaveBeenCalledWith(
        'cron:purge-order-retention:lock',
        '1',
        'EX',
        82800,
        'NX',
      );
    });

    it('does not call order.updateMany when the lock is not acquired', async () => {
      redis.set.mockResolvedValue(null);

      await service.purgeExpiredOrderRetention();

      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── @Cron metadata ───────────────────────────────────────────────────────────

  describe('@Cron metadata', () => {
    it('purgeExpiredOrderRetention fires in Europe/Warsaw timezone', () => {
      const meta = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        OrdersCleanupService.prototype['purgeExpiredOrderRetention'],
      );
      expect(meta?.timeZone).toBe('Europe/Warsaw');
    });

    it('purgeExpiredOrderRetention is scheduled for January 1st at 03:00 (0 3 1 1 *)', () => {
      const meta = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        OrdersCleanupService.prototype['purgeExpiredOrderRetention'],
      );
      expect(meta?.cronTime).toBe('0 3 1 1 *');
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { DataRetentionCleanupService } from '../data-retention-cleanup.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DataRetentionCleanupService', () => {
  let service: DataRetentionCleanupService;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionCleanupService,
        {
          provide: PrismaService,
          useValue: {
            outboxMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
            emailLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn().mockResolvedValue('OK') },
        },
      ],
    }).compile();

    service = module.get(DataRetentionCleanupService);
    prisma = module.get(PrismaService);
    redis = module.get('REDIS_CLIENT');
  });

  afterEach(() => jest.clearAllMocks());

  // ─── distributed lock guard ──────────────────────────────────────────────

  it('skips purge entirely when another replica already holds the lock', async () => {
    redis.set.mockResolvedValue(null);

    await service.purgeStaleOperationalLogs();

    expect(prisma.outboxMessage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.emailLog.deleteMany).not.toHaveBeenCalled();
  });

  it('acquires the lock with a TTL under 24h so a missed run can retry within the same calendar day', async () => {
    redis.set.mockResolvedValue('OK');

    await service.purgeStaleOperationalLogs();

    expect(redis.set).toHaveBeenCalledWith(
      'cron:purge-operational-logs:lock',
      '1',
      'EX',
      82000,
      'NX',
    );
  });

  // ─── outboxMessage retention ─────────────────────────────────────────────

  it('deletes only PROCESSED outbox messages older than 90 days', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-16T00:00:00Z'));
    redis.set.mockResolvedValue('OK');

    await service.purgeStaleOperationalLogs();

    expect(prisma.outboxMessage.deleteMany).toHaveBeenCalledWith({
      where: { status: 'PROCESSED', processedAt: { lt: new Date('2026-03-18T00:00:00Z') } },
    });

    jest.useRealTimers();
  });

  // ─── emailLog retention ──────────────────────────────────────────────────

  it('deletes email logs older than 1 year', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-16T00:00:00Z'));
    redis.set.mockResolvedValue('OK');

    await service.purgeStaleOperationalLogs();

    expect(prisma.emailLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2025-06-16T00:00:00Z') } },
    });

    jest.useRealTimers();
  });

  it('resolves without error when nothing is purged', async () => {
    redis.set.mockResolvedValue('OK');
    prisma.outboxMessage.deleteMany.mockResolvedValue({ count: 0 });
    prisma.emailLog.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.purgeStaleOperationalLogs()).resolves.not.toThrow();
  });

  it('resolves without error when rows are purged from both tables', async () => {
    redis.set.mockResolvedValue('OK');
    prisma.outboxMessage.deleteMany.mockResolvedValue({ count: 12 });
    prisma.emailLog.deleteMany.mockResolvedValue({ count: 7 });

    await expect(service.purgeStaleOperationalLogs()).resolves.not.toThrow();
  });

  // ─── @Cron timezone configuration ────────────────────────────────────────

  it('purgeStaleOperationalLogs is configured to fire in Europe/Warsaw timezone', () => {
    const meta = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      DataRetentionCleanupService.prototype['purgeStaleOperationalLogs'],
    );
    expect(meta?.timeZone).toBe('Europe/Warsaw');
  });
});

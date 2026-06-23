import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DataRetentionCleanupService } from '../data-retention-cleanup.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DataRetentionCleanupService', () => {
  let service: DataRetentionCleanupService;
  let prisma: any;
  let redis: any;
  let dlq: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionCleanupService,
        {
          provide: PrismaService,
          useValue: {
            outboxMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
            emailLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
            consentLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
            user: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn().mockResolvedValue('OK') },
        },
        {
          provide: getQueueToken('email-dlq'),
          useValue: { clean: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    service = module.get(DataRetentionCleanupService);
    prisma = module.get(PrismaService);
    redis = module.get('REDIS_CLIENT');
    dlq = module.get(getQueueToken('email-dlq'));
  });

  afterEach(() => jest.clearAllMocks());

  // ─── distributed lock guard ──────────────────────────────────────────────

  it('skips purge entirely when another replica already holds the lock', async () => {
    redis.set.mockResolvedValue(null);

    await service.purgeStaleOperationalLogs();

    expect(prisma.outboxMessage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.emailLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.consentLog.deleteMany).not.toHaveBeenCalled();
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

  it('deletes both PROCESSED and FAILED outbox messages older than 90 days', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-16T00:00:00Z'));
    redis.set.mockResolvedValue('OK');

    await service.purgeStaleOperationalLogs();

    expect(prisma.outboxMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PROCESSED', 'FAILED'] },
        processedAt: { lt: new Date('2026-03-18T00:00:00Z') },
      },
    });

    jest.useRealTimers();
  });

  // ─── email-dlq retention ──────────────────────────────────────────────────

  it('cleans email-dlq jobs older than 90 days from the wait state', async () => {
    redis.set.mockResolvedValue('OK');

    await service.purgeStaleOperationalLogs();

    expect(dlq.clean).toHaveBeenCalledWith(90 * 24 * 60 * 60 * 1000, 0, 'wait');
  });

  it('does not clean email-dlq jobs when another replica holds the lock', async () => {
    redis.set.mockResolvedValue(null);

    await service.purgeStaleOperationalLogs();

    expect(dlq.clean).not.toHaveBeenCalled();
  });

  it('resolves without error when no email-dlq jobs are old enough to remove', async () => {
    redis.set.mockResolvedValue('OK');
    dlq.clean.mockResolvedValue([]);

    await expect(service.purgeStaleOperationalLogs()).resolves.not.toThrow();
  });

  it('resolves without error when email-dlq jobs are removed', async () => {
    redis.set.mockResolvedValue('OK');
    dlq.clean.mockResolvedValue(['job-1', 'job-2']);

    await expect(service.purgeStaleOperationalLogs()).resolves.not.toThrow();
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

  it('queries only currently-bounced users before deciding what to exclude', async () => {
    redis.set.mockResolvedValue('OK');

    await service.purgeStaleOperationalLogs();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { emailBounced: true },
      select: { email: true },
    });
  });

  it('excludes email logs for addresses with an active emailBounced flag, regardless of age', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-16T00:00:00Z'));
    redis.set.mockResolvedValue('OK');
    prisma.user.findMany.mockResolvedValue([{ email: 'bounced@example.com' }, { email: 'also-bounced@example.com' }]);

    await service.purgeStaleOperationalLogs();

    expect(prisma.emailLog.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date('2025-06-16T00:00:00Z') },
        to: { notIn: ['bounced@example.com', 'also-bounced@example.com'] },
      },
    });

    jest.useRealTimers();
  });

  it('does not add a to/notIn filter when no users are currently bounced', async () => {
    redis.set.mockResolvedValue('OK');
    prisma.user.findMany.mockResolvedValue([]);

    await service.purgeStaleOperationalLogs();

    const call = prisma.emailLog.deleteMany.mock.calls[0][0];
    expect(call.where.to).toBeUndefined();
  });

  it('resolves without error when nothing is purged', async () => {
    redis.set.mockResolvedValue('OK');
    prisma.outboxMessage.deleteMany.mockResolvedValue({ count: 0 });
    prisma.emailLog.deleteMany.mockResolvedValue({ count: 0 });
    prisma.consentLog.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.purgeStaleOperationalLogs()).resolves.not.toThrow();
  });

  it('resolves without error when rows are purged from all tables', async () => {
    redis.set.mockResolvedValue('OK');
    prisma.outboxMessage.deleteMany.mockResolvedValue({ count: 12 });
    prisma.emailLog.deleteMany.mockResolvedValue({ count: 7 });
    prisma.consentLog.deleteMany.mockResolvedValue({ count: 3 });

    await expect(service.purgeStaleOperationalLogs()).resolves.not.toThrow();
  });

  // ─── consentLog retention ────────────────────────────────────────────────

  it('deletes consent logs whose expiresAt has passed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-16T00:00:00Z'));
    redis.set.mockResolvedValue('OK');

    await service.purgeStaleOperationalLogs();

    expect(prisma.consentLog.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date('2026-06-16T00:00:00Z') } },
    });

    jest.useRealTimers();
  });

  it('does not delete consent logs that have not yet expired', async () => {
    redis.set.mockResolvedValue('OK');
    prisma.consentLog.deleteMany.mockResolvedValue({ count: 0 });

    await service.purgeStaleOperationalLogs();

    const call = prisma.consentLog.deleteMany.mock.calls[0][0];
    expect(call.where.expiresAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
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

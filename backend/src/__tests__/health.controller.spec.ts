import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { HealthController } from '../health.controller';
import { PrismaService } from '../modules/prisma/prisma.service';

const mockPrisma = {
  $queryRaw: jest.fn(),
};

const mockRedis = {
  ping: jest.fn(),
  get: jest.fn(),
};

const mockEmailQueue = {
  getJobCounts: jest.fn(),
};

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: getQueueToken('email'), useValue: mockEmailQueue },
      ],
    }).compile();

    controller = module.get(HealthController);
    jest.clearAllMocks();
    // Default: no reconciliation has run yet
    mockRedis.get.mockResolvedValue(null);
  });

  describe('GET /health', () => {
    describe('when DB and Redis are healthy', () => {
      it('returns status ok with all checks connected and queue depths', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{}]);
        mockRedis.ping.mockResolvedValue('PONG');
        mockEmailQueue.getJobCounts.mockResolvedValue({ waiting: 2, failed: 1 });

        const result = await controller.check();

        expect(result).toMatchObject({
          status: 'ok',
          db: 'connected',
          redis: 'connected',
          queue: { waiting: 2, failed: 1 },
        });
        expect(typeof result.timestamp).toBe('string');
      });

      it('returns status ok even when queue has a non-zero backlog', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{}]);
        mockRedis.ping.mockResolvedValue('PONG');
        mockEmailQueue.getJobCounts.mockResolvedValue({ waiting: 500, failed: 42 });

        const result = await controller.check();

        expect(result.status).toBe('ok');
        expect(result.queue).toEqual({ waiting: 500, failed: 42 });
      });

      it('defaults missing queue fields to 0', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{}]);
        mockRedis.ping.mockResolvedValue('PONG');
        // BullMQ may omit fields for count types with 0 jobs
        mockEmailQueue.getJobCounts.mockResolvedValue({});

        const result = await controller.check();

        expect(result.queue).toEqual({ waiting: 0, failed: 0 });
      });
    });

    describe('when Redis is unreachable', () => {
      it('throws 503 HttpException with degraded status and redis disconnected', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{}]);
        mockRedis.ping.mockRejectedValue(new Error('Redis ECONNREFUSED'));
        mockEmailQueue.getJobCounts.mockResolvedValue({ waiting: 0, failed: 0 });

        const thrown = await controller.check().catch((e) => e);

        expect(thrown).toBeInstanceOf(HttpException);
        expect(thrown.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(thrown.getResponse()).toMatchObject({
          status: 'degraded',
          redis: 'disconnected',
          db: 'connected',
        });
      });

      it('throws 503 with sentinel -1 queue depths when the queue is also unreachable', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{}]);
        mockRedis.ping.mockRejectedValue(new Error('Redis ECONNREFUSED'));
        mockEmailQueue.getJobCounts.mockRejectedValue(new Error('Redis ECONNREFUSED'));

        const thrown = await controller.check().catch((e) => e);

        expect(thrown).toBeInstanceOf(HttpException);
        expect(thrown.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect((thrown.getResponse() as Record<string, unknown>).queue).toEqual({
          waiting: -1,
          failed: -1,
        });
      });
    });

    describe('when the database is unreachable', () => {
      it('throws 503 HttpException with degraded status and db disconnected', async () => {
        mockPrisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED 5432'));
        mockRedis.ping.mockResolvedValue('PONG');
        mockEmailQueue.getJobCounts.mockResolvedValue({ waiting: 0, failed: 0 });

        const thrown = await controller.check().catch((e) => e);

        expect(thrown).toBeInstanceOf(HttpException);
        expect(thrown.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(thrown.getResponse()).toMatchObject({
          status: 'degraded',
          db: 'disconnected',
          redis: 'connected',
        });
      });
    });

    describe('when both DB and Redis are unreachable', () => {
      it('throws 503 HttpException with degraded status and both checks disconnected', async () => {
        mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'));
        mockRedis.ping.mockRejectedValue(new Error('Redis down'));
        mockEmailQueue.getJobCounts.mockRejectedValue(new Error('Redis down'));

        const thrown = await controller.check().catch((e) => e);

        expect(thrown).toBeInstanceOf(HttpException);
        expect(thrown.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(thrown.getResponse()).toMatchObject({
          status: 'degraded',
          db: 'disconnected',
          redis: 'disconnected',
        });
        expect((thrown.getResponse() as Record<string, unknown>).queue).toEqual({
          waiting: -1,
          failed: -1,
        });
      });
    });
  });

  describe('GET /health — lastReconcileAt cron liveness field', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockResolvedValue([{}]);
      mockRedis.ping.mockResolvedValue('PONG');
      mockEmailQueue.getJobCounts.mockResolvedValue({ waiting: 0, failed: 0 });
    });

    it('returns lastReconcileAt: null when the reconciliation cron has never fired', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await controller.check();

      expect(result.lastReconcileAt).toBeNull();
    });

    it('returns the ISO timestamp stored by reconcilePendingPayments when the cron has run', async () => {
      const ts = '2026-06-08T10:00:00.000Z';
      mockRedis.get.mockResolvedValue(ts);

      const result = await controller.check();

      expect(result.lastReconcileAt).toBe(ts);
    });

    it('returns lastReconcileAt: null and does not throw when Redis.get rejects', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis timeout'));

      const result = await controller.check();

      expect(result.lastReconcileAt).toBeNull();
      expect(result.status).toBe('ok');
    });
  });

  describe('GET /health/debug-sentry', () => {
    const savedSecret = process.env.DEBUG_SENTRY_SECRET;

    afterEach(() => {
      if (savedSecret === undefined) {
        delete process.env.DEBUG_SENTRY_SECRET;
      } else {
        process.env.DEBUG_SENTRY_SECRET = savedSecret;
      }
    });

    it('throws UnauthorizedException when DEBUG_SENTRY_SECRET is not set', () => {
      delete process.env.DEBUG_SENTRY_SECRET;

      expect(() => controller.debugSentry('anything')).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the provided secret does not match', () => {
      process.env.DEBUG_SENTRY_SECRET = 'correct-secret';

      expect(() => controller.debugSentry('wrong-secret')).toThrow(UnauthorizedException);
    });

    it('throws a Sentry test Error when the correct secret is supplied', () => {
      process.env.DEBUG_SENTRY_SECRET = 'correct-secret';

      expect(() => controller.debugSentry('correct-secret')).toThrow(
        'Sentry backend test — intentional error',
      );
    });
  });
});

import { Controller, Get, HttpException, HttpStatus, Inject, Query, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { PrismaService } from './modules/prisma/prisma.service';

@SkipThrottle({ burst: true, sustained: true, 'coupon-anon': true, 'coupon-auth': true })
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  @Get('debug-sentry')
  debugSentry(@Query('secret') secret: string) {
    const expected = process.env.DEBUG_SENTRY_SECRET;
    if (!expected || secret !== expected) throw new UnauthorizedException();
    throw new Error('Sentry backend test — intentional error');
  }

  @Get()
  async check() {
    const [db, redis, queue, lastReconcileAt] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkEmailQueue(),
      Promise.race([
        this.redis.get('cron:reconcile-payments:lastRun').catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
      ]),
    ]);

    const healthy = db === 'connected' && redis === 'connected';
    const body = {
      status: healthy ? 'ok' : 'degraded',
      db,
      redis,
      queue,
      lastReconcileAt: lastReconcileAt ?? null,
      timestamp: new Date().toISOString(),
    };

    if (!healthy) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }

  private async checkDb(): Promise<'connected' | 'disconnected'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('db health timeout')), 5_000);
      });
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, deadline]);
      return 'connected';
    } catch {
      return 'disconnected';
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkRedis(): Promise<'connected' | 'disconnected'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('redis health timeout')), 3_000);
      });
      await Promise.race([this.redis.ping(), deadline]);
      return 'connected';
    } catch {
      return 'disconnected';
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkEmailQueue(): Promise<{ waiting: number; failed: number }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('queue health timeout')), 3_000);
      });
      const counts = await Promise.race([
        this.emailQueue.getJobCounts('waiting', 'failed'),
        deadline,
      ]);
      return { waiting: counts.waiting ?? 0, failed: counts.failed ?? 0 };
    } catch {
      return { waiting: -1, failed: -1 };
    } finally {
      clearTimeout(timer);
    }
  }
}

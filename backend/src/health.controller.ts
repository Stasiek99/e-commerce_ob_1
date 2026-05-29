import { Controller, Get, Inject, Query, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { PrismaService } from './modules/prisma/prisma.service';

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
    const [db, redis, queue] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkEmailQueue(),
    ]);

    const status = db === 'connected' && redis === 'connected' ? 'ok' : 'error';
    return { status, db, redis, queue, timestamp: new Date().toISOString() };
  }

  private async checkDb(): Promise<'connected' | 'disconnected'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }

  private async checkRedis(): Promise<'connected' | 'disconnected'> {
    try {
      await this.redis.ping();
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }

  private async checkEmailQueue(): Promise<{ waiting: number; failed: number }> {
    try {
      const counts = await this.emailQueue.getJobCounts('waiting', 'failed');
      return { waiting: counts.waiting ?? 0, failed: counts.failed ?? 0 };
    } catch {
      return { waiting: -1, failed: -1 };
    }
  }
}

import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { PrismaService } from './modules/prisma/prisma.service';

@Controller('health')
export class HealthController {
  private readonly redis: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.redis = new IORedis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      { maxRetriesPerRequest: 0, connectTimeout: 3_000, enableOfflineQueue: false },
    );
  }

  @Get('debug-sentry')
  debugSentry(@Query('secret') secret: string) {
    const expected = process.env.DEBUG_SENTRY_SECRET;
    if (!expected || secret !== expected) throw new UnauthorizedException();
    throw new Error('Sentry backend test — intentional error');
  }

  @Get()
  async check() {
    const [dbStatus, redisStatus] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
    ]);
    const healthy = dbStatus === 'connected' && redisStatus === 'connected';
    return {
      status: healthy ? 'ok' : 'error',
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
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
}

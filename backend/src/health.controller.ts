import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from './modules/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('debug-sentry')
  debugSentry(@Query('secret') secret: string) {
    const expected = process.env.DEBUG_SENTRY_SECRET;
    if (!expected || secret !== expected) throw new UnauthorizedException();
    throw new Error('Sentry backend test — intentional error');
  }

  @Get()
  async check() {
    const db = await this.checkDb();
    return {
      status: db === 'connected' ? 'ok' : 'error',
      db,
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
}

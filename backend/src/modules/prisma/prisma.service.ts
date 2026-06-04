import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const poolSize = config.get<number>('DATABASE_CONNECTION_LIMIT', 10);
    const rawUrl = config.getOrThrow<string>('DATABASE_URL');
    const url = new URL(rawUrl);
    url.searchParams.set('connection_limit', String(poolSize));
    super({ datasourceUrl: url.toString() });
    this.logger.log(`Prisma pool: ${poolSize} connections/instance`);
  }

  async onModuleInit() {
    const maxAttempts = 6;
    const baseDelayMs = 3_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        await this.$queryRaw`SELECT 1`;
        this.logger.log('Database connected');
        return;
      } catch (err) {
        if (attempt === maxAttempts) {
          this.logger.error('Database unreachable after all retries — giving up');
          throw err;
        }
        const delay = baseDelayMs * 2 ** (attempt - 1); // 3s, 6s, 12s, 24s, 48s
        this.logger.warn(
          `Database unreachable (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms…`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

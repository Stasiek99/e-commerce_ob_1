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
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

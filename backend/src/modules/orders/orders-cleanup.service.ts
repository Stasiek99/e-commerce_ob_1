import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersCleanupService {
  private readonly logger = new Logger(OrdersCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  // Runs on January 1st at 03:00 Warsaw time — after the previous year's
  // retentionExpiresAt (Dec 31, year Y+5) has elapsed for any order created
  // in year Y. Ustawa o rachunkowości Art. 74 + GDPR Art. 5(1)(e).
  @Cron('0 3 1 1 *', { timeZone: 'Europe/Warsaw' })
  async purgeExpiredOrderRetention(): Promise<void> {
    const acquired = await this.redis.set('cron:purge-order-retention:lock', '1', 'EX', 82800, 'NX');
    if (!acquired) return;

    const now = new Date();

    const { count } = await this.prisma.order.updateMany({
      where: {
        retentionExpiresAt: { lt: now },
        // Skip orders already anonymized by deleteAccount (sentinel suffix).
        snapshotEmail: { not: { endsWith: '@deleted.invalid' } },
      },
      data: {
        snapshotFirstName: '[usunięto]',
        snapshotLastName:  '[usunięto]',
        snapshotEmail:     'retention-expired@deleted.invalid',
        snapshotPhone:     '',
        snapshotNip:       null,
      },
    });

    if (count > 0) {
      this.logger.log(`Retention purge: anonymised PII on ${count} order(s) past 5-year accounting window`);
    } else {
      this.logger.debug('Retention purge: no expired orders found');
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

const OUTBOX_RETENTION_DAYS = 90;
const EMAIL_LOG_RETENTION_DAYS = 365;

// GDPR Art. 5(1)(e) storage limitation: email_logs and outbox_messages hold
// customer PII (addresses, names, order snapshots) with no prior expiry.
@Injectable()
export class DataRetentionCleanupService {
  private readonly logger = new Logger(DataRetentionCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  @Cron(CronExpression.EVERY_WEEK, { timeZone: 'Europe/Warsaw' })
  async purgeStaleOperationalLogs(): Promise<void> {
    const acquired = await this.redis.set('cron:purge-operational-logs:lock', '1', 'EX', 82000, 'NX');
    if (!acquired) return;

    const outboxCutoff = new Date(Date.now() - OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count: outboxCount } = await this.prisma.outboxMessage.deleteMany({
      where: { status: 'PROCESSED', processedAt: { lt: outboxCutoff } },
    });
    if (outboxCount > 0) {
      this.logger.log(`Retention purge: deleted ${outboxCount} processed outbox message(s) older than ${OUTBOX_RETENTION_DAYS} days`);
    }

    const emailLogCutoff = new Date(Date.now() - EMAIL_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count: emailLogCount } = await this.prisma.emailLog.deleteMany({
      where: { createdAt: { lt: emailLogCutoff } },
    });
    if (emailLogCount > 0) {
      this.logger.log(`Retention purge: deleted ${emailLogCount} email log(s) older than ${EMAIL_LOG_RETENTION_DAYS} days`);
    }

    const { count: consentLogCount } = await this.prisma.consentLog.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (consentLogCount > 0) {
      this.logger.log(`Retention purge: deleted ${consentLogCount} expired consent log(s)`);
    }
  }
}

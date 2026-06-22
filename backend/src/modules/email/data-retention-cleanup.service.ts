import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

const OUTBOX_RETENTION_DAYS = 90;
const EMAIL_LOG_RETENTION_DAYS = 365;
const DLQ_RETENTION_DAYS = 90;

// GDPR Art. 5(1)(e) storage limitation: email_logs and outbox_messages hold
// customer PII (addresses, names, order snapshots) with no prior expiry.
@Injectable()
export class DataRetentionCleanupService {
  private readonly logger = new Logger(DataRetentionCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
    @InjectQueue('email-dlq') private readonly dlq: Queue,
  ) {}

  @Cron(CronExpression.EVERY_WEEK, { timeZone: 'Europe/Warsaw' })
  async purgeStaleOperationalLogs(): Promise<void> {
    const acquired = await this.redis.set('cron:purge-operational-logs:lock', '1', 'EX', 82000, 'NX');
    if (!acquired) return;

    const outboxCutoff = new Date(Date.now() - OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count: outboxCount } = await this.prisma.outboxMessage.deleteMany({
      where: { status: { in: ['PROCESSED', 'FAILED'] }, processedAt: { lt: outboxCutoff } },
    });
    if (outboxCount > 0) {
      this.logger.log(`Retention purge: deleted ${outboxCount} processed/failed outbox message(s) older than ${OUTBOX_RETENTION_DAYS} days`);
    }

    // email-dlq jobs are kept indefinitely by design (removeOnFail: false) so a
    // human can inspect a permanently-failed send — but that means nothing else
    // bounds their retention. Sweep them here too, on the same GDPR-motivated cron.
    const dlqRemovedIds = await this.dlq.clean(DLQ_RETENTION_DAYS * 24 * 60 * 60 * 1000, 0, 'wait');
    if (dlqRemovedIds.length > 0) {
      this.logger.log(`Retention purge: removed ${dlqRemovedIds.length} email-dlq job(s) older than ${DLQ_RETENTION_DAYS} days`);
    }

    // Preserve the audit trail for still-bounced addresses: deleting these
    // EmailLog rows would destroy the only evidence of *why* transactional
    // emails were suppressed, while the emailBounced flag itself can persist
    // far longer than the 365-day log retention window.
    const bouncedUsers = await this.prisma.user.findMany({
      where: { emailBounced: true },
      select: { email: true },
    });
    const bouncedEmails = bouncedUsers.map((u) => u.email);

    const emailLogCutoff = new Date(Date.now() - EMAIL_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count: emailLogCount } = await this.prisma.emailLog.deleteMany({
      where: {
        createdAt: { lt: emailLogCutoff },
        ...(bouncedEmails.length > 0 && { to: { notIn: bouncedEmails } }),
      },
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

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { InvoiceService } from '../invoice/invoice.service';

const MAX_RETRIES = 3;
// Only attempt recovery for messages older than 30s — the in-process fast path
// (dispatchPostPaymentNotifications) needs time to complete and mark PROCESSED.
const RECOVERY_DELAY_MS = 30_000;
// Slightly under the 30s @Interval period so the lock self-clears before the
// next tick on a normal run, while still preventing overlapping replicas.
const LOCK_TTL_SECONDS = 25;

@Injectable()
export class OutboxProcessorService {
  private readonly logger = new Logger(OutboxProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailQueueService: EmailQueueService,
    private readonly invoiceService: InvoiceService,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  @Interval(30_000)
  async recoverPendingMessages(): Promise<void> {
    const acquired = await this.redis.set(
      'cron:outbox-recovery:lock',
      '1',
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (!acquired) return;

    const cutoff = new Date(Date.now() - RECOVERY_DELAY_MS);
    const messages = await this.prisma.outboxMessage.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lte: cutoff },
        retries: { lt: MAX_RETRIES },
      },
      take: 10,
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length === 0) return;

    this.logger.warn(`Outbox recovery: found ${messages.length} pending message(s)`);

    for (const msg of messages) {
      if (msg.type === 'POST_PAYMENT_NOTIFICATIONS') {
        await this.processPostPaymentNotifications(
          msg as { id: string; orderId: string | null; retries: number },
        );
      }
    }
  }

  private async processPostPaymentNotifications(msg: {
    id: string;
    orderId: string | null;
    retries: number;
  }): Promise<void> {
    if (!msg.orderId) {
      await this.prisma.outboxMessage.update({
        where: { id: msg.id },
        data: { status: 'FAILED', lastError: 'Missing orderId in outbox message' },
      });
      return;
    }

    try {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: msg.orderId },
        include: { items: true },
      });

      const adminEmail =
        this.configService.get<string>('ADMIN_ALERT_EMAIL') ||
        this.configService.get<string>('EMAIL_FROM');
      if (adminEmail) {
        const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
        await this.emailQueueService.sendNewOrderNotification({
          to: adminEmail,
          orderNumber: order.orderNumber,
          customerEmail: order.snapshotEmail,
          totalInCents: order.totalInCents,
          items: order.items.map((i) => ({
            name: i.snapshotName,
            quantity: i.quantity,
            price: i.snapshotPrice,
          })),
          carrierCode: String(order.carrierCode),
          adminUrl: frontendUrl ? `${frontendUrl}/admin/orders/${order.id}` : undefined,
        });
      }

      try {
        const { storagePath } = await this.invoiceService.processInvoice(order);
        await this.emailQueueService.sendPaymentConfirmedWithInvoice({
          to: order.snapshotEmail,
          orderNumber: order.orderNumber,
          firstName: order.snapshotFirstName,
          items: order.items.map((i) => ({
            name: i.snapshotName,
            quantity: i.quantity,
            price: i.snapshotPrice,
          })),
          shippingCostInCents: order.shippingCostInCents,
          totalInCents: order.totalInCents,
          invoiceStoragePath: storagePath,
        });
      } catch (invoiceErr) {
        this.logger.warn(
          `Outbox: invoice generation failed for order ${order.orderNumber}, sending plain confirmation: ${(invoiceErr as Error).message}`,
        );
        await this.emailQueueService.sendPaymentConfirmed({
          to: order.snapshotEmail,
          orderNumber: order.orderNumber,
          firstName: order.snapshotFirstName,
          totalInCents: order.totalInCents,
        });
      }

      await this.prisma.outboxMessage.update({
        where: { id: msg.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });

      this.logger.log(`Outbox: successfully recovered message ${msg.id} for order ${msg.orderId}`);
    } catch (err) {
      const newRetries = msg.retries + 1;
      this.logger.error(
        `Outbox: failed to process message ${msg.id} (attempt ${newRetries}/${MAX_RETRIES}): ${(err as Error).message}`,
      );
      Sentry.withScope((scope) => {
        scope.setTag('outbox.message_id', msg.id);
        scope.setTag('outbox.order_id', msg.orderId ?? 'unknown');
        Sentry.captureException(err);
      });
      await this.prisma.outboxMessage.update({
        where: { id: msg.id },
        data: {
          retries: { increment: 1 },
          lastError: (err as Error).message,
          ...(newRetries >= MAX_RETRIES ? { status: 'FAILED' } : {}),
        },
      });
    }
  }
}

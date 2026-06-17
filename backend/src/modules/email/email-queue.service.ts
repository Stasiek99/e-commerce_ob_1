import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailJobData } from './email-queue.types';
import { PrismaService } from '../prisma/prisma.service';

const JOB_OPTIONS = {
  attempts: 12,
  // Exponential: 5s → 10s → 20s → … → ~43min per attempt.
  // 12 attempts cover a ~2-hour outage window before the job is declared dead.
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: false,
} as const;

// UoK Art. 21 requires order confirmation on a durable medium — these must reach
// the customer even on a soft (transient) bounce, since the mailbox is still live.
// A hard (permanent) bounce means the mailbox no longer exists, so there is no
// channel left to deliver on — suppression applies regardless of email type.
const TRANSACTIONAL_ORDER_EMAIL_TYPES = new Set<EmailJobData['type']>([
  'order_confirmation',
  'payment_confirmed',
  'payment_confirmed_with_invoice',
  'order_cancellation',
  'shipping_notification',
  'order_acknowledged',
]);

const BOUNCE_AUTO_RESET_MS = 30 * 24 * 60 * 60 * 1000;

type Payload<T extends EmailJobData['type']> = Extract<EmailJobData, { type: T }>['payload'];

@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(
    @InjectQueue('email') private readonly queue: Queue<EmailJobData>,
    private readonly prisma: PrismaService,
  ) {}

  private deriveJobId(name: string, data: EmailJobData): string | undefined {
    const p = data.payload as Record<string, unknown>;
    if (typeof p['requestId'] === 'string') {
      // Return events: include newStatus so each state transition gets its own key
      const suffix = typeof p['newStatus'] === 'string' ? `-${p['newStatus']}` : '';
      return `${name}-${p['requestId']}${suffix}`;
    }
    if (typeof p['orderNumber'] === 'string') {
      return `${name}-${p['orderNumber']}`;
    }
    if (typeof p['wishlistItemId'] === 'string') {
      return `${name}-${p['wishlistItemId']}`;
    }
    return undefined;
  }

  private async enqueue(name: string, data: EmailJobData): Promise<void> {
    const to = (data.payload as Record<string, unknown>).to as string | undefined;
    if (to) {
      const user = await this.prisma.user.findFirst({
        where: { email: to },
        select: { emailBounced: true, emailBouncedAt: true, emailBouncedType: true, emailComplained: true },
      });
      if (user?.emailBounced) {
        const bounceIsStale =
          !!user.emailBouncedAt && Date.now() - user.emailBouncedAt.getTime() > BOUNCE_AUTO_RESET_MS;
        const isSoftBounce = user.emailBouncedType === 'Transient';
        if (bounceIsStale) {
          await this.prisma.user.updateMany({
            where: { email: to },
            data: { emailBounced: false, emailBouncedAt: null, emailBouncedReason: null, emailBouncedType: null },
          });
          this.logger.log(`Bounce flag auto-reset for ${to} after 30 days — retrying delivery`);
        } else if (TRANSACTIONAL_ORDER_EMAIL_TYPES.has(data.type) && isSoftBounce) {
          this.logger.warn(
            `Email job "${name}" sent despite soft bounce on record — transactional order email required by law (${to})`,
          );
        } else {
          this.logger.warn(
            `Email job "${name}" suppressed — ${to} has a${isSoftBounce ? ' soft' : ' hard'} bounce on record`,
          );
          return;
        }
      }
      if (user?.emailComplained) {
        this.logger.warn(`Email job "${name}" suppressed — ${to} has filed a spam complaint`);
        return;
      }
    }
    try {
      const jobId = this.deriveJobId(name, data);
      await this.queue.add(name, data, { ...JOB_OPTIONS, ...(jobId && { jobId }) });
    } catch (err: unknown) {
      this.logger.warn(`Email job "${name}" not queued: ${(err as Error).message}`);
      throw err;
    }
  }

  sendEmailVerification(data: Payload<'email_verification'>) {
    return this.enqueue('email_verification', { type: 'email_verification', payload: data });
  }

  sendPasswordReset(data: Payload<'password_reset'>) {
    return this.enqueue('password_reset', { type: 'password_reset', payload: data });
  }

  sendEmailChangeVerification(data: Payload<'email_change'>) {
    return this.enqueue('email_change', { type: 'email_change', payload: data });
  }

  sendMagicLink(data: Payload<'magic_link_login'>) {
    return this.enqueue('magic_link_login', { type: 'magic_link_login', payload: data });
  }

  sendOrderConfirmation(data: Payload<'order_confirmation'>) {
    return this.enqueue('order_confirmation', { type: 'order_confirmation', payload: data });
  }

  sendPaymentConfirmed(data: Payload<'payment_confirmed'>) {
    return this.enqueue('payment_confirmed', { type: 'payment_confirmed', payload: data });
  }

  sendPaymentConfirmedWithInvoice(data: Payload<'payment_confirmed_with_invoice'>) {
    return this.enqueue('payment_confirmed_with_invoice', {
      type: 'payment_confirmed_with_invoice',
      payload: data,
    });
  }

  sendOrderCancellation(data: Payload<'order_cancellation'>) {
    return this.enqueue('order_cancellation', { type: 'order_cancellation', payload: data });
  }

  sendShippingNotification(data: Payload<'shipping_notification'>) {
    return this.enqueue('shipping_notification', { type: 'shipping_notification', payload: data });
  }

  sendNewOrderNotification(data: Payload<'new_order_notification'>) {
    return this.enqueue('new_order_notification', { type: 'new_order_notification', payload: data });
  }

  sendLowStockAlert(data: Payload<'low_stock_alert'>) {
    return this.enqueue('low_stock_alert', { type: 'low_stock_alert', payload: data });
  }

  sendBackInStock(data: Payload<'back_in_stock'>) {
    return this.enqueue('back_in_stock', { type: 'back_in_stock', payload: data });
  }

  sendReviewRequest(data: Payload<'review_request'>) {
    return this.enqueue('review_request', { type: 'review_request', payload: data });
  }

  sendReturnConfirmation(data: Payload<'return_confirmation'>) {
    return this.enqueue('return_confirmation', { type: 'return_confirmation', payload: data });
  }

  sendReturnAdminNotification(data: Payload<'return_admin_notification'>) {
    return this.enqueue('return_admin_notification', { type: 'return_admin_notification', payload: data });
  }

  sendReturnStatusUpdate(data: Payload<'return_status_update'>) {
    return this.enqueue('return_status_update', { type: 'return_status_update', payload: data });
  }

  sendFraudReviewAlert(data: Payload<'fraud_review_alert'>) {
    return this.enqueue('fraud_review_alert', { type: 'fraud_review_alert', payload: data });
  }

  sendDisputeAlert(data: Payload<'dispute_alert'>) {
    return this.enqueue('dispute_alert', { type: 'dispute_alert', payload: data });
  }

  sendPayoutFailedAlert(data: Payload<'payout_failed_alert'>) {
    return this.enqueue('payout_failed_alert', { type: 'payout_failed_alert', payload: data });
  }

  sendOrderAcknowledgement(data: Payload<'order_acknowledged'>) {
    return this.enqueue('order_acknowledged', { type: 'order_acknowledged', payload: data });
  }
}

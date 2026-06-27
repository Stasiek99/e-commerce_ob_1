import { Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { EmailService } from './email.service';
import { EmailJobData } from './email-queue.types';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

@Processor('email')
export class EmailQueueProcessor extends WorkerHost implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
    @InjectQueue('email-dlq') private readonly dlq: Queue<EmailJobData>,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    this.worker.on('failed', (job, err) => {
      Sentry.captureException(err, { extra: { jobName: job?.name, jobId: job?.id } });
      this.logger.error(`BullMQ job failed: ${job?.name}`, err.stack);

      if (!job) return;
      const isFinalAttempt = job.attemptsMade >= (job.opts?.attempts ?? 1);
      if (isFinalAttempt) {
        this.dlq
          .add(job.name, job.data, { removeOnComplete: false, removeOnFail: false })
          .catch((dlqErr: unknown) => {
            this.logger.error(`Failed to move job ${job.id} to email-dlq`, (dlqErr as Error).stack);
            Sentry.captureException(dlqErr, { extra: { source: 'email-dlq-enqueue', jobId: job.id } });
          });
        this.logger.warn(`Email job "${job.name}" permanently failed after ${job.attemptsMade} attempts — moved to DLQ`);
        Sentry.captureMessage(`Email DLQ: "${job.name}" exhausted all retries`, {
          level: 'error',
          extra: { jobId: job.id, attemptsMade: job.attemptsMade, jobData: job.data },
        });
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // force=false: Railway's SIGTERM→SIGKILL window (~10s) is shorter than some
    // jobs (e.g. PDF invoice generation). force=true blocks until the active job
    // finishes and gets SIGKILLed mid-job instead, leaving it stalled — BullMQ then
    // re-queues it on the next boot and the customer gets a duplicate email. Every
    // customer-facing job type carries a deterministic jobId (see deriveJobId in
    // EmailQueueService), so a stalled-job re-add is a no-op rather than a resend.
    await this.worker.close(false);
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    this.logger.debug(`Processing email job ${job.id}: type=${job.data.type}`);

    const { type, payload } = job.data;

    switch (type) {
      case 'order_confirmation':
        await this.emailService.sendOrderConfirmation(payload);
        break;

      case 'payment_confirmed':
        await this.emailService.sendPaymentConfirmed(payload);
        break;

      case 'payment_confirmed_with_invoice': {
        const { invoiceStoragePath, ...rest } = payload;
        const signedUrl = await this.storageService.getInvoiceSignedUrl(invoiceStoragePath, 3600);
        const pdfRes = await fetch(signedUrl);
        if (!pdfRes.ok) {
          throw new Error(`Invoice PDF download failed (${pdfRes.status}): ${signedUrl}`);
        }
        const invoicePdf = Buffer.from(await pdfRes.arrayBuffer());
        await this.emailService.sendPaymentConfirmedWithInvoice({ ...rest, invoicePdf });
        break;
      }

      case 'order_cancellation':
        await this.emailService.sendOrderCancellation(payload);
        break;

      case 'shipping_notification':
        await this.emailService.sendShippingNotification(payload);
        break;

      case 'email_verification':
        await this.emailService.sendEmailVerification(payload);
        break;

      case 'email_change':
        await this.emailService.sendEmailChangeVerification(payload);
        break;

      case 'password_reset':
        await this.emailService.sendPasswordReset(payload);
        break;

      case 'new_order_notification':
        await this.emailService.sendNewOrderNotification(payload);
        break;

      case 'low_stock_alert':
        await this.emailService.sendLowStockAlert(payload);
        break;

      case 'back_in_stock': {
        const { wishlistItemId, ...emailPayload } = payload;
        // Flag-first idempotency: atomically clear notifyOnRestock only if still true.
        // On BullMQ retry after a failed send, count === 0 and we skip the duplicate.
        const { count } = await this.prisma.wishlistItem.updateMany({
          where: { id: wishlistItemId, notifyOnRestock: true },
          data: { notifyOnRestock: false },
        });
        if (count === 0) break;
        await this.emailService.sendBackInStock(emailPayload);
        break;
      }

      case 'review_request':
        await this.emailService.sendReviewRequest(payload);
        break;

      case 'return_confirmation':
        await this.emailService.sendReturnConfirmation(payload);
        break;

      case 'return_admin_notification':
        await this.emailService.sendReturnAdminNotification(payload);
        break;

      case 'return_status_update':
        await this.emailService.sendReturnStatusUpdate(payload);
        break;

      case 'magic_link_login':
        await this.emailService.sendMagicLink(payload);
        break;

      case 'fraud_review_alert':
        await this.emailService.sendFraudReviewAlert(payload);
        break;

      case 'dispute_alert':
        await this.emailService.sendDisputeAlert(payload);
        break;

      case 'payout_failed_alert':
        await this.emailService.sendPayoutFailedAlert(payload);
        break;

      case 'order_acknowledged':
        await this.emailService.sendOrderAcknowledgement(payload);
        break;

      case 'shipment_exception_alert':
        await this.emailService.sendShipmentExceptionAlert(payload);
        break;

      default: {
        const _exhaustive: never = job.data;
        throw new Error(`Unknown email job type: ${(_exhaustive as any).type}`);
      }
    }
  }
}

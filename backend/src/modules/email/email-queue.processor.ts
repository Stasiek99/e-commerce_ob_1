import { Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EmailService } from './email.service';
import { EmailJobData } from './email-queue.types';
import { StorageService } from '../storage/storage.service';

@Processor('email')
export class EmailQueueProcessor extends WorkerHost implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    this.worker.on('failed', (job, err) => {
      Sentry.captureException(err, { extra: { jobName: job?.name, jobId: job?.id } });
      this.logger.error(`BullMQ job failed: ${job?.name}`, err.stack);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close(true);
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

      case 'back_in_stock':
        await this.emailService.sendBackInStock(payload);
        break;

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

      default: {
        const _exhaustive: never = job.data;
        throw new Error(`Unknown email job type: ${(_exhaustive as any).type}`);
      }
    }
  }
}

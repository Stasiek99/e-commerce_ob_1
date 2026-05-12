import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailService } from './email.service';
import { EmailJobData } from './email-queue.types';

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
} as const;

type Payload<T extends EmailJobData['type']> = Extract<EmailJobData, { type: T }>['payload'];

@Injectable()
export class EmailQueueService {
  constructor(@InjectQueue('email') private readonly queue: Queue<EmailJobData>) {}

  sendEmailVerification(data: Payload<'email_verification'>) {
    return this.queue.add('email_verification', { type: 'email_verification', payload: data }, JOB_OPTIONS);
  }

  sendPasswordReset(data: Payload<'password_reset'>) {
    return this.queue.add('password_reset', { type: 'password_reset', payload: data }, JOB_OPTIONS);
  }

  sendEmailChangeVerification(data: Payload<'email_change'>) {
    return this.queue.add('email_change', { type: 'email_change', payload: data }, JOB_OPTIONS);
  }

  sendMagicLink(data: Payload<'magic_link_login'>) {
    return this.queue.add('magic_link_login', { type: 'magic_link_login', payload: data }, JOB_OPTIONS);
  }

  sendOrderConfirmation(data: Payload<'order_confirmation'>) {
    return this.queue.add('order_confirmation', { type: 'order_confirmation', payload: data }, JOB_OPTIONS);
  }

  sendPaymentConfirmed(data: Payload<'payment_confirmed'>) {
    return this.queue.add('payment_confirmed', { type: 'payment_confirmed', payload: data }, JOB_OPTIONS);
  }

  sendPaymentConfirmedWithInvoice(
    data: Parameters<EmailService['sendPaymentConfirmedWithInvoice']>[0],
  ) {
    const { invoicePdf, ...rest } = data;
    return this.queue.add(
      'payment_confirmed_with_invoice',
      {
        type: 'payment_confirmed_with_invoice',
        payload: { ...rest, invoicePdfBase64: invoicePdf.toString('base64') },
      },
      JOB_OPTIONS,
    );
  }

  sendOrderCancellation(data: Payload<'order_cancellation'>) {
    return this.queue.add('order_cancellation', { type: 'order_cancellation', payload: data }, JOB_OPTIONS);
  }

  sendShippingNotification(data: Payload<'shipping_notification'>) {
    return this.queue.add('shipping_notification', { type: 'shipping_notification', payload: data }, JOB_OPTIONS);
  }

  sendNewOrderNotification(data: Payload<'new_order_notification'>) {
    return this.queue.add('new_order_notification', { type: 'new_order_notification', payload: data }, JOB_OPTIONS);
  }

  sendLowStockAlert(data: Payload<'low_stock_alert'>) {
    return this.queue.add('low_stock_alert', { type: 'low_stock_alert', payload: data }, JOB_OPTIONS);
  }

  sendBackInStock(data: Payload<'back_in_stock'>) {
    return this.queue.add('back_in_stock', { type: 'back_in_stock', payload: data }, JOB_OPTIONS);
  }

  sendReviewRequest(data: Payload<'review_request'>) {
    return this.queue.add('review_request', { type: 'review_request', payload: data }, JOB_OPTIONS);
  }

  sendReturnConfirmation(data: Payload<'return_confirmation'>) {
    return this.queue.add('return_confirmation', { type: 'return_confirmation', payload: data }, JOB_OPTIONS);
  }

  sendReturnAdminNotification(data: Payload<'return_admin_notification'>) {
    return this.queue.add('return_admin_notification', { type: 'return_admin_notification', payload: data }, JOB_OPTIONS);
  }
}

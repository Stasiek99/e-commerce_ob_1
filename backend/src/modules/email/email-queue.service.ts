import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailJobData } from './email-queue.types';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 86_400 },  // keep 24 h
  removeOnFail: { age: 604_800 },     // keep 7 d for debugging
} as const;

@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(@InjectQueue('email') private readonly queue: Queue<EmailJobData>) {}

  private enqueue(data: EmailJobData) {
    return this.queue.add(data.type, data, DEFAULT_JOB_OPTIONS).catch((err: Error) => {
      this.logger.error(`Failed to enqueue email job [${data.type}]: ${err.message}`);
      throw err;
    });
  }

  sendOrderConfirmation(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    totalInCents: number;
  }) {
    return this.enqueue({ type: 'order_confirmation', payload: data });
  }

  sendPaymentConfirmed(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    totalInCents: number;
  }) {
    return this.enqueue({ type: 'payment_confirmed', payload: data });
  }

  sendPaymentConfirmedWithInvoice(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    shippingCostInCents: number;
    totalInCents: number;
    invoiceUrl: string;
    invoicePdf: Buffer;
  }) {
    const { invoicePdf, ...rest } = data;
    return this.enqueue({
      type: 'payment_confirmed_with_invoice',
      payload: { ...rest, invoicePdfBase64: invoicePdf.toString('base64') },
    });
  }

  sendOrderCancellation(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    totalInCents: number;
    isRefund: boolean;
  }) {
    return this.enqueue({ type: 'order_cancellation', payload: data });
  }

  sendShippingNotification(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    carrier: string;
    trackingNumber: string;
    trackingUrl?: string;
  }) {
    return this.enqueue({ type: 'shipping_notification', payload: data });
  }

  sendEmailVerification(data: { to: string; firstName: string; verifyUrl: string }) {
    return this.enqueue({ type: 'email_verification', payload: data });
  }

  sendEmailChangeVerification(data: {
    to: string;
    firstName: string;
    newEmail: string;
    verifyUrl: string;
  }) {
    return this.enqueue({ type: 'email_change', payload: data });
  }

  sendPasswordReset(data: { to: string; firstName: string; resetUrl: string }) {
    return this.enqueue({ type: 'password_reset', payload: data });
  }

  sendNewOrderNotification(data: {
    to: string;
    orderNumber: string;
    customerEmail: string;
    totalInCents: number;
    items: Array<{ name: string; quantity: number; price: number }>;
    carrierCode: string;
    adminUrl?: string;
  }) {
    return this.enqueue({ type: 'new_order_notification', payload: data });
  }

  sendLowStockAlert(data: {
    to: string;
    orderNumber: string;
    items: Array<{ sku: string; name: string; stock: number; isOutOfStock: boolean }>;
  }) {
    return this.enqueue({ type: 'low_stock_alert', payload: data });
  }

  sendBackInStock(data: {
    to: string;
    firstName: string;
    productName: string;
    variantLabel: string;
    productUrl: string;
  }) {
    return this.enqueue({ type: 'back_in_stock', payload: data });
  }

  sendReviewRequest(data: {
    to: string;
    firstName: string;
    orderNumber: string;
    products: Array<{ name: string; imageUrl?: string; reviewUrl: string }>;
  }) {
    return this.enqueue({ type: 'review_request', payload: data });
  }

  sendReturnConfirmation(data: {
    to: string;
    firstName: string;
    orderNumber: string;
    requestId: string;
    type: 'WITHDRAWAL' | 'COMPLAINT';
    items: Array<{ productName: string; quantity: number }>;
  }) {
    return this.enqueue({ type: 'return_confirmation', payload: data });
  }

  sendReturnAdminNotification(data: {
    to: string;
    requestId: string;
    orderNumber: string;
    customerName: string;
    email: string;
    phone?: string;
    type: 'WITHDRAWAL' | 'COMPLAINT';
    deliveryDate?: string;
    items: Array<{ productName: string; quantity: number }>;
    reason?: string;
    requestedResolution?: string;
    bankAccount?: string;
  }) {
    return this.enqueue({ type: 'return_admin_notification', payload: data });
  }
}

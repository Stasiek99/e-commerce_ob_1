import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { Resend } from 'resend';
import { orderConfirmationTemplate } from './templates/order-confirmation.template';
import { paymentConfirmedTemplate } from './templates/payment-confirmed.template';
import { shippingNotificationTemplate } from './templates/shipping-notification.template';
import { invoiceTemplate } from './templates/invoice.template';
import { passwordResetTemplate } from './templates/password-reset.template';
import { emailVerificationTemplate } from './templates/email-verification.template';
import { orderCancellationTemplate } from './templates/order-cancellation.template';
import { lowStockAlertTemplate } from './templates/low-stock-alert.template';
import { newOrderNotificationTemplate } from './templates/new-order-notification.template';
import { backInStockTemplate } from './templates/back-in-stock.template';
import { reviewRequestTemplate } from './templates/review-request.template';
import { returnConfirmationTemplate } from './templates/return-confirmation.template';
import { returnAdminNotificationTemplate } from './templates/return-admin-notification.template';
import { emailChangeTemplate } from './templates/email-change.template';

type EmailKind =
  | 'order_confirmation'
  | 'payment_confirmed'
  | 'payment_confirmed_with_invoice'
  | 'shipping_notification'
  | 'password_reset'
  | 'email_verification'
  | 'order_cancellation'
  | 'low_stock_alert'
  | 'new_order_notification'
  | 'back_in_stock'
  | 'review_request'
  | 'return_confirmation'
  | 'return_admin_notification'
  | 'email_change';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {
    const apiKey = configService.get<string>('RESEND_API_KEY', '');
    this.resend = new Resend(apiKey || 're_placeholder_set_RESEND_API_KEY_in_env');
    this.from = configService.get<string>('EMAIL_FROM', 'sklep@twojadomena.pl');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set — emails will fail silently');
    }
  }

  async sendOrderConfirmation(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    totalInCents: number;
  }) {
    const { subject, html } = orderConfirmationTemplate(data);
    return this.send('order_confirmation', data.to, subject, html, {
      orderNumber: data.orderNumber,
    });
  }

  async sendPaymentConfirmed(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    totalInCents: number;
  }) {
    const { subject, html } = paymentConfirmedTemplate(data);
    return this.send('payment_confirmed', data.to, subject, html, {
      orderNumber: data.orderNumber,
    });
  }

  async sendPaymentConfirmedWithInvoice(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    shippingCostInCents: number;
    totalInCents: number;
    invoiceUrl: string;
    invoicePdf: Buffer;
  }) {
    const { subject, html } = invoiceTemplate(data);
    return this.sendWithAttachments(
      'payment_confirmed_with_invoice',
      data.to,
      subject,
      html,
      { orderNumber: data.orderNumber },
      [{ filename: `FV-${data.orderNumber}.pdf`, content: data.invoicePdf }],
    );
  }

  async sendOrderCancellation(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    totalInCents: number;
    isRefund: boolean;
  }) {
    const { subject, html } = orderCancellationTemplate(data);
    return this.send('order_cancellation', data.to, subject, html, { orderNumber: data.orderNumber });
  }

  async sendEmailChangeVerification(data: { to: string; firstName: string; newEmail: string; verifyUrl: string }) {
    const { subject, html } = emailChangeTemplate({ firstName: data.firstName, newEmail: data.newEmail, verifyUrl: data.verifyUrl });
    return this.send('email_change', data.to, subject, html, { verifyUrl: data.verifyUrl });
  }

  async sendEmailVerification(data: { to: string; firstName: string; verifyUrl: string }) {
    const { subject, html } = emailVerificationTemplate({ firstName: data.firstName, verifyUrl: data.verifyUrl });
    return this.send('email_verification', data.to, subject, html, { verifyUrl: data.verifyUrl });
  }

  async sendPasswordReset(data: { to: string; firstName: string; resetUrl: string }) {
    const { subject, html } = passwordResetTemplate({ firstName: data.firstName, resetUrl: data.resetUrl });
    return this.send('password_reset', data.to, subject, html, { resetUrl: data.resetUrl });
  }

  async sendNewOrderNotification(data: {
    to: string;
    orderNumber: string;
    customerEmail: string;
    totalInCents: number;
    items: Array<{ name: string; quantity: number; price: number }>;
    carrierCode: string;
    adminUrl?: string;
  }) {
    const { subject, html } = newOrderNotificationTemplate(data);
    return this.send('new_order_notification', data.to, subject, html, { orderNumber: data.orderNumber });
  }

  async sendLowStockAlert(data: {
    to: string;
    orderNumber: string;
    items: Array<{ sku: string; name: string; stock: number; isOutOfStock: boolean }>;
  }) {
    const { subject, html } = lowStockAlertTemplate(data);
    return this.send('low_stock_alert', data.to, subject, html, { orderNumber: data.orderNumber });
  }

  async sendBackInStock(data: {
    to: string;
    firstName: string;
    productName: string;
    variantLabel: string;
    productUrl: string;
  }) {
    const { subject, html } = backInStockTemplate(data);
    return this.send('back_in_stock', data.to, subject, html, { productName: data.productName });
  }

  async sendReviewRequest(data: {
    to: string;
    firstName: string;
    orderNumber: string;
    products: Array<{ name: string; imageUrl?: string; reviewUrl: string }>;
  }) {
    const { subject, html } = reviewRequestTemplate(data);
    return this.send('review_request', data.to, subject, html, {
      orderNumber: data.orderNumber,
    });
  }

  async sendReturnConfirmation(data: {
    to: string;
    firstName: string;
    orderNumber: string;
    requestId: string;
    type: 'WITHDRAWAL' | 'COMPLAINT';
    items: Array<{ productName: string; quantity: number }>;
  }) {
    const { subject, html } = returnConfirmationTemplate(data);
    return this.send('return_confirmation', data.to, subject, html, {
      orderNumber: data.orderNumber,
      requestId: data.requestId,
    });
  }

  async sendReturnAdminNotification(data: {
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
    const { subject, html } = returnAdminNotificationTemplate(data);
    return this.send('return_admin_notification', data.to, subject, html, {
      orderNumber: data.orderNumber,
      requestId: data.requestId,
    });
  }

  async sendShippingNotification(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    carrier: string;
    trackingNumber: string;
    trackingUrl?: string;
  }) {
    const { subject, html } = shippingNotificationTemplate(data);
    return this.send('shipping_notification', data.to, subject, html, {
      orderNumber: data.orderNumber,
      carrier: data.carrier,
    });
  }

  private async sendWithAttachments(
    kind: EmailKind,
    to: string,
    subject: string,
    html: string,
    context: Record<string, string>,
    attachments: Array<{ filename: string; content: Buffer }>,
  ) {
    try {
      const result = await this.withRetry(kind, () =>
        this.resend.emails.send({
          from: this.from,
          to,
          subject,
          html,
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
          })),
        }),
      );
      this.logger.log(`Email with attachment sent to ${to}: ${subject}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send ${kind} email to ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      Sentry.withScope((scope) => {
        scope.setTag('email.kind', kind);
        scope.setContext('email', { to, subject, ...context });
        Sentry.captureException(error);
      });
      throw error;
    }
  }

  private async send(
    kind: EmailKind,
    to: string,
    subject: string,
    html: string,
    context: Record<string, string>,
  ) {
    try {
      // Resend's SDK returns { data, error } on validation/API errors
      // instead of throwing, so withRetry normalises both paths into a throw.
      const result = await this.withRetry(kind, () =>
        this.resend.emails.send({ from: this.from, to, subject, html }),
      );
      this.logger.log(`Email sent to ${to}: ${subject}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send ${kind} email to ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      Sentry.withScope((scope) => {
        scope.setTag('email.kind', kind);
        scope.setContext('email', { to, subject, ...context });
        Sentry.captureException(error);
      });
      throw error;
    }
  }

  private async withRetry<T extends { error: unknown }>(
    kind: EmailKind,
    fn: () => Promise<T>,
    maxAttempts = 3,
    baseDelayMs = 1000,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await fn();

      if (!result.error) return result;

      lastError = new Error(
        `Resend API error: ${(result.error as any).name} — ${(result.error as any).message}`,
      );

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        this.logger.warn(
          `${kind} email attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError;
  }
}

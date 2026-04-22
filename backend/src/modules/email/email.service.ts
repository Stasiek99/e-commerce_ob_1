import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { Resend } from 'resend';
import { orderConfirmationTemplate } from './templates/order-confirmation.template';
import { paymentConfirmedTemplate } from './templates/payment-confirmed.template';
import { shippingNotificationTemplate } from './templates/shipping-notification.template';
import { invoiceTemplate } from './templates/invoice.template';

type EmailKind =
  | 'order_confirmation'
  | 'payment_confirmed'
  | 'payment_confirmed_with_invoice'
  | 'shipping_notification';

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

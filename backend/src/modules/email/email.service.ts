import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { Resend } from 'resend';
import { orderConfirmationTemplate } from './templates/order-confirmation.template';
import { paymentConfirmedTemplate } from './templates/payment-confirmed.template';
import { shippingNotificationTemplate } from './templates/shipping-notification.template';

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
    totalInCents: number;
    invoiceUrl: string;
    invoicePdf: Buffer;
  }) {
    const { subject, html } = paymentConfirmedTemplate({
      orderNumber: data.orderNumber,
      firstName: data.firstName,
      totalInCents: data.totalInCents,
    });
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
      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
        })),
      });

      if (result.error) {
        throw new Error(
          `Resend API error: ${result.error.name} — ${result.error.message}`,
        );
      }

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
      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      // Resend's SDK returns { data, error } on validation/API errors
      // instead of throwing, so we must branch on result.error explicitly.
      if (result.error) {
        throw new Error(
          `Resend API error: ${result.error.name} — ${result.error.message}`,
        );
      }

      this.logger.log(`Email sent to ${to}: ${subject}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send ${kind} email to ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      Sentry.withScope((scope) => {
        scope.setTag('email.kind', kind);
        scope.setContext('email', {
          to,
          subject,
          ...context,
        });
        Sentry.captureException(error);
      });
      throw error;
    }
  }
}

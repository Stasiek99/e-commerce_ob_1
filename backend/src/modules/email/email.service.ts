import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { orderConfirmationTemplate } from './templates/order-confirmation.template';
import { paymentConfirmedTemplate } from './templates/payment-confirmed.template';
import { shippingNotificationTemplate } from './templates/shipping-notification.template';

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
    return this.send(data.to, subject, html);
  }

  async sendPaymentConfirmed(data: {
    to: string;
    orderNumber: string;
    firstName: string;
    totalInCents: number;
  }) {
    const { subject, html } = paymentConfirmedTemplate(data);
    return this.send(data.to, subject, html);
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
    return this.send(data.to, subject, html);
  }

  private async send(to: string, subject: string, html: string) {
    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw error;
    }
  }
}

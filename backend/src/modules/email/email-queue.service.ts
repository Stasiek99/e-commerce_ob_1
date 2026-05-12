import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from './email.service';

@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(private readonly emailService: EmailService) {}

  private fire(label: string, fn: () => Promise<unknown>): Promise<void> {
    return fn().then(() => undefined, (err: Error) => {
      this.logger.error(`Email send failed [${label}]: ${err.message}`);
    });
  }

  sendOrderConfirmation(data: Parameters<EmailService['sendOrderConfirmation']>[0]) {
    return this.fire('order_confirmation', () => this.emailService.sendOrderConfirmation(data));
  }

  sendPaymentConfirmed(data: Parameters<EmailService['sendPaymentConfirmed']>[0]) {
    return this.fire('payment_confirmed', () => this.emailService.sendPaymentConfirmed(data));
  }

  sendPaymentConfirmedWithInvoice(data: Parameters<EmailService['sendPaymentConfirmedWithInvoice']>[0]) {
    return this.fire('payment_confirmed_with_invoice', () => this.emailService.sendPaymentConfirmedWithInvoice(data));
  }

  sendOrderCancellation(data: Parameters<EmailService['sendOrderCancellation']>[0]) {
    return this.fire('order_cancellation', () => this.emailService.sendOrderCancellation(data));
  }

  sendShippingNotification(data: Parameters<EmailService['sendShippingNotification']>[0]) {
    return this.fire('shipping_notification', () => this.emailService.sendShippingNotification(data));
  }

  sendEmailVerification(data: Parameters<EmailService['sendEmailVerification']>[0]) {
    return this.emailService.sendEmailVerification(data);
  }

  sendEmailChangeVerification(data: Parameters<EmailService['sendEmailChangeVerification']>[0]) {
    return this.emailService.sendEmailChangeVerification(data);
  }

  sendPasswordReset(data: Parameters<EmailService['sendPasswordReset']>[0]) {
    return this.emailService.sendPasswordReset(data);
  }

  sendMagicLink(data: Parameters<EmailService['sendMagicLink']>[0]) {
    return this.emailService.sendMagicLink(data);
  }

  sendNewOrderNotification(data: Parameters<EmailService['sendNewOrderNotification']>[0]) {
    return this.fire('new_order_notification', () => this.emailService.sendNewOrderNotification(data));
  }

  sendLowStockAlert(data: Parameters<EmailService['sendLowStockAlert']>[0]) {
    return this.fire('low_stock_alert', () => this.emailService.sendLowStockAlert(data));
  }

  sendBackInStock(data: Parameters<EmailService['sendBackInStock']>[0]) {
    return this.fire('back_in_stock', () => this.emailService.sendBackInStock(data));
  }

  sendReviewRequest(data: Parameters<EmailService['sendReviewRequest']>[0]) {
    return this.fire('review_request', () => this.emailService.sendReviewRequest(data));
  }

  sendReturnConfirmation(data: Parameters<EmailService['sendReturnConfirmation']>[0]) {
    return this.fire('return_confirmation', () => this.emailService.sendReturnConfirmation(data));
  }

  sendReturnAdminNotification(data: Parameters<EmailService['sendReturnAdminNotification']>[0]) {
    return this.fire('return_admin_notification', () => this.emailService.sendReturnAdminNotification(data));
  }
}

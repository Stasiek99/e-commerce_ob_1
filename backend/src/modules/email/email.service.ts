import { createHash } from 'crypto';
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
import { returnStatusUpdateTemplate } from './templates/return-status-update.template';
import { emailChangeTemplate } from './templates/email-change.template';
import { magicLinkTemplate } from './templates/magic-link.template';

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
  | 'return_status_update'
  | 'email_change'
  | 'magic_link_login'
  | 'fraud_review_alert'
  | 'payout_failed_alert';

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
    carrierCode?: string;
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

  async sendFraudReviewAlert(data: {
    to: string;
    orderNumber: string;
    customerEmail: string;
    totalInCents: number;
    radarRiskLevel: string;
    adminUrl?: string;
  }) {
    const amount = (data.totalInCents / 100).toFixed(2);
    const subject = `[FRAUD REVIEW] Zamówienie ${data.orderNumber} wymaga weryfikacji`;
    const reviewLink = data.adminUrl
      ? `<p><a href="${data.adminUrl}">Przejdź do zamówienia →</a></p>`
      : '';
    const html = `
      <h2>Zamówienie wstrzymane — weryfikacja antyfraudowa</h2>
      <p>Stripe Radar oznaczył płatność jako ryzykowną i zamówienie zostało wstrzymane przed realizacją.</p>
      <table>
        <tr><td><strong>Zamówienie:</strong></td><td>${data.orderNumber}</td></tr>
        <tr><td><strong>Klient:</strong></td><td>${data.customerEmail}</td></tr>
        <tr><td><strong>Kwota:</strong></td><td>${amount} PLN</td></tr>
        <tr><td><strong>Poziom ryzyka Radar:</strong></td><td>${data.radarRiskLevel}</td></tr>
      </table>
      ${reviewLink}
      <p>Aby zatwierdzić zamówienie: <code>POST /orders/admin/${data.orderNumber}/fraud-review/approve</code></p>
      <p>Aby odrzucić i zwrócić środki: <code>POST /orders/admin/${data.orderNumber}/fraud-review/reject</code></p>
      <p><em>Klient nie otrzymał żadnego powiadomienia — nie ujawniaj wstrzymania.</em></p>
    `;
    return this.send('fraud_review_alert', data.to, subject, html, { orderNumber: data.orderNumber });
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

  async sendReturnStatusUpdate(data: {
    to: string;
    firstName: string;
    orderNumber: string;
    requestId: string;
    type: 'WITHDRAWAL' | 'COMPLAINT';
    newStatus: 'APPROVED' | 'REJECTED' | 'COMPLETED';
    adminNote?: string;
  }) {
    const { subject, html } = returnStatusUpdateTemplate(data);
    return this.send('return_status_update', data.to, subject, html, {
      orderNumber: data.orderNumber,
      requestId: data.requestId,
      newStatus: data.newStatus,
    });
  }

  async sendPayoutFailedAlert(data: {
    to: string;
    payoutId: string;
    amountInCents: number;
    currency: string;
    failureCode: string | null;
    failureMessage: string | null;
    arrivalDate: string;
  }) {
    const amount = (data.amountInCents / 100).toFixed(2);
    const subject = `[KRYTYCZNY] Stripe payout nie powiódł się — ${amount} ${data.currency.toUpperCase()}`;
    const html = `
      <h2>Stripe payout nie powiódł się</h2>
      <p>Wypłata środków ze Stripe nie powiodła się. Wymagana natychmiastowa interwencja.</p>
      <table>
        <tr><td><strong>Payout ID:</strong></td><td>${data.payoutId}</td></tr>
        <tr><td><strong>Kwota:</strong></td><td>${amount} ${data.currency.toUpperCase()}</td></tr>
        <tr><td><strong>Kod błędu:</strong></td><td>${data.failureCode ?? '—'}</td></tr>
        <tr><td><strong>Szczegóły:</strong></td><td>${data.failureMessage ?? '—'}</td></tr>
        <tr><td><strong>Planowana data:</strong></td><td>${data.arrivalDate}</td></tr>
      </table>
      <h3>Działania naprawcze</h3>
      <ol>
        <li>Zaloguj się do <a href="https://dashboard.stripe.com/payouts">Stripe Dashboard → Payouts</a> i sprawdź powód nieudanej wypłaty.</li>
        <li>Zweryfikuj dane konta bankowego: Stripe Dashboard → Settings → Bank accounts.</li>
        <li>Jeśli dane są prawidłowe, skontaktuj się z supportem Stripe: <a href="https://support.stripe.com">support.stripe.com</a>.</li>
        <li>W przypadku blokady konta sprawdź zamówienia w statusie DISPUTE_HOLD lub FRAUD_REVIEW i oceń konieczność ręcznych zwrotów.</li>
        <li>Ręczny zwrot przez Stripe Dashboard: Payments → znajdź transakcję → Refund. Kwota do zwrotu dostępna jest w bazie w kolumnie <code>Order.totalInCents</code>.</li>
      </ol>
      <p><strong>Uwaga:</strong> Klienci mają prawo do zwrotu środków w ciągu 14 dni zgodnie z Art. 32 UoK, niezależnie od statusu wypłat Stripe.</p>
    `;
    return this.send('payout_failed_alert', data.to, subject, html, { payoutId: data.payoutId });
  }

  async sendMagicLink(data: { to: string; firstName: string; magicUrl: string }) {
    const { subject, html } = magicLinkTemplate({ firstName: data.firstName, magicUrl: data.magicUrl });
    return this.send('magic_link_login', data.to, subject, html, { magicUrl: data.magicUrl });
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
      const toHash = createHash('sha256').update(to).digest('hex').slice(0, 12);
      Sentry.withScope((scope) => {
        scope.setTag('email.kind', kind);
        scope.setTag('email.to_hash', toHash);
        scope.setContext('email', { subject, ...context });
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
      const toHash = createHash('sha256').update(to).digest('hex').slice(0, 12);
      Sentry.withScope((scope) => {
        scope.setTag('email.kind', kind);
        scope.setTag('email.to_hash', toHash);
        scope.setContext('email', { subject, ...context });
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

import * as fs from 'fs';
import * as path from 'path';

import { passwordResetTemplate } from '../password-reset.template';
import { magicLinkTemplate } from '../magic-link.template';
import { emailVerificationTemplate } from '../email-verification.template';
import { emailChangeTemplate } from '../email-change.template';
import { paymentConfirmedTemplate } from '../payment-confirmed.template';
import { invoiceTemplate } from '../invoice.template';
import { reviewRequestTemplate } from '../review-request.template';
import { backInStockTemplate } from '../back-in-stock.template';
import { newOrderNotificationTemplate } from '../new-order-notification.template';
import { lowStockAlertTemplate } from '../low-stock-alert.template';
import { orderAcknowledgedTemplate } from '../order-acknowledged.template';
import { orderCancellationTemplate } from '../order-cancellation.template';
import { orderConfirmationTemplate } from '../order-confirmation.template';
import { returnAdminNotificationTemplate } from '../return-admin-notification.template';
import { returnConfirmationTemplate } from '../return-confirmation.template';
import { returnStatusUpdateTemplate } from '../return-status-update.template';
import { shippingNotificationTemplate } from '../shipping-notification.template';

const XSS_PAYLOAD = '<img src=x onerror=alert(1)>';
const JS_URL_PAYLOAD = 'javascript:alert(1)';

interface Coverage {
  run: () => { html: string };
  /** Set when the template passes a field through sanitizeUrl (not just escapeHtml). */
  checkUrlPayload?: boolean;
}

// Every *.template.ts file in this directory's parent MUST have an entry here.
// This is enforced by the "every template file has registered coverage" test below,
// so a new template added without escaping coverage fails loudly instead of being
// silently skipped (the failure mode that let two templates ship unescaped).
const COVERAGE: Record<string, Coverage> = {
  'password-reset': {
    run: () => passwordResetTemplate({ firstName: XSS_PAYLOAD, resetUrl: JS_URL_PAYLOAD }),
    checkUrlPayload: true,
  },
  'magic-link': {
    run: () => magicLinkTemplate({ firstName: XSS_PAYLOAD, magicUrl: JS_URL_PAYLOAD }),
    checkUrlPayload: true,
  },
  'email-verification': {
    run: () => emailVerificationTemplate({ firstName: XSS_PAYLOAD, verifyUrl: JS_URL_PAYLOAD }),
    checkUrlPayload: true,
  },
  'email-change': {
    run: () =>
      emailChangeTemplate({
        firstName: XSS_PAYLOAD,
        newEmail: XSS_PAYLOAD,
        verifyUrl: JS_URL_PAYLOAD,
      }),
    checkUrlPayload: true,
  },
  'payment-confirmed': {
    run: () =>
      paymentConfirmedTemplate({ orderNumber: '1001', firstName: XSS_PAYLOAD, totalInCents: 1000 }),
  },
  invoice: {
    run: () =>
      invoiceTemplate({
        orderNumber: '1001',
        firstName: XSS_PAYLOAD,
        items: [{ name: XSS_PAYLOAD, quantity: 1, price: 1000 }],
        shippingCostInCents: 0,
        totalInCents: 1000,
      }),
  },
  'review-request': {
    run: () =>
      reviewRequestTemplate({
        firstName: XSS_PAYLOAD,
        orderNumber: '1001',
        products: [{ name: XSS_PAYLOAD, imageUrl: JS_URL_PAYLOAD, reviewUrl: JS_URL_PAYLOAD }],
      }),
    checkUrlPayload: true,
  },
  'back-in-stock': {
    run: () =>
      backInStockTemplate({
        firstName: XSS_PAYLOAD,
        productName: XSS_PAYLOAD,
        variantLabel: XSS_PAYLOAD,
        productUrl: JS_URL_PAYLOAD,
      }),
    checkUrlPayload: true,
  },
  'new-order-notification': {
    run: () =>
      newOrderNotificationTemplate({
        orderNumber: '1001',
        customerEmail: XSS_PAYLOAD,
        totalInCents: 1000,
        items: [{ name: XSS_PAYLOAD, quantity: 1, price: 1000 }],
        carrierCode: 'INPOST',
      }),
  },
  'low-stock-alert': {
    run: () =>
      lowStockAlertTemplate({
        orderNumber: '1001',
        items: [{ sku: XSS_PAYLOAD, name: XSS_PAYLOAD, stock: 3, isOutOfStock: false }],
      }),
  },
  'order-acknowledged': {
    run: () =>
      orderAcknowledgedTemplate({
        orderNumber: '1001',
        firstName: XSS_PAYLOAD,
        items: [{ name: XSS_PAYLOAD, quantity: 1, price: 1000 }],
        totalInCents: 1000,
        paymentUrl: 'https://example.com/pay',
        cancelUrl: 'https://example.com/cancel',
      }),
  },
  'order-cancellation': {
    run: () =>
      orderCancellationTemplate({
        orderNumber: '1001',
        firstName: XSS_PAYLOAD,
        totalInCents: 1000,
        isRefund: false,
      }),
  },
  'order-confirmation': {
    run: () =>
      orderConfirmationTemplate({
        orderNumber: '1001',
        firstName: XSS_PAYLOAD,
        items: [{ name: XSS_PAYLOAD, quantity: 1, price: 1000 }],
        totalInCents: 1000,
      }),
  },
  'return-admin-notification': {
    run: () =>
      returnAdminNotificationTemplate({
        requestId: 'R1',
        orderNumber: '1001',
        customerName: XSS_PAYLOAD,
        email: XSS_PAYLOAD,
        type: 'WITHDRAWAL',
        items: [{ productName: XSS_PAYLOAD, quantity: 1 }],
        reason: XSS_PAYLOAD,
        requestedResolution: 'REFUND',
      }),
  },
  'return-confirmation': {
    run: () =>
      returnConfirmationTemplate({
        firstName: XSS_PAYLOAD,
        orderNumber: '1001',
        requestId: 'R1',
        type: 'WITHDRAWAL',
        items: [{ productName: XSS_PAYLOAD, quantity: 1 }],
      }),
  },
  'return-status-update': {
    run: () =>
      returnStatusUpdateTemplate({
        firstName: XSS_PAYLOAD,
        orderNumber: '1001',
        requestId: 'R1',
        type: 'WITHDRAWAL',
        newStatus: 'APPROVED',
        adminNote: XSS_PAYLOAD,
      }),
  },
  'shipping-notification': {
    run: () =>
      shippingNotificationTemplate({
        orderNumber: '1001',
        firstName: XSS_PAYLOAD,
        carrier: XSS_PAYLOAD,
        trackingNumber: XSS_PAYLOAD,
        trackingUrl: JS_URL_PAYLOAD,
      }),
    checkUrlPayload: true,
  },
};

const templatesDir = path.join(__dirname, '..');
const templateNames = fs
  .readdirSync(templatesDir)
  .filter((file) => file.endsWith('.template.ts'))
  .map((file) => file.replace(/\.template\.ts$/, ''))
  .sort();

describe('email template HTML escaping', () => {
  it('every *.template.ts file has registered escaping coverage in this spec', () => {
    const missing = templateNames.filter((name) => !COVERAGE[name]);
    expect(missing).toEqual([]);
  });

  for (const name of templateNames) {
    const coverage = COVERAGE[name];
    if (!coverage) continue;

    it(`${name}.template escapes untrusted input`, () => {
      const { html } = coverage.run();
      expect(html).not.toContain(XSS_PAYLOAD);
      if (coverage.checkUrlPayload) {
        expect(html).not.toContain(JS_URL_PAYLOAD);
      }
    });
  }
});

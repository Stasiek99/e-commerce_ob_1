import { passwordResetTemplate } from '../password-reset.template';
import { magicLinkTemplate } from '../magic-link.template';
import { emailVerificationTemplate } from '../email-verification.template';
import { emailChangeTemplate } from '../email-change.template';
import { paymentConfirmedTemplate } from '../payment-confirmed.template';
import { invoiceTemplate } from '../invoice.template';
import { reviewRequestTemplate } from '../review-request.template';
import { backInStockTemplate } from '../back-in-stock.template';

const XSS_PAYLOAD = '<img src=x onerror=alert(1)>';
const JS_URL_PAYLOAD = 'javascript:alert(1)';

describe('email template HTML escaping', () => {
  it('passwordResetTemplate escapes firstName and sanitizes resetUrl', () => {
    const { html } = passwordResetTemplate({ firstName: XSS_PAYLOAD, resetUrl: JS_URL_PAYLOAD });
    expect(html).not.toContain(XSS_PAYLOAD);
    expect(html).not.toContain(JS_URL_PAYLOAD);
  });

  it('magicLinkTemplate escapes firstName and sanitizes magicUrl', () => {
    const { html } = magicLinkTemplate({ firstName: XSS_PAYLOAD, magicUrl: JS_URL_PAYLOAD });
    expect(html).not.toContain(XSS_PAYLOAD);
    expect(html).not.toContain(JS_URL_PAYLOAD);
  });

  it('emailVerificationTemplate escapes firstName and sanitizes verifyUrl', () => {
    const { html } = emailVerificationTemplate({ firstName: XSS_PAYLOAD, verifyUrl: JS_URL_PAYLOAD });
    expect(html).not.toContain(XSS_PAYLOAD);
    expect(html).not.toContain(JS_URL_PAYLOAD);
  });

  it('emailChangeTemplate escapes firstName, newEmail and sanitizes verifyUrl', () => {
    const { html } = emailChangeTemplate({
      firstName: XSS_PAYLOAD,
      newEmail: XSS_PAYLOAD,
      verifyUrl: JS_URL_PAYLOAD,
    });
    expect(html).not.toContain(XSS_PAYLOAD);
    expect(html).not.toContain(JS_URL_PAYLOAD);
  });

  it('paymentConfirmedTemplate escapes firstName', () => {
    const { html } = paymentConfirmedTemplate({
      orderNumber: '1001',
      firstName: XSS_PAYLOAD,
      totalInCents: 1000,
    });
    expect(html).not.toContain(XSS_PAYLOAD);
  });

  it('invoiceTemplate escapes firstName and item names', () => {
    const { html } = invoiceTemplate({
      orderNumber: '1001',
      firstName: XSS_PAYLOAD,
      items: [{ name: XSS_PAYLOAD, quantity: 1, price: 1000 }],
      shippingCostInCents: 0,
      totalInCents: 1000,
    });
    expect(html).not.toContain(XSS_PAYLOAD);
  });

  it('reviewRequestTemplate escapes firstName, product name and sanitizes imageUrl/reviewUrl', () => {
    const { html } = reviewRequestTemplate({
      firstName: XSS_PAYLOAD,
      orderNumber: '1001',
      products: [{ name: XSS_PAYLOAD, imageUrl: JS_URL_PAYLOAD, reviewUrl: JS_URL_PAYLOAD }],
    });
    expect(html).not.toContain(XSS_PAYLOAD);
    expect(html).not.toContain(JS_URL_PAYLOAD);
  });

  it('backInStockTemplate escapes firstName, productName, variantLabel and sanitizes productUrl', () => {
    const { html } = backInStockTemplate({
      firstName: XSS_PAYLOAD,
      productName: XSS_PAYLOAD,
      variantLabel: XSS_PAYLOAD,
      productUrl: JS_URL_PAYLOAD,
    });
    expect(html).not.toContain(XSS_PAYLOAD);
    expect(html).not.toContain(JS_URL_PAYLOAD);
  });
});

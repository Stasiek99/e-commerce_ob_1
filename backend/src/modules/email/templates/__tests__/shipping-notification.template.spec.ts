import { shippingNotificationTemplate } from '../shipping-notification.template';

const BASE = {
  orderNumber: 'ORD-2026-000042',
  firstName: 'Marek',
  carrier: 'InPost',
  trackingNumber: '1234567890',
};

describe('shippingNotificationTemplate()', () => {
  // ── Subject line ──────────────────────────────────────────────────

  describe('subject', () => {
    it('contains the order number', () => {
      const { subject } = shippingNotificationTemplate(BASE);
      expect(subject).toContain('ORD-2026-000042');
    });

    it('contains "zostało nadane"', () => {
      const { subject } = shippingNotificationTemplate(BASE);
      expect(subject).toContain('zostało nadane');
    });
  });

  // ── HTML — content ────────────────────────────────────────────────

  describe('HTML — content', () => {
    it('contains the customer first name', () => {
      const { html } = shippingNotificationTemplate(BASE);
      expect(html).toContain('Marek');
    });

    it('contains the order number', () => {
      const { html } = shippingNotificationTemplate(BASE);
      expect(html).toContain('ORD-2026-000042');
    });

    it('contains the carrier name', () => {
      const { html } = shippingNotificationTemplate(BASE);
      expect(html).toContain('InPost');
    });

    it('shows tracking number when no trackingUrl is provided', () => {
      const { html } = shippingNotificationTemplate(BASE);
      expect(html).toContain('1234567890');
    });

    it('shows tracking link when trackingUrl is provided', () => {
      const { html } = shippingNotificationTemplate({
        ...BASE,
        trackingUrl: 'https://inpost.pl/trace/1234567890',
      });
      expect(html).toContain('href="https://inpost.pl/trace/1234567890"');
      expect(html).toContain('Śledź przesyłkę');
    });
  });

  // ── HTML — structure ──────────────────────────────────────────────

  describe('HTML — structure', () => {
    it('returns a valid HTML document', () => {
      const { html } = shippingNotificationTemplate(BASE);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('sets lang="pl"', () => {
      const { html } = shippingNotificationTemplate(BASE);
      expect(html).toContain('lang="pl"');
    });
  });

  // ── XSS — user-supplied fields are HTML-escaped ───────────────────

  describe('XSS — escaping', () => {
    it('escapes HTML in firstName', () => {
      const { html } = shippingNotificationTemplate({
        ...BASE,
        firstName: '<script>alert(1)</script>',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML in carrier name', () => {
      const { html } = shippingNotificationTemplate({
        ...BASE,
        carrier: '<b>evil</b>',
      });
      expect(html).not.toContain('<b>');
      expect(html).toContain('&lt;b&gt;');
    });

    it('escapes HTML in trackingNumber', () => {
      const { html } = shippingNotificationTemplate({
        ...BASE,
        trackingNumber: '<script>evil()</script>',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('replaces javascript: trackingUrl with "#" in href', () => {
      const { html } = shippingNotificationTemplate({
        ...BASE,
        trackingUrl: 'javascript:alert(document.cookie)',
      });
      expect(html).not.toContain('javascript:');
      expect(html).toContain('href="#"');
    });

    it('replaces data: trackingUrl with "#" in href', () => {
      const { html } = shippingNotificationTemplate({
        ...BASE,
        trackingUrl: 'data:text/html,<script>alert(1)</script>',
      });
      expect(html).not.toContain('data:');
      expect(html).toContain('href="#"');
    });

    it('replaces malformed trackingUrl with "#" in href', () => {
      const { html } = shippingNotificationTemplate({
        ...BASE,
        trackingUrl: 'not-a-url',
      });
      expect(html).toContain('href="#"');
    });

    it('passes safe https trackingUrl through unchanged', () => {
      const url = 'https://inpost.pl/trace/1234567890';
      const { html } = shippingNotificationTemplate({ ...BASE, trackingUrl: url });
      expect(html).toContain(`href="${url}"`);
    });

    it('passes safe firstName through unchanged', () => {
      const { html } = shippingNotificationTemplate(BASE);
      expect(html).toContain('Marek');
    });
  });
});

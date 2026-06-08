import { orderCancellationTemplate } from '../order-cancellation.template';

const BASE_CANCELLED = {
  orderNumber: 'ORD-2026-000077',
  firstName: 'Tomasz',
  totalInCents: 14900,
  isRefund: false,
};

const BASE_REFUND = { ...BASE_CANCELLED, isRefund: true };

describe('orderCancellationTemplate()', () => {
  // ── Subject line ──────────────────────────────────────────────────

  describe('subject', () => {
    it('cancellation — contains "anulowane"', () => {
      const { subject } = orderCancellationTemplate(BASE_CANCELLED);
      expect(subject.toLowerCase()).toContain('anulowane');
    });

    it('refund — contains "zwrotu"', () => {
      const { subject } = orderCancellationTemplate(BASE_REFUND);
      expect(subject.toLowerCase()).toContain('zwrotu');
    });

    it('contains the order number', () => {
      const { subject } = orderCancellationTemplate(BASE_CANCELLED);
      expect(subject).toContain('ORD-2026-000077');
    });

    it('subjects differ between cancellation and refund', () => {
      const { subject: cs } = orderCancellationTemplate(BASE_CANCELLED);
      const { subject: rs } = orderCancellationTemplate(BASE_REFUND);
      expect(cs).not.toBe(rs);
    });
  });

  // ── HTML — content ────────────────────────────────────────────────

  describe('HTML — content', () => {
    it('contains the customer first name', () => {
      const { html } = orderCancellationTemplate(BASE_CANCELLED);
      expect(html).toContain('Tomasz');
    });

    it('refund — contains the formatted refund amount', () => {
      const { html } = orderCancellationTemplate(BASE_REFUND);
      expect(html).toContain('149,00 zł');
    });

    it('refund — references the right-of-withdrawal law', () => {
      const { html } = orderCancellationTemplate(BASE_REFUND);
      expect(html).toContain('ustawą o prawach konsumenta');
    });

    it('cancellation — states no payment was taken', () => {
      const { html } = orderCancellationTemplate(BASE_CANCELLED);
      expect(html).toContain('Żadna płatność nie została pobrana');
    });
  });

  // ── HTML — structure ──────────────────────────────────────────────

  describe('HTML — structure', () => {
    it('returns a valid HTML document', () => {
      const { html } = orderCancellationTemplate(BASE_CANCELLED);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('sets lang="pl"', () => {
      const { html } = orderCancellationTemplate(BASE_CANCELLED);
      expect(html).toContain('lang="pl"');
    });
  });

  // ── XSS — user-supplied fields are HTML-escaped ───────────────────

  describe('XSS — escaping', () => {
    it('escapes HTML in firstName', () => {
      const { html } = orderCancellationTemplate({
        ...BASE_CANCELLED,
        firstName: '<script>alert(1)</script>',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes quotes in firstName to prevent attribute injection', () => {
      const { html } = orderCancellationTemplate({
        ...BASE_CANCELLED,
        firstName: '" style="color:red',
      });
      expect(html).not.toContain('" style="color:red');
      expect(html).toContain('&quot;');
    });

    it('passes safe firstName through unchanged', () => {
      const { html } = orderCancellationTemplate(BASE_CANCELLED);
      expect(html).toContain('Tomasz');
    });
  });
});

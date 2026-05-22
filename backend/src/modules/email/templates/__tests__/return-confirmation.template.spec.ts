import { returnConfirmationTemplate } from '../return-confirmation.template';

const BASE_WITHDRAWAL = {
  firstName: 'Anna',
  orderNumber: 'ORD-2026-042',
  requestId: 'clx1234567890',
  type: 'WITHDRAWAL' as const,
  items: [
    { productName: 'Perfumy Gold 50ml', quantity: 1 },
    { productName: 'Krem Pielęgnacyjny', quantity: 2 },
  ],
};

const BASE_COMPLAINT = { ...BASE_WITHDRAWAL, type: 'COMPLAINT' as const };

describe('returnConfirmationTemplate()', () => {
  // ── Subject line ──────────────────────────────────────────────────

  describe('subject', () => {
    it('WITHDRAWAL — contains "odstąpienia od umowy"', () => {
      const { subject } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(subject.toLowerCase()).toContain('odstąpienia od umowy');
    });

    it('WITHDRAWAL — explicitly references art. 27', () => {
      const { subject } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(subject).toMatch(/art\.\s*27/i);
    });

    it('WITHDRAWAL — contains the order number', () => {
      const { subject } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(subject).toContain('ORD-2026-042');
    });

    it('COMPLAINT — contains "reklamacji"', () => {
      const { subject } = returnConfirmationTemplate(BASE_COMPLAINT);
      expect(subject.toLowerCase()).toContain('reklamacji');
    });

    it('COMPLAINT — does not reference art. 27', () => {
      const { subject } = returnConfirmationTemplate(BASE_COMPLAINT);
      expect(subject).not.toMatch(/art\.\s*27/i);
    });

    it('subjects differ between WITHDRAWAL and COMPLAINT', () => {
      const { subject: ws } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      const { subject: cs } = returnConfirmationTemplate(BASE_COMPLAINT);
      expect(ws).not.toBe(cs);
    });
  });

  // ── HTML — type badge / legal basis ──────────────────────────────

  describe('HTML — legal type label', () => {
    it('WITHDRAWAL — badge includes "art. 27"', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toMatch(/art\.\s*27/i);
    });

    it('WITHDRAWAL — badge includes "Ustawowe odstąpienie od umowy"', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('Ustawowe odstąpienie od umowy');
    });

    it('COMPLAINT — badge includes "Reklamacja z tytułu rękojmi"', () => {
      const { html } = returnConfirmationTemplate(BASE_COMPLAINT);
      expect(html).toContain('Reklamacja z tytułu rękojmi');
    });

    it('COMPLAINT — does not contain art. 27 in HTML', () => {
      const { html } = returnConfirmationTemplate(BASE_COMPLAINT);
      expect(html).not.toMatch(/art\.\s*27/i);
    });
  });

  // ── HTML — personalisation & reference data ───────────────────────

  describe('HTML — content', () => {
    it('contains the customer first name', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('Anna');
    });

    it('contains the request ID', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('clx1234567890');
    });

    it('contains all item names', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('Perfumy Gold 50ml');
      expect(html).toContain('Krem Pielęgnacyjny');
    });

    it('contains item quantities', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('× 2');
    });

    it('contains the contact email address', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('zwroty@aromaterie.pl');
    });

    it('contains the order number in the body', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('ORD-2026-042');
    });
  });

  // ── HTML — validity ───────────────────────────────────────────────

  describe('HTML — structure', () => {
    it('returns a valid HTML document', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('sets lang="pl"', () => {
      const { html } = returnConfirmationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('lang="pl"');
    });
  });
});

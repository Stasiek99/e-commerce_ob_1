import { orderConfirmationTemplate } from '../order-confirmation.template';

const BASE = {
  orderNumber: 'ORD-2026-000001',
  firstName: 'Anna',
  items: [{ name: 'Rose Oud 50ml', quantity: 1, price: 9900 }],
  totalInCents: 9900,
};

describe('orderConfirmationTemplate()', () => {
  // ── Subject line ──────────────────────────────────────────────────────────

  describe('subject', () => {
    it('contains the order number', () => {
      const { subject } = orderConfirmationTemplate(BASE);
      expect(subject).toContain('ORD-2026-000001');
    });

    it('contains "Potwierdzenie zamówienia"', () => {
      const { subject } = orderConfirmationTemplate(BASE);
      expect(subject).toContain('Potwierdzenie zamówienia');
    });
  });

  // ── HTML — personalisation & order data ──────────────────────────────────

  describe('HTML — content', () => {
    it('contains the customer first name', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).toContain('Anna');
    });

    it('contains the order number in the body', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).toContain('ORD-2026-000001');
    });

    it('contains item names', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).toContain('Rose Oud 50ml');
    });

    it('contains the formatted total', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).toContain('99,00 zł');
    });
  });

  // ── HTML — delivery estimate ──────────────────────────────────────────────

  describe('delivery estimate', () => {
    it('includes "następny dzień roboczy" for INPOST', () => {
      const { html } = orderConfirmationTemplate({ ...BASE, carrierCode: 'INPOST' });
      expect(html).toContain('następny dzień roboczy');
    });

    it('includes "1–2 dni robocze" for DHL', () => {
      const { html } = orderConfirmationTemplate({ ...BASE, carrierCode: 'DHL' });
      expect(html).toContain('1–2 dni robocze');
    });

    it('includes "2–3 dni robocze" for GLS', () => {
      const { html } = orderConfirmationTemplate({ ...BASE, carrierCode: 'GLS' });
      expect(html).toContain('2–3 dni robocze');
    });

    it('includes "Szacowany czas dostawy" label when carrierCode is known', () => {
      const { html } = orderConfirmationTemplate({ ...BASE, carrierCode: 'INPOST' });
      expect(html).toContain('Szacowany czas dostawy');
    });

    it('omits delivery estimate when carrierCode is absent', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).not.toContain('Szacowany czas dostawy');
    });

    it('omits delivery estimate for unknown carrier code', () => {
      const { html } = orderConfirmationTemplate({ ...BASE, carrierCode: 'FEDEX' });
      expect(html).not.toContain('Szacowany czas dostawy');
    });
  });

  // ── Return cost disclosure (Art. 34 ust. 2 UoK) ──────────────────────────

  describe('return cost disclosure', () => {
    it('contains the mandatory return cost notice', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).toContain('bezpośrednie koszty zwrotu towarów');
    });

    it('references art. 34 ust. 2 ustawy o prawach konsumenta', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).toContain('34');
      expect(html).toContain('ustawy o prawach konsumenta');
    });

    it('includes the notice regardless of carrier', () => {
      for (const code of ['INPOST', 'DHL', 'GLS', undefined]) {
        const { html } = orderConfirmationTemplate({ ...BASE, carrierCode: code });
        expect(html).toContain('bezpośrednie koszty zwrotu towarów');
      }
    });
  });

  // ── HTML — structure ─────────────────────────────────────────────────────

  describe('HTML — structure', () => {
    it('returns a valid HTML document', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('sets lang="pl"', () => {
      const { html } = orderConfirmationTemplate(BASE);
      expect(html).toContain('lang="pl"');
    });
  });
});

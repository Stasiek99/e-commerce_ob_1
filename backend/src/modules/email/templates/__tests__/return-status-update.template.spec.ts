import { returnStatusUpdateTemplate } from '../return-status-update.template';

const BASE = {
  firstName: 'Zofia',
  orderNumber: 'ORD-2026-099',
  requestId: 'clx9999999999',
  type: 'COMPLAINT' as const,
  newStatus: 'APPROVED' as const,
};

describe('returnStatusUpdateTemplate()', () => {
  // ── Subject line ──────────────────────────────────────────────────

  describe('subject', () => {
    it('APPROVED — contains "zatwierdzone"', () => {
      const { subject } = returnStatusUpdateTemplate(BASE);
      expect(subject.toLowerCase()).toContain('zatwierdzone');
    });

    it('REJECTED — contains "odrzucone"', () => {
      const { subject } = returnStatusUpdateTemplate({ ...BASE, newStatus: 'REJECTED' });
      expect(subject.toLowerCase()).toContain('odrzucone');
    });

    it('COMPLETED — contains "zakończone"', () => {
      const { subject } = returnStatusUpdateTemplate({ ...BASE, newStatus: 'COMPLETED' });
      expect(subject.toLowerCase()).toContain('zakończone');
    });

    it('contains the order number', () => {
      const { subject } = returnStatusUpdateTemplate(BASE);
      expect(subject).toContain('ORD-2026-099');
    });

    it('WITHDRAWAL subject references "odstąpienia od umowy"', () => {
      const { subject } = returnStatusUpdateTemplate({ ...BASE, type: 'WITHDRAWAL' });
      expect(subject.toLowerCase()).toContain('odstąpienia od umowy');
    });
  });

  // ── HTML — status badge ───────────────────────────────────────────

  describe('HTML — status badge', () => {
    it('APPROVED — badge shows "Zatwierdzono"', () => {
      const { html } = returnStatusUpdateTemplate(BASE);
      expect(html).toContain('Zatwierdzono');
    });

    it('REJECTED — badge shows "Odrzucono"', () => {
      const { html } = returnStatusUpdateTemplate({ ...BASE, newStatus: 'REJECTED' });
      expect(html).toContain('Odrzucono');
    });

    it('COMPLETED — badge shows "Zakończono"', () => {
      const { html } = returnStatusUpdateTemplate({ ...BASE, newStatus: 'COMPLETED' });
      expect(html).toContain('Zakończono');
    });
  });

  // ── HTML — admin note ─────────────────────────────────────────────

  describe('HTML — admin note', () => {
    it('shows admin note block when adminNote is provided', () => {
      const { html } = returnStatusUpdateTemplate({
        ...BASE,
        adminNote: 'Reklamacja uznana — wysyłamy nowy produkt.',
      });
      expect(html).toContain('Reklamacja uznana — wysyłamy nowy produkt.');
      expect(html).toContain('Wiadomość od obsługi klienta');
    });

    it('omits admin note block when adminNote is absent', () => {
      const { html } = returnStatusUpdateTemplate(BASE);
      expect(html).not.toContain('Wiadomość od obsługi klienta');
    });
  });

  // ── HTML — content ────────────────────────────────────────────────

  describe('HTML — content', () => {
    it('contains the customer first name', () => {
      const { html } = returnStatusUpdateTemplate(BASE);
      expect(html).toContain('Zofia');
    });

    it('contains the request ID', () => {
      const { html } = returnStatusUpdateTemplate(BASE);
      expect(html).toContain('clx9999999999');
    });

    it('contains the contact email', () => {
      const { html } = returnStatusUpdateTemplate(BASE);
      expect(html).toContain('zwroty@aromaterie.pl');
    });
  });

  // ── HTML — structure ──────────────────────────────────────────────

  describe('HTML — structure', () => {
    it('returns a valid HTML document', () => {
      const { html } = returnStatusUpdateTemplate(BASE);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('sets lang="pl"', () => {
      const { html } = returnStatusUpdateTemplate(BASE);
      expect(html).toContain('lang="pl"');
    });
  });

  // ── XSS — user-supplied fields are HTML-escaped ───────────────────

  describe('XSS — escaping', () => {
    it('escapes HTML in firstName', () => {
      const { html } = returnStatusUpdateTemplate({
        ...BASE,
        firstName: '<script>alert(1)</script>',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML in adminNote', () => {
      const { html } = returnStatusUpdateTemplate({
        ...BASE,
        adminNote: '<img src=x onerror=fetch("https://evil.com/")>',
      });
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('passes safe firstName through unchanged', () => {
      const { html } = returnStatusUpdateTemplate(BASE);
      expect(html).toContain('Zofia');
    });

    it('passes safe adminNote through unchanged', () => {
      const { html } = returnStatusUpdateTemplate({
        ...BASE,
        adminNote: 'Produkt odesłany.',
      });
      expect(html).toContain('Produkt odesłany.');
    });
  });
});

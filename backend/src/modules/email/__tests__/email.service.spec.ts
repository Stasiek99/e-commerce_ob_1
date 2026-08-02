import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email.service';

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
    contacts: { create: jest.fn() },
  })),
}));

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  withScope: jest.fn((cb: (scope: unknown) => void) =>
    cb({ setTag: jest.fn(), setContext: jest.fn(), setLevel: jest.fn() }),
  ),
}));

describe('EmailService — admin alert HTML escaping', () => {
  let service: EmailService;

  beforeEach(async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, def?: unknown) => def) },
        },
      ],
    }).compile();

    service = module.get(EmailService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── sendFraudReviewAlert ─────────────────────────────────────────────────────
  // Invariant: customerEmail traces back to order.snapshotEmail (User.email or
  // guestEmail), which is @IsEmail()-validated but not a strict guarantee against
  // raw '<'/'>' (RFC 5321 quoted-string local parts). Without escaping, a crafted
  // value would inject markup into the internal admin alert email.

  describe('sendFraudReviewAlert', () => {
    it('escapes HTML special characters in customerEmail', async () => {
      await service.sendFraudReviewAlert({
        to: 'admin@store.com',
        orderNumber: 'ORD-1',
        customerEmail: '<script>alert(1)</script>@evil.com',
        totalInCents: 1000,
        radarRiskLevel: 'elevated',
      });

      const html = mockSend.mock.calls[0][0].html as string;
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;@evil.com');
    });

    it('renders a well-formed customerEmail unchanged (no double-escaping)', async () => {
      await service.sendFraudReviewAlert({
        to: 'admin@store.com',
        orderNumber: 'ORD-1',
        customerEmail: 'jan.kowalski@example.com',
        totalInCents: 1000,
        radarRiskLevel: 'normal',
      });

      const html = mockSend.mock.calls[0][0].html as string;
      expect(html).toContain('jan.kowalski@example.com');
    });
  });

  // ── sendDisputeAlert ─────────────────────────────────────────────────────────
  // Invariant: both customerEmail and reason (the latter "for completeness" per
  // the audit — Stripe's reason is enum-constrained, but escaping is applied
  // consistently with every other field crossing this trust boundary) must be
  // escaped before interpolation into the chargeback alert HTML.

  describe('sendDisputeAlert', () => {
    it('escapes HTML special characters in customerEmail', async () => {
      await service.sendDisputeAlert({
        to: 'admin@store.com',
        orderNumber: 'ORD-1',
        customerEmail: '<img src=x onerror=alert(1)>@evil.com',
        amountInCents: 1000,
        reason: 'fraudulent',
        evidenceDeadline: '2026-07-01T00:00:00.000Z',
        disputeId: 'dp_1',
      });

      const html = mockSend.mock.calls[0][0].html as string;
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;@evil.com');
    });

    it('escapes HTML special characters in reason', async () => {
      await service.sendDisputeAlert({
        to: 'admin@store.com',
        orderNumber: 'ORD-1',
        customerEmail: 'jan@example.com',
        amountInCents: 1000,
        reason: '"><script>alert(2)</script>',
        evidenceDeadline: '2026-07-01T00:00:00.000Z',
        disputeId: 'dp_2',
      });

      const html = mockSend.mock.calls[0][0].html as string;
      expect(html).not.toContain('<script>alert(2)</script>');
      expect(html).toContain('&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
    });

    it('renders well-formed customerEmail and reason unchanged (no double-escaping)', async () => {
      await service.sendDisputeAlert({
        to: 'admin@store.com',
        orderNumber: 'ORD-1',
        customerEmail: 'jan.kowalski@example.com',
        amountInCents: 1000,
        reason: 'product_not_received',
        evidenceDeadline: '2026-07-01T00:00:00.000Z',
        disputeId: 'dp_3',
      });

      const html = mockSend.mock.calls[0][0].html as string;
      expect(html).toContain('jan.kowalski@example.com');
      expect(html).toContain('product_not_received');
    });
  });
});

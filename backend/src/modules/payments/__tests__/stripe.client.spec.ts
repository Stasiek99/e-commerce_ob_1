import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeClient, CreateCheckoutSessionInput } from '../stripe.client';

// Mock the Stripe SDK before the module is loaded.
// StripeClient uses `require('stripe')` internally, so jest.mock intercepts it.
const mockSessionsCreate = jest.fn();
jest.mock('stripe', () => {
  return function MockStripe() {
    return {
      checkout: {
        sessions: {
          create: mockSessionsCreate,
          expire: jest.fn(),
          retrieve: jest.fn(),
        },
      },
      refunds: { create: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    };
  };
});

const BASE_INPUT: CreateCheckoutSessionInput = {
  orderId: 'order-1',
  orderNumber: 'ORD-2026-000001',
  customerEmail: 'jan@example.com',
  currency: 'pln',
  lineItems: [{ name: 'Perfumy Gold 50ml', unitAmount: 12999, quantity: 1 }],
  successUrl: 'http://localhost:4200/checkout/success',
  cancelUrl: 'http://localhost:4200/checkout/failure',
};

const MOCK_SESSION = {
  id: 'cs_test_abc',
  url: 'https://checkout.stripe.com/pay/cs_test_abc',
  payment_intent: 'pi_test_abc',
};

async function buildClient(ttlMinutes?: number) {
  const module = await Test.createTestingModule({
    providers: [
      StripeClient,
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: jest.fn().mockReturnValue('sk_test_dummy'),
          get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === 'STRIPE_CHECKOUT_TTL_MINUTES') return ttlMinutes ?? defaultValue;
            return defaultValue;
          }),
        },
      },
    ],
  }).compile();
  return module.get(StripeClient);
}

describe('StripeClient.createCheckoutSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionsCreate.mockResolvedValue(MOCK_SESSION);
  });

  // ── expires_at ──────────────────────────────────────────────────────

  describe('expires_at', () => {
    it('sets expires_at ~30 minutes from now by default', async () => {
      const before = Math.floor(Date.now() / 1000);
      const client = await buildClient();

      await client.createCheckoutSession(BASE_INPUT);

      const after = Math.floor(Date.now() / 1000);
      const { expires_at } = mockSessionsCreate.mock.calls[0][0];

      // Should be within the [before+1800, after+1800] window
      expect(expires_at).toBeGreaterThanOrEqual(before + 1800);
      expect(expires_at).toBeLessThanOrEqual(after + 1800);
    });

    it('respects STRIPE_CHECKOUT_TTL_MINUTES when set above 30', async () => {
      const client = await buildClient(60); // 1 hour

      const before = Math.floor(Date.now() / 1000);
      await client.createCheckoutSession(BASE_INPUT);
      const after = Math.floor(Date.now() / 1000);

      const { expires_at } = mockSessionsCreate.mock.calls[0][0];
      expect(expires_at).toBeGreaterThanOrEqual(before + 3600);
      expect(expires_at).toBeLessThanOrEqual(after + 3600);
    });

    it('clamps STRIPE_CHECKOUT_TTL_MINUTES below 30 up to 30 (Stripe minimum)', async () => {
      const client = await buildClient(5); // 5 minutes — below Stripe minimum

      const before = Math.floor(Date.now() / 1000);
      await client.createCheckoutSession(BASE_INPUT);
      const after = Math.floor(Date.now() / 1000);

      const { expires_at } = mockSessionsCreate.mock.calls[0][0];
      // Must be at least 30 minutes, not 5
      expect(expires_at).toBeGreaterThanOrEqual(before + 1800);
      expect(expires_at).toBeLessThanOrEqual(after + 1800);
    });

    it('always passes expires_at as an integer (Unix timestamp)', async () => {
      const client = await buildClient();
      await client.createCheckoutSession(BASE_INPUT);
      const { expires_at } = mockSessionsCreate.mock.calls[0][0];
      expect(Number.isInteger(expires_at)).toBe(true);
    });
  });

  // ── session shape ────────────────────────────────────────────────────

  describe('session parameters', () => {
    it('passes orderId and orderNumber in metadata', async () => {
      const client = await buildClient();
      await client.createCheckoutSession(BASE_INPUT);
      const params = mockSessionsCreate.mock.calls[0][0];
      expect(params.metadata).toMatchObject({
        orderId: 'order-1',
        orderNumber: 'ORD-2026-000001',
      });
    });

    it('sets locale to pl', async () => {
      const client = await buildClient();
      await client.createCheckoutSession(BASE_INPUT);
      expect(mockSessionsCreate.mock.calls[0][0].locale).toBe('pl');
    });

    it('sets mode to payment', async () => {
      const client = await buildClient();
      await client.createCheckoutSession(BASE_INPUT);
      expect(mockSessionsCreate.mock.calls[0][0].mode).toBe('payment');
    });

    it('returns the Stripe session object from the SDK', async () => {
      const client = await buildClient();
      const result = await client.createCheckoutSession(BASE_INPUT);
      expect(result).toEqual(MOCK_SESSION);
    });
  });
});

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeClient, CreateCheckoutSessionInput } from '../stripe.client';

// Mock the Stripe SDK before the module is loaded.
// StripeClient uses `require('stripe')` internally, so jest.mock intercepts it.
const mockSessionsCreate = jest.fn();
const mockCouponsCreate = jest.fn();
const mockCouponsDel = jest.fn();
const mockStripeConstructor = jest.fn();
jest.mock('stripe', () => {
  return function MockStripe(...args: unknown[]) {
    mockStripeConstructor(...args);
    return {
      checkout: {
        sessions: {
          create: mockSessionsCreate,
          expire: jest.fn(),
          retrieve: jest.fn(),
        },
      },
      coupons: {
        create: mockCouponsCreate,
        del: mockCouponsDel,
      },
      refunds: { create: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    };
  };
});

const BASE_INPUT: CreateCheckoutSessionInput = {
  orderId: 'order-1',
  orderNumber: 'ORD-2026-000001',
  paymentId: 'pay-1',
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

// ─── StripeClient construction ─────────────────────────────────────────────
// Guards the fix: apiVersion must be pinned explicitly rather than left to
// whatever DEFAULT_API_VERSION happens to ship with the installed `stripe`
// package (see docs/accepted-tradeoffs.md "Stripe API version").

describe('StripeClient construction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('constructs the Stripe SDK with the pinned apiVersion', async () => {
    await buildClient();

    expect(mockStripeConstructor).toHaveBeenCalledWith(
      'sk_test_dummy',
      { apiVersion: '2026-05-27.dahlia', timeout: 15000, maxNetworkRetries: 2 },
    );
  });

  it('passes the API key from STRIPE_SECRET_KEY as the first constructor argument', async () => {
    await buildClient();

    const [apiKey] = mockStripeConstructor.mock.calls[0];
    expect(apiKey).toBe('sk_test_dummy');
  });

  // Guards business-process-model.md finding A7: no timeout/retry config meant
  // every call rode the SDK's defaults (80s timeout, 0 retries), risking the
  // synchronous webhook handler holding its response open near Stripe's own
  // retry-patience window.
  it('configures a bounded timeout and automatic network retries', async () => {
    await buildClient();

    const [, config] = mockStripeConstructor.mock.calls[0];
    expect(config.timeout).toBe(15000);
    expect(config.maxNetworkRetries).toBe(2);
  });
});

describe('StripeClient.createCheckoutSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionsCreate.mockResolvedValue(MOCK_SESSION);
    mockCouponsCreate.mockResolvedValue({ id: 'co_test_discount' });
    mockCouponsDel.mockResolvedValue({});
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

  // ── idempotency keys ─────────────────────────────────────────────────
  // Guards the fix: LB retries must not produce duplicate Stripe objects.

  describe('idempotency keys', () => {
    it('passes checkout-<paymentId> idempotency key to sessions.create', async () => {
      const client = await buildClient();

      await client.createCheckoutSession({ ...BASE_INPUT, paymentId: 'pay-abc' });

      const options = mockSessionsCreate.mock.calls[0][1];
      expect(options).toEqual({ idempotencyKey: 'checkout-pay-abc' });
    });

    it('passes coupon-<paymentId> idempotency key to coupons.create when discount is present', async () => {
      const client = await buildClient();

      await client.createCheckoutSession({ ...BASE_INPUT, paymentId: 'pay-xyz', discountAmountInCents: 500 });

      const options = mockCouponsCreate.mock.calls[0][1];
      expect(options).toEqual({ idempotencyKey: 'coupon-pay-xyz' });
    });

    it('does not call coupons.create (no idempotency key concern) when no discount', async () => {
      const client = await buildClient();

      await client.createCheckoutSession(BASE_INPUT);

      expect(mockCouponsCreate).not.toHaveBeenCalled();
    });
  });

  // ── payment methods ──────────────────────────────────────────────────
  // Guards the fix: BLIK and P24 must be explicitly listed.
  // Passing only ['card'] silently excludes them — Stripe does not
  // auto-include BLIK/P24 via the 'card' type.

  describe('payment methods', () => {
    it('includes card in payment_method_types', async () => {
      const client = await buildClient();

      await client.createCheckoutSession(BASE_INPUT);

      const { payment_method_types } = mockSessionsCreate.mock.calls[0][0];
      expect(payment_method_types).toContain('card');
    });

    it('includes blik in payment_method_types', async () => {
      const client = await buildClient();

      await client.createCheckoutSession(BASE_INPUT);

      const { payment_method_types } = mockSessionsCreate.mock.calls[0][0];
      expect(payment_method_types).toContain('blik');
    });

    it('includes p24 in payment_method_types', async () => {
      const client = await buildClient();

      await client.createCheckoutSession(BASE_INPUT);

      const { payment_method_types } = mockSessionsCreate.mock.calls[0][0];
      expect(payment_method_types).toContain('p24');
    });

    it('passes exactly card, blik, and p24 — no more, no less', async () => {
      const client = await buildClient();

      await client.createCheckoutSession(BASE_INPUT);

      const { payment_method_types } = mockSessionsCreate.mock.calls[0][0];
      expect(payment_method_types).toEqual(['card', 'blik', 'p24']);
    });
  });

  // ── discount coupon ──────────────────────────────────────────────────
  // Guards the fix: orders with a coupon must have a Stripe coupon attached
  // so Stripe charges order.totalInCents, not the pre-discount item sum.

  describe('discount coupon', () => {
    it('does not create a Stripe coupon when discountAmountInCents is absent', async () => {
      const client = await buildClient();

      await client.createCheckoutSession(BASE_INPUT);

      expect(mockCouponsCreate).not.toHaveBeenCalled();
    });

    it('does not create a Stripe coupon when discountAmountInCents is 0', async () => {
      const client = await buildClient();

      await client.createCheckoutSession({ ...BASE_INPUT, discountAmountInCents: 0 });

      expect(mockCouponsCreate).not.toHaveBeenCalled();
    });

    it('does not include a discounts key in the session when there is no discount', async () => {
      const client = await buildClient();

      await client.createCheckoutSession(BASE_INPUT);

      const params = mockSessionsCreate.mock.calls[0][0];
      expect(params.discounts).toBeUndefined();
    });

    it('creates a Stripe coupon with the correct amount, currency, and restrictions when discountAmountInCents > 0', async () => {
      const client = await buildClient();

      await client.createCheckoutSession({ ...BASE_INPUT, discountAmountInCents: 2000, couponLabel: 'SUMMER20' });

      expect(mockCouponsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount_off: 2000,
          currency: 'pln',
          duration: 'once',
          max_redemptions: 1,
          name: 'SUMMER20',
        }),
        expect.objectContaining({ idempotencyKey: 'coupon-pay-1' }),
      );
    });

    it('uses couponLabel as the Stripe coupon name', async () => {
      const client = await buildClient();

      await client.createCheckoutSession({ ...BASE_INPUT, discountAmountInCents: 1500, couponLabel: 'VIP15' });

      expect(mockCouponsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'VIP15' }),
        expect.anything(),
      );
    });

    it('falls back to "Rabat" as the coupon name when couponLabel is not provided', async () => {
      const client = await buildClient();

      await client.createCheckoutSession({ ...BASE_INPUT, discountAmountInCents: 1500 });

      expect(mockCouponsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Rabat' }),
        expect.anything(),
      );
    });

    it('attaches the created coupon id to the session via discounts array', async () => {
      mockCouponsCreate.mockResolvedValue({ id: 'co_abc123' });
      const client = await buildClient();

      await client.createCheckoutSession({ ...BASE_INPUT, discountAmountInCents: 2000, couponLabel: 'SUMMER20' });

      const params = mockSessionsCreate.mock.calls[0][0];
      expect(params.discounts).toEqual([{ coupon: 'co_abc123' }]);
    });
  });
});

// ─── StripeClient.deleteCoupon ────────────────────────────────────────────────
// Guards the fix: one-time checkout coupons must be deleted after the session
// completes or expires to prevent accumulation in the Stripe Dashboard.

describe('StripeClient.deleteCoupon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCouponsDel.mockResolvedValue({});
  });

  it('calls stripe.coupons.del with the given coupon ID', async () => {
    const client = await buildClient();

    await client.deleteCoupon('co_test_abc');

    expect(mockCouponsDel).toHaveBeenCalledWith('co_test_abc');
  });

  it('resolves to undefined when stripe.coupons.del succeeds', async () => {
    const client = await buildClient();

    await expect(client.deleteCoupon('co_test_abc')).resolves.toBeUndefined();
  });

  it('resolves without throwing when stripe.coupons.del rejects (already deleted or not found)', async () => {
    mockCouponsDel.mockRejectedValue(new Error('No such coupon: co_already_gone'));
    const client = await buildClient();

    await expect(client.deleteCoupon('co_already_gone')).resolves.toBeUndefined();
  });

  it('calls stripe.coupons.del exactly once per invocation', async () => {
    const client = await buildClient();

    await client.deleteCoupon('co_one_shot');

    expect(mockCouponsDel).toHaveBeenCalledTimes(1);
  });
});

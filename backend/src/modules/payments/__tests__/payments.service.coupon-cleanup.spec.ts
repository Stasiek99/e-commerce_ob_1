/**
 * Regression harness for the orphaned Stripe coupon fix.
 *
 * Before the fix: when a customer abandoned a discounted checkout and came back,
 * initiatePayment reset the payment row (stripeCheckoutSessionId → null) BEFORE
 * deleting the old coupon. The checkout.session.expired webhook then failed to
 * find the payment row by stripeCheckoutSessionId and the coupon was never deleted.
 *
 * After the fix: the coupon is deleted synchronously inside initiatePayment,
 * before the payment row is reset, so the webhook no longer needs to handle it.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import type { Stripe } from 'stripe/cjs/stripe.core';
import * as Sentry from '@sentry/nestjs';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeClient } from '../stripe.client';
import { EmailQueueService } from '../../email/email-queue.service';
import { InvoiceService } from '../../invoice/invoice.service';
import { ConfigService } from '@nestjs/config';
import { CouponService } from '../../coupons/coupon.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  withScope: jest.fn().mockImplementation((cb: (scope: any) => void) => {
    cb({ setLevel: jest.fn(), setTag: jest.fn(), setContext: jest.fn() });
  }),
}));

jest.mock('axios', () => ({
  default: { post: jest.fn().mockResolvedValue({ data: 'ok' }) },
  __esModule: true,
}));

const MOCK_SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_new';
const MOCK_NEW_SESSION: Partial<Stripe.Checkout.Session> = {
  id: 'cs_new_123',
  payment_intent: 'pi_new_abc',
  url: MOCK_SESSION_URL,
};

const MOCK_ORDER = {
  id: 'order-1',
  orderNumber: 'ORD-2026-001',
  snapshotEmail: 'test@example.com',
  totalInCents: 12999,
  shippingCostInCents: 1499,
  carrierCode: 'INPOST',
  discountInCents: 2000,
  couponCode: 'SUMMER20',
  userId: null,
  items: [
    { snapshotName: 'Dior 100ml', snapshotSku: 'DS-100', snapshotPrice: 11500, quantity: 1 },
  ],
};

describe('PaymentsService — orphaned coupon cleanup on payment retry', () => {
  let service: PaymentsService;
  let prisma: any;
  let stripeClient: jest.Mocked<StripeClient>;
  let redis: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PrismaService,
          useValue: {
            payment: {
              findUnique: jest.fn(),
              findUniqueOrThrow: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn().mockResolvedValue({ id: 'payment-fresh' }),
              update: jest.fn().mockResolvedValue({ id: 'payment-1' }),
            },
            order: {
              findUniqueOrThrow: jest.fn(),
              update: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
            },
            orderEvent: { create: jest.fn() },
            orderItem: { update: jest.fn(), findMany: jest.fn() },
            productVariant: { update: jest.fn() },
            processedStripeEvent: {
              create: jest.fn().mockResolvedValue({}),
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            outboxMessage: {
              create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
              update: jest.fn().mockResolvedValue({}),
              findMany: jest.fn().mockResolvedValue([]),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: StripeClient,
          useValue: {
            createCheckoutSession: jest.fn().mockResolvedValue(MOCK_NEW_SESSION),
            constructWebhookEvent: jest.fn(),
            retrieveCheckoutSession: jest.fn(),
            expireCheckoutSession: jest.fn().mockResolvedValue(undefined),
            retrievePaymentIntentWithCharge: jest.fn().mockResolvedValue({
              latest_charge: { outcome: { risk_level: 'normal' } },
            }),
            createRefund: jest.fn(),
            createPartialRefund: jest.fn(),
            deleteCoupon: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EmailQueueService,
          useValue: {
            sendPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
            sendPaymentConfirmedWithInvoice: jest.fn().mockResolvedValue(undefined),
            sendNewOrderNotification: jest.fn().mockResolvedValue(undefined),
            sendFraudReviewAlert: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            processInvoice: jest.fn().mockResolvedValue({
              url: 'https://mock-invoice.pdf',
              storagePath: 'invoices/FV.pdf',
              pdf: Buffer.from(''),
              invoiceNumber: 'FV/2026/000001',
            }),
            getSignedUrl: jest.fn().mockResolvedValue('https://mock-invoice.pdf'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('pln'),
            getOrThrow: jest.fn().mockReturnValue('http://localhost:4200/checkout/success'),
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn().mockResolvedValue('OK'), get: jest.fn() },
        },
        {
          provide: CouponService,
          useValue: { validate: jest.fn().mockResolvedValue({ valid: true }) },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
    prisma = module.get(PrismaService);
    stripeClient = module.get(StripeClient);
    redis = module.get('REDIS_CLIENT');
  });

  afterEach(() => jest.clearAllMocks());

  // ── helpers ───────────────────────────────────────────────────────────────

  function pendingPaymentWithSession(sessionId = 'cs_old_expired') {
    return {
      id: 'payment-1',
      status: PaymentStatus.PENDING,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: null,
      failureReason: null,
    };
  }

  function failedPaymentWithSession(sessionId = 'cs_old_failed') {
    return {
      id: 'payment-1',
      status: PaymentStatus.FAILED,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: null,
      failureReason: 'Stripe API error',
    };
  }

  function expiredSessionWithCoupon(coupon: string | { id: string }) {
    return {
      id: 'cs_old_expired',
      status: 'expired',
      url: null,
      discounts: [{ coupon }],
    };
  }

  // ── PENDING + expired session (the primary bug scenario) ─────────────────

  it('deletes the orphaned coupon when a PENDING session is expired and has a string coupon ID', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue(pendingPaymentWithSession());
    stripeClient.retrieveCheckoutSession.mockResolvedValue(
      expiredSessionWithCoupon('co_old_abc') as any,
    );

    await service.initiatePayment('order-1');

    expect(stripeClient.deleteCoupon).toHaveBeenCalledWith('co_old_abc');
    expect(stripeClient.deleteCoupon).toHaveBeenCalledTimes(1);
  });

  it('extracts coupon.id when the old session discount contains an expanded coupon object', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue(pendingPaymentWithSession());
    stripeClient.retrieveCheckoutSession.mockResolvedValue(
      expiredSessionWithCoupon({ id: 'co_expanded_obj' }) as any,
    );

    await service.initiatePayment('order-1');

    expect(stripeClient.deleteCoupon).toHaveBeenCalledWith('co_expanded_obj');
  });

  it('does not call deleteCoupon when the expired session has no discounts', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue(pendingPaymentWithSession());
    stripeClient.retrieveCheckoutSession.mockResolvedValue({
      id: 'cs_old_expired',
      status: 'expired',
      url: null,
      discounts: [],
    } as any);

    await service.initiatePayment('order-1');

    expect(stripeClient.deleteCoupon).not.toHaveBeenCalled();
  });

  it('does not call deleteCoupon when old session retrieval throws (graceful degradation)', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue(pendingPaymentWithSession());
    stripeClient.retrieveCheckoutSession.mockRejectedValue(new Error('Stripe unavailable'));

    // Should not throw — the catch block absorbs the retrieval error
    const result = await service.initiatePayment('order-1');

    expect(stripeClient.deleteCoupon).not.toHaveBeenCalled();
    expect(result.paymentUrl).toBe(MOCK_SESSION_URL);
  });

  it('nulls stripeCheckoutSessionId in the payment row after coupon deletion (ordering guarantee)', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue(pendingPaymentWithSession('cs_old_to_null'));
    stripeClient.retrieveCheckoutSession.mockResolvedValue(
      expiredSessionWithCoupon('co_old_abc') as any,
    );

    await service.initiatePayment('order-1');

    // Verify the payment row was reset (session ID nulled)
    const resetCall = (prisma.payment.update as jest.Mock).mock.calls.find(
      (c: any[]) => c[0]?.data?.stripeCheckoutSessionId === null,
    );
    expect(resetCall).toBeDefined();
    // And coupon was deleted (ensuring both happened)
    expect(stripeClient.deleteCoupon).toHaveBeenCalledWith('co_old_abc');
  });

  // ── FAILED row (secondary scenario — first block doesn't run) ────────────

  it('deletes the orphaned coupon when a FAILED payment row has an old session with a coupon', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue(failedPaymentWithSession('cs_failed_session'));
    stripeClient.retrieveCheckoutSession.mockResolvedValue(
      expiredSessionWithCoupon('co_failed_coupon') as any,
    );

    await service.initiatePayment('order-1');

    // retrieveCheckoutSession is called from inside the FAILED/reset block (fresh retrieval)
    expect(stripeClient.retrieveCheckoutSession).toHaveBeenCalledWith('cs_failed_session');
    expect(stripeClient.deleteCoupon).toHaveBeenCalledWith('co_failed_coupon');
  });

  it('does not call deleteCoupon when FAILED session retrieval throws (graceful degradation)', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue(failedPaymentWithSession('cs_failed_session'));
    stripeClient.retrieveCheckoutSession.mockRejectedValue(new Error('Stripe unavailable'));

    const result = await service.initiatePayment('order-1');

    expect(stripeClient.deleteCoupon).not.toHaveBeenCalled();
    expect(result.paymentUrl).toBe(MOCK_SESSION_URL);
  });

  it('does not call deleteCoupon when FAILED row has no session ID', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      status: PaymentStatus.FAILED,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      failureReason: 'Stripe API error',
    });

    await service.initiatePayment('order-1');

    expect(stripeClient.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(stripeClient.deleteCoupon).not.toHaveBeenCalled();
  });

  // ── Non-discounted order — no coupon to delete ───────────────────────────

  it('does not call deleteCoupon when the expired session has no discount (non-discounted retry)', async () => {
    const orderWithoutDiscount = { ...MOCK_ORDER, discountInCents: 0, couponCode: null };
    prisma.order.findUniqueOrThrow.mockResolvedValue(orderWithoutDiscount);
    prisma.payment.findUnique.mockResolvedValue(pendingPaymentWithSession());
    stripeClient.retrieveCheckoutSession.mockResolvedValue({
      id: 'cs_old_expired',
      status: 'expired',
      url: null,
      discounts: null,
    } as any);

    await service.initiatePayment('order-1');

    expect(stripeClient.deleteCoupon).not.toHaveBeenCalled();
  });

  // ── Open session reuse path — coupon must NOT be deleted ─────────────────

  it('does not call deleteCoupon when the existing session is still open (reuse path)', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue(MOCK_ORDER);
    prisma.payment.findUnique.mockResolvedValue(pendingPaymentWithSession('cs_still_open'));
    stripeClient.retrieveCheckoutSession.mockResolvedValue({
      id: 'cs_still_open',
      status: 'open',
      url: 'https://checkout.stripe.com/c/pay/cs_still_open',
      discounts: [{ coupon: 'co_active' }],
    } as any);

    const result = await service.initiatePayment('order-1');

    // Session URL reused — coupon belongs to active session, must NOT be deleted
    expect(stripeClient.deleteCoupon).not.toHaveBeenCalled();
    expect(result.paymentUrl).toBe('https://checkout.stripe.com/c/pay/cs_still_open');
  });
});

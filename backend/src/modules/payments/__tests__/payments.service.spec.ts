import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PaymentStatus, OrderStatus, Prisma } from '@prisma/client';
import type { Stripe } from 'stripe/cjs/stripe.core';
import * as Sentry from '@sentry/nestjs';
import axios from 'axios';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeClient } from '../stripe.client';
import { EmailQueueService } from '../../email/email-queue.service';
import { InvoiceService } from '../../invoice/invoice.service';
import { ConfigService } from '@nestjs/config';
import { CouponService } from '../../coupons/coupon.service';
import { ProductsService } from '../../products/products.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  withScope: jest.fn().mockImplementation((callback: (scope: any) => void) => {
    callback({ setLevel: jest.fn(), setTag: jest.fn(), setContext: jest.fn() });
  }),
}));

jest.mock('axios', () => ({
  default: { post: jest.fn().mockResolvedValue({ data: 'ok' }) },
  __esModule: true,
}));

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let stripeClient: jest.Mocked<StripeClient>;
  let emailService: jest.Mocked<EmailQueueService>;
  let invoiceService: jest.Mocked<InvoiceService>;
  let couponService: jest.Mocked<CouponService>;
  let productsService: { notifyStockChangesByDelta: jest.Mock };
  let redis: any;

  const mockSession: Partial<Stripe.Checkout.Session> = {
    id: 'cs_test_abc123',
    payment_intent: 'pi_test_abc123',
    url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
  };

  const mockPayment = {
    id: 'payment-1',
    orderId: 'order-1',
    status: PaymentStatus.PENDING,
    stripeCheckoutSessionId: 'cs_test_abc123',
    stripePaymentIntentId: 'pi_test_abc123',
    amountInCents: 14999,
    currency: 'PLN',
    paidAt: null,
    failureReason: null,
    rawWebhookPayload: null,
    provider: 'stripe',
    createdAt: new Date(),
    updatedAt: new Date(),
    order: {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: OrderStatus.PENDING_PAYMENT,
      snapshotEmail: 'test@example.com',
      snapshotFirstName: 'Jan',
      snapshotLastName: 'Kowalski',
      totalInCents: 14999,
      items: [
        { productVariantId: 'pv-1', quantity: 2 },
      ],
    },
  };

  const buildEvent = <T extends Stripe.Event.Type>(
    type: T,
    object: unknown,
  ): Stripe.Event =>
    ({
      id: `evt_${type}`,
      type,
      data: { object },
    }) as unknown as Stripe.Event;

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
              create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
              update: jest.fn().mockResolvedValue({}),
            },
            order: {
              findUniqueOrThrow: jest.fn(),
              update: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              findMany: jest.fn().mockResolvedValue([]),
            },
            orderEvent: {
              create: jest.fn(),
            },
            orderItem: {
              update: jest.fn(),
              findMany: jest.fn(),
            },
            productVariant: {
              update: jest.fn(),
            },
            couponUse: {
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
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
            $executeRaw: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: StripeClient,
          useValue: {
            createCheckoutSession: jest.fn(),
            constructWebhookEvent: jest.fn(),
            retrieveCheckoutSession: jest.fn(),
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
            processInvoice: jest.fn().mockResolvedValue({ url: 'https://mock-invoice.pdf', storagePath: 'invoices/FV-2026-000001.pdf', pdf: Buffer.from(''), invoiceNumber: 'FV/2026/000001' }),
            getSignedUrl: jest.fn().mockResolvedValue('https://mock-invoice.pdf'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('pln'),
            getOrThrow: jest
              .fn()
              .mockReturnValue('http://localhost:4200/checkout/success'),
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn().mockResolvedValue('OK'), get: jest.fn() },
        },
        {
          provide: CouponService,
          useValue: {
            validate: jest.fn().mockResolvedValue({ valid: true }),
          },
        },
        {
          provide: ProductsService,
          useValue: {
            notifyStockChangesByDelta: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
    prisma = module.get(PrismaService);
    redis = module.get('REDIS_CLIENT');
    stripeClient = module.get(StripeClient);
    emailService = module.get(EmailQueueService);
    invoiceService = module.get(InvoiceService);
    couponService = module.get(CouponService);
    productsService = module.get(ProductsService);

    // Default: pass prisma mock methods as tx so callback-form $transaction
    // executes the callback and tests can assert on prisma.* directly.
    // Individual tests that need different transaction behaviour override this.
    prisma.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === 'function') {
        return fn({
          $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.PENDING }]),
          $executeRaw: jest.fn().mockResolvedValue(0),
          processedStripeEvent: prisma.processedStripeEvent,
          payment: prisma.payment,
          order: prisma.order,
          orderEvent: prisma.orderEvent,
          productVariant: prisma.productVariant,
          outboxMessage: prisma.outboxMessage,
          couponUse: prisma.couponUse,
        });
      }
      return Promise.all(fn);
    });
  });

  describe('handleWebhookEvent', () => {
    it('ignores unknown event types without touching the DB', async () => {
      const event = buildEvent('customer.created' as Stripe.Event.Type, {});

      await service.handleWebhookEvent(event);

      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips processing if payment is already COMPLETED (idempotency)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      });

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
    });

    it('marks payment COMPLETED on checkout.session.completed', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { stripeCheckoutSessionId: mockSession.id },
        include: { order: { include: { items: true } } },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArgs = prisma.$transaction.mock.calls[0][0];
      expect(typeof txArgs).toBe('function');
      // The invoice + email chain is fire-and-forget; flush microtasks before asserting
      await Promise.resolve();
      expect(emailService.sendPaymentConfirmedWithInvoice).toHaveBeenCalled();
    });

    it('silently returns if no payment exists for the session id', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
    });

    it('cancels order and restores stock on checkout.session.expired', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.PENDING }]),
            processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
            orderEvent: { create: jest.fn() },
            productVariant: { update: jest.fn() },
          });
        }
      });

      await service.handleWebhookEvent(
        buildEvent('checkout.session.expired', mockSession),
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
    });

    it('cancels order on checkout.session.async_payment_failed (delayed BLIK/P24 failure)', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.PENDING }]),
            processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
            orderEvent: { create: jest.fn() },
            productVariant: { update: jest.fn() },
          });
        }
      });

      await service.handleWebhookEvent(
        buildEvent('checkout.session.async_payment_failed', mockSession),
      );

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('does not cancel an already-paid order on a stray expired event', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      });

      await service.handleWebhookEvent(
        buildEvent('checkout.session.expired', mockSession),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // ── Stripe event deduplication ──────────────────────────────────────

    it('skips payment processing when the event_id is already in processed_stripe_events (duplicate delivery)', async () => {
      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`event_id`)',
        { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['event_id'] } },
      );
      // payment.findUnique is called before the transaction (Radar check needs the payment)
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      // $transaction rejects with P2002 because processedStripeEvent.create is inside it
      prisma.$transaction.mockRejectedValue(duplicateError);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(emailService.sendPaymentConfirmedWithInvoice).not.toHaveBeenCalled();
    });

    it('skips failure processing for expired event duplicate without touching stock', async () => {
      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`event_id`)',
        { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['event_id'] } },
      );
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockRejectedValue(duplicateError);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.expired', mockSession),
      );

      // $transaction was attempted but P2002 from processedStripeEvent.create caused early return
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('re-throws non-P2002 errors from the transaction (DB connection failure)', async () => {
      const dbError = new Prisma.PrismaClientKnownRequestError(
        'Connection timed out',
        { code: 'P1001', clientVersion: '6.0.0', meta: {} },
      );
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockRejectedValue(dbError);

      await expect(
        service.handleWebhookEvent(buildEvent('checkout.session.completed', mockSession)),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it('records the event_id before dispatching to any handler', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const event = buildEvent('checkout.session.completed', mockSession);
      await service.handleWebhookEvent(event);

      expect(prisma.processedStripeEvent.create).toHaveBeenCalledWith({
        data: { eventId: event.id },
      });
      // And the handler still ran (event was fresh)
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    // ── markSessionFailed idempotency (layer 2 guard) ────────────────────

    it('skips stock restoration when payment is already FAILED', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.FAILED,
      });

      await service.handleWebhookEvent(
        buildEvent('checkout.session.expired', mockSession),
      );

      // No transaction means no stock restoration attempted
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // ── Stripe Radar fraud review path ───────────────────────────────────────

    describe('fraud review path (Stripe Radar)', () => {
      const mockPaymentForFraud = {
        ...mockPayment,
        order: {
          ...mockPayment.order,
          snapshotLastName: 'Kowalski',
          snapshotStreet: 'ul. Testowa 1',
          snapshotCity: 'Kraków',
          snapshotPostalCode: '30-001',
          snapshotCompany: null,
          snapshotNip: null,
          itemsTotalInCents: 13500,
          shippingCostInCents: 1499,
          discountInCents: 0,
          couponCode: null,
          carrierCode: 'INPOST',
          createdAt: new Date('2026-01-15'),
          items: [
            { snapshotName: 'Dior 100ml', snapshotPrice: 13500, snapshotVatRate: 2300, quantity: 1 },
          ],
        },
      };

      it('sets order status to FRAUD_REVIEW and alerts admin when Radar risk_level is elevated', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForFraud);
        stripeClient.retrievePaymentIntentWithCharge.mockResolvedValue({
          latest_charge: { outcome: { risk_level: 'elevated' } },
        } as any);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', mockSession),
        );

        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: OrderStatus.FRAUD_REVIEW } }),
        );
        await Promise.resolve();
        expect(emailService.sendFraudReviewAlert).toHaveBeenCalled();
      });

      it('sets order status to FRAUD_REVIEW when Radar risk_level is highest', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForFraud);
        stripeClient.retrievePaymentIntentWithCharge.mockResolvedValue({
          latest_charge: { outcome: { risk_level: 'highest' } },
        } as any);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', mockSession),
        );

        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: OrderStatus.FRAUD_REVIEW } }),
        );
      });

      it('does not send customer confirmation when order is held for fraud review', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForFraud);
        stripeClient.retrievePaymentIntentWithCharge.mockResolvedValue({
          latest_charge: { outcome: { risk_level: 'elevated' } },
        } as any);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', mockSession),
        );

        await new Promise((resolve) => setImmediate(resolve));
        expect(emailService.sendPaymentConfirmedWithInvoice).not.toHaveBeenCalled();
        expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
      });

      it('sets order status to PAID and sends customer email when risk_level is normal', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForFraud);
        stripeClient.retrievePaymentIntentWithCharge.mockResolvedValue({
          latest_charge: { outcome: { risk_level: 'normal' } },
        } as any);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', mockSession),
        );

        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: OrderStatus.PAID } }),
        );
        await Promise.resolve();
        expect(emailService.sendFraudReviewAlert).not.toHaveBeenCalled();
        expect(emailService.sendPaymentConfirmedWithInvoice).toHaveBeenCalled();
      });

      it('defaults to PAID when retrievePaymentIntentWithCharge throws (resilience)', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForFraud);
        stripeClient.retrievePaymentIntentWithCharge.mockRejectedValue(
          new Error('Stripe API timeout'),
        );

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', mockSession),
        );

        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: OrderStatus.PAID } }),
        );
        expect(emailService.sendFraudReviewAlert).not.toHaveBeenCalled();
      });

      it('defaults to PAID and skips Radar check when paymentIntentId is null', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForFraud);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', { ...mockSession, payment_intent: null }),
        );

        expect(stripeClient.retrievePaymentIntentWithCharge).not.toHaveBeenCalled();
        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: OrderStatus.PAID } }),
        );
      });

      it('includes the Radar risk level in the orderEvent note when flagged', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForFraud);
        stripeClient.retrievePaymentIntentWithCharge.mockResolvedValue({
          latest_charge: { outcome: { risk_level: 'elevated' } },
        } as any);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', mockSession),
        );

        expect(prisma.orderEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              note: expect.stringContaining('elevated'),
            }),
          }),
        );
      });
    });

    // ── Defense-in-depth: Stripe captured-amount assertion ────────────────────
    // markSessionPaid must never trust payment.amountInCents blindly — it has to
    // confirm Stripe actually collected that amount before marking the order PAID.

    describe('amount mismatch guard', () => {
      const mockPaymentForAmountCheck = {
        ...mockPayment,
        amountInCents: 14999,
        order: {
          ...mockPayment.order,
          snapshotLastName: 'Kowalski',
          snapshotStreet: 'ul. Testowa 1',
          snapshotCity: 'Kraków',
          snapshotPostalCode: '30-001',
          snapshotCompany: null,
          snapshotNip: null,
          itemsTotalInCents: 13500,
          shippingCostInCents: 1499,
          discountInCents: 0,
          couponCode: null,
          carrierCode: 'INPOST',
          createdAt: new Date('2026-01-15'),
          items: [
            { snapshotName: 'Dior 100ml', snapshotPrice: 13500, snapshotVatRate: 2300, quantity: 1 },
          ],
        },
      };

      it('holds the order for review instead of PAID when Stripe captured a different amount', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForAmountCheck);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', { ...mockSession, amount_total: 100 }),
        );

        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: OrderStatus.FRAUD_REVIEW } }),
        );
      });

      it('still marks the payment COMPLETED on amount mismatch — Stripe did collect money, just not the expected amount', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForAmountCheck);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', { ...mockSession, amount_total: 100 }),
        );

        expect(prisma.payment.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: PaymentStatus.COMPLETED }) }),
        );
      });

      it('does not dispatch customer/admin post-payment notifications on amount mismatch', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForAmountCheck);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', { ...mockSession, amount_total: 100 }),
        );

        await new Promise((resolve) => setImmediate(resolve));
        expect(emailService.sendPaymentConfirmedWithInvoice).not.toHaveBeenCalled();
        expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
      });

      it('does not send the Radar fraud-review email for a pure amount mismatch with normal risk', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForAmountCheck);
        stripeClient.retrievePaymentIntentWithCharge.mockResolvedValue({
          latest_charge: { outcome: { risk_level: 'normal' } },
        } as any);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', { ...mockSession, amount_total: 100 }),
        );

        await Promise.resolve();
        expect(emailService.sendFraudReviewAlert).not.toHaveBeenCalled();
      });

      it('raises a fatal Sentry alert tagged amount_mismatch', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForAmountCheck);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', { ...mockSession, amount_total: 100 }),
        );

        expect(Sentry.withScope).toHaveBeenCalled();
        const scopeCallback = (Sentry.withScope as jest.Mock).mock.calls.at(-1)[0];
        const mockScope = { setLevel: jest.fn(), setTag: jest.fn(), setContext: jest.fn() };
        scopeCallback(mockScope);
        expect(mockScope.setLevel).toHaveBeenCalledWith('fatal');
        expect(mockScope.setTag).toHaveBeenCalledWith('payment.event', 'amount_mismatch');
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.stringContaining(mockPaymentForAmountCheck.order.orderNumber),
          'fatal',
        );
      });

      it('includes expected vs captured amounts in the orderEvent note', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForAmountCheck);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', { ...mockSession, amount_total: 100 }),
        );

        expect(prisma.orderEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              note: expect.stringContaining('100'),
            }),
          }),
        );
      });

      it('proceeds to PAID when the captured amount matches the expected amount exactly', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForAmountCheck);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', {
            ...mockSession,
            amount_total: mockPaymentForAmountCheck.amountInCents,
          }),
        );

        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: OrderStatus.PAID } }),
        );
      });

      it('does not flag a mismatch when Stripe omits amount_total (cannot prove a discrepancy)', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPaymentForAmountCheck);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', { ...mockSession, amount_total: null }),
        );

        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: OrderStatus.PAID } }),
        );
      });
    });
  });

  // ── fromStatus audit trail fix ───────────────────────────────────────────────
  // markSessionPaid previously hardcoded fromStatus: PENDING_PAYMENT in the
  // OrderEvent. reconcilePendingPayments can call markSessionPaid on orders that
  // were already routed to FRAUD_REVIEW, producing a corrupt PENDING_PAYMENT→PAID
  // audit event. The fix reads payment.order.status at transaction time.

  describe('markSessionPaid — fromStatus reflects actual order status', () => {
    it('writes fromStatus=PENDING_PAYMENT when order was in PENDING_PAYMENT state', async () => {
      const paymentInPending = {
        ...mockPayment,
        order: { ...mockPayment.order, status: OrderStatus.PENDING_PAYMENT },
      };
      prisma.payment.findUnique.mockResolvedValue(paymentInPending);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      expect(prisma.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fromStatus: OrderStatus.PENDING_PAYMENT }),
        }),
      );
    });

    it('writes fromStatus=FRAUD_REVIEW when reconcile calls markSessionPaid on a fraud-held order', async () => {
      const paymentInFraudReview = {
        ...mockPayment,
        order: { ...mockPayment.order, status: OrderStatus.FRAUD_REVIEW },
      };
      prisma.payment.findUnique.mockResolvedValue(paymentInFraudReview);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      expect(prisma.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fromStatus: OrderStatus.FRAUD_REVIEW }),
        }),
      );
    });

    it('does NOT write fromStatus=PENDING_PAYMENT when order was in FRAUD_REVIEW — regression guard', async () => {
      const paymentInFraudReview = {
        ...mockPayment,
        order: { ...mockPayment.order, status: OrderStatus.FRAUD_REVIEW },
      };
      prisma.payment.findUnique.mockResolvedValue(paymentInFraudReview);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      const createCall = prisma.orderEvent.create.mock.calls[0][0];
      expect(createCall.data.fromStatus).not.toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('fromStatus matches order.status regardless of whether newOrderStatus is PAID or FRAUD_REVIEW', async () => {
      const paymentInFraudReview = {
        ...mockPayment,
        order: { ...mockPayment.order, status: OrderStatus.FRAUD_REVIEW },
      };
      prisma.payment.findUnique.mockResolvedValue(paymentInFraudReview);
      stripeClient.retrievePaymentIntentWithCharge.mockResolvedValue({
        latest_charge: { outcome: { risk_level: 'normal' } },
      } as any);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      const createCall = prisma.orderEvent.create.mock.calls[0][0];
      expect(createCall.data.fromStatus).toBe(OrderStatus.FRAUD_REVIEW);
      expect(createCall.data.toStatus).toBe(OrderStatus.PAID);
    });
  });

  describe('initiatePayment', () => {
    const mockOrderWithItems = {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      snapshotEmail: 'test@example.com',
      totalInCents: 14999,
      shippingCostInCents: 1499,
      carrierCode: 'INPOST',
      items: [
        { snapshotName: 'Dior 100ml', snapshotSku: 'DS-100', snapshotPrice: 13500, quantity: 1 },
      ],
    };

    it('returns paymentUrl on success', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      const result = await service.initiatePayment('order-1');
      expect(result.paymentUrl).toBe(mockSession.url);
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-1', provider: 'stripe' }),
        }),
      );
    });

    it('throws when Stripe session returns no redirect URL', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue({ ...mockSession, url: null } as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await expect(service.initiatePayment('order-1')).rejects.toThrow(
        'missing redirect URL',
      );
    });

    it('handles payment_intent as an object (not a string)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue({
        ...mockSession,
        payment_intent: { id: 'pi_nested_id' } as any,
      } as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      // stripePaymentIntentId is now set via payment.update (after Stripe confirms), not payment.create
      const updateCall = prisma.payment.update.mock.calls[0][0];
      expect(updateCall.data.stripePaymentIntentId).toBe('pi_nested_id');
    });

    // ── coupon discount forwarding ────────────────────────────────────────
    // Guards the fix: discountInCents must be forwarded to StripeClient so
    // Stripe charges order.totalInCents, not the pre-discount item sum.

    it('does not pass discount fields to createCheckoutSession when discountInCents is 0', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ ...mockOrderWithItems, discountInCents: 0 });
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      const callArg = stripeClient.createCheckoutSession.mock.calls[0][0];
      expect(callArg.discountAmountInCents).toBeUndefined();
      expect(callArg.couponLabel).toBeUndefined();
    });

    it('passes discountAmountInCents and couponLabel when order has a coupon discount', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithItems,
        discountInCents: 2000,
        couponCode: 'SUMMER20',
      });
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          discountAmountInCents: 2000,
          couponLabel: 'SUMMER20',
        }),
      );
    });

    it('passes couponLabel as undefined when discountInCents > 0 but couponCode is null', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithItems,
        discountInCents: 1500,
        couponCode: null,
      });
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          discountAmountInCents: 1500,
          couponLabel: undefined,
        }),
      );
    });

    // ─── Fix #16 regression harness — DB row created before Stripe call ──────
    // Invariant: payment.create must be called BEFORE createCheckoutSession so
    // a DB record always exists when a Stripe session exists.

    it('creates the Payment DB row before calling Stripe (no orphan session on DB failure)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);

      const callOrder: string[] = [];
      prisma.payment.create.mockImplementation(() => {
        callOrder.push('db-create');
        return Promise.resolve({ id: 'payment-1' });
      });
      stripeClient.createCheckoutSession.mockImplementation(() => {
        callOrder.push('stripe');
        return Promise.resolve(mockSession as any);
      });

      await service.initiatePayment('order-1');

      expect(callOrder[0]).toBe('db-create');
      expect(callOrder[1]).toBe('stripe');
    });

    it('attaches stripeCheckoutSessionId via update after Stripe confirms, not in create', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);

      await service.initiatePayment('order-1');

      const createData = prisma.payment.create.mock.calls[0][0].data;
      expect(createData.stripeCheckoutSessionId).toBeUndefined();

      const updateData = prisma.payment.update.mock.calls[0][0].data;
      expect(updateData.stripeCheckoutSessionId).toBe(mockSession.id);
    });

    it('marks Payment FAILED and rethrows when Stripe throws, without leaving a dangling PENDING row', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockRejectedValue(new Error('Stripe API down'));

      await expect(service.initiatePayment('order-1')).rejects.toThrow('Stripe API down');

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PaymentStatus.FAILED }),
        }),
      );
    });

    it('marks Payment FAILED when Stripe returns no redirect URL', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue({ ...mockSession, url: null } as any);

      await expect(service.initiatePayment('order-1')).rejects.toThrow('missing redirect URL');

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentStatus.FAILED,
            failureReason: expect.stringContaining('missing redirect URL'),
          }),
        }),
      );
    });

    // ── cancel URL orderId injection ─────────────────────────────────────────
    // Invariant: cancelUrl passed to Stripe must include ?orderId=<order.id>
    // so the failure page can offer "Retry Payment" without creating a duplicate order.

    it('appends ?orderId to the cancel URL passed to createCheckoutSession', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      const callArg = stripeClient.createCheckoutSession.mock.calls[0][0];
      expect(callArg.cancelUrl).toMatch(/[?&]orderId=order-1/);
    });

    // ── Fix: PENDING payment row reuse — avoids P2002 on second pay attempt ──────
    // Invariant: initiatePayment must not call payment.create when a PENDING row
    // already exists for the order (orderId is @unique — a second create throws P2002).
    // If the existing Stripe session is still open, return its URL directly.
    // If it's expired (or retrieval fails), reset the row and create a fresh session.

    it('returns existing Stripe session URL without creating a new row when PENDING has an open session', async () => {
      const openUrl = 'https://checkout.stripe.com/c/pay/cs_existing_abc';
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        status: PaymentStatus.PENDING,
        stripeCheckoutSessionId: 'cs_existing_abc',
        stripePaymentIntentId: null,
        failureReason: null,
      });
      stripeClient.retrieveCheckoutSession.mockResolvedValue({
        status: 'open',
        url: openUrl,
      } as any);

      const result = await service.initiatePayment('order-1');

      expect(result.paymentUrl).toBe(openUrl);
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('does not call payment.create when PENDING row exists — prevents P2002 unique constraint violation', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        status: PaymentStatus.PENDING,
        stripeCheckoutSessionId: 'cs_existing_abc',
        stripePaymentIntentId: null,
        failureReason: null,
      });
      stripeClient.retrieveCheckoutSession.mockResolvedValue({
        status: 'open',
        url: 'https://checkout.stripe.com/c/pay/cs_existing_abc',
      } as any);

      await service.initiatePayment('order-1');

      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('resets PENDING row and creates a fresh Stripe session when existing session is expired', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        status: PaymentStatus.PENDING,
        stripeCheckoutSessionId: 'cs_expired',
        stripePaymentIntentId: null,
        failureReason: null,
      });
      stripeClient.retrieveCheckoutSession.mockResolvedValue({
        status: 'expired',
        url: null,
      } as any);
      (stripeClient as any).expireCheckoutSession = jest.fn().mockResolvedValue(undefined);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);

      const result = await service.initiatePayment('order-1');

      expect(result.paymentUrl).toBe(mockSession.url);
      expect(prisma.payment.create).not.toHaveBeenCalled();
      const resetCall = (prisma.payment.update as jest.Mock).mock.calls.find(
        (c: any[]) => c[0]?.data?.stripeCheckoutSessionId === null,
      );
      expect(resetCall).toBeDefined();
      expect(stripeClient.createCheckoutSession).toHaveBeenCalledTimes(1);
    });

    it('falls through to reset path and creates a new session when retrieveCheckoutSession throws', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        status: PaymentStatus.PENDING,
        stripeCheckoutSessionId: 'cs_unreachable',
        stripePaymentIntentId: null,
        failureReason: null,
      });
      stripeClient.retrieveCheckoutSession.mockRejectedValue(new Error('Stripe API unavailable'));
      (stripeClient as any).expireCheckoutSession = jest.fn().mockResolvedValue(undefined);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);

      const result = await service.initiatePayment('order-1');

      expect(result.paymentUrl).toBe(mockSession.url);
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(stripeClient.createCheckoutSession).toHaveBeenCalledTimes(1);
    });

    it('resets PENDING row directly without calling expireCheckoutSession when session ID is absent', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        status: PaymentStatus.PENDING,
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
        failureReason: null,
      });
      (stripeClient as any).expireCheckoutSession = jest.fn().mockResolvedValue(undefined);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);

      const result = await service.initiatePayment('order-1');

      expect(result.paymentUrl).toBe(mockSession.url);
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect((stripeClient as any).expireCheckoutSession).not.toHaveBeenCalled();
    });

    // ── per-identity velocity guard (replaces the broken city-level check) ──────
    // City-level guard blocked the 5th legitimate Warsaw customer during promotions.
    // Per-userId (authenticated) or per-email (guest) scope prevents that while
    // still catching the realistic abuse pattern: a single identity spamming checkout.

    it('throws 429 when >5 orders from the same user were initiated in the last 30 minutes', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithItems,
        userId: 'user-1',
      });
      prisma.order.count.mockResolvedValue(6);

      await expect(service.initiatePayment('order-1')).rejects.toThrow(
        'Order velocity limit reached',
      );
      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('allows checkout when exactly 5 orders from the same user exist in the window', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithItems,
        userId: 'user-1',
      });
      prisma.order.count.mockResolvedValue(5);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      const result = await service.initiatePayment('order-1');

      expect(result.paymentUrl).toBe(mockSession.url);
    });

    it('scopes velocity check to userId for authenticated orders', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithItems,
        userId: 'user-abc',
      });
      prisma.order.count.mockResolvedValue(0);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      expect(prisma.order.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-abc' }),
        }),
      );
    });

    it('scopes velocity check to snapshotEmail for guest orders (no userId)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithItems,
        userId: null,
        snapshotEmail: 'guest@example.com',
      });
      prisma.order.count.mockResolvedValue(0);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      expect(prisma.order.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ snapshotEmail: 'guest@example.com' }),
        }),
      );
    });

    it('does NOT scope velocity check to snapshotCity — city-level guard is removed', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithItems,
        userId: 'user-1',
        snapshotCity: 'Warszawa',
      });
      prisma.order.count.mockResolvedValue(0);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      expect(prisma.order.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ snapshotCity: expect.anything() }),
        }),
      );
    });

    // ── opaque Redis guest token ──────────────────────────────────────────────
    // Invariant: the success URL token must be a short-lived opaque random value
    // stored in Redis, NOT a deterministic HMAC/JWT derived from the master secret.
    // An HMAC/JWT in the URL leaks via Referer headers to analytics providers and
    // exposes the master JWT_ACCESS_SECRET if the token is ever decoded.

    it('stores an opaque random token in Redis under the order-token key with a 7-day TTL', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      // TTL must be 7 days (604800s) — P24 bank transfers can take up to 5
      // business days; a 1-hour TTL locked out guests before payment settled.
      expect(redis.set).toHaveBeenCalledWith(
        'order-token:order-1',
        expect.stringMatching(/^[0-9a-f]{64}$/),
        'EX',
        604800,
      );
    });

    it('does NOT use a 1-hour TTL for the guest order token (P24/BLIK regression guard)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      const setCall = redis.set.mock.calls.find((c: any[]) => c[0] === 'order-token:order-1');
      const ttl: number = setCall[3];
      expect(ttl).not.toBe(3600);
      expect(ttl).toBe(7 * 24 * 3600);
    });

    it('embeds the stored Redis token in the success URL', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      const storedToken: string = redis.set.mock.calls.find(
        (c: any[]) => c[0] === 'order-token:order-1',
      )[1];
      const callArg = stripeClient.createCheckoutSession.mock.calls[0][0];
      expect(callArg.successUrl).toContain(`token=${storedToken}`);
    });

    it('generates a unique token on each call (not deterministic)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');
      const firstToken: string = redis.set.mock.calls.find(
        (c: any[]) => c[0] === 'order-token:order-1',
      )[1];

      jest.clearAllMocks();
      redis.set.mockResolvedValue('OK');
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithItems);
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');
      const secondToken: string = redis.set.mock.calls.find(
        (c: any[]) => c[0] === 'order-token:order-1',
      )[1];

      expect(firstToken).not.toBe(secondToken);
    });

    // ── coupon re-validation on retry ────────────────────────────────────────
    // Invariant: initiatePayment must re-validate the coupon every time it is
    // called (including retryPayment). A coupon deactivated after the original
    // order was placed must NOT be honoured on subsequent payment attempts.

    const mockOrderWithCoupon = {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      snapshotEmail: 'test@example.com',
      userId: 'user-1',
      totalInCents: 11999,
      itemsTotalInCents: 13498,
      shippingCostInCents: 1499,
      discountInCents: 2000,
      couponId: 'coupon-abc',
      couponCode: 'SUMMER20',
      carrierCode: 'INPOST',
      items: [
        { snapshotName: 'Dior 100ml', snapshotSku: 'DS-100', snapshotPrice: 13498, quantity: 1 },
      ],
    };

    it('throws BadRequestException when the coupon has been deactivated since order creation', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithCoupon);
      couponService.validate.mockResolvedValue({
        valid: false,
        message: 'Kod rabatowy jest nieprawidłowy lub nieaktywny.',
      });

      await expect(service.initiatePayment('order-1')).rejects.toThrow(BadRequestException);

      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the coupon has expired since order creation', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithCoupon);
      couponService.validate.mockResolvedValue({
        valid: false,
        message: 'Ten kod wygasł.',
      });

      await expect(service.initiatePayment('order-1')).rejects.toThrow(BadRequestException);

      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('uses the coupon validation failure message in the thrown exception', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithCoupon);
      const failureMessage = 'Ten kod osiągnął limit użyć.';
      couponService.validate.mockResolvedValue({ valid: false, message: failureMessage });

      await expect(service.initiatePayment('order-1')).rejects.toThrow(failureMessage);
    });

    it('proceeds to Stripe checkout when the coupon is still valid on retry', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithCoupon);
      couponService.validate.mockResolvedValue({ valid: true });
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      const result = await service.initiatePayment('order-1');

      expect(result.paymentUrl).toBe(mockSession.url);
      expect(stripeClient.createCheckoutSession).toHaveBeenCalledTimes(1);
    });

    it('skips coupon re-validation when the order has no couponId', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithCoupon,
        couponId: null,
        couponCode: null,
        discountInCents: 0,
      });
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      expect(couponService.validate).not.toHaveBeenCalled();
    });

    it('passes userId and itemsTotalInCents to couponService.validate for per-user limit checks', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithCoupon);
      couponService.validate.mockResolvedValue({ valid: true });
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      expect(couponService.validate).toHaveBeenCalledWith(
        'SUMMER20',
        mockOrderWithCoupon.itemsTotalInCents,
        mockOrderWithCoupon.userId,
        undefined,
        mockOrderWithCoupon.id,
      );
    });

    it('passes undefined userId to couponService.validate for guest orders', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockOrderWithCoupon,
        userId: null,
      });
      couponService.validate.mockResolvedValue({ valid: true });
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      expect(couponService.validate).toHaveBeenCalledWith(
        'SUMMER20',
        mockOrderWithCoupon.itemsTotalInCents,
        undefined,
        undefined,
        mockOrderWithCoupon.id,
      );
    });

    // ── self-reservation exclusion (round 12 fix) ───────────────────────────
    // Invariant: re-validation must pass the order's own id as excludeOrderId
    // so CouponService can exclude this order's already-reserved CouponUse row
    // from the maxUsesTotal/maxUsesPerUser caps it already passed at order
    // creation. Without this, the order that consumed the coupon's last slot
    // can never pass re-validation again — not even on its first retry.

    it('passes the order id as excludeOrderId so the order does not get re-counted against its own cap', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrderWithCoupon);
      couponService.validate.mockResolvedValue({ valid: true });
      stripeClient.createCheckoutSession.mockResolvedValue(mockSession as any);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

      await service.initiatePayment('order-1');

      const [, , , , excludeOrderId] = couponService.validate.mock.calls[0];
      expect(excludeOrderId).toBe('order-1');
    });
  });

  describe('getPaymentStatus', () => {
    it('returns status, paidAt, and orderNumber for an order the user owns', async () => {
      const now = new Date();

      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        order: { userId: 'user-1', orderNumber: 'ORD-2026-000001', shippingCostInCents: 0, items: [] },
      });

      const result = await service.getPaymentStatus('order-1', 'user-1');

      expect(result).toEqual({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        orderNumber: 'ORD-2026-000001',
        shippingInCents: 0,
        items: [],
      });
    });

    it('includes orderNumber in the Prisma select so the response is never missing it', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { userId: 'user-1', orderNumber: 'ORD-2026-000042', shippingCostInCents: 0, items: [] },
      });

      const result = await service.getPaymentStatus('order-1', 'user-1');

      expect(result.orderNumber).toBe('ORD-2026-000042');
    });

    it('throws ForbiddenException when user does not own the order', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { userId: 'other-user', orderNumber: 'ORD-2026-000001' },
      });

      await expect(service.getPaymentStatus('order-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when payment does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.getPaymentStatus('order-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPaymentStatusByToken', () => {
    const ORDER_ID = 'order-1';
    // 64-char hex string — same format as randomBytes(32).toString('hex')
    const VALID_TOKEN = 'a1b2c3d4'.repeat(8);

    it('returns status, paidAt, and orderNumber when Redis token matches', async () => {
      const now = new Date();

      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        order: { orderNumber: 'ORD-2026-000001', shippingCostInCents: 0, items: [] },
      });
      redis.get.mockResolvedValue(VALID_TOKEN);

      const result = await service.getPaymentStatusByToken(ORDER_ID, VALID_TOKEN);

      expect(result).toEqual({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        orderNumber: 'ORD-2026-000001',
        shippingInCents: 0,
        items: [],
      });
    });

    it('includes the human-readable orderNumber so guests can use it in track-order form', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { orderNumber: 'ORD-2026-000042', shippingCostInCents: 0, items: [] },
      });
      redis.get.mockResolvedValue(VALID_TOKEN);

      const result = await service.getPaymentStatusByToken(ORDER_ID, VALID_TOKEN);

      expect(result.orderNumber).toBe('ORD-2026-000042');
    });

    it('looks up the Redis key scoped to the orderId', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { orderNumber: 'ORD-2026-000001', shippingCostInCents: 0, items: [] },
      });
      redis.get.mockResolvedValue(VALID_TOKEN);

      await service.getPaymentStatusByToken(ORDER_ID, VALID_TOKEN);

      expect(redis.get).toHaveBeenCalledWith(`order-token:${ORDER_ID}`);
    });

    it('throws UnauthorizedException when the token does not match the Redis value', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { orderNumber: 'ORD-2026-000001' },
      });
      redis.get.mockResolvedValue('different-stored-token');

      await expect(
        service.getPaymentStatusByToken(ORDER_ID, VALID_TOKEN),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when Redis has no token (expired or never set)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { orderNumber: 'ORD-2026-000001' },
      });
      redis.get.mockResolvedValue(null);

      await expect(
        service.getPaymentStatusByToken(ORDER_ID, VALID_TOKEN),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException when no payment exists for the order', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      redis.get.mockResolvedValue(VALID_TOKEN);

      await expect(
        service.getPaymentStatusByToken(ORDER_ID, VALID_TOKEN),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reconcilePendingPayments', () => {
    const stalePayment = {
      ...mockPayment,
      stripeCheckoutSessionId: mockSession.id as string,
    };

    it('does nothing when no stale payments exist', async () => {
      prisma.payment.findMany.mockResolvedValue([]);

      await service.reconcilePendingPayments();

      expect(stripeClient.retrieveCheckoutSession).not.toHaveBeenCalled();
    });

    it('marks payment as paid when Stripe shows payment_status=paid', async () => {
      prisma.payment.findMany.mockResolvedValue([stalePayment]);
      stripeClient.retrieveCheckoutSession.mockResolvedValue({
        ...mockSession,
        payment_status: 'paid',
        status: 'complete',
      } as any);
      // markSessionPaid internally calls payment.findUnique
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockResolvedValue([{}, {}]);

      await service.reconcilePendingPayments();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('cancels order when Stripe session is expired', async () => {
      prisma.payment.findMany.mockResolvedValue([stalePayment]);
      stripeClient.retrieveCheckoutSession.mockResolvedValue({
        id: mockSession.id,
        payment_status: 'unpaid',
        status: 'expired',
      } as any);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
            orderEvent: { create: jest.fn() },
            productVariant: { update: jest.fn() },
          });
        }
      });

      await service.reconcilePendingPayments();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('leaves open sessions untouched (customer may still pay)', async () => {
      prisma.payment.findMany.mockResolvedValue([stalePayment]);
      stripeClient.retrieveCheckoutSession.mockResolvedValue({
        id: mockSession.id,
        payment_status: 'unpaid',
        status: 'open',
      } as any);

      await service.reconcilePendingPayments();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('logs error and continues when Stripe API throws', async () => {
      prisma.payment.findMany.mockResolvedValue([stalePayment]);
      stripeClient.retrieveCheckoutSession.mockRejectedValue(new Error('Stripe API down'));

      await expect(service.reconcilePendingPayments()).resolves.not.toThrow();
    });

    // ── Index coverage — query shape for @@index([status, createdAt]) and @@index([stripeCheckoutSessionId]) ──

    it('queries payment.findMany with status=PENDING, 30-min cutoff, and non-null stripeCheckoutSessionId', async () => {
      // Arrange: lock acquired, no stale rows (we only care about the WHERE shape)
      prisma.payment.findMany.mockResolvedValue([]);
      const before = Date.now();

      // Act
      await service.reconcilePendingPayments();

      // Assert
      expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);
      const [callArg] = prisma.payment.findMany.mock.calls[0];
      expect(callArg.where.status).toBe(PaymentStatus.PENDING);
      expect(callArg.where.stripeCheckoutSessionId).toEqual({ not: null });
      // cutoff is Date.now() - 30 min; verify it's a Date within the expected range
      const cutoff: Date = callArg.where.createdAt.lt;
      expect(cutoff).toBeInstanceOf(Date);
      const THIRTY_MIN_MS = 30 * 60 * 1000;
      const after = Date.now();
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - THIRTY_MIN_MS - 1000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - THIRTY_MIN_MS + 1000);
    });

    it('skips findMany entirely when Redis lock is already held by another process', async () => {
      // Redis NX returns null when key already exists (lock held)
      redis.set.mockResolvedValueOnce(null);

      await service.reconcilePendingPayments();

      expect(prisma.payment.findMany).not.toHaveBeenCalled();
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });
  });

  // ── Secondary sweep: orders left PENDING_PAYMENT with no Stripe session ──
  describe('reconcilePendingPayments — orphaned PENDING_PAYMENT sweep', () => {
    const orphanedOrder = {
      id: 'order-orphan-1',
      orderNumber: 'ORD-2026-000099',
      couponId: null as string | null,
      items: [{ productVariantId: 'pv-9', quantity: 3 }],
    };

    beforeEach(() => {
      // No stale Stripe-session payments this tick — isolates the orphan sweep
      prisma.payment.findMany.mockResolvedValue([]);
    });

    it('does nothing when no orphaned orders exist', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.reconcilePendingPayments();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cancels the order and restores stock for an orphaned order', async () => {
      prisma.order.findMany.mockResolvedValue([orphanedOrder]);

      await service.reconcilePendingPayments();

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-orphan-1' },
        data: { status: OrderStatus.CANCELLED },
      });
      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'pv-9' },
        data: { stock: { increment: 3 } },
      });
      expect(prisma.orderEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-orphan-1',
          fromStatus: OrderStatus.PENDING_PAYMENT,
          toStatus: OrderStatus.CANCELLED,
          actor: 'SYSTEM:reconcile-cron',
        }),
      });
    });

    it('surfaces the auto-cancellation via Sentry for manual review', async () => {
      prisma.order.findMany.mockResolvedValue([orphanedOrder]);

      await service.reconcilePendingPayments();

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Auto-cancelled orphaned PENDING_PAYMENT order with no Stripe session',
        'warning',
      );
    });

    it('restores stock minus cancelledQuantity when an orphaned order item was already partially cancelled', async () => {
      prisma.order.findMany.mockResolvedValue([
        { ...orphanedOrder, items: [{ productVariantId: 'pv-9', quantity: 3, cancelledQuantity: 1 }] },
      ]);

      await service.reconcilePendingPayments();

      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'pv-9' },
        data: { stock: { increment: 2 } },
      });
    });

    it('releases coupon capacity when the orphaned order used a coupon', async () => {
      prisma.order.findMany.mockResolvedValue([{ ...orphanedOrder, couponId: 'coupon-1' }]);

      await service.reconcilePendingPayments();

      expect(prisma.couponUse.deleteMany).toHaveBeenCalledWith({
        where: { orderId: 'order-orphan-1' },
      });
    });

    it('does not touch coupon tables when the orphaned order has no coupon', async () => {
      prisma.order.findMany.mockResolvedValue([orphanedOrder]);

      await service.reconcilePendingPayments();

      expect(prisma.couponUse.deleteMany).not.toHaveBeenCalled();
    });

    it('logs and captures the exception but does not throw when auto-cancellation fails', async () => {
      prisma.order.findMany.mockResolvedValue([orphanedOrder]);
      prisma.$transaction.mockImplementationOnce(async () => {
        throw new Error('DB unavailable');
      });

      await expect(service.reconcilePendingPayments()).resolves.not.toThrow();

      expect(Sentry.captureException).toHaveBeenCalled();
    });

    it('queries order.findMany for PENDING_PAYMENT older than 2h with no session on the Payment row', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      const before = Date.now();

      await service.reconcilePendingPayments();

      expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
      const [callArg] = prisma.order.findMany.mock.calls[0];
      expect(callArg.where.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(callArg.where.OR).toEqual([
        { payment: { is: null } },
        { payment: { stripeCheckoutSessionId: null } },
      ]);
      const cutoff: Date = callArg.where.createdAt.lt;
      expect(cutoff).toBeInstanceOf(Date);
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const after = Date.now();
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - TWO_HOURS_MS - 1000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - TWO_HOURS_MS + 1000);
    });
  });

  describe('partialRefund', () => {
    const completedPayment = {
      id: 'payment-1',
      status: PaymentStatus.COMPLETED,
      stripePaymentIntentId: 'pi_test_abc123',
      amountInCents: 200000,
      refundedAmountInCents: 0,
      order: { orderNumber: 'ORD-2026-000001' },
    };

    const twoItems = [
      { orderItemId: 'item-1', productVariantId: 'pv-1', quantity: 2, priceInCents: 34900 },
      { orderItemId: 'item-2', productVariantId: 'pv-2', quantity: 1, priceInCents: 44900 },
    ];

    const buildPartialTx = (overrides: {
      updatedItems?: Array<{ id: string; quantity: number; cancelledQuantity: number }>;
    } = {}) => {
      const updatedItems = overrides.updatedItems ?? [
        { id: 'item-1', quantity: 3, cancelledQuantity: 2 },
        { id: 'item-2', quantity: 2, cancelledQuantity: 1 },
      ];
      return async (fn: any) => {
        const capturedOrderItemUpdates: any[] = [];
        const capturedVariantUpdates: any[] = [];
        let capturedOrderUpdate: any;
        let capturedPaymentUpdate: any;
        let capturedEventCreate: any;

        await fn({
          orderItem: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedOrderItemUpdates.push(args);
            }),
            findMany: jest.fn().mockResolvedValue(updatedItems),
          },
          productVariant: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedVariantUpdates.push(args);
            }),
          },
          order: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedOrderUpdate = args;
            }),
          },
          payment: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedPaymentUpdate = args;
            }),
          },
          orderEvent: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedEventCreate = args;
            }),
          },
        });

        return { capturedOrderItemUpdates, capturedVariantUpdates, capturedOrderUpdate, capturedPaymentUpdate, capturedEventCreate };
      };
    };

    it('throws NotFoundException when no payment exists for the order', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when payment status is not COMPLETED', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...completedPayment,
        status: PaymentStatus.PENDING,
      });

      await expect(
        service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER'),
      ).rejects.toThrow('Cannot issue a partial refund for payment with status PENDING');
    });

    it('throws when there is no Stripe PaymentIntent ID', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...completedPayment,
        stripePaymentIntentId: null,
      });

      await expect(
        service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER'),
      ).rejects.toThrow('No Stripe PaymentIntent ID on payment payment-1');
    });

    it('calls createPartialRefund with correct amount (sum of qty × price)', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);
      prisma.$transaction.mockImplementation(buildPartialTx());

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      // 2×34900 + 1×44900 = 114700
      expect(stripeClient.createPartialRefund).toHaveBeenCalledWith(
        'pi_test_abc123',
        114700,
        expect.any(String),
      );
    });

    it('uses a deterministic, sorted idempotency key', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);
      prisma.$transaction.mockImplementation(buildPartialTx());

      const itemsForwardOrder = [
        { orderItemId: 'item-1', productVariantId: 'pv-1', quantity: 2, priceInCents: 34900 },
        { orderItemId: 'item-2', productVariantId: 'pv-2', quantity: 1, priceInCents: 44900 },
      ];
      const itemsReverseOrder = [...itemsForwardOrder].reverse();

      await service.partialRefund('order-1', itemsForwardOrder, OrderStatus.PAID, 'CUSTOMER');
      const key1 = (stripeClient.createPartialRefund as jest.Mock).mock.calls[0][2];

      (stripeClient.createPartialRefund as jest.Mock).mockClear();
      prisma.$transaction.mockImplementation(buildPartialTx());

      await service.partialRefund('order-1', itemsReverseOrder, OrderStatus.PAID, 'CUSTOMER');
      const key2 = (stripeClient.createPartialRefund as jest.Mock).mock.calls[0][2];

      expect(key1).toBe(key2);
    });

    it('produces a different idempotency key for identical item/quantity pairs when refundedAmountInCents differs', async () => {
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      prisma.payment.findUnique.mockResolvedValue({ ...completedPayment, refundedAmountInCents: 0 });
      prisma.$transaction.mockImplementation(buildPartialTx());
      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');
      const firstCallKey = (stripeClient.createPartialRefund as jest.Mock).mock.calls[0][2];

      (stripeClient.createPartialRefund as jest.Mock).mockClear();

      // Simulates a later, unrelated cancellation that happens to repeat the same
      // orderItemId:quantity pairs — refundedAmountInCents has moved on from the first call.
      prisma.payment.findUnique.mockResolvedValue({ ...completedPayment, refundedAmountInCents: 50000 });
      prisma.$transaction.mockImplementation(buildPartialTx());
      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');
      const laterCallKey = (stripeClient.createPartialRefund as jest.Mock).mock.calls[0][2];

      expect(firstCallKey).not.toBe(laterCallKey);
    });

    it('increments cancelledQuantity for each item', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      const capturedUpdates: any[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedUpdates.push(args);
            }),
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 3, cancelledQuantity: 2 },
              { id: 'item-2', quantity: 2, cancelledQuantity: 1 },
            ]),
          },
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          payment: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(capturedUpdates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            where: { id: 'item-1' },
            data: { cancelledQuantity: { increment: 2 } },
          }),
          expect.objectContaining({
            where: { id: 'item-2' },
            data: { cancelledQuantity: { increment: 1 } },
          }),
        ]),
      );
    });

    it('restores stock for each item', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      const stockRestored: Array<{ id: string; increment: number }> = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn(),
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 3, cancelledQuantity: 2 },
              { id: 'item-2', quantity: 2, cancelledQuantity: 1 },
            ]),
          },
          productVariant: {
            update: jest.fn().mockImplementation((args: any) => {
              stockRestored.push({ id: args.where.id, increment: args.data.stock.increment });
            }),
          },
          order: { update: jest.fn() },
          payment: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(stockRestored).toEqual(
        expect.arrayContaining([
          { id: 'pv-1', increment: 2 },
          { id: 'pv-2', increment: 1 },
        ]),
      );
    });

    it('transitions order to PARTIALLY_REFUNDED when some items remain uncancelled', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      let capturedOrderStatus: OrderStatus | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn(),
            // item-1 still has 1 remaining (cancelledQuantity=2, quantity=3)
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 3, cancelledQuantity: 2 },
              { id: 'item-2', quantity: 2, cancelledQuantity: 2 },
            ]),
          },
          productVariant: { update: jest.fn() },
          order: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedOrderStatus = args.data.status;
            }),
          },
          payment: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(capturedOrderStatus).toBe(OrderStatus.PARTIALLY_REFUNDED);
    });

    it('transitions order to REFUNDED when all items are fully cancelled', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      let capturedOrderStatus: OrderStatus | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn(),
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 3, cancelledQuantity: 3 },
              { id: 'item-2', quantity: 2, cancelledQuantity: 2 },
            ]),
          },
          productVariant: { update: jest.fn() },
          order: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedOrderStatus = args.data.status;
            }),
          },
          payment: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(capturedOrderStatus).toBe(OrderStatus.REFUNDED);
    });

    it('marks payment as REFUNDED when all items are fully cancelled', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      let capturedPaymentData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn(),
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 2, cancelledQuantity: 2 },
            ]),
          },
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          payment: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedPaymentData = args.data;
            }),
          },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(capturedPaymentData.status).toBe(PaymentStatus.REFUNDED);
    });

    it('does NOT set payment status to REFUNDED when partially cancelled', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      let capturedPaymentData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn(),
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 3, cancelledQuantity: 2 },
            ]),
          },
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          payment: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedPaymentData = args.data;
            }),
          },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(capturedPaymentData.status).toBeUndefined();
    });

    it('increments refundedAmountInCents on the payment record', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      let capturedPaymentData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn(),
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 3, cancelledQuantity: 2 },
              { id: 'item-2', quantity: 2, cancelledQuantity: 1 },
            ]),
          },
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          payment: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedPaymentData = args.data;
            }),
          },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(capturedPaymentData.refundedAmountInCents).toEqual({ increment: 114700 });
    });

    it('creates an OrderEvent with the correct actor and note', async () => {
      prisma.payment.findUnique.mockResolvedValue(completedPayment);
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      let capturedEventData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn(),
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 3, cancelledQuantity: 2 },
            ]),
          },
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          payment: { update: jest.fn() },
          orderEvent: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedEventData = args.data;
            }),
          },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(capturedEventData.actor).toBe('CUSTOMER');
      expect(capturedEventData.fromStatus).toBe(OrderStatus.PAID);
      expect(capturedEventData.note).toContain('114700');
      expect(capturedEventData.note).toContain('2 item line(s)');
    });

    // ─── available-balance cap (fix: prevent over-refund on second partial cancel) ─

    it('throws Error when no refundable balance remains', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...completedPayment,
        amountInCents: 50000,
        refundedAmountInCents: 50000,
      });

      await expect(
        service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER'),
      ).rejects.toThrow('No refundable balance remaining for order order-1');
    });

    it('caps Stripe refund at available balance when raw items sum exceeds remaining amount', async () => {
      // Raw sum = 2×34900 + 1×44900 = 114700, but only 90000 remain refundable.
      prisma.payment.findUnique.mockResolvedValue({
        ...completedPayment,
        amountInCents: 150000,
        refundedAmountInCents: 60000,
      });
      stripeClient.createPartialRefund.mockResolvedValue({} as any);
      prisma.$transaction.mockImplementation(buildPartialTx());

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(stripeClient.createPartialRefund).toHaveBeenCalledWith(
        'pi_test_abc123',
        90000,
        expect.any(String),
      );
    });

    it('increments refundedAmountInCents by the capped amount when raw sum exceeds available', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...completedPayment,
        amountInCents: 150000,
        refundedAmountInCents: 60000,
      });
      stripeClient.createPartialRefund.mockResolvedValue({} as any);

      let capturedPaymentData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          orderItem: {
            update: jest.fn(),
            findMany: jest.fn().mockResolvedValue([
              { id: 'item-1', quantity: 3, cancelledQuantity: 2 },
            ]),
          },
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          payment: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedPaymentData = args.data;
            }),
          },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.partialRefund('order-1', twoItems, OrderStatus.PAID, 'CUSTOMER');

      expect(capturedPaymentData.refundedAmountInCents).toEqual({ increment: 90000 });
    });
  });

  describe('handleRefundUpdate (via charge.refund.updated / refund.updated)', () => {
    const buildRefund = (overrides: Partial<Stripe.Refund> = {}): Stripe.Refund =>
      ({
        id: 're_test_123',
        object: 'refund',
        amount: 14999,
        status: 'succeeded',
        payment_intent: 'pi_test_abc123',
        ...overrides,
      }) as unknown as Stripe.Refund;

    const refundPayment = {
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.COMPLETED,
      stripePaymentIntentId: 'pi_test_abc123',
      amountInCents: 14999,
      order: {
        orderNumber: 'ORD-2026-000001',
        status: OrderStatus.PAID,
        items: [
          { productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 0 },
          { productVariantId: 'pv-2', quantity: 1, cancelledQuantity: 0 },
        ],
      },
    };

    const buildFullRefundTx = (capturedState: {
      paymentStatus?: PaymentStatus;
      orderStatus?: OrderStatus;
      stockRestored?: Array<{ id: string; increment: number }>;
      eventData?: any;
    }) =>
      async (fn: any) => {
        capturedState.stockRestored = [];
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          payment: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedState.paymentStatus = args.data.status;
            }),
          },
          order: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedState.orderStatus = args.data.status;
            }),
          },
          productVariant: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedState.stockRestored!.push({
                id: args.where.id,
                increment: args.data.stock.increment,
              });
            }),
          },
          orderEvent: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedState.eventData = args.data;
            }),
          },
        });
      };

    it('routes charge.refund.updated to the refund handler', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(buildEvent('charge.refund.updated', buildRefund()));

      expect(prisma.payment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stripePaymentIntentId: 'pi_test_abc123' } }),
      );
    });

    it('routes refund.updated to the refund handler', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(buildEvent('refund.updated', buildRefund()));

      expect(prisma.payment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stripePaymentIntentId: 'pi_test_abc123' } }),
      );
    });

    it('skips "pending" transitional status without touching the DB', async () => {
      await service.handleWebhookEvent(
        buildEvent('refund.updated', buildRefund({ status: 'pending' as any })),
      );

      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips "canceled" transitional status without touching the DB', async () => {
      await service.handleWebhookEvent(
        buildEvent('refund.updated', buildRefund({ status: 'canceled' as any })),
      );

      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('warns and returns when refund has no payment_intent', async () => {
      await service.handleWebhookEvent(
        buildEvent('charge.refund.updated', buildRefund({ payment_intent: null as any })),
      );

      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('extracts payment_intent.id when payment_intent is an object', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(
        buildEvent('refund.updated', buildRefund({ payment_intent: { id: 'pi_nested_id' } as any })),
      );

      expect(prisma.payment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stripePaymentIntentId: 'pi_nested_id' } }),
      );
    });

    it('warns and returns when no payment found for the PaymentIntent ID', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(buildEvent('charge.refund.updated', buildRefund()));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('logs error and returns without DB changes when refund.status is "failed"', async () => {
      prisma.payment.findUnique.mockResolvedValue(refundPayment);

      await service.handleWebhookEvent(
        buildEvent('charge.refund.updated', buildRefund({ status: 'failed' })),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is idempotent: skips when payment is already REFUNDED', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...refundPayment,
        status: PaymentStatus.REFUNDED,
      });

      await service.handleWebhookEvent(buildEvent('refund.updated', buildRefund()));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('marks payment and order REFUNDED on a full async refund', async () => {
      prisma.payment.findUnique.mockResolvedValue(refundPayment);
      const state: { paymentStatus?: PaymentStatus; orderStatus?: OrderStatus } = {};
      prisma.$transaction.mockImplementation(buildFullRefundTx(state));

      await service.handleWebhookEvent(buildEvent('charge.refund.updated', buildRefund()));

      expect(state.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(state.orderStatus).toBe(OrderStatus.REFUNDED);
    });

    it('restores stock for active items (quantity - cancelledQuantity) on full refund', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...refundPayment,
        order: {
          ...refundPayment.order,
          items: [
            { productVariantId: 'pv-1', quantity: 3, cancelledQuantity: 1 }, // activeQty = 2
            { productVariantId: 'pv-2', quantity: 2, cancelledQuantity: 0 }, // activeQty = 2
          ],
        },
      });
      const state: { stockRestored?: Array<{ id: string; increment: number }> } = {};
      prisma.$transaction.mockImplementation(buildFullRefundTx(state));

      await service.handleWebhookEvent(buildEvent('refund.updated', buildRefund()));

      expect(state.stockRestored).toEqual(
        expect.arrayContaining([
          { id: 'pv-1', increment: 2 },
          { id: 'pv-2', increment: 2 },
        ]),
      );
    });

    it('does not restore stock for items that were already fully cancelled', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...refundPayment,
        order: {
          ...refundPayment.order,
          items: [
            { productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 2 }, // activeQty = 0 — skip
            { productVariantId: 'pv-2', quantity: 1, cancelledQuantity: 0 }, // activeQty = 1 — restore
          ],
        },
      });
      const state: { stockRestored?: Array<{ id: string; increment: number }> } = {};
      prisma.$transaction.mockImplementation(buildFullRefundTx(state));

      await service.handleWebhookEvent(buildEvent('refund.updated', buildRefund()));

      const restoredIds = state.stockRestored!.map((s) => s.id);
      expect(restoredIds).not.toContain('pv-1');
      expect(restoredIds).toContain('pv-2');
    });

    it('creates an OrderEvent referencing the refund id and SYSTEM:stripe-webhook actor', async () => {
      prisma.payment.findUnique.mockResolvedValue(refundPayment);
      const state: { eventData?: any } = {};
      prisma.$transaction.mockImplementation(buildFullRefundTx(state));

      await service.handleWebhookEvent(
        buildEvent('charge.refund.updated', buildRefund({ id: 're_test_123' })),
      );

      expect(state.eventData.actor).toBe('SYSTEM:stripe-webhook');
      expect(state.eventData.toStatus).toBe(OrderStatus.REFUNDED);
      expect(state.eventData.note).toContain('re_test_123');
    });

    it('logs confirmation (no DB change) when partial refund arrives and sync path already applied (PARTIALLY_REFUNDED)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...refundPayment,
        order: { ...refundPayment.order, status: OrderStatus.PARTIALLY_REFUNDED },
      });

      await expect(
        service.handleWebhookEvent(
          buildEvent('refund.updated', buildRefund({ amount: 5000 })), // partial: 5000 < 14999
        ),
      ).resolves.not.toThrow();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('logs confirmation (no DB change) when partial refund arrives and order is already REFUNDED', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...refundPayment,
        order: { ...refundPayment.order, status: OrderStatus.REFUNDED },
      });

      await expect(
        service.handleWebhookEvent(
          buildEvent('charge.refund.updated', buildRefund({ amount: 5000 })),
        ),
      ).resolves.not.toThrow();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('applies best-effort recovery via $transaction when partial refund arrives but order is still PAID (sync path failed)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...refundPayment,
        order: { ...refundPayment.order, status: OrderStatus.PAID }, // sync path never ran
      });

      await expect(
        service.handleWebhookEvent(
          buildEvent('refund.updated', buildRefund({ amount: 5000 })),
        ),
      ).resolves.not.toThrow();

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('refundPayment', () => {
    it('throws NotFoundException when no payment exists for the order', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.refundPayment('order-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns early (no-op) when payment is already REFUNDED', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.REFUNDED,
      });

      await service.refundPayment('order-1');

      expect(stripeClient.createRefund).not.toHaveBeenCalled();
    });

    it('throws when payment status is not COMPLETED', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.PENDING,
      });

      await expect(service.refundPayment('order-1')).rejects.toThrow(
        'Cannot refund payment with status',
      );
    });

    it('throws when there is no Stripe PaymentIntent ID', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
        stripePaymentIntentId: null,
      });

      await expect(service.refundPayment('order-1')).rejects.toThrow(
        'No Stripe PaymentIntent ID',
      );
    });

    it('issues Stripe refund and restores stock inside a transaction', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      });
      stripeClient.createRefund.mockResolvedValue({} as any);

      const stockRestored: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
            orderEvent: { create: jest.fn() },
            productVariant: {
              update: jest.fn().mockImplementation((args: any) => {
                stockRestored.push(args.where.id);
              }),
            },
          });
        }
      });

      await service.refundPayment('order-1');

      expect(stripeClient.createRefund).toHaveBeenCalledWith('pi_test_abc123', 'order-1');
      expect(stockRestored).toContain('pv-1');
    });

    // FIX: refund stock restores previously never reached the live-stock SSE
    // stream or the back-in-stock notifier.
    it('notifies ProductsService of the restored variant after the refund transaction commits', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      });
      stripeClient.createRefund.mockResolvedValue({} as any);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          payment: { update: jest.fn() },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
          productVariant: { update: jest.fn() },
        });
      });

      await service.refundPayment('order-1');

      expect(productsService.notifyStockChangesByDelta).toHaveBeenCalledWith([
        { variantId: 'pv-1', delta: 2 },
      ]);
    });

    it('omits the withdrawal reason from the orderEvent note when none is given', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      });
      stripeClient.createRefund.mockResolvedValue({} as any);

      let capturedNote: string | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          payment: { update: jest.fn() },
          order: { update: jest.fn() },
          productVariant: { update: jest.fn() },
          orderEvent: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedNote = args.data.note;
            }),
          },
        });
      });

      await service.refundPayment('order-1', 'CUSTOMER');

      expect(capturedNote).toBe('Stripe refund issued for PaymentIntent pi_test_abc123');
    });

    it('appends the withdrawal reason to the same orderEvent note instead of creating a second event', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      });
      stripeClient.createRefund.mockResolvedValue({} as any);

      const orderEventCreate = jest.fn();
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          payment: { update: jest.fn() },
          order: { update: jest.fn() },
          productVariant: { update: jest.fn() },
          orderEvent: { create: orderEventCreate },
        });
      });

      await service.refundPayment('order-1', 'CUSTOMER', 'Changed my mind');

      expect(orderEventCreate).toHaveBeenCalledTimes(1);
      expect(orderEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromStatus: mockPayment.order.status,
            toStatus: OrderStatus.REFUNDED,
            note: 'Stripe refund issued for PaymentIntent pi_test_abc123. Withdrawal reason: Changed my mind',
          }),
        }),
      );
    });
  });

  // ── Sentry error reporting ───────────────────────────────────────────────
  // Verifies that the four catch paths that were previously swallowed (logged
  // only) now also report to Sentry so they are visible in the dashboard.

  describe('Sentry error reporting', () => {
    const buildRefundForSentry = (overrides: Partial<Stripe.Refund> = {}): Stripe.Refund =>
      ({
        id: 're_sentry_test',
        object: 'refund',
        amount: 5000,
        status: 'succeeded',
        payment_intent: 'pi_test_abc123',
        ...overrides,
      }) as unknown as Stripe.Refund;

    const refundPaymentForSentry = {
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.COMPLETED,
      stripePaymentIntentId: 'pi_test_abc123',
      amountInCents: 14999,
      order: {
        orderNumber: 'ORD-2026-000001',
        status: OrderStatus.PAID,
        items: [{ productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 0 }],
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('calls Sentry.captureException when invoice generation fails', async () => {
      const invoiceError = new Error('PDF service timeout');
      invoiceService.processInvoice.mockRejectedValue(invoiceError);
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockResolvedValue([{}, {}]);
      emailService.sendPaymentConfirmed.mockResolvedValue(undefined);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      // Drain the fire-and-forget promise chain (.then().catch())
      await new Promise((resolve) => setImmediate(resolve));

      expect(Sentry.captureException).toHaveBeenCalledWith(invoiceError);
    });

    it('falls back to plain payment confirmation when invoice generation fails', async () => {
      invoiceService.processInvoice.mockRejectedValue(new Error('PDF service timeout'));
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockResolvedValue([{}, {}]);
      emailService.sendPaymentConfirmed.mockResolvedValue(undefined);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      await new Promise((resolve) => setImmediate(resolve));

      expect(emailService.sendPaymentConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ orderNumber: mockPayment.order.orderNumber }),
      );
    });

    it('calls Sentry.captureMessage at error level when a Stripe refund fails', async () => {
      prisma.payment.findUnique.mockResolvedValue(refundPaymentForSentry);

      await service.handleWebhookEvent(
        buildEvent('charge.refund.updated', buildRefundForSentry({ status: 'failed' })),
      );

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('re_sentry_test'),
        'error',
      );
      expect(Sentry.withScope).toHaveBeenCalled();
      // A failed refund should not write DB changes — financial records must not be altered
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('calls Sentry.captureMessage at fatal level when partial refund sync path failed', async () => {
      // Partial refund (amount < amountInCents) but order is still PAID — the
      // sync path in partialRefund() never completed (e.g. DB crash after Stripe succeeded).
      prisma.payment.findUnique.mockResolvedValue({
        ...refundPaymentForSentry,
        order: { ...refundPaymentForSentry.order, status: OrderStatus.PAID },
      });
      prisma.$transaction.mockResolvedValue([]);

      await service.handleWebhookEvent(
        buildEvent('refund.updated', buildRefundForSentry({ amount: 5000, status: 'succeeded' })),
      );

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('ORD-2026-000001'),
        'fatal',
      );
    });

    it('calls Sentry.captureException when reconciliation throws for a payment', async () => {
      const reconcileError = new Error('DB connection lost during reconciliation');
      prisma.payment.findMany.mockResolvedValue([
        { ...mockPayment, stripeCheckoutSessionId: mockSession.id },
      ]);
      stripeClient.retrieveCheckoutSession.mockRejectedValue(reconcileError);

      await service.reconcilePendingPayments();

      expect(Sentry.captureException).toHaveBeenCalledWith(reconcileError);
    });

    it('continues reconciling remaining payments after a single failure', async () => {
      const secondPayment = {
        ...mockPayment,
        id: 'payment-2',
        stripeCheckoutSessionId: 'cs_second',
      };
      prisma.payment.findMany.mockResolvedValue([
        { ...mockPayment, stripeCheckoutSessionId: mockSession.id },
        secondPayment,
      ]);
      stripeClient.retrieveCheckoutSession
        .mockRejectedValueOnce(new Error('Stripe timeout'))
        .mockResolvedValueOnce({ id: 'cs_second', payment_status: 'unpaid', status: 'open' } as any);

      await expect(service.reconcilePendingPayments()).resolves.not.toThrow();

      expect(stripeClient.retrieveCheckoutSession).toHaveBeenCalledTimes(2);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
  });

  // ── Merchant notifications (markSessionPaid) ────────────────────────────
  // Verifies the improved notification flow: email fallback, Sentry on
  // failure, deep-link adminUrl, and optional Slack webhook.

  describe('merchant notifications (markSessionPaid)', () => {
    let notifService: PaymentsService;
    let notifPrisma: any;
    let notifEmail: jest.Mocked<EmailQueueService>;
    let notifConfigGet: jest.Mock;

    const mockPaymentWithItems = {
      id: 'payment-notif-1',
      orderId: 'order-notif-1',
      status: PaymentStatus.PENDING,
      stripeCheckoutSessionId: 'cs_notif',
      order: {
        id: 'order-notif-1',
        orderNumber: 'ORD-2026-000099',
        status: OrderStatus.PENDING_PAYMENT,
        snapshotEmail: 'customer@example.com',
        snapshotFirstName: 'Anna',
        totalInCents: 29900,
        carrierCode: 'INPOST',
        items: [
          { snapshotName: 'Dior Sauvage 100ml', quantity: 1, snapshotPrice: 29900 },
        ],
      },
    };

    beforeEach(async () => {
      notifConfigGet = jest.fn().mockReturnValue(undefined);
      jest.clearAllMocks();
      (axios.post as jest.Mock).mockResolvedValue({ data: 'ok' });

      const module = await Test.createTestingModule({
        providers: [
          PaymentsService,
          {
            provide: PrismaService,
            useValue: {
              payment: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
              order: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
              orderEvent: { create: jest.fn() },
              orderItem: { update: jest.fn(), findMany: jest.fn() },
              productVariant: { update: jest.fn() },
              processedStripeEvent: { create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
              outboxMessage: {
                create: jest.fn().mockResolvedValue({ id: 'outbox-notif-1' }),
                update: jest.fn().mockResolvedValue({}),
              },
              $transaction: jest.fn(),
            },
          },
          {
            provide: StripeClient,
            useValue: {
              createCheckoutSession: jest.fn(),
              constructWebhookEvent: jest.fn(),
              retrieveCheckoutSession: jest.fn(),
              retrievePaymentIntentWithCharge: jest.fn().mockResolvedValue({
                latest_charge: { outcome: { risk_level: 'normal' } },
              }),
              createRefund: jest.fn(),
              createPartialRefund: jest.fn(),
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
              processInvoice: jest.fn().mockResolvedValue({ url: 'https://invoice.pdf', storagePath: 'invoices/FV-2026-000001.pdf', pdf: Buffer.from(''), invoiceNumber: 'FV/2026/000001' }),
              getSignedUrl: jest.fn().mockResolvedValue('https://invoice.pdf'),
            },
          },
          {
            provide: ConfigService,
            useValue: {
              get: notifConfigGet,
              getOrThrow: jest.fn().mockReturnValue('http://example.com'),
            },
          },
          {
            provide: 'REDIS_CLIENT',
            useValue: { set: jest.fn().mockResolvedValue('OK') },
          },
          {
            provide: CouponService,
            useValue: { validate: jest.fn().mockResolvedValue({ valid: true }) },
          },
          {
            provide: ProductsService,
            useValue: { notifyStockChangesByDelta: jest.fn().mockResolvedValue(undefined) },
          },
        ],
      }).compile();

      notifService = module.get(PaymentsService);
      notifPrisma = module.get(PrismaService);
      notifEmail = module.get(EmailQueueService);

      notifPrisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          return fn({
            processedStripeEvent: notifPrisma.processedStripeEvent,
            payment: notifPrisma.payment,
            order: notifPrisma.order,
            orderEvent: notifPrisma.orderEvent,
            productVariant: notifPrisma.productVariant,
            outboxMessage: notifPrisma.outboxMessage,
          });
        }
        return Promise.all(fn);
      });
    });

    const triggerPaid = async () => {
      notifPrisma.payment.findUnique.mockResolvedValue(mockPaymentWithItems);
      await notifService.handleWebhookEvent(
        buildEvent('checkout.session.completed', { id: 'cs_notif', payment_intent: 'pi_notif' }),
      );
      await new Promise((resolve) => setImmediate(resolve));
    };

    it('sends email notification to ADMIN_ALERT_EMAIL when configured', async () => {
      notifConfigGet.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'merchant@store.com';
        return undefined;
      });

      await triggerPaid();

      expect(notifEmail.sendNewOrderNotification).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'merchant@store.com' }),
      );
    });

    it('falls back to EMAIL_FROM when ADMIN_ALERT_EMAIL is absent', async () => {
      notifConfigGet.mockImplementation((key: string) => {
        if (key === 'EMAIL_FROM') return 'noreply@store.com';
        return undefined;
      });

      await triggerPaid();

      expect(notifEmail.sendNewOrderNotification).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'noreply@store.com' }),
      );
    });

    it('sends no email notification when both ADMIN_ALERT_EMAIL and EMAIL_FROM are absent', async () => {
      // notifConfigGet returns undefined for all keys by default
      await triggerPaid();

      expect(notifEmail.sendNewOrderNotification).not.toHaveBeenCalled();
    });

    it('deep-links adminUrl to /admin/orders/:orderId rather than just /admin', async () => {
      notifConfigGet.mockImplementation((key: string, defaultVal?: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        if (key === 'FRONTEND_URL') return 'https://mystore.pl';
        return defaultVal;
      });

      await triggerPaid();

      expect(notifEmail.sendNewOrderNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUrl: 'https://mystore.pl/admin/orders/order-notif-1',
        }),
      );
    });

    it('reports email enqueue failure to Sentry instead of swallowing it silently', async () => {
      notifConfigGet.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });
      const queueError = new Error('Redis connection refused');
      (notifEmail.sendNewOrderNotification as jest.Mock).mockRejectedValue(queueError);

      await triggerPaid();

      expect(Sentry.captureException).toHaveBeenCalledWith(
        queueError,
        expect.objectContaining({
          tags: expect.objectContaining({ 'notification.channel': 'email' }),
        }),
      );
    });

    it('email enqueue failure does not propagate to the webhook handler', async () => {
      notifConfigGet.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });
      (notifEmail.sendNewOrderNotification as jest.Mock).mockRejectedValue(new Error('Redis down'));

      notifPrisma.payment.findUnique.mockResolvedValue(mockPaymentWithItems);
      await expect(
        notifService.handleWebhookEvent(
          buildEvent('checkout.session.completed', { id: 'cs_notif', payment_intent: 'pi_notif' }),
        ),
      ).resolves.not.toThrow();
    });

    it('POSTs to Slack webhook with order number and formatted total when MERCHANT_SLACK_WEBHOOK_URL is set', async () => {
      notifConfigGet.mockImplementation((key: string) => {
        if (key === 'MERCHANT_SLACK_WEBHOOK_URL') return 'https://hooks.slack.com/services/T00/B00/xxx';
        return undefined;
      });

      await triggerPaid();

      expect(axios.post).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/T00/B00/xxx',
        expect.objectContaining({
          text: expect.stringContaining('ORD-2026-000099'),
        }),
        { timeout: 3_000 },
      );
      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ text: expect.stringContaining('299.00') }),
        { timeout: 3_000 },
      );
    });

    it('passes a 3-second timeout to axios.post to prevent graceful-shutdown stall', async () => {
      notifConfigGet.mockImplementation((key: string) => {
        if (key === 'MERCHANT_SLACK_WEBHOOK_URL') return 'https://hooks.slack.com/services/T00/B00/yyy';
        return undefined;
      });

      await triggerPaid();

      const [, , config] = (axios.post as jest.Mock).mock.calls[0];
      expect(config).toEqual({ timeout: 3_000 });
    });

    it('does not POST to Slack when MERCHANT_SLACK_WEBHOOK_URL is absent', async () => {
      // notifConfigGet returns undefined for all keys
      await triggerPaid();

      expect(axios.post).not.toHaveBeenCalled();
    });

    it('Slack POST failure does not propagate to the webhook handler', async () => {
      notifConfigGet.mockImplementation((key: string) => {
        if (key === 'MERCHANT_SLACK_WEBHOOK_URL') return 'https://hooks.slack.com/services/T00/B00/xxx';
        return undefined;
      });
      (axios.post as jest.Mock).mockRejectedValue(new Error('Slack API unavailable'));

      notifPrisma.payment.findUnique.mockResolvedValue(mockPaymentWithItems);
      await expect(
        notifService.handleWebhookEvent(
          buildEvent('checkout.session.completed', { id: 'cs_notif', payment_intent: 'pi_notif' }),
        ),
      ).resolves.not.toThrow();
    });
  });

  // ── approveFraudReview ──────────────────────────────────────────────────────
  // Invariants:
  //  - Only FRAUD_REVIEW orders can be approved; any other status throws
  //  - On approval: order moves to PAID and post-payment notifications fire
  //  - Customer confirmation email IS sent after admin approves

  describe('approveFraudReview', () => {
    const mockFraudOrder = {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: OrderStatus.FRAUD_REVIEW,
      snapshotEmail: 'customer@example.com',
      snapshotFirstName: 'Jan',
      snapshotLastName: 'Kowalski',
      snapshotCompany: null,
      snapshotNip: null,
      snapshotStreet: 'ul. Testowa 1',
      snapshotCity: 'Kraków',
      snapshotPostalCode: '30-001',
      totalInCents: 14999,
      itemsTotalInCents: 13500,
      shippingCostInCents: 1499,
      discountInCents: 0,
      couponCode: null,
      carrierCode: 'INPOST',
      createdAt: new Date('2026-01-15'),
      items: [
        { snapshotName: 'Dior 100ml', snapshotPrice: 13500, snapshotVatRate: 2300, quantity: 1 },
      ],
    };

    it('throws when the order is not in FRAUD_REVIEW status', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...mockFraudOrder,
        status: OrderStatus.PAID,
      });

      await expect(service.approveFraudReview('order-1')).rejects.toThrow(
        /Cannot approve order/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('transitions order from FRAUD_REVIEW to PAID in a single transaction', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockFraudOrder);
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        stripePaymentIntentId: 'pi_test_abc123',
      });

      await service.approveFraudReview('order-1', 'ADMIN');

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: OrderStatus.PAID } }),
      );
      expect(prisma.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromStatus: OrderStatus.FRAUD_REVIEW,
            toStatus: OrderStatus.PAID,
          }),
        }),
      );
    });

    it('dispatches customer confirmation email after approval', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockFraudOrder);
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        stripePaymentIntentId: 'pi_test_abc123',
      });

      await service.approveFraudReview('order-1', 'ADMIN');

      await Promise.resolve();
      expect(emailService.sendPaymentConfirmedWithInvoice).toHaveBeenCalled();
    });

    it('records the approving actor in the orderEvent', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockFraudOrder);
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        stripePaymentIntentId: null,
      });

      await service.approveFraudReview('order-1', 'ADMIN:analyst');

      expect(prisma.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actor: 'ADMIN:analyst' }),
        }),
      );
    });

    // ── Outbox recovery safety net ──────────────────────────────────────────
    // Regression coverage for: a crash between the PAID commit and the
    // in-process notification dispatch used to permanently lose the invoice +
    // confirmation email, because no OutboxMessage row backed this path.

    it('inserts a POST_PAYMENT_NOTIFICATIONS outbox row atomically with the PAID transition', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockFraudOrder);
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        stripePaymentIntentId: 'pi_test_abc123',
      });

      await service.approveFraudReview('order-1', 'ADMIN');

      expect(prisma.outboxMessage.create).toHaveBeenCalledWith({
        data: { type: 'POST_PAYMENT_NOTIFICATIONS', orderId: 'order-1' },
      });
    });

    it('marks the outbox row PROCESSED once the fast-path dispatch completes', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockFraudOrder);
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        stripePaymentIntentId: 'pi_test_abc123',
      });
      prisma.outboxMessage.create.mockResolvedValue({ id: 'outbox-fraud-1' });

      await service.approveFraudReview('order-1', 'ADMIN');
      await Promise.resolve();

      expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
        where: { id: 'outbox-fraud-1' },
        data: { status: 'PROCESSED', processedAt: expect.any(Date) },
      });
    });

    it('still inserts the outbox row even if the order has no recoverable payment intent', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockFraudOrder);
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        stripePaymentIntentId: null,
      });

      await service.approveFraudReview('order-1', 'ADMIN');

      expect(prisma.outboxMessage.create).toHaveBeenCalledWith({
        data: { type: 'POST_PAYMENT_NOTIFICATIONS', orderId: 'order-1' },
      });
    });
  });

  // ── markSessionPaid idempotency — session-scoped key ──────────────────
  // Verifies the fix: markSessionPaid always inserts a paid-{session.id}
  // processedStripeEvent row regardless of caller (webhook or reconcile cron)
  // so concurrent callers race on the same unique constraint — only one wins.

  describe('markSessionPaid idempotency — session-scoped key', () => {
    const paidSession = {
      ...mockSession,
      payment_status: 'paid',
      status: 'complete',
    } as any;

    it('always inserts paid-{session.id} key in the transaction when called from reconcile path (no eventId)', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { ...mockPayment, stripeCheckoutSessionId: mockSession.id },
      ]);
      stripeClient.retrieveCheckoutSession.mockResolvedValue(paidSession);
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      await service.reconcilePendingPayments();

      expect(prisma.processedStripeEvent.create).toHaveBeenCalledWith({
        data: { eventId: `paid-${mockSession.id}` },
      });
    });

    it('does not insert a webhook eventId row when called from reconcile path (session key only)', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { ...mockPayment, stripeCheckoutSessionId: mockSession.id },
      ]);
      stripeClient.retrieveCheckoutSession.mockResolvedValue(paidSession);
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      await service.reconcilePendingPayments();

      expect(prisma.processedStripeEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.processedStripeEvent.create).toHaveBeenCalledWith({
        data: { eventId: `paid-${mockSession.id}` },
      });
    });

    it('inserts both paid-{session.id} and eventId when called from webhook path', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const event = buildEvent('checkout.session.completed', mockSession);
      await service.handleWebhookEvent(event);

      expect(prisma.processedStripeEvent.create).toHaveBeenCalledTimes(2);
      expect(prisma.processedStripeEvent.create).toHaveBeenCalledWith({
        data: { eventId: `paid-${mockSession.id}` },
      });
      expect(prisma.processedStripeEvent.create).toHaveBeenCalledWith({
        data: { eventId: event.id },
      });
    });

    it('reconcile path resolves without error when session-scoped key already exists (P2002 — webhook already committed)', async () => {
      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`event_id`)',
        { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['event_id'] } },
      );
      prisma.payment.findMany.mockResolvedValue([
        { ...mockPayment, stripeCheckoutSessionId: mockSession.id },
      ]);
      stripeClient.retrieveCheckoutSession.mockResolvedValue(paidSession);
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockRejectedValue(duplicateError);

      await expect(service.reconcilePendingPayments()).resolves.not.toThrow();

      expect(emailService.sendPaymentConfirmedWithInvoice).not.toHaveBeenCalled();
      expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
    });
  });

  // ── handlePaymentFailure — SELECT FOR UPDATE race-condition guard ─────────
  // Invariant: when expired arrives first and completed arrives second (out-of-order
  // BLIK/P24 delivery), the SELECT FOR UPDATE lock inside handlePaymentFailure must
  // see COMPLETED (set by the concurrent markSessionPaid) and bail — no double-cancel.
  // Conversely, if expired arrives and the payment is still PENDING, it must proceed.

  describe('handlePaymentFailure — SELECT FOR UPDATE serialisation guard', () => {
    it('does NOT cancel the order when SELECT FOR UPDATE sees payment already COMPLETED (completed won the race)', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const txOrderUpdate = jest.fn();
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.COMPLETED }]),
            processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
            payment: { update: jest.fn() },
            order: { update: txOrderUpdate },
            orderEvent: { create: jest.fn() },
            productVariant: { update: jest.fn() },
          });
        }
      });

      await service.handleWebhookEvent(
        buildEvent('checkout.session.expired', mockSession),
      );

      expect(txOrderUpdate).not.toHaveBeenCalled();
    });

    it('DOES cancel the order when SELECT FOR UPDATE sees payment still PENDING (failure path wins)', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const txOrderUpdate = jest.fn();
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.PENDING }]),
            processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
            payment: { update: jest.fn() },
            order: { update: txOrderUpdate },
            orderEvent: { create: jest.fn() },
            productVariant: { update: jest.fn() },
          });
        }
      });

      await service.handleWebhookEvent(
        buildEvent('checkout.session.expired', mockSession),
      );

      expect(txOrderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: OrderStatus.CANCELLED } }),
      );
    });

    it('inserts session-scoped failed-{session.id} idempotency key inside the transaction', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const txProcessedCreate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.PENDING }]),
            processedStripeEvent: { create: txProcessedCreate },
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
            orderEvent: { create: jest.fn() },
            productVariant: { update: jest.fn() },
          });
        }
      });

      const event = buildEvent('checkout.session.expired', mockSession);
      await service.handleWebhookEvent(event);

      expect(txProcessedCreate).toHaveBeenCalledWith({
        data: { eventId: `failed-${mockSession.id}` },
      });
    });

    it('inserts both failed-{session.id} and the webhook eventId when both are available', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const txProcessedCreate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.PENDING }]),
            processedStripeEvent: { create: txProcessedCreate },
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
            orderEvent: { create: jest.fn() },
            productVariant: { update: jest.fn() },
          });
        }
      });

      const event = buildEvent('checkout.session.expired', mockSession);
      await service.handleWebhookEvent(event);

      expect(txProcessedCreate).toHaveBeenCalledWith({
        data: { eventId: `failed-${mockSession.id}` },
      });
      expect(txProcessedCreate).toHaveBeenCalledWith({
        data: { eventId: event.id },
      });
    });

    it('resolves without error when P2002 is thrown on failed-{session.id} key (duplicate expired delivery)', async () => {
      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`event_id`)',
        { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['event_id'] } },
      );
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockRejectedValue(duplicateError);

      await expect(
        service.handleWebhookEvent(buildEvent('checkout.session.expired', mockSession)),
      ).resolves.not.toThrow();
    });
  });

  // ── handlePaymentFailure — stock restore respects cancelledQuantity ────────
  // Invariant: stock restore must credit only the still-active units
  // (quantity - cancelledQuantity), matching the other three restore sites in
  // payments.service.ts and orders.service.ts. Without this, an item that was
  // partially cancelled before payment failed would be double-credited.

  describe('handlePaymentFailure — stock restore respects cancelledQuantity', () => {
    const buildFailureTx = (capturedState: {
      stockRestored?: Array<{ id: string; increment: number }>;
    }) =>
      async (fn: any) => {
        capturedState.stockRestored = [];
        await fn({
          $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.PENDING }]),
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          payment: { update: jest.fn() },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
          productVariant: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedState.stockRestored!.push({
                id: args.where.id,
                increment: args.data.stock.increment,
              });
            }),
          },
        });
      };

    it('restores only the active quantity (quantity - cancelledQuantity) for a partially cancelled item', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        order: {
          ...mockPayment.order,
          items: [
            { productVariantId: 'pv-1', quantity: 3, cancelledQuantity: 1 }, // activeQty = 2
            { productVariantId: 'pv-2', quantity: 2, cancelledQuantity: 0 }, // activeQty = 2
          ],
        },
      });
      const state: { stockRestored?: Array<{ id: string; increment: number }> } = {};
      prisma.$transaction.mockImplementation(buildFailureTx(state));

      await service.handleWebhookEvent(buildEvent('checkout.session.expired', mockSession));

      expect(state.stockRestored).toEqual(
        expect.arrayContaining([
          { id: 'pv-1', increment: 2 },
          { id: 'pv-2', increment: 2 },
        ]),
      );
    });

    it('does not credit stock for an item that was already fully cancelled', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        order: {
          ...mockPayment.order,
          items: [
            { productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 2 }, // activeQty = 0
            { productVariantId: 'pv-2', quantity: 1, cancelledQuantity: 0 }, // activeQty = 1
          ],
        },
      });
      const state: { stockRestored?: Array<{ id: string; increment: number }> } = {};
      prisma.$transaction.mockImplementation(buildFailureTx(state));

      await service.handleWebhookEvent(buildEvent('checkout.session.expired', mockSession));

      expect(state.stockRestored).toEqual([
        { id: 'pv-1', increment: 0 },
        { id: 'pv-2', increment: 1 },
      ]);
    });

    it('restores the full quantity when cancelledQuantity is absent (treated as 0)', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment); // items: [{ productVariantId: 'pv-1', quantity: 2 }]
      const state: { stockRestored?: Array<{ id: string; increment: number }> } = {};
      prisma.$transaction.mockImplementation(buildFailureTx(state));

      await service.handleWebhookEvent(buildEvent('checkout.session.expired', mockSession));

      expect(state.stockRestored).toEqual([{ id: 'pv-1', increment: 2 }]);
    });
  });

  // ── pruneProcessedStripeEvents ─────────────────────────────────────────
  // Invariant: nightly cron must delete rows older than 7 days so the
  // dedup table does not grow unboundedly and cause Postgres disk exhaustion.

  describe('pruneProcessedStripeEvents', () => {
    it('calls deleteMany with a createdAt cutoff exactly 7 days in the past', async () => {
      const frozenNow = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(frozenNow);
      prisma.processedStripeEvent.deleteMany.mockResolvedValue({ count: 3 });

      await service.pruneProcessedStripeEvents();

      expect(prisma.processedStripeEvent.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: new Date(frozenNow - 7 * 24 * 60 * 60 * 1000) } },
      });

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('resolves without error when no rows are pruned (count = 0)', async () => {
      prisma.processedStripeEvent.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.pruneProcessedStripeEvents()).resolves.not.toThrow();
    });

    it('resolves without error when rows are pruned (count > 0)', async () => {
      prisma.processedStripeEvent.deleteMany.mockResolvedValue({ count: 42 });

      await expect(service.pruneProcessedStripeEvents()).resolves.not.toThrow();
    });

    it('does not call any other prisma method (cleanup is self-contained)', async () => {
      prisma.processedStripeEvent.deleteMany.mockResolvedValue({ count: 0 });

      await service.pruneProcessedStripeEvents();

      expect(prisma.payment.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── @Cron timezone configuration ────────────────────────────────────────────

  describe('@Cron timezone configuration', () => {
    it('reconcilePendingPayments is configured to fire in Europe/Warsaw timezone', () => {
      const meta = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        PaymentsService.prototype['reconcilePendingPayments'],
      );
      expect(meta?.timeZone).toBe('Europe/Warsaw');
    });

    it('pruneProcessedStripeEvents is configured to fire in Europe/Warsaw timezone', () => {
      const meta = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        PaymentsService.prototype['pruneProcessedStripeEvents'],
      );
      expect(meta?.timeZone).toBe('Europe/Warsaw');
    });
  });

  // ── Dispute webhook handlers ─────────────────────────────────────────────────
  // Invariants enforced by the fix:
  //   1. charge.dispute.created → order → DISPUTE_HOLD, admin email + Sentry alert
  //   2. charge.dispute.closed (won) → order restored to pre-dispute status
  //   3. charge.dispute.closed (lost) → CANCELLED; stock always restored (no labelUrl heuristic)
  //   4. Duplicate events (P2002) are swallowed; non-P2002 errors are re-thrown

  describe('dispute webhook handlers', () => {
    const buildDispute = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      id: 'dp_test_123',
      payment_intent: 'pi_test_abc123',
      reason: 'fraudulent',
      status: 'needs_response',
      amount: 14999,
      currency: 'pln',
      evidence_details: { due_by: 1_800_000_000 },
      ...overrides,
    });

    const mockOrderPaid = {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: OrderStatus.PAID,
      snapshotEmail: 'test@example.com',
      snapshotFirstName: 'Jan',
      totalInCents: 14999,
    };

    const mockPaymentForDispute = {
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.COMPLETED,
      stripePaymentIntentId: 'pi_test_abc123',
      amountInCents: 14999,
      order: mockOrderPaid,
    };

    const mockPaymentForDisputeClosed = {
      ...mockPaymentForDispute,
      order: {
        ...mockOrderPaid,
        status: OrderStatus.DISPUTE_HOLD,
        items: [
          { productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 0 },
        ],
        shipment: null,
      },
    };

    beforeEach(() => {
      // Dynamically extend the mocks that the outer beforeEach doesn't include
      prisma.orderEvent.findFirst = jest.fn();
      (emailService as any).sendDisputeAlert = jest.fn().mockResolvedValue(undefined);
    });

    // ── charge.dispute.created routing ──────────────────────────────────────

    it('routes charge.dispute.created to the dispute handler', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(buildEvent('charge.dispute.created', buildDispute()));

      expect(prisma.payment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stripePaymentIntentId: 'pi_test_abc123' } }),
      );
    });

    it('returns early when dispute has no payment_intent', async () => {
      await service.handleWebhookEvent(
        buildEvent('charge.dispute.created', buildDispute({ payment_intent: null })),
      );

      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('extracts payment_intent.id when payment_intent is an object', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.created', buildDispute({ payment_intent: { id: 'pi_nested' } })),
      );

      expect(prisma.payment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stripePaymentIntentId: 'pi_nested' } }),
      );
    });

    it('returns early when no payment is found for the PaymentIntent', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(buildEvent('charge.dispute.created', buildDispute()));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips when order is already DISPUTE_HOLD (idempotency guard)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPaymentForDispute,
        order: { ...mockOrderPaid, status: OrderStatus.DISPUTE_HOLD },
      });

      await service.handleWebhookEvent(buildEvent('charge.dispute.created', buildDispute()));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('transitions order to DISPUTE_HOLD when dispute is opened', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDispute);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(buildEvent('charge.dispute.created', buildDispute()));

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('records an OrderEvent with DISPUTE_HOLD toStatus and prior status as fromStatus', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDispute);

      let capturedEvent: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn() },
          orderEvent: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedEvent = args.data;
            }),
          },
        });
      });

      await service.handleWebhookEvent(buildEvent('charge.dispute.created', buildDispute()));

      expect(capturedEvent.fromStatus).toBe(OrderStatus.PAID);
      expect(capturedEvent.toStatus).toBe(OrderStatus.DISPUTE_HOLD);
      expect(capturedEvent.actor).toBe('SYSTEM:stripe-webhook');
      expect(capturedEvent.note).toContain('dp_test_123');
      expect(capturedEvent.note).toContain('fraudulent');
    });

    it('swallows P2002 from duplicate dispute.created event delivery', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDispute);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '6.0.0',
          meta: { target: ['event_id'] },
        }),
      );

      await expect(
        service.handleWebhookEvent(buildEvent('charge.dispute.created', buildDispute())),
      ).resolves.not.toThrow();
    });

    it('re-throws non-P2002 errors from the transaction', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDispute);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Connection failed', {
          code: 'P1001',
          clientVersion: '6.0.0',
          meta: {},
        }),
      );

      await expect(
        service.handleWebhookEvent(buildEvent('charge.dispute.created', buildDispute())),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it('sends admin dispute alert email with dispute details when admin email is configured', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDispute);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.created', buildDispute({ reason: 'credit_not_processed' })),
      );

      await Promise.resolve();
      expect((emailService as any).sendDisputeAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          orderNumber: 'ORD-2026-000001',
          reason: 'credit_not_processed',
          disputeId: 'dp_test_123',
        }),
      );
    });

    it('captures a Sentry error event when a dispute is opened', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDispute);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(buildEvent('charge.dispute.created', buildDispute()));

      expect(Sentry.withScope).toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('ORD-2026-000001'),
        'error',
      );
    });

    // ── charge.dispute.closed routing ───────────────────────────────────────

    it('routes charge.dispute.closed to the dispute closed handler', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'won' })),
      );

      expect(prisma.payment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stripePaymentIntentId: 'pi_test_abc123' } }),
      );
    });

    it('skips charge.dispute.closed when no payment found', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'won' })),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips charge.dispute.closed when order is not in DISPUTE_HOLD', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPaymentForDisputeClosed,
        order: { ...mockPaymentForDisputeClosed.order, status: OrderStatus.PAID },
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'won' })),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not touch the DB for non-terminal dispute.closed statuses (e.g. warning_closed)', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDisputeClosed);

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'warning_closed' })),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // ── charge.dispute.closed — WON ─────────────────────────────────────────

    it('restores order to prior status from the DISPUTE_HOLD OrderEvent when dispute is won', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDisputeClosed);
      (prisma.orderEvent.findFirst as jest.Mock).mockResolvedValue({
        fromStatus: OrderStatus.SHIPPED,
      });

      let capturedOrderUpdate: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedOrderUpdate = args;
            }),
          },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'won' })),
      );

      expect(capturedOrderUpdate.data.status).toBe(OrderStatus.SHIPPED);
    });

    it('falls back to PAID when no DISPUTE_HOLD OrderEvent is found', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDisputeClosed);
      (prisma.orderEvent.findFirst as jest.Mock).mockResolvedValue(null);

      let capturedOrderUpdate: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedOrderUpdate = args;
            }),
          },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'won' })),
      );

      expect(capturedOrderUpdate.data.status).toBe(OrderStatus.PAID);
    });

    it('creates an OrderEvent with DISPUTE_HOLD fromStatus and prior toStatus when won', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDisputeClosed);
      (prisma.orderEvent.findFirst as jest.Mock).mockResolvedValue({ fromStatus: OrderStatus.PROCESSING });

      let capturedEvent: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn() },
          orderEvent: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedEvent = args.data;
            }),
          },
        });
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'won' })),
      );

      expect(capturedEvent.fromStatus).toBe(OrderStatus.DISPUTE_HOLD);
      expect(capturedEvent.toStatus).toBe(OrderStatus.PROCESSING);
      expect(capturedEvent.note).toContain('WON');
    });

    it('swallows P2002 on won dispute duplicate delivery', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDisputeClosed);
      (prisma.orderEvent.findFirst as jest.Mock).mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '6.0.0',
          meta: { target: ['event_id'] },
        }),
      );

      await expect(
        service.handleWebhookEvent(
          buildEvent('charge.dispute.closed', buildDispute({ status: 'won' })),
        ),
      ).resolves.not.toThrow();
    });

    // ── charge.dispute.closed — LOST ────────────────────────────────────────

    it('moves the order to DISPUTE_LOST_REVIEW when dispute is lost', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDisputeClosed);

      let capturedOrderStatus: OrderStatus | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: {
            update: jest.fn().mockImplementation((args: any) => {
              capturedOrderStatus = args.data.status;
            }),
          },
          productVariant: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'lost' })),
      );

      expect(capturedOrderStatus).toBe(OrderStatus.DISPUTE_LOST_REVIEW);
    });

    it('does not restore stock when dispute is lost — requires explicit admin confirmation first', async () => {
      // Most real chargebacks involve goods that were genuinely delivered and aren't
      // coming back. Auto-restoring stock here would oversell the SKU to a second
      // customer. Stock is only restored once an admin confirms non-delivery via the
      // standard admin status-update endpoint (DISPUTE_LOST_REVIEW → CANCELLED).
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPaymentForDisputeClosed,
        order: {
          ...mockPaymentForDisputeClosed.order,
          items: [
            { productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 0 },
            { productVariantId: 'pv-2', quantity: 1, cancelledQuantity: 0 },
          ],
        },
      });

      const productVariantUpdate = jest.fn();
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn() },
          productVariant: { update: productVariantUpdate },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'lost' })),
      );

      expect(productVariantUpdate).not.toHaveBeenCalled();
    });

    it('does not restore stock when dispute is lost even though a shipping label was generated (labelUrl set)', async () => {
      // A generated label only proves a label was created, not that the parcel was
      // delivered — irrelevant either way now, since this path never auto-restores stock.
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPaymentForDisputeClosed,
        order: {
          ...mockPaymentForDisputeClosed.order,
          shipment: { labelUrl: 'https://example.com/label.pdf' },
          items: [{ productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 0 }],
        },
      });

      const productVariantUpdate = jest.fn();
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn() },
          productVariant: { update: productVariantUpdate },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'lost' })),
      );

      expect(productVariantUpdate).not.toHaveBeenCalled();
    });

    it('captures a Sentry fatal event when dispute is lost', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDisputeClosed);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn() },
          productVariant: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.handleWebhookEvent(
        buildEvent('charge.dispute.closed', buildDispute({ status: 'lost' })),
      );

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('ORD-2026-000001'),
        'fatal',
      );
    });

    it('swallows P2002 on lost dispute duplicate delivery', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPaymentForDisputeClosed);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '6.0.0',
          meta: { target: ['event_id'] },
        }),
      );

      await expect(
        service.handleWebhookEvent(
          buildEvent('charge.dispute.closed', buildDispute({ status: 'lost' })),
        ),
      ).resolves.not.toThrow();
    });
  });

  // ─── Distributed lock guard ───────────────────────────────────────────────────

  describe('distributed lock guard', () => {
    describe('reconcilePendingPayments', () => {
      it('skips DB query when another replica already holds the lock (redis.set returns null)', async () => {
        redis.set.mockResolvedValue(null);

        await service.reconcilePendingPayments();

        expect(prisma.payment.findMany).not.toHaveBeenCalled();
      });

      it('runs the reconciliation body when the lock is acquired (redis.set returns OK)', async () => {
        redis.set.mockResolvedValue('OK');
        prisma.payment.findMany.mockResolvedValue([]);

        await service.reconcilePendingPayments();

        expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);
      });

      it('acquires the lock with NX and a 540-second TTL', async () => {
        redis.set.mockResolvedValue('OK');
        prisma.payment.findMany.mockResolvedValue([]);

        await service.reconcilePendingPayments();

        expect(redis.set).toHaveBeenCalledWith(
          'cron:reconcile-payments:lock',
          '1',
          'EX',
          540,
          'NX',
        );
      });
    });

    // ── Stripe coupon cleanup after session close ─────────────────────────────
    // Guards the fix: each discounted checkout creates a max_redemptions=1 Stripe
    // coupon that is never auto-deleted. deleteCoupon must be called after both
    // completed and expired/failed sessions so orphaned objects don't accumulate.

    describe('coupon cleanup after session close', () => {
      const sessionWithDiscount = {
        ...mockSession,
        discounts: [{ coupon: 'co_test_cleanup' }],
      };

      const setupExpiredTx = () => {
        prisma.$transaction.mockImplementation(async (fn: any) => {
          if (typeof fn === 'function') {
            await fn({
              $queryRaw: jest.fn().mockResolvedValue([{ status: PaymentStatus.PENDING }]),
              processedStripeEvent: { create: jest.fn().mockResolvedValue({}) },
              payment: { update: jest.fn() },
              order: { update: jest.fn() },
              orderEvent: { create: jest.fn() },
              productVariant: { update: jest.fn() },
            });
          }
        });
      };

      it('calls deleteCoupon with the session coupon ID after checkout.session.completed', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPayment);
        prisma.$transaction.mockResolvedValue([{}, {}]);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', sessionWithDiscount),
        );

        expect(stripeClient.deleteCoupon).toHaveBeenCalledWith('co_test_cleanup');
      });

      it('does NOT call deleteCoupon on checkout.session.completed when session has no discounts', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPayment);
        prisma.$transaction.mockResolvedValue([{}, {}]);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', mockSession),
        );

        expect(stripeClient.deleteCoupon).not.toHaveBeenCalled();
      });

      it('calls deleteCoupon with the session coupon ID after checkout.session.expired', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPayment);
        setupExpiredTx();

        await service.handleWebhookEvent(
          buildEvent('checkout.session.expired', sessionWithDiscount),
        );

        expect(stripeClient.deleteCoupon).toHaveBeenCalledWith('co_test_cleanup');
      });

      it('does NOT call deleteCoupon on checkout.session.expired when session has no discounts', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPayment);
        setupExpiredTx();

        await service.handleWebhookEvent(
          buildEvent('checkout.session.expired', mockSession),
        );

        expect(stripeClient.deleteCoupon).not.toHaveBeenCalled();
      });

      it('calls deleteCoupon after checkout.session.async_payment_failed', async () => {
        prisma.payment.findUnique.mockResolvedValue(mockPayment);
        setupExpiredTx();

        await service.handleWebhookEvent(
          buildEvent('checkout.session.async_payment_failed', sessionWithDiscount),
        );

        expect(stripeClient.deleteCoupon).toHaveBeenCalledWith('co_test_cleanup');
      });

      it('extracts the coupon ID from an expanded coupon object (not just a string)', async () => {
        const sessionWithExpandedCoupon = {
          ...mockSession,
          discounts: [{ coupon: { id: 'co_expanded_obj', object: 'coupon' } }],
        };
        prisma.payment.findUnique.mockResolvedValue(mockPayment);
        prisma.$transaction.mockResolvedValue([{}, {}]);

        await service.handleWebhookEvent(
          buildEvent('checkout.session.completed', sessionWithExpandedCoupon),
        );

        expect(stripeClient.deleteCoupon).toHaveBeenCalledWith('co_expanded_obj');
      });
    });

    describe('pruneProcessedStripeEvents', () => {
      it('skips pruning when another replica already holds the lock', async () => {
        redis.set.mockResolvedValue(null);

        await service.pruneProcessedStripeEvents();

        expect(prisma.processedStripeEvent.deleteMany).not.toHaveBeenCalled();
      });

      it('executes the prune when the lock is acquired', async () => {
        redis.set.mockResolvedValue('OK');
        prisma.processedStripeEvent.deleteMany.mockResolvedValue({ count: 3 });
        await service.pruneProcessedStripeEvents();

        expect(prisma.processedStripeEvent.deleteMany).toHaveBeenCalledTimes(1);
      });

      it('acquires the lock with a TTL under 24h so a missed run can retry within the same calendar day', async () => {
        redis.set.mockResolvedValue('OK');
        prisma.processedStripeEvent.deleteMany.mockResolvedValue({ count: 0 });

        await service.pruneProcessedStripeEvents();

        expect(redis.set).toHaveBeenCalledWith(
          'cron:prune-stripe-events:lock',
          '1',
          'EX',
          82000,
          'NX',
        );
      });
    });
  });

  // ── payout.failed webhook handler ───────────────────────────────────────
  // Guards the fix: payout.failed must fire a Sentry fatal alert and an admin
  // email. Previously the event fell through to the default ignore branch —
  // a silent payout failure meant no alert while customer refund obligations
  // (Art. 32 UoK, 14-day window) remained unaddressed.

  describe('payout.failed webhook handler', () => {
    let payoutService: PaymentsService;
    let payoutPrisma: any;
    let payoutEmail: any;
    let payoutConfigGet: jest.Mock;

    const buildPayout = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      id: 'po_test_123',
      object: 'payout',
      amount: 150000,
      currency: 'pln',
      failure_code: 'account_closed',
      failure_message: 'The bank account has been closed.',
      arrival_date: 1748995200,
      automatic: true,
      ...overrides,
    });

    beforeEach(async () => {
      payoutConfigGet = jest.fn().mockReturnValue(undefined);
      jest.clearAllMocks();

      const mod = await Test.createTestingModule({
        providers: [
          PaymentsService,
          {
            provide: PrismaService,
            useValue: {
              payment: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
              order: { findUniqueOrThrow: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
              orderEvent: { create: jest.fn() },
              orderItem: { update: jest.fn(), findMany: jest.fn() },
              productVariant: { update: jest.fn() },
              processedStripeEvent: { create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
              $transaction: jest.fn(),
            },
          },
          {
            provide: StripeClient,
            useValue: {
              createCheckoutSession: jest.fn(),
              retrieveCheckoutSession: jest.fn(),
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
              sendPayoutFailedAlert: jest.fn().mockResolvedValue(undefined),
              sendPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
              sendPaymentConfirmedWithInvoice: jest.fn().mockResolvedValue(undefined),
              sendNewOrderNotification: jest.fn().mockResolvedValue(undefined),
              sendFraudReviewAlert: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: InvoiceService,
            useValue: {
              processInvoice: jest.fn().mockResolvedValue({ url: 'https://invoice.pdf', pdf: Buffer.from(''), invoiceNumber: 'FV/2026/000001' }),
            },
          },
          {
            provide: ConfigService,
            useValue: {
              get: payoutConfigGet,
              getOrThrow: jest.fn().mockReturnValue('http://example.com'),
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
          {
            provide: ProductsService,
            useValue: { notifyStockChangesByDelta: jest.fn().mockResolvedValue(undefined) },
          },
        ],
      }).compile();

      payoutService = mod.get(PaymentsService);
      payoutPrisma = mod.get(PrismaService);
      payoutEmail = mod.get(EmailQueueService);
    });

    it('handles payout.failed without touching any payment, order, or stock DB tables', async () => {
      await payoutService.handleWebhookEvent(
        buildEvent('payout.failed', buildPayout()),
      );

      expect(payoutPrisma.payment.findUnique).not.toHaveBeenCalled();
      expect(payoutPrisma.$transaction).not.toHaveBeenCalled();
      expect(payoutPrisma.order.update).not.toHaveBeenCalled();
      expect(payoutPrisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('calls Sentry.withScope at fatal level with payout_failed tag', async () => {
      await payoutService.handleWebhookEvent(
        buildEvent('payout.failed', buildPayout()),
      );

      expect(Sentry.withScope).toHaveBeenCalled();
      const scopeCallback = (Sentry.withScope as jest.Mock).mock.calls.at(-1)[0];
      const mockScope = { setLevel: jest.fn(), setTag: jest.fn(), setContext: jest.fn() };
      scopeCallback(mockScope);
      expect(mockScope.setLevel).toHaveBeenCalledWith('fatal');
      expect(mockScope.setTag).toHaveBeenCalledWith('payment.event', 'payout_failed');
    });

    it('calls Sentry.captureMessage with the payout id at fatal level', async () => {
      await payoutService.handleWebhookEvent(
        buildEvent('payout.failed', buildPayout({ id: 'po_critical_99' })),
      );

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('po_critical_99'),
        'fatal',
      );
    });

    it('sends payout_failed_alert to ADMIN_ALERT_EMAIL when configured', async () => {
      payoutConfigGet.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });

      await payoutService.handleWebhookEvent(
        buildEvent('payout.failed', buildPayout()),
      );
      await Promise.resolve();

      expect(payoutEmail.sendPayoutFailedAlert).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin@store.com', payoutId: 'po_test_123' }),
      );
    });

    it('falls back to EMAIL_FROM when ADMIN_ALERT_EMAIL is absent', async () => {
      payoutConfigGet.mockImplementation((key: string) => {
        if (key === 'EMAIL_FROM') return 'noreply@store.com';
        return undefined;
      });

      await payoutService.handleWebhookEvent(
        buildEvent('payout.failed', buildPayout()),
      );
      await Promise.resolve();

      expect(payoutEmail.sendPayoutFailedAlert).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'noreply@store.com' }),
      );
    });

    it('sends no admin email when both ADMIN_ALERT_EMAIL and EMAIL_FROM are absent', async () => {
      // payoutConfigGet returns undefined for all keys by default

      await payoutService.handleWebhookEvent(
        buildEvent('payout.failed', buildPayout()),
      );
      await Promise.resolve();

      expect(payoutEmail.sendPayoutFailedAlert).not.toHaveBeenCalled();
    });

    it('passes failure_code and failure_message to the alert email', async () => {
      payoutConfigGet.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });

      await payoutService.handleWebhookEvent(
        buildEvent('payout.failed', buildPayout({
          failure_code: 'insufficient_funds',
          failure_message: 'Your bank account has insufficient funds.',
        })),
      );
      await Promise.resolve();

      expect(payoutEmail.sendPayoutFailedAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          failureCode: 'insufficient_funds',
          failureMessage: 'Your bank account has insufficient funds.',
        }),
      );
    });

    it('handles null failure_code and failure_message gracefully', async () => {
      payoutConfigGet.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });

      await payoutService.handleWebhookEvent(
        buildEvent('payout.failed', buildPayout({ failure_code: null, failure_message: null })),
      );
      await Promise.resolve();

      expect(payoutEmail.sendPayoutFailedAlert).toHaveBeenCalledWith(
        expect.objectContaining({ failureCode: null, failureMessage: null }),
      );
    });

    it('does not propagate an email enqueue failure to the webhook caller', async () => {
      payoutConfigGet.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });
      payoutEmail.sendPayoutFailedAlert.mockRejectedValue(new Error('Redis down'));

      await expect(
        payoutService.handleWebhookEvent(buildEvent('payout.failed', buildPayout())),
      ).resolves.not.toThrow();
    });
  });
});

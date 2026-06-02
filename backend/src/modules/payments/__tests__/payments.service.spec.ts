import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PaymentStatus, OrderStatus, Prisma } from '@prisma/client';
import { generateOrderToken } from '../../../common/utils/order-token.util';
import type { Stripe } from 'stripe/cjs/stripe.core';
import * as Sentry from '@sentry/nestjs';
import axios from 'axios';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeClient } from '../stripe.client';
import { EmailQueueService } from '../../email/email-queue.service';
import { InvoiceService } from '../../invoice/invoice.service';
import { ConfigService } from '@nestjs/config';

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
            processedStripeEvent: {
              create: jest.fn().mockResolvedValue({}),
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
      ],
    }).compile();

    service = module.get(PaymentsService);
    prisma = module.get(PrismaService);
    stripeClient = module.get(StripeClient);
    emailService = module.get(EmailQueueService);
    invoiceService = module.get(InvoiceService);
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
      prisma.$transaction.mockResolvedValue([{}, {}]);

      await service.handleWebhookEvent(
        buildEvent('checkout.session.completed', mockSession),
      );

      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { stripeCheckoutSessionId: mockSession.id },
        include: { order: { include: { items: true } } },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArgs = prisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArgs)).toBe(true);
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
      prisma.$transaction.mockResolvedValue([{}, {}]);

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
        prisma.$transaction.mockResolvedValue([{}, {}, {}]);
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
        prisma.$transaction.mockResolvedValue([{}, {}, {}]);
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
        prisma.$transaction.mockResolvedValue([{}, {}, {}]);
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
        prisma.$transaction.mockResolvedValue([{}, {}, {}]);
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
        prisma.$transaction.mockResolvedValue([{}, {}, {}]);
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
        prisma.$transaction.mockResolvedValue([{}, {}, {}]);

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
        prisma.$transaction.mockResolvedValue([{}, {}, {}]);
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
  });

  describe('getPaymentStatus', () => {
    it('returns status, paidAt, and orderNumber for an order the user owns', async () => {
      const now = new Date();

      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        order: { userId: 'user-1', orderNumber: 'ORD-2026-000001' },
      });

      const result = await service.getPaymentStatus('order-1', 'user-1');

      expect(result).toEqual({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        orderNumber: 'ORD-2026-000001',
      });
    });

    it('includes orderNumber in the Prisma select so the response is never missing it', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { userId: 'user-1', orderNumber: 'ORD-2026-000042' },
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
    // The ConfigService mock returns 'pln' for all get() calls, so JWT_ACCESS_SECRET = 'pln'
    const SECRET = 'pln';
    const ORDER_ID = 'order-1';
    const EMAIL = 'test@example.com';

    it('returns status, paidAt, and orderNumber when token is valid', async () => {
      const now = new Date();
      const validToken = generateOrderToken(ORDER_ID, EMAIL, SECRET);

      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        order: { snapshotEmail: EMAIL, orderNumber: 'ORD-2026-000001' },
      });

      const result = await service.getPaymentStatusByToken(ORDER_ID, validToken);

      expect(result).toEqual({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        orderNumber: 'ORD-2026-000001',
      });
    });

    it('includes the human-readable orderNumber so guests can use it in track-order form', async () => {
      const validToken = generateOrderToken(ORDER_ID, EMAIL, SECRET);

      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { snapshotEmail: EMAIL, orderNumber: 'ORD-2026-000042' },
      });

      const result = await service.getPaymentStatusByToken(ORDER_ID, validToken);

      expect(result.orderNumber).toBe('ORD-2026-000042');
    });

    it('throws UnauthorizedException when token is invalid', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { snapshotEmail: EMAIL, orderNumber: 'ORD-2026-000001' },
      });

      await expect(
        service.getPaymentStatusByToken(ORDER_ID, 'invalid-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token belongs to a different order (prevents enumeration)', async () => {
      const tokenForOtherOrder = generateOrderToken('other-order-id', EMAIL, SECRET);

      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { snapshotEmail: EMAIL, orderNumber: 'ORD-2026-000001' },
      });

      await expect(
        service.getPaymentStatusByToken(ORDER_ID, tokenForOtherOrder),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException when no payment exists for the order', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      const validToken = generateOrderToken(ORDER_ID, EMAIL, SECRET);

      await expect(
        service.getPaymentStatusByToken(ORDER_ID, validToken),
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
  });

  describe('partialRefund', () => {
    const completedPayment = {
      id: 'payment-1',
      status: PaymentStatus.COMPLETED,
      stripePaymentIntentId: 'pi_test_abc123',
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
              $transaction: jest.fn().mockResolvedValue([{}, {}]),
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
        ],
      }).compile();

      notifService = module.get(PaymentsService);
      notifPrisma = module.get(PrismaService);
      notifEmail = module.get(EmailQueueService);
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
      );
      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ text: expect.stringContaining('299.00') }),
      );
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
      prisma.$transaction.mockResolvedValue([{}, {}]);

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
      prisma.$transaction.mockResolvedValue([{}, {}]);

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
      prisma.$transaction.mockResolvedValue([{}, {}]);

      await service.approveFraudReview('order-1', 'ADMIN:analyst');

      expect(prisma.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actor: 'ADMIN:analyst' }),
        }),
      );
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
      prisma.$transaction.mockResolvedValue([{}, {}]);

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
      prisma.$transaction.mockResolvedValue([{}, {}]);

      await service.reconcilePendingPayments();

      expect(prisma.processedStripeEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.processedStripeEvent.create).toHaveBeenCalledWith({
        data: { eventId: `paid-${mockSession.id}` },
      });
    });

    it('inserts both paid-{session.id} and eventId when called from webhook path', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockResolvedValue([{}, {}]);

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
});

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentStatus, OrderStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeClient } from '../stripe.client';
import { EmailQueueService } from '../../email/email-queue.service';
import { InvoiceService } from '../../invoice/invoice.service';
import { ConfigService } from '@nestjs/config';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let stripeClient: jest.Mocked<StripeClient>;
  let emailService: jest.Mocked<EmailQueueService>;

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
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            order: {
              findUniqueOrThrow: jest.fn(),
              update: jest.fn(),
            },
            orderEvent: {
              create: jest.fn(),
            },
            productVariant: {
              update: jest.fn(),
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
            createRefund: jest.fn(),
          },
        },
        {
          provide: EmailQueueService,
          useValue: {
            sendPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
            sendPaymentConfirmedWithInvoice: jest.fn().mockResolvedValue(undefined),
            sendNewOrderNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            processInvoice: jest.fn().mockResolvedValue({ url: 'https://mock-invoice.pdf', pdf: Buffer.from('') }),
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
      prisma.payment.create.mockResolvedValue({} as any);

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
      prisma.payment.create.mockResolvedValue({} as any);

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
      prisma.payment.create.mockResolvedValue({} as any);

      await service.initiatePayment('order-1');

      const createCall = prisma.payment.create.mock.calls[0][0];
      expect(createCall.data.stripePaymentIntentId).toBe('pi_nested_id');
    });
  });

  describe('getPaymentStatus', () => {
    it('returns status and paidAt for an order the user owns', async () => {
      const now = new Date();
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        order: { userId: 'user-1' },
      });

      const result = await service.getPaymentStatus('order-1', 'user-1');
      expect(result).toEqual({ status: PaymentStatus.COMPLETED, paidAt: now });
    });

    it('throws ForbiddenException when user does not own the order', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        order: { userId: 'other-user' },
      });

      await expect(service.getPaymentStatus('order-1', 'user-1')).rejects.toThrow(
        'You do not have access to this order',
      );
    });

    it('throws NotFoundException when payment does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.getPaymentStatus('order-1', 'user-1')).rejects.toThrow(
        'No payment found for order order-1',
      );
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
});

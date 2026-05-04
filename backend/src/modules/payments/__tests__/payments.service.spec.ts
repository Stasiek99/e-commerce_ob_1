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
            orderItem: {
              update: jest.fn(),
              findMany: jest.fn(),
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
            createPartialRefund: jest.fn(),
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

    it('logs error (no DB change) when partial refund arrives but order is still in unexpected status (sync path failed)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...refundPayment,
        order: { ...refundPayment.order, status: OrderStatus.PAID }, // sync path never ran
      });

      await expect(
        service.handleWebhookEvent(
          buildEvent('refund.updated', buildRefund({ amount: 5000 })),
        ),
      ).resolves.not.toThrow();

      expect(prisma.$transaction).not.toHaveBeenCalled();
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

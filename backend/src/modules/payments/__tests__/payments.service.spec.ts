import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus, OrderStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeClient } from '../stripe.client';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let stripeClient: jest.Mocked<StripeClient>;
  let emailService: jest.Mocked<EmailService>;

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
              create: jest.fn(),
              update: jest.fn(),
            },
            order: {
              findUniqueOrThrow: jest.fn(),
              update: jest.fn(),
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
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
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
    emailService = module.get(EmailService);
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
      expect(emailService.sendPaymentConfirmed).toHaveBeenCalled();
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

    it('cancels order on async_payment_failed (delayed BLIK/P24 failure)', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
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
});

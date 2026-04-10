import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PaymentStatus, OrderStatus } from '@prisma/client';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Przelewy24Client } from '../przelewy24.client';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';
import { WebhookPayloadDto } from '../dto/webhook-payload.dto';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let p24: jest.Mocked<Przelewy24Client>;
  let emailService: jest.Mocked<EmailService>;

  const mockPayload: WebhookPayloadDto = {
    merchantId: 12345,
    posId: 12345,
    sessionId: 'test-session-id',
    amount: 14999,
    originAmount: 14999,
    currency: 'PLN',
    orderId: 999,
    methodId: 25,
    statement: 'test statement',
    sign: 'valid-signature',
  };

  const mockPayment = {
    id: 'payment-1',
    orderId: 'order-1',
    status: PaymentStatus.PENDING,
    p24SessionId: 'test-session-id',
    p24Token: 'tok_123',
    p24OrderId: null,
    amountInCents: 14999,
    currency: 'PLN',
    paidAt: null,
    failureReason: null,
    rawWebhookPayload: null,
    provider: 'przelewy24',
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
          provide: Przelewy24Client,
          useValue: {
            registerTransaction: jest.fn(),
            verifyTransaction: jest.fn(),
            verifyWebhookSignature: jest.fn(),
            getPaymentUrl: jest.fn(),
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
            get: jest.fn().mockReturnValue('http://localhost:4200/checkout/success'),
            getOrThrow: jest.fn().mockReturnValue('http://localhost:3000/payments/webhook'),
          },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
    prisma = module.get(PrismaService);
    p24 = module.get(Przelewy24Client);
    emailService = module.get(EmailService);
  });

  describe('handleWebhook', () => {
    it('should reject invalid webhook signatures before any DB access', async () => {
      p24.verifyWebhookSignature.mockReturnValue(false);

      await expect(service.handleWebhook(mockPayload)).rejects.toThrow(
        ForbiddenException,
      );

      // Verify NO database calls were made
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should skip processing if payment is already COMPLETED (idempotency)', async () => {
      p24.verifyWebhookSignature.mockReturnValue(true);
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      } as any);

      await service.handleWebhook(mockPayload);

      // Should NOT attempt to verify with P24 or update DB
      expect(p24.verifyTransaction).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should verify signature, look up payment, verify with P24, and complete', async () => {
      p24.verifyWebhookSignature.mockReturnValue(true);
      prisma.payment.findUnique.mockResolvedValue(mockPayment as any);
      p24.verifyTransaction.mockResolvedValue(undefined);
      prisma.$transaction.mockResolvedValue([{}, {}]);

      await service.handleWebhook(mockPayload);

      // 1. Verified signature first
      expect(p24.verifyWebhookSignature).toHaveBeenCalledWith(mockPayload);

      // 2. Looked up payment by sessionId
      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { p24SessionId: mockPayload.sessionId },
        include: { order: { include: { items: true } } },
      });

      // 3. Verified with P24
      expect(p24.verifyTransaction).toHaveBeenCalledWith({
        sessionId: mockPayload.sessionId,
        orderId: mockPayload.orderId,
        amount: mockPayload.amount,
        currency: mockPayload.currency,
      });

      // 4. Updated payment + order in a transaction (batch mode with array)
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArgs = prisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArgs)).toBe(true);

      // 5. Sent email
      expect(emailService.sendPaymentConfirmed).toHaveBeenCalled();
    });

    it('should silently return if no payment found for sessionId', async () => {
      p24.verifyWebhookSignature.mockReturnValue(true);
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handleWebhook(mockPayload);

      expect(p24.verifyTransaction).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should handle payment failure when P24 verification fails', async () => {
      p24.verifyWebhookSignature.mockReturnValue(true);
      prisma.payment.findUnique.mockResolvedValue(mockPayment as any);
      p24.verifyTransaction.mockRejectedValue(new Error('P24 verification failed'));

      // Mock the transaction used in handlePaymentFailure
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
            productVariant: { update: jest.fn() },
          });
        }
      });

      await service.handleWebhook(mockPayload);

      // Should have attempted payment failure handling
      expect(prisma.$transaction).toHaveBeenCalled();
      // Should NOT have sent success email
      expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
    });
  });
});

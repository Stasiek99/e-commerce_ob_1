import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { OutboxProcessorService } from '../outbox-processor.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { InvoiceService } from '../../invoice/invoice.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  withScope: jest.fn().mockImplementation((callback: (scope: any) => void) => {
    callback({ setTag: jest.fn() });
  }),
}));

describe('OutboxProcessorService', () => {
  let service: OutboxProcessorService;
  let prisma: any;
  let emailQueueService: jest.Mocked<EmailQueueService>;
  let invoiceService: jest.Mocked<InvoiceService>;
  let redis: any;

  const baseOrder = {
    id: 'order-1',
    orderNumber: 'ORD-1',
    snapshotEmail: 'customer@example.com',
    snapshotFirstName: 'Jan',
    totalInCents: 5000,
    shippingCostInCents: 1000,
    carrierCode: 'INPOST',
    items: [{ snapshotName: 'Perfume', quantity: 1, snapshotPrice: 5000 }],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxProcessorService,
        {
          provide: PrismaService,
          useValue: {
            outboxMessage: {
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn(),
            },
            order: {
              findUniqueOrThrow: jest.fn(),
            },
          },
        },
        {
          provide: EmailQueueService,
          useValue: {
            sendNewOrderNotification: jest.fn().mockResolvedValue(undefined),
            sendPaymentConfirmedWithInvoice: jest.fn().mockResolvedValue(undefined),
            sendPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            processInvoice: jest.fn().mockResolvedValue({ storagePath: 'invoices/1.pdf' }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn().mockResolvedValue('OK') },
        },
      ],
    }).compile();

    service = module.get(OutboxProcessorService);
    prisma = module.get(PrismaService);
    emailQueueService = module.get(EmailQueueService);
    invoiceService = module.get(InvoiceService);
    redis = module.get('REDIS_CLIENT');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Distributed lock guard ────────────────────────────────────────────────

  describe('distributed lock guard', () => {
    it('skips message lookup when another replica already holds the lock', async () => {
      redis.set.mockResolvedValue(null);

      await service.recoverPendingMessages();

      expect(prisma.outboxMessage.findMany).not.toHaveBeenCalled();
    });

    it('proceeds to look up messages when the lock is acquired', async () => {
      redis.set.mockResolvedValue('OK');

      await service.recoverPendingMessages();

      expect(prisma.outboxMessage.findMany).toHaveBeenCalledTimes(1);
    });

    it('acquires the lock with key cron:outbox-recovery:lock, a 25s TTL, and NX', async () => {
      redis.set.mockResolvedValue('OK');

      await service.recoverPendingMessages();

      expect(redis.set).toHaveBeenCalledWith('cron:outbox-recovery:lock', '1', 'EX', 25, 'NX');
    });
  });

  // ─── recoverPendingMessages ─────────────────────────────────────────────────

  describe('recoverPendingMessages', () => {
    beforeEach(() => {
      redis.set.mockResolvedValue('OK');
    });

    it('does nothing when there are no pending messages', async () => {
      prisma.outboxMessage.findMany.mockResolvedValue([]);

      await service.recoverPendingMessages();

      expect(prisma.order.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('only queries PENDING messages older than the recovery delay with retries below the max', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-06-01T12:00:00Z'));
      prisma.outboxMessage.findMany.mockResolvedValue([]);

      await service.recoverPendingMessages();

      expect(prisma.outboxMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'PENDING',
            createdAt: { lte: new Date('2025-06-01T11:59:30Z') },
            retries: { lt: 3 },
          },
        }),
      );

      jest.useRealTimers();
    });

    it('marks a message FAILED without touching the order when orderId is missing', async () => {
      prisma.outboxMessage.findMany.mockResolvedValue([
        { id: 'msg-1', orderId: null, retries: 0, type: 'POST_PAYMENT_NOTIFICATIONS' },
      ]);

      await service.recoverPendingMessages();

      expect(prisma.order.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: { status: 'FAILED', lastError: 'Missing orderId in outbox message' },
      });
    });

    it('processes a POST_PAYMENT_NOTIFICATIONS message and marks it PROCESSED on success', async () => {
      prisma.outboxMessage.findMany.mockResolvedValue([
        { id: 'msg-1', orderId: 'order-1', retries: 0, type: 'POST_PAYMENT_NOTIFICATIONS' },
      ]);
      prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder);

      await service.recoverPendingMessages();

      expect(invoiceService.processInvoice).toHaveBeenCalledWith(baseOrder);
      expect(emailQueueService.sendPaymentConfirmedWithInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'customer@example.com', orderNumber: 'ORD-1' }),
      );
      expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: { status: 'PROCESSED', processedAt: expect.any(Date) },
      });
    });

    it('ignores outbox message types other than POST_PAYMENT_NOTIFICATIONS', async () => {
      prisma.outboxMessage.findMany.mockResolvedValue([
        { id: 'msg-1', orderId: 'order-1', retries: 0, type: 'SOME_OTHER_TYPE' },
      ]);

      await service.recoverPendingMessages();

      expect(prisma.order.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.outboxMessage.update).not.toHaveBeenCalled();
    });

    it('falls back to a plain confirmation email when invoice generation fails', async () => {
      prisma.outboxMessage.findMany.mockResolvedValue([
        { id: 'msg-1', orderId: 'order-1', retries: 0, type: 'POST_PAYMENT_NOTIFICATIONS' },
      ]);
      prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder);
      invoiceService.processInvoice.mockRejectedValue(new Error('storage unreachable'));

      await service.recoverPendingMessages();

      expect(emailQueueService.sendPaymentConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'customer@example.com', orderNumber: 'ORD-1' }),
      );
      expect(emailQueueService.sendPaymentConfirmedWithInvoice).not.toHaveBeenCalled();
      expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: { status: 'PROCESSED', processedAt: expect.any(Date) },
      });
    });

    it('increments retries and captures a Sentry exception when processing throws', async () => {
      prisma.outboxMessage.findMany.mockResolvedValue([
        { id: 'msg-1', orderId: 'order-1', retries: 0, type: 'POST_PAYMENT_NOTIFICATIONS' },
      ]);
      prisma.order.findUniqueOrThrow.mockRejectedValue(new Error('order vanished'));

      await service.recoverPendingMessages();

      expect(Sentry.captureException).toHaveBeenCalled();
      expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: { retries: { increment: 1 }, lastError: 'order vanished' },
      });
    });

    it('marks a message FAILED once retries reach the max', async () => {
      prisma.outboxMessage.findMany.mockResolvedValue([
        { id: 'msg-1', orderId: 'order-1', retries: 2, type: 'POST_PAYMENT_NOTIFICATIONS' },
      ]);
      prisma.order.findUniqueOrThrow.mockRejectedValue(new Error('order vanished'));

      await service.recoverPendingMessages();

      expect(prisma.outboxMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: { retries: { increment: 1 }, lastError: 'order vanished', status: 'FAILED' },
      });
    });
  });
});

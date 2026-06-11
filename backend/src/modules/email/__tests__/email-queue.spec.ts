import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { EmailQueueService } from '../email-queue.service';
import { EmailQueueProcessor } from '../email-queue.processor';
import { EmailService } from '../email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeJob<T>(data: T): Job<T> {
  return { id: 'job-1', data } as unknown as Job<T>;
}

// ─── EmailQueueService ────────────────────────────────────────────────────────

describe('EmailQueueService', () => {
  let service: EmailQueueService;
  let queueAdd: jest.Mock;
  let mockPrisma: { user: { findFirst: jest.Mock } };

  beforeEach(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
    // Default: user not found → no suppression → all existing tests unaffected
    mockPrisma = { user: { findFirst: jest.fn().mockResolvedValue(null) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailQueueService,
        {
          provide: getQueueToken('email'),
          useValue: { add: queueAdd },
        },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(EmailQueueService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── persistence config ──────────────────────────────────────────────────────
  // These tests verify the "outbox" guarantees: jobs must survive server restarts
  // because they are durably stored in Redis with retries before EmailService is called.

  describe('job options (outbox persistence guarantees)', () => {
    it('enqueues with 12 retry attempts to survive multi-hour outages', async () => {
      await service.sendEmailVerification({ to: 'a@b.com', firstName: 'Ana', verifyUrl: 'https://x' });

      expect(queueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ attempts: 12 }),
      );
    });

    it('enqueues with exponential backoff at 5 s base delay', async () => {
      await service.sendEmailVerification({ to: 'a@b.com', firstName: 'Ana', verifyUrl: 'https://x' });

      expect(queueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          backoff: { type: 'exponential', delay: 5_000 },
        }),
      );
    });

    it('keeps completed jobs for 24 h (86 400 s) for audit', async () => {
      await service.sendPasswordReset({ to: 'a@b.com', firstName: 'Ana', resetUrl: 'https://x' });

      expect(queueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ removeOnComplete: { age: 86_400 } }),
      );
    });

    it('never auto-deletes failed jobs (removeOnFail: false) so DLQ can capture them', async () => {
      await service.sendPasswordReset({ to: 'a@b.com', firstName: 'Ana', resetUrl: 'https://x' });

      expect(queueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ removeOnFail: false }),
      );
    });

    it('re-throws when Redis enqueue fails (caller must handle)', async () => {
      queueAdd.mockRejectedValue(new Error('Redis connection lost'));

      await expect(
        service.sendEmailVerification({ to: 'a@b.com', firstName: 'Ana', verifyUrl: 'https://x' }),
      ).rejects.toThrow('Redis connection lost');
    });
  });

  // ── transactional / critical-path emails ────────────────────────────────────

  describe('sendEmailVerification', () => {
    it('enqueues job with correct type and payload', async () => {
      const data = { to: 'user@test.com', firstName: 'Jan', verifyUrl: 'https://verify/tok' };

      await service.sendEmailVerification(data);

      expect(queueAdd).toHaveBeenCalledWith(
        'email_verification',
        { type: 'email_verification', payload: data },
        expect.any(Object),
      );
    });
  });

  describe('sendPasswordReset', () => {
    it('enqueues job with correct type and payload', async () => {
      const data = { to: 'user@test.com', firstName: 'Jan', resetUrl: 'https://reset/tok' };

      await service.sendPasswordReset(data);

      expect(queueAdd).toHaveBeenCalledWith(
        'password_reset',
        { type: 'password_reset', payload: data },
        expect.any(Object),
      );
    });
  });

  describe('sendEmailChangeVerification', () => {
    it('enqueues job with correct type and payload', async () => {
      const data = {
        to: 'old@test.com',
        firstName: 'Jan',
        newEmail: 'new@test.com',
        verifyUrl: 'https://verify/tok',
      };

      await service.sendEmailChangeVerification(data);

      expect(queueAdd).toHaveBeenCalledWith(
        'email_change',
        { type: 'email_change', payload: data },
        expect.any(Object),
      );
    });
  });

  describe('sendMagicLink', () => {
    it('enqueues job with type magic_link_login and correct payload', async () => {
      const data = { to: 'user@test.com', firstName: 'Jan', magicUrl: 'https://store.pl/auth/magic-login?token=abc' };

      await service.sendMagicLink(data);

      expect(queueAdd).toHaveBeenCalledWith(
        'magic_link_login',
        { type: 'magic_link_login', payload: data },
        expect.any(Object),
      );
    });

    it('enqueues with the same persistence guarantees as other critical-path emails', async () => {
      await service.sendMagicLink({ to: 'u@t.com', firstName: 'Jan', magicUrl: 'https://x' });

      expect(queueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ attempts: 12, backoff: { type: 'exponential', delay: 5_000 } }),
      );
    });
  });

  // ── order-lifecycle emails ───────────────────────────────────────────────────

  describe('sendOrderConfirmation', () => {
    it('enqueues job with correct type and payload', async () => {
      const data = {
        to: 'user@test.com',
        orderNumber: 'ORD-2026-000001',
        firstName: 'Jan',
        items: [{ name: 'Rose Perfume', quantity: 1, price: 14999 }],
        totalInCents: 14999,
      };

      await service.sendOrderConfirmation(data);

      expect(queueAdd).toHaveBeenCalledWith(
        'order_confirmation',
        { type: 'order_confirmation', payload: data },
        expect.any(Object),
      );
    });
  });

  describe('sendPaymentConfirmed', () => {
    it('enqueues job with correct type and payload', async () => {
      const data = {
        to: 'user@test.com',
        orderNumber: 'ORD-2026-000001',
        firstName: 'Jan',
        totalInCents: 14999,
      };

      await service.sendPaymentConfirmed(data);

      expect(queueAdd).toHaveBeenCalledWith(
        'payment_confirmed',
        { type: 'payment_confirmed', payload: data },
        expect.any(Object),
      );
    });
  });

  describe('sendPaymentConfirmedWithInvoice', () => {
    it('enqueues job with only invoiceStoragePath — no base64 blob in Redis payload', async () => {
      const data = {
        to: 'user@test.com',
        orderNumber: 'ORD-2026-000001',
        firstName: 'Jan',
        items: [{ name: 'Rose Perfume', quantity: 1, price: 14999 }],
        shippingCostInCents: 1500,
        totalInCents: 16499,
        invoiceStoragePath: 'invoices/FV-2026-000001.pdf',
      };

      await service.sendPaymentConfirmedWithInvoice(data);

      const [jobName, jobData] = queueAdd.mock.calls[0];
      expect(jobName).toBe('payment_confirmed_with_invoice');
      expect(jobData.payload.invoiceStoragePath).toBe(data.invoiceStoragePath);
      // PDF is fetched at processing time — no binary or pre-signed URL in Redis
      expect(jobData.payload).not.toHaveProperty('invoicePdfBase64');
      expect(jobData.payload).not.toHaveProperty('invoicePdf');
      expect(jobData.payload).not.toHaveProperty('invoiceUrl');
    });

    it('preserves all scalar fields in the enqueued payload', async () => {
      const data = {
        to: 'user@test.com',
        orderNumber: 'ORD-2026-000001',
        firstName: 'Jan',
        items: [{ name: 'Item', quantity: 2, price: 5000 }],
        shippingCostInCents: 900,
        totalInCents: 10900,
        invoiceStoragePath: 'invoices/FV-2026-000001.pdf',
      };

      await service.sendPaymentConfirmedWithInvoice(data);

      const payload = queueAdd.mock.calls[0][1].payload;
      expect(payload.to).toBe('user@test.com');
      expect(payload.orderNumber).toBe('ORD-2026-000001');
      expect(payload.invoiceStoragePath).toBe('invoices/FV-2026-000001.pdf');
      expect(payload.totalInCents).toBe(10900);
    });
  });

  describe('sendOrderCancellation', () => {
    it('enqueues job with correct type', async () => {
      await service.sendOrderCancellation({
        to: 'u@t.com',
        orderNumber: 'ORD-1',
        firstName: 'Jan',
        totalInCents: 5000,
        isRefund: true,
      });

      expect(queueAdd).toHaveBeenCalledWith('order_cancellation', expect.any(Object), expect.any(Object));
    });
  });

  describe('sendShippingNotification', () => {
    it('enqueues job with optional trackingUrl included when provided', async () => {
      await service.sendShippingNotification({
        to: 'u@t.com',
        orderNumber: 'ORD-1',
        firstName: 'Jan',
        carrier: 'InPost',
        trackingNumber: 'INP123',
        trackingUrl: 'https://inpost.pl/track/INP123',
      });

      const payload = queueAdd.mock.calls[0][1].payload;
      expect(payload.trackingUrl).toBe('https://inpost.pl/track/INP123');
    });

    it('enqueues job without trackingUrl when not provided', async () => {
      await service.sendShippingNotification({
        to: 'u@t.com',
        orderNumber: 'ORD-1',
        firstName: 'Jan',
        carrier: 'InPost',
        trackingNumber: 'INP123',
      });

      const payload = queueAdd.mock.calls[0][1].payload;
      expect(payload.trackingUrl).toBeUndefined();
    });
  });

  describe('sendNewOrderNotification', () => {
    it('enqueues admin-facing notification with correct job type', async () => {
      await service.sendNewOrderNotification({
        to: 'admin@store.com',
        orderNumber: 'ORD-1',
        customerEmail: 'cust@test.com',
        totalInCents: 9999,
        items: [],
        carrierCode: 'INPOST',
      });

      expect(queueAdd).toHaveBeenCalledWith(
        'new_order_notification',
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('sendReturnConfirmation', () => {
    it('enqueues return_confirmation with WITHDRAWAL type', async () => {
      await service.sendReturnConfirmation({
        to: 'u@t.com',
        firstName: 'Jan',
        orderNumber: 'ORD-1',
        requestId: 'ret-1',
        type: 'WITHDRAWAL',
        items: [{ productName: 'Rose Perfume', quantity: 1 }],
      });

      const jobData = queueAdd.mock.calls[0][1];
      expect(jobData.type).toBe('return_confirmation');
      expect(jobData.payload.type).toBe('WITHDRAWAL');
    });

    it('enqueues return_confirmation with COMPLAINT type', async () => {
      await service.sendReturnConfirmation({
        to: 'u@t.com',
        firstName: 'Jan',
        orderNumber: 'ORD-1',
        requestId: 'ret-2',
        type: 'COMPLAINT',
        items: [],
      });

      expect(queueAdd.mock.calls[0][1].payload.type).toBe('COMPLAINT');
    });
  });

  // ── deterministic jobId (deduplication) ─────────────────────────────────────
  // Invariant: webhook + reconciliation cron both call sendPaymentConfirmedWithInvoice
  // for the same order. Without a deterministic jobId, BullMQ treats them as two
  // distinct jobs and sends two emails. The fix keys the job by name + orderNumber
  // so the second add is a no-op while the first is active/completed.

  describe('deterministic jobId (deduplication)', () => {
    it('sets jobId = payment_confirmed_with_invoice-{orderNumber} to block duplicate sends', async () => {
      await service.sendPaymentConfirmedWithInvoice({
        to: 'u@t.com',
        orderNumber: 'ORD-2026-000042',
        firstName: 'Jan',
        items: [],
        shippingCostInCents: 900,
        totalInCents: 10000,
        invoiceStoragePath: 'invoices/FV-2026-000042.pdf',
      });

      const [, , opts] = queueAdd.mock.calls[0];
      expect(opts.jobId).toBe('payment_confirmed_with_invoice-ORD-2026-000042');
    });

    it('sets jobId = order_confirmation-{orderNumber} for order_confirmation', async () => {
      await service.sendOrderConfirmation({
        to: 'u@t.com',
        orderNumber: 'ORD-2026-000001',
        firstName: 'Jan',
        items: [],
        totalInCents: 9999,
      });

      const [, , opts] = queueAdd.mock.calls[0];
      expect(opts.jobId).toBe('order_confirmation-ORD-2026-000001');
    });

    it('sets jobId = payment_confirmed-{orderNumber} for payment_confirmed', async () => {
      await service.sendPaymentConfirmed({
        to: 'u@t.com',
        orderNumber: 'ORD-2026-000007',
        firstName: 'Jan',
        totalInCents: 5000,
      });

      const [, , opts] = queueAdd.mock.calls[0];
      expect(opts.jobId).toBe('payment_confirmed-ORD-2026-000007');
    });

    it('sets jobId = return_confirmation-{requestId} (uses requestId over orderNumber for returns)', async () => {
      await service.sendReturnConfirmation({
        to: 'u@t.com',
        firstName: 'Jan',
        orderNumber: 'ORD-1',
        requestId: 'ret-abc-999',
        type: 'WITHDRAWAL',
        items: [],
      });

      const [, , opts] = queueAdd.mock.calls[0];
      expect(opts.jobId).toBe('return_confirmation-ret-abc-999');
    });

    it('sets jobId = return_status_update-{requestId}-{newStatus} so each status transition is distinct', async () => {
      await service.sendReturnStatusUpdate({
        to: 'u@t.com',
        firstName: 'Jan',
        orderNumber: 'ORD-1',
        requestId: 'ret-xyz',
        type: 'COMPLAINT',
        newStatus: 'APPROVED',
      });

      const [, , opts] = queueAdd.mock.calls[0];
      expect(opts.jobId).toBe('return_status_update-ret-xyz-APPROVED');
    });

    it('two different return status transitions produce different jobIds', async () => {
      await service.sendReturnStatusUpdate({
        to: 'u@t.com',
        firstName: 'Jan',
        orderNumber: 'ORD-1',
        requestId: 'ret-xyz',
        type: 'COMPLAINT',
        newStatus: 'APPROVED',
      });

      await service.sendReturnStatusUpdate({
        to: 'u@t.com',
        firstName: 'Jan',
        orderNumber: 'ORD-1',
        requestId: 'ret-xyz',
        type: 'COMPLAINT',
        newStatus: 'COMPLETED',
      });

      const firstJobId = queueAdd.mock.calls[0][2].jobId;
      const secondJobId = queueAdd.mock.calls[1][2].jobId;
      expect(firstJobId).not.toBe(secondJobId);
    });

    it('does NOT set jobId for email_verification (user-level, no dedup risk)', async () => {
      await service.sendEmailVerification({ to: 'u@t.com', firstName: 'Jan', verifyUrl: 'https://x' });

      const [, , opts] = queueAdd.mock.calls[0];
      expect(opts.jobId).toBeUndefined();
    });

    it('does NOT set jobId for password_reset (user may legitimately resend)', async () => {
      await service.sendPasswordReset({ to: 'u@t.com', firstName: 'Jan', resetUrl: 'https://x' });

      const [, , opts] = queueAdd.mock.calls[0];
      expect(opts.jobId).toBeUndefined();
    });

    it('two calls for same order + same event type produce identical jobIds', async () => {
      const payload = {
        to: 'u@t.com',
        orderNumber: 'ORD-SAME',
        firstName: 'Jan',
        totalInCents: 5000,
        isRefund: false,
      };

      await service.sendOrderCancellation(payload);
      await service.sendOrderCancellation(payload);

      const firstJobId = queueAdd.mock.calls[0][2].jobId;
      const secondJobId = queueAdd.mock.calls[1][2].jobId;
      expect(firstJobId).toBe(secondJobId);
      expect(firstJobId).toBe('order_cancellation-ORD-SAME');
    });
  });

  // ── bounce suppression gate ───────────────────────────────────────────────────
  // Invariant: enqueue() must not add a job to the BullMQ queue when the
  // recipient has a hard bounce on record (emailBounced=true). Sending to a
  // bounced address again generates another bounce event that counts against the
  // sender domain's ISP reputation. Above ~2-5% bounce rate, ISPs throttle or
  // blacklist the domain, silently killing all transactional email delivery.

  describe('bounce suppression gate', () => {
    it('suppresses enqueue and does not call queue.add when recipient has emailBounced=true', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ emailBounced: true });

      await service.sendOrderConfirmation({
        to: 'bounced@example.com',
        orderNumber: 'ORD-1',
        firstName: 'Jan',
        items: [],
        totalInCents: 9999,
      });

      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('enqueues normally when recipient has emailBounced=false', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ emailBounced: false });

      await service.sendOrderConfirmation({
        to: 'ok@example.com',
        orderNumber: 'ORD-2',
        firstName: 'Jan',
        items: [],
        totalInCents: 9999,
      });

      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('enqueues normally when recipient is not a registered user (user not found in DB)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await service.sendOrderConfirmation({
        to: 'guest@example.com',
        orderNumber: 'ORD-3',
        firstName: 'Jan',
        items: [],
        totalInCents: 9999,
      });

      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('suppression applies to all job types — verified with sendPaymentConfirmed', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ emailBounced: true });

      await service.sendPaymentConfirmed({
        to: 'bounced@example.com',
        orderNumber: 'ORD-4',
        firstName: 'Jan',
        totalInCents: 5000,
      });

      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('queries the DB with the exact recipient email address', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const to = 'specific@example.com';

      await service.sendEmailVerification({ to, firstName: 'Jan', verifyUrl: 'https://x' });

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: to } }),
      );
    });

    it('selects emailBounced and emailComplained fields — avoids pulling full user row', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await service.sendEmailVerification({ to: 'u@t.com', firstName: 'Jan', verifyUrl: 'https://x' });

      const [callArg] = mockPrisma.user.findFirst.mock.calls[0];
      expect(callArg.select).toEqual({ emailBounced: true, emailComplained: true });
    });
  });

  // ── complaint suppression gate ────────────────────────────────────────────────
  // Invariant: enqueue() must not add a job when the recipient has filed a spam
  // complaint (emailComplained=true). Resend terminates accounts at ≥0.08%
  // complaint rate — a single repeat complainer receiving 4 transactional emails
  // per order can push a low-volume account over the threshold.

  describe('complaint suppression gate', () => {
    it('suppresses enqueue and does not call queue.add when recipient has emailComplained=true', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ emailBounced: false, emailComplained: true });

      await service.sendOrderConfirmation({
        to: 'complainer@example.com',
        orderNumber: 'ORD-C1',
        firstName: 'Jan',
        items: [],
        totalInCents: 9999,
      });

      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('enqueues normally when recipient has emailComplained=false', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ emailBounced: false, emailComplained: false });

      await service.sendOrderConfirmation({
        to: 'ok@example.com',
        orderNumber: 'ORD-C2',
        firstName: 'Jan',
        items: [],
        totalInCents: 9999,
      });

      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('complaint suppression applies to all job types — verified with sendShippingNotification', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ emailBounced: false, emailComplained: true });

      await service.sendShippingNotification({
        to: 'complainer@example.com',
        orderNumber: 'ORD-C3',
        firstName: 'Jan',
        carrier: 'InPost',
        trackingNumber: 'TRACK123',
      });

      expect(queueAdd).not.toHaveBeenCalled();
    });
  });
});

// ─── EmailQueueProcessor ──────────────────────────────────────────────────────

describe('EmailQueueProcessor', () => {
  let processor: EmailQueueProcessor;
  let emailService: jest.Mocked<EmailService>;
  let storageService: jest.Mocked<StorageService>;
  let dlqAdd: jest.Mock;

  beforeEach(async () => {
    dlqAdd = jest.fn().mockResolvedValue({ id: 'dlq-job-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailQueueProcessor,
        {
          provide: getQueueToken('email-dlq'),
          useValue: { add: dlqAdd },
        },
        {
          provide: EmailService,
          useValue: {
            sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
            sendPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
            sendPaymentConfirmedWithInvoice: jest.fn().mockResolvedValue(undefined),
            sendOrderCancellation: jest.fn().mockResolvedValue(undefined),
            sendShippingNotification: jest.fn().mockResolvedValue(undefined),
            sendEmailVerification: jest.fn().mockResolvedValue(undefined),
            sendEmailChangeVerification: jest.fn().mockResolvedValue(undefined),
            sendPasswordReset: jest.fn().mockResolvedValue(undefined),
            sendNewOrderNotification: jest.fn().mockResolvedValue(undefined),
            sendLowStockAlert: jest.fn().mockResolvedValue(undefined),
            sendBackInStock: jest.fn().mockResolvedValue(undefined),
            sendReviewRequest: jest.fn().mockResolvedValue(undefined),
            sendReturnConfirmation: jest.fn().mockResolvedValue(undefined),
            sendReturnAdminNotification: jest.fn().mockResolvedValue(undefined),
            sendReturnStatusUpdate: jest.fn().mockResolvedValue(undefined),
            sendMagicLink: jest.fn().mockResolvedValue(undefined),
            sendFraudReviewAlert: jest.fn().mockResolvedValue(undefined),
            sendDisputeAlert: jest.fn().mockResolvedValue(undefined),
            sendPayoutFailedAlert: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StorageService,
          useValue: {
            getInvoiceSignedUrl: jest.fn().mockResolvedValue('https://storage/signed-inv.pdf'),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            wishlistItem: { update: jest.fn().mockResolvedValue({}) },
          },
        },
      ],
    }).compile();

    processor = module.get(EmailQueueProcessor);
    emailService = module.get(EmailService);
    storageService = module.get(StorageService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── job routing ──────────────────────────────────────────────────────────────

  it('routes order_confirmation to emailService.sendOrderConfirmation', async () => {
    const payload = {
      to: 'u@t.com',
      orderNumber: 'ORD-1',
      firstName: 'Jan',
      items: [],
      totalInCents: 5000,
    };

    await processor.process(makeJob({ type: 'order_confirmation' as const, payload }));

    expect(emailService.sendOrderConfirmation).toHaveBeenCalledWith(payload);
  });

  it('routes payment_confirmed to emailService.sendPaymentConfirmed', async () => {
    const payload = { to: 'u@t.com', orderNumber: 'ORD-1', firstName: 'Jan', totalInCents: 5000 };

    await processor.process(makeJob({ type: 'payment_confirmed' as const, payload }));

    expect(emailService.sendPaymentConfirmed).toHaveBeenCalledWith(payload);
  });

  it('routes order_cancellation to emailService.sendOrderCancellation', async () => {
    const payload = {
      to: 'u@t.com',
      orderNumber: 'ORD-1',
      firstName: 'Jan',
      totalInCents: 5000,
      isRefund: false,
    };

    await processor.process(makeJob({ type: 'order_cancellation' as const, payload }));

    expect(emailService.sendOrderCancellation).toHaveBeenCalledWith(payload);
  });

  it('routes shipping_notification to emailService.sendShippingNotification', async () => {
    const payload = {
      to: 'u@t.com',
      orderNumber: 'ORD-1',
      firstName: 'Jan',
      carrier: 'InPost',
      trackingNumber: 'INP123',
    };

    await processor.process(makeJob({ type: 'shipping_notification' as const, payload }));

    expect(emailService.sendShippingNotification).toHaveBeenCalledWith(payload);
  });

  it('routes email_verification to emailService.sendEmailVerification', async () => {
    const payload = { to: 'u@t.com', firstName: 'Jan', verifyUrl: 'https://x' };

    await processor.process(makeJob({ type: 'email_verification' as const, payload }));

    expect(emailService.sendEmailVerification).toHaveBeenCalledWith(payload);
  });

  it('routes email_change to emailService.sendEmailChangeVerification', async () => {
    const payload = {
      to: 'old@t.com',
      firstName: 'Jan',
      newEmail: 'new@t.com',
      verifyUrl: 'https://x',
    };

    await processor.process(makeJob({ type: 'email_change' as const, payload }));

    expect(emailService.sendEmailChangeVerification).toHaveBeenCalledWith(payload);
  });

  it('routes password_reset to emailService.sendPasswordReset', async () => {
    const payload = { to: 'u@t.com', firstName: 'Jan', resetUrl: 'https://x' };

    await processor.process(makeJob({ type: 'password_reset' as const, payload }));

    expect(emailService.sendPasswordReset).toHaveBeenCalledWith(payload);
  });

  it('routes new_order_notification to emailService.sendNewOrderNotification', async () => {
    const payload = {
      to: 'admin@store.com',
      orderNumber: 'ORD-1',
      customerEmail: 'c@t.com',
      totalInCents: 9999,
      items: [],
      carrierCode: 'INPOST',
    };

    await processor.process(makeJob({ type: 'new_order_notification' as const, payload }));

    expect(emailService.sendNewOrderNotification).toHaveBeenCalledWith(payload);
  });

  it('routes low_stock_alert to emailService.sendLowStockAlert', async () => {
    const payload = {
      to: 'admin@store.com',
      orderNumber: 'ORD-1',
      items: [{ sku: 'SKU-1', name: 'Item', stock: 2, isOutOfStock: false }],
    };

    await processor.process(makeJob({ type: 'low_stock_alert' as const, payload }));

    expect(emailService.sendLowStockAlert).toHaveBeenCalledWith(payload);
  });

  it('routes back_in_stock to emailService.sendBackInStock (strips wishlistItemId from payload)', async () => {
    const payload = {
      to: 'u@t.com',
      firstName: 'Jan',
      productName: 'Rose Perfume',
      variantLabel: '50 ml',
      productUrl: 'https://store.pl/rose',
      wishlistItemId: 'wl-test-1',
    };

    await processor.process(makeJob({ type: 'back_in_stock' as const, payload }));

    const { wishlistItemId: _stripped, ...emailPayload } = payload;
    expect(emailService.sendBackInStock).toHaveBeenCalledWith(emailPayload);
  });

  it('routes review_request to emailService.sendReviewRequest', async () => {
    const payload = {
      to: 'u@t.com',
      firstName: 'Jan',
      orderNumber: 'ORD-1',
      products: [{ name: 'Rose', reviewUrl: 'https://x' }],
    };

    await processor.process(makeJob({ type: 'review_request' as const, payload }));

    expect(emailService.sendReviewRequest).toHaveBeenCalledWith(payload);
  });

  it('routes return_confirmation to emailService.sendReturnConfirmation', async () => {
    const payload = {
      to: 'u@t.com',
      firstName: 'Jan',
      orderNumber: 'ORD-1',
      requestId: 'ret-1',
      type: 'WITHDRAWAL' as const,
      items: [],
    };

    await processor.process(makeJob({ type: 'return_confirmation' as const, payload }));

    expect(emailService.sendReturnConfirmation).toHaveBeenCalledWith(payload);
  });

  it('routes return_admin_notification to emailService.sendReturnAdminNotification', async () => {
    const payload = {
      to: 'admin@store.com',
      requestId: 'ret-1',
      orderNumber: 'ORD-1',
      customerName: 'Jan Kowalski',
      email: 'jan@t.com',
      type: 'COMPLAINT' as const,
      items: [],
    };

    await processor.process(makeJob({ type: 'return_admin_notification' as const, payload }));

    expect(emailService.sendReturnAdminNotification).toHaveBeenCalledWith(payload);
  });

  it('routes magic_link_login to emailService.sendMagicLink', async () => {
    const payload = {
      to: 'user@test.com',
      firstName: 'Jan',
      magicUrl: 'https://store.pl/auth/magic-login?token=abc123',
    };

    await processor.process(makeJob({ type: 'magic_link_login' as const, payload }));

    expect(emailService.sendMagicLink).toHaveBeenCalledWith(payload);
  });

  it('routes return_status_update to emailService.sendReturnStatusUpdate', async () => {
    const payload = {
      to: 'u@t.com',
      firstName: 'Jan',
      orderNumber: 'ORD-1',
      requestId: 'ret-1',
      type: 'WITHDRAWAL' as const,
      newStatus: 'APPROVED' as const,
    };

    await processor.process(makeJob({ type: 'return_status_update' as const, payload }));

    expect(emailService.sendReturnStatusUpdate).toHaveBeenCalledWith(payload);
  });

  it('routes fraud_review_alert to emailService.sendFraudReviewAlert', async () => {
    const payload = {
      to: 'admin@store.com',
      orderNumber: 'ORD-1',
      customerEmail: 'c@t.com',
      totalInCents: 29900,
      radarRiskLevel: 'elevated',
    };

    await processor.process(makeJob({ type: 'fraud_review_alert' as const, payload }));

    expect(emailService.sendFraudReviewAlert).toHaveBeenCalledWith(payload);
  });

  // ── dispute_alert fix — previously logger.warn stub, now real email ──────────
  // Invariant: a dispute_alert job MUST call emailService.sendDisputeAlert so
  // the admin receives the chargeback notification. The previous stub silently
  // discarded the job — a missed alert could result in an uncontested chargeback
  // (Stripe's evidence deadline is 7 calendar days).

  it('routes dispute_alert to emailService.sendDisputeAlert — regression guard for stub removal', async () => {
    const payload = {
      to: 'admin@store.com',
      orderNumber: 'ORD-2026-000001',
      customerEmail: 'c@t.com',
      amountInCents: 29900,
      reason: 'fraudulent',
      evidenceDeadline: '2026-06-11T00:00:00.000Z',
      disputeId: 'dp_test_123',
    };

    await processor.process(makeJob({ type: 'dispute_alert' as const, payload }));

    expect(emailService.sendDisputeAlert).toHaveBeenCalledWith(payload);
  });

  it('passes the full payload to sendDisputeAlert including adminUrl when present', async () => {
    const payload = {
      to: 'admin@store.com',
      orderNumber: 'ORD-2026-000001',
      customerEmail: 'c@t.com',
      amountInCents: 29900,
      reason: 'product_not_received',
      evidenceDeadline: '2026-06-11T00:00:00.000Z',
      disputeId: 'dp_test_456',
      adminUrl: 'https://store.pl/admin/orders/order-1',
    };

    await processor.process(makeJob({ type: 'dispute_alert' as const, payload }));

    expect(emailService.sendDisputeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ adminUrl: 'https://store.pl/admin/orders/order-1' }),
    );
  });

  it('does not call sendDisputeAlert more than once per job (no double-send)', async () => {
    const payload = {
      to: 'admin@store.com',
      orderNumber: 'ORD-1',
      customerEmail: 'c@t.com',
      amountInCents: 5000,
      reason: 'duplicate',
      evidenceDeadline: '2026-06-11T00:00:00.000Z',
      disputeId: 'dp_once_123',
    };

    await processor.process(makeJob({ type: 'dispute_alert' as const, payload }));

    expect(emailService.sendDisputeAlert).toHaveBeenCalledTimes(1);
  });

  it('propagates sendDisputeAlert rejection so BullMQ can retry the job', async () => {
    (emailService.sendDisputeAlert as jest.Mock).mockRejectedValue(new Error('SMTP unavailable'));

    const payload = {
      to: 'admin@store.com',
      orderNumber: 'ORD-1',
      customerEmail: 'c@t.com',
      amountInCents: 5000,
      reason: 'fraudulent',
      evidenceDeadline: '2026-06-11T00:00:00.000Z',
      disputeId: 'dp_fail_1',
    };

    await expect(
      processor.process(makeJob({ type: 'dispute_alert' as const, payload })),
    ).rejects.toThrow('SMTP unavailable');
  });

  it('routes payout_failed_alert to emailService.sendPayoutFailedAlert', async () => {
    const payload = {
      to: 'admin@store.com',
      payoutId: 'po_test_123',
      amountInCents: 150000,
      currency: 'pln',
      failureCode: 'account_closed',
      failureMessage: 'The bank account has been closed.',
      arrivalDate: '2026-06-04T00:00:00.000Z',
    };

    await processor.process(makeJob({ type: 'payout_failed_alert' as const, payload }));

    expect(emailService.sendPayoutFailedAlert).toHaveBeenCalledWith(payload);
  });

  // ── PDF fetched at processing time (no pre-signed URL in Redis) ─────────────

  describe('payment_confirmed_with_invoice — fresh signed URL generated at processing time', () => {
    const basePayload = {
      to: 'u@t.com',
      orderNumber: 'ORD-1',
      firstName: 'Jan',
      items: [{ name: 'Item', quantity: 1, price: 9999 }],
      shippingCostInCents: 900,
      totalInCents: 10899,
      invoiceStoragePath: 'invoices/FV-2026-000001.pdf',
    };

    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      const pdfContent = 'fake-pdf-content';
      // Use a properly isolated ArrayBuffer (Node.js Buffers share a pool, so
      // .buffer returns the full pool — slice to get only the content bytes).
      const src = Buffer.from(pdfContent);
      const isolatedAB = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: async () => isolatedAB,
      } as unknown as Response);
    });

    afterEach(() => fetchSpy.mockRestore());

    it('generates a fresh 1-hour signed URL from invoiceStoragePath at processing time', async () => {
      await processor.process(
        makeJob({ type: 'payment_confirmed_with_invoice' as const, payload: basePayload }),
      );

      expect(storageService.getInvoiceSignedUrl).toHaveBeenCalledWith(basePayload.invoiceStoragePath, 3600);
    });

    it('fetches the invoice PDF from the freshly generated signed URL', async () => {
      await processor.process(
        makeJob({ type: 'payment_confirmed_with_invoice' as const, payload: basePayload }),
      );

      expect(fetchSpy).toHaveBeenCalledWith('https://storage/signed-inv.pdf');
    });

    it('passes the downloaded content as a Buffer to emailService', async () => {
      await processor.process(
        makeJob({ type: 'payment_confirmed_with_invoice' as const, payload: basePayload }),
      );

      expect(emailService.sendPaymentConfirmedWithInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ invoicePdf: Buffer.from('fake-pdf-content') }),
      );
    });

    it('throws when PDF download returns non-OK status — triggers BullMQ retry', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 404 } as unknown as Response);

      await expect(
        processor.process(
          makeJob({ type: 'payment_confirmed_with_invoice' as const, payload: basePayload }),
        ),
      ).rejects.toThrow('Invoice PDF download failed');
    });

    it('passes scalar fields to emailService without invoiceUrl or invoiceStoragePath', async () => {
      await processor.process(
        makeJob({ type: 'payment_confirmed_with_invoice' as const, payload: basePayload }),
      );

      expect(emailService.sendPaymentConfirmedWithInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          to: basePayload.to,
          orderNumber: basePayload.orderNumber,
          totalInCents: basePayload.totalInCents,
        }),
      );
      // Neither the storage path nor the signed URL must leak into the EmailService call
      const callArg = (emailService.sendPaymentConfirmedWithInvoice as jest.Mock).mock.calls[0][0];
      expect(callArg).not.toHaveProperty('invoiceStoragePath');
      expect(callArg).not.toHaveProperty('invoiceUrl');
    });
  });

  // ── error propagation (BullMQ retry mechanism) ───────────────────────────────

  it('propagates emailService error so BullMQ can retry the job', async () => {
    emailService.sendEmailVerification.mockRejectedValue(new Error('Resend API timeout'));

    await expect(
      processor.process(
        makeJob({
          type: 'email_verification' as const,
          payload: { to: 'u@t.com', firstName: 'Jan', verifyUrl: 'https://x' },
        }),
      ),
    ).rejects.toThrow('Resend API timeout');
  });

  it('propagates error for password_reset so retries are attempted', async () => {
    emailService.sendPasswordReset.mockRejectedValue(new Error('SMTP unavailable'));

    await expect(
      processor.process(
        makeJob({
          type: 'password_reset' as const,
          payload: { to: 'u@t.com', firstName: 'Jan', resetUrl: 'https://x' },
        }),
      ),
    ).rejects.toThrow('SMTP unavailable');
  });

  // ── exhaustiveness guard ─────────────────────────────────────────────────────
  // Invariant: unknown job type must throw so BullMQ moves the job to failed
  // state and applies the retry policy. A resolved promise would silently
  // dequeue the job, losing the email permanently.

  it('throws an Error for an unrecognised job type so BullMQ retries the job', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badJob = { id: 'job-bad', data: { type: 'totally_unknown', payload: {} } } as unknown as Job<any>;

    await expect(processor.process(badJob)).rejects.toThrow(
      'Unknown email job type: totally_unknown',
    );
  });

  it('does not call any email method before throwing on an unrecognised type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badJob = { id: 'job-bad', data: { type: 'totally_unknown', payload: {} } } as unknown as Job<any>;

    await processor.process(badJob).catch(() => undefined);

    expect(emailService.sendEmailVerification).not.toHaveBeenCalled();
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
    expect(emailService.sendOrderConfirmation).not.toHaveBeenCalled();
  });

  // ── onApplicationBootstrap — failed-job alert ────────────────────────────────
  // Invariant: when a BullMQ job exhausts all retries and moves to the failed
  // set, Sentry.captureException must fire and the error must be logged.
  // Without this hook the failure is permanently silent — no Sentry event,
  // no log line, and removeOnFail deletes the evidence after 7 days.

  describe('onApplicationBootstrap — worker failed-job alert', () => {
    type FailedCallback = (job: Job | undefined, err: Error) => void;

    function stubWorkerWithEmitter(processor: EmailQueueProcessor) {
      let failedCallback: FailedCallback | null = null;

      const mockWorker = {
        on: jest.fn().mockImplementation((event: string, cb: FailedCallback) => {
          if (event === 'failed') failedCallback = cb;
        }),
        close: jest.fn().mockResolvedValue(undefined),
      };

      Object.defineProperty(processor, 'worker', {
        get: () => mockWorker,
        configurable: true,
      });

      const triggerFailed = (job: Partial<Job> | undefined, err: Error) =>
        failedCallback!(job as Job, err);

      return { mockWorker, triggerFailed };
    }

    it('registers a "failed" event listener on the worker during bootstrap', () => {
      const { mockWorker } = stubWorkerWithEmitter(processor);

      processor.onApplicationBootstrap();

      expect(mockWorker.on).toHaveBeenCalledWith('failed', expect.any(Function));
    });

    it('calls Sentry.captureException when a job fails', () => {
      const { triggerFailed } = stubWorkerWithEmitter(processor);
      processor.onApplicationBootstrap();

      const err = new Error('Resend API down');
      triggerFailed({ id: 'job-42', name: 'order_confirmation' } as Partial<Job>, err);

      expect(Sentry.captureException).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ extra: expect.objectContaining({ jobId: 'job-42' }) }),
      );
    });

    it('passes the job name to Sentry extra context', () => {
      const { triggerFailed } = stubWorkerWithEmitter(processor);
      processor.onApplicationBootstrap();

      const err = new Error('timeout');
      triggerFailed({ id: 'job-7', name: 'password_reset' } as Partial<Job>, err);

      expect(Sentry.captureException).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ extra: expect.objectContaining({ jobName: 'password_reset' }) }),
      );
    });

    it('does not throw when job is undefined (BullMQ passes undefined for stalled jobs)', () => {
      const { triggerFailed } = stubWorkerWithEmitter(processor);
      processor.onApplicationBootstrap();

      expect(() => triggerFailed(undefined, new Error('stalled'))).not.toThrow();
    });

    // ── DLQ re-enqueue on terminal failure ──────────────────────────────────────
    // Invariant: when attemptsMade reaches opts.attempts (all retries exhausted),
    // the job MUST be re-enqueued to email-dlq so it is not permanently lost.
    // Without the DLQ, a customer whose order confirmation email failed during
    // a 36-second Resend outage would never receive it.

    it('re-enqueues the job to email-dlq when all attempts are exhausted', async () => {
      const { triggerFailed } = stubWorkerWithEmitter(processor);
      processor.onApplicationBootstrap();

      const terminalJob = {
        id: 'job-terminal',
        name: 'order_confirmation',
        data: { type: 'order_confirmation', payload: { orderNumber: 'ORD-1' } },
        attemptsMade: 12,
        opts: { attempts: 12 },
      } as unknown as Job;

      triggerFailed(terminalJob, new Error('Resend outage'));

      // Allow the async dlq.add to be called (it runs via .catch chained off the Promise)
      await Promise.resolve();

      expect(dlqAdd).toHaveBeenCalledWith(
        'order_confirmation',
        terminalJob.data,
        expect.objectContaining({ removeOnComplete: false, removeOnFail: false }),
      );
    });

    it('fires Sentry.captureMessage at error level on terminal failure', async () => {
      const { triggerFailed } = stubWorkerWithEmitter(processor);
      processor.onApplicationBootstrap();

      const terminalJob = {
        id: 'job-sentry',
        name: 'payment_confirmed',
        data: { type: 'payment_confirmed', payload: {} },
        attemptsMade: 12,
        opts: { attempts: 12 },
      } as unknown as Job;

      triggerFailed(terminalJob, new Error('permanent failure'));

      await Promise.resolve();

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('payment_confirmed'),
        expect.objectContaining({ level: 'error' }),
      );
    });

    it('does NOT enqueue to DLQ on intermediate failures (attemptsMade < opts.attempts)', async () => {
      const { triggerFailed } = stubWorkerWithEmitter(processor);
      processor.onApplicationBootstrap();

      const intermediateJob = {
        id: 'job-retry',
        name: 'order_confirmation',
        data: { type: 'order_confirmation', payload: {} },
        attemptsMade: 3,
        opts: { attempts: 12 },
      } as unknown as Job;

      triggerFailed(intermediateJob, new Error('transient'));

      await Promise.resolve();

      expect(dlqAdd).not.toHaveBeenCalled();
    });

    it('does not throw when DLQ enqueue fails — primary failure path must not be obscured', async () => {
      dlqAdd.mockRejectedValue(new Error('Redis DLQ unreachable'));
      const { triggerFailed } = stubWorkerWithEmitter(processor);
      processor.onApplicationBootstrap();

      const terminalJob = {
        id: 'job-dlq-fail',
        name: 'order_confirmation',
        data: { type: 'order_confirmation', payload: {} },
        attemptsMade: 12,
        opts: { attempts: 12 },
      } as unknown as Job;

      expect(() => triggerFailed(terminalJob, new Error('original error'))).not.toThrow();

      // Give the rejected promise a chance to settle
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  // ── graceful shutdown (SIGTERM drain) ─────────────────────────────────────────
  // Invariant: onApplicationShutdown must drain the BullMQ worker before the
  // process exits. Without worker.close(true), a mid-flight job is interrupted:
  //   • new container starts within lockDuration → job re-queued → duplicate email
  //   • new container starts after lock expires  → job dropped  → no confirmation
  // The `true` argument is the drain flag — it blocks until the active job finishes.

  describe('onApplicationShutdown — graceful BullMQ drain', () => {
    function stubWorker(processor: EmailQueueProcessor, close: jest.Mock) {
      Object.defineProperty(processor, 'worker', {
        get: () => ({ close }),
        configurable: true,
      });
    }

    it('calls worker.close with drain=true on shutdown', async () => {
      const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
      stubWorker(processor, mockWorkerClose);

      await processor.onApplicationShutdown();

      expect(mockWorkerClose).toHaveBeenCalledWith(true);
    });

    it('calls worker.close exactly once — no double-drain', async () => {
      const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
      stubWorker(processor, mockWorkerClose);

      await processor.onApplicationShutdown();

      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    });

    it('awaits worker.close — does not return before drain completes', async () => {
      let drainResolved = false;
      const mockWorkerClose = jest.fn().mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(() => { drainResolved = true; resolve(); }, 10)),
      );
      stubWorker(processor, mockWorkerClose);

      await processor.onApplicationShutdown();

      expect(drainResolved).toBe(true);
    });

    it('propagates worker.close rejection so the process exits with an error signal', async () => {
      const mockWorkerClose = jest.fn().mockRejectedValue(new Error('Worker close timed out'));
      stubWorker(processor, mockWorkerClose);

      await expect(processor.onApplicationShutdown()).rejects.toThrow('Worker close timed out');
    });
  });
});

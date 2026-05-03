import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EmailQueueService } from '../email-queue.service';
import { EmailQueueProcessor } from '../email-queue.processor';
import { EmailService } from '../email.service';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeJob<T>(data: T): Job<T> {
  return { id: 'job-1', data } as unknown as Job<T>;
}

// ─── EmailQueueService ────────────────────────────────────────────────────────

describe('EmailQueueService', () => {
  let service: EmailQueueService;
  let queueAdd: jest.Mock;

  beforeEach(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailQueueService,
        {
          provide: getQueueToken('email'),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    service = module.get(EmailQueueService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── persistence config ──────────────────────────────────────────────────────
  // These tests verify the "outbox" guarantees: jobs must survive server restarts
  // because they are durably stored in Redis with retries before EmailService is called.

  describe('job options (outbox persistence guarantees)', () => {
    it('enqueues with 3 retry attempts', async () => {
      await service.sendEmailVerification({ to: 'a@b.com', firstName: 'Ana', verifyUrl: 'https://x' });

      expect(queueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ attempts: 3 }),
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

    it('keeps failed jobs for 7 days (604 800 s) for debugging', async () => {
      await service.sendPasswordReset({ to: 'a@b.com', firstName: 'Ana', resetUrl: 'https://x' });

      expect(queueAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ removeOnFail: { age: 604_800 } }),
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
        expect.objectContaining({ attempts: 3, backoff: { type: 'exponential', delay: 5_000 } }),
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
    it('serialises Buffer to base64 before enqueuing (Buffer is not Redis-safe)', async () => {
      const pdfContent = 'fake-pdf-bytes';
      const invoicePdf = Buffer.from(pdfContent);
      const data = {
        to: 'user@test.com',
        orderNumber: 'ORD-2026-000001',
        firstName: 'Jan',
        items: [{ name: 'Rose Perfume', quantity: 1, price: 14999 }],
        shippingCostInCents: 1500,
        totalInCents: 16499,
        invoiceUrl: 'https://storage/inv.pdf',
        invoicePdf,
      };

      await service.sendPaymentConfirmedWithInvoice(data);

      const [jobName, jobData] = queueAdd.mock.calls[0];
      expect(jobName).toBe('payment_confirmed_with_invoice');
      expect(jobData.payload.invoicePdfBase64).toBe(invoicePdf.toString('base64'));
      // raw Buffer must NOT be present — it cannot round-trip through Redis JSON
      expect(jobData.payload).not.toHaveProperty('invoicePdf');
    });

    it('preserves all other fields unchanged during serialisation', async () => {
      const data = {
        to: 'user@test.com',
        orderNumber: 'ORD-2026-000001',
        firstName: 'Jan',
        items: [{ name: 'Item', quantity: 2, price: 5000 }],
        shippingCostInCents: 900,
        totalInCents: 10900,
        invoiceUrl: 'https://storage/inv.pdf',
        invoicePdf: Buffer.from('pdf'),
      };

      await service.sendPaymentConfirmedWithInvoice(data);

      const payload = queueAdd.mock.calls[0][1].payload;
      expect(payload.to).toBe('user@test.com');
      expect(payload.orderNumber).toBe('ORD-2026-000001');
      expect(payload.invoiceUrl).toBe('https://storage/inv.pdf');
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
});

// ─── EmailQueueProcessor ──────────────────────────────────────────────────────

describe('EmailQueueProcessor', () => {
  let processor: EmailQueueProcessor;
  let emailService: jest.Mocked<EmailService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailQueueProcessor,
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
            sendMagicLink: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    processor = module.get(EmailQueueProcessor);
    emailService = module.get(EmailService);
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

  it('routes back_in_stock to emailService.sendBackInStock', async () => {
    const payload = {
      to: 'u@t.com',
      firstName: 'Jan',
      productName: 'Rose Perfume',
      variantLabel: '50 ml',
      productUrl: 'https://store.pl/rose',
    };

    await processor.process(makeJob({ type: 'back_in_stock' as const, payload }));

    expect(emailService.sendBackInStock).toHaveBeenCalledWith(payload);
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

  // ── Buffer base64 round-trip ─────────────────────────────────────────────────

  describe('payment_confirmed_with_invoice — base64 deserialisation', () => {
    const basePayload = {
      to: 'u@t.com',
      orderNumber: 'ORD-1',
      firstName: 'Jan',
      items: [{ name: 'Item', quantity: 1, price: 9999 }],
      shippingCostInCents: 900,
      totalInCents: 10899,
      invoiceUrl: 'https://storage/inv.pdf',
    };

    it('converts base64 back to Buffer before calling emailService', async () => {
      const originalContent = 'fake-pdf-content';
      const invoicePdfBase64 = Buffer.from(originalContent).toString('base64');

      await processor.process(
        makeJob({
          type: 'payment_confirmed_with_invoice' as const,
          payload: { ...basePayload, invoicePdfBase64 },
        }),
      );

      expect(emailService.sendPaymentConfirmedWithInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          invoicePdf: Buffer.from(originalContent),
        }),
      );
    });

    it('does NOT pass invoicePdfBase64 string through to emailService', async () => {
      const invoicePdfBase64 = Buffer.from('pdf').toString('base64');

      await processor.process(
        makeJob({
          type: 'payment_confirmed_with_invoice' as const,
          payload: { ...basePayload, invoicePdfBase64 },
        }),
      );

      const callArg = (emailService.sendPaymentConfirmedWithInvoice as jest.Mock).mock.calls[0][0];
      expect(callArg).not.toHaveProperty('invoicePdfBase64');
    });

    it('preserves all non-binary fields after deserialisation', async () => {
      const invoicePdfBase64 = Buffer.from('pdf').toString('base64');

      await processor.process(
        makeJob({
          type: 'payment_confirmed_with_invoice' as const,
          payload: { ...basePayload, invoicePdfBase64 },
        }),
      );

      expect(emailService.sendPaymentConfirmedWithInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          to: basePayload.to,
          orderNumber: basePayload.orderNumber,
          invoiceUrl: basePayload.invoiceUrl,
          totalInCents: basePayload.totalInCents,
        }),
      );
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

  it('does not throw on an unrecognised job type (warns and returns gracefully)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badJob = { id: 'job-bad', data: { type: 'totally_unknown', payload: {} } } as unknown as Job<any>;

    await expect(processor.process(badJob)).resolves.toBeUndefined();

    // None of the real email methods should have been called
    expect(emailService.sendEmailVerification).not.toHaveBeenCalled();
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { ReturnsService } from '../returns.service';
import { decryptIban } from '../iban-crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { PaymentsService } from '../../payments/payments.service';
import { ReturnType as ReturnRequestType } from '../dto/create-return.dto';

const TEST_IBAN_KEY = randomBytes(32).toString('hex');

const ADMIN_EMAIL = 'admin@aromaterie.pl';
const OWNER_ID = 'user-owner-1';
// Distinct from dto.email — confirms the service uses the DB record, not the caller-supplied value.
const USER_ACCOUNT_EMAIL = 'authenticated-user@account.example.com';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

const WITHDRAWAL_DTO = {
  orderNumber: 'ORD-2026-001',
  email: 'jan@example.com',
  firstName: 'Jan',
  lastName: 'Kowalski',
  type: ReturnRequestType.WITHDRAWAL,
  deliveryDate: daysAgo(5), // 5 days ago — always within the 14-day window
  items: [{ productName: 'Perfumy Gold 50ml', quantity: 1 }],
  sealedOnReturn: true,
  reason: undefined,
  requestedResolution: undefined,
  bankAccount: undefined,
  phone: undefined,
};

const COMPLAINT_DTO = {
  ...WITHDRAWAL_DTO,
  type: ReturnRequestType.COMPLAINT,
  requestedResolution: 'REFUND' as any,
  reason: 'Produkt jest wadliwy',
  deliveryDate: undefined,
  sealedOnReturn: undefined,
};

// orderRow: { id, userId, status, shipment? } when order exists, null when order does not exist.
function buildPrismaMock(
  overrides: Partial<{ id: string; type: string; requestedResolution: string }> = {},
  orderRow: {
    id?: string;
    userId: string | null;
    status?: string;
    shipment?: { deliveredAt: Date | null } | null;
  } | null = {
    id: 'order-uuid-1',
    userId: OWNER_ID,
    status: 'SHIPPED',
  },
) {
  const record = {
    id: 'return-id-001',
    orderNumber: 'ORD-2026-001',
    firstName: 'Jan',
    lastName: 'Kowalski',
    email: USER_ACCOUNT_EMAIL,
    phone: null,
    type: ReturnRequestType.WITHDRAWAL,
    reason: null,
    requestedResolution: null,
    bankAccount: null,
    ...overrides,
  };
  return {
    order: {
      findFirst: jest.fn().mockResolvedValue(orderRow),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ email: USER_ACCOUNT_EMAIL }),
    },
    returnRequest: {
      create: jest.fn().mockResolvedValue(record),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(record),
    },
  };
}

function buildReturnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-id-001',
    orderId: 'order-uuid-1',
    orderNumber: 'ORD-2026-001',
    firstName: 'Jan',
    lastName: 'Kowalski',
    email: USER_ACCOUNT_EMAIL,
    phone: null,
    type: 'WITHDRAWAL',
    status: 'PENDING',
    reason: null,
    requestedResolution: null,
    bankAccount: null,
    adminNote: null,
    returnTrackingNumber: null,
    ...overrides,
  };
}

describe('ReturnsService', () => {
  let service: ReturnsService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let emailService: jest.Mocked<
    Pick<
      EmailQueueService,
      'sendReturnConfirmation' | 'sendReturnAdminNotification' | 'sendReturnStatusUpdate'
    >
  >;
  let paymentsService: jest.Mocked<Pick<PaymentsService, 'refundPayment'>>;

  async function createModule(prismaMock = buildPrismaMock()) {
    prisma = prismaMock;
    emailService = {
      sendReturnConfirmation: jest.fn().mockResolvedValue(undefined),
      sendReturnAdminNotification: jest.fn().mockResolvedValue(undefined),
      sendReturnStatusUpdate: jest.fn().mockResolvedValue(undefined),
    };
    paymentsService = { refundPayment: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmailQueueService, useValue: emailService },
        { provide: PaymentsService, useValue: paymentsService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(ADMIN_EMAIL) },
        },
      ],
    }).compile();

    service = module.get<ReturnsService>(ReturnsService);
  }

  async function createModuleWithIbanKey(
    ibanKey: string,
    prismaMock = buildPrismaMock(),
  ): Promise<void> {
    prisma = prismaMock;
    emailService = {
      sendReturnConfirmation: jest.fn().mockResolvedValue(undefined),
      sendReturnAdminNotification: jest.fn().mockResolvedValue(undefined),
      sendReturnStatusUpdate: jest.fn().mockResolvedValue(undefined),
    };
    paymentsService = { refundPayment: jest.fn().mockResolvedValue(undefined) };

    const configGetMock = jest.fn().mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'IBAN_ENCRYPTION_KEY') return ibanKey;
      if (key === 'ADMIN_DEFAULT_EMAIL') return ADMIN_EMAIL;
      return fallback;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmailQueueService, useValue: emailService },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: ConfigService, useValue: { get: configGetMock } },
      ],
    }).compile();

    service = module.get<ReturnsService>(ReturnsService);
  }

  // ── create() ─────────────────────────────────────────────────────────

  describe('return value', () => {
    it('returns { id, orderNumber } on success', async () => {
      await createModule();
      const result = await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });
  });

  describe('database write', () => {
    it('persists WITHDRAWAL type to the database', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: ReturnRequestType.WITHDRAWAL }),
        }),
      );
    });

    it('persists COMPLAINT type to the database', async () => {
      await createModule(buildPrismaMock({ type: ReturnRequestType.COMPLAINT }));
      await service.create(COMPLAINT_DTO as any, OWNER_ID);
      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: ReturnRequestType.COMPLAINT }),
        }),
      );
    });

    it('normalises orderNumber to upper-case', async () => {
      await createModule();
      await service.create({ ...WITHDRAWAL_DTO, orderNumber: 'ord-2026-001' } as any, OWNER_ID);
      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderNumber: 'ORD-2026-001' }),
        }),
      );
    });

    it('stores the authenticated user account email, ignoring dto.email', async () => {
      await createModule();
      // dto.email is a different address — the DB write must use user.email from the DB lookup
      await service.create({ ...WITHDRAWAL_DTO, email: 'attacker@evil.com' } as any, OWNER_ID);
      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: USER_ACCOUNT_EMAIL }),
        }),
      );
    });

    it('stores deliveryDate as a Date object when provided', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deliveryDate: new Date(WITHDRAWAL_DTO.deliveryDate),
          }),
        }),
      );
    });

    it('stores deliveryDate as null when not provided', async () => {
      await createModule(buildPrismaMock({ type: ReturnRequestType.COMPLAINT }));
      await service.create(COMPLAINT_DTO as any, OWNER_ID);
      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deliveryDate: null }),
        }),
      );
    });

    it('persists orderId from the order FK lookup', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-uuid-1' }),
        }),
      );
    });
  });

  describe('customer confirmation email', () => {
    it('calls sendReturnConfirmation for WITHDRAWAL with type=WITHDRAWAL', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(emailService.sendReturnConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'WITHDRAWAL' }),
      );
    });

    it('calls sendReturnConfirmation for COMPLAINT with type=COMPLAINT', async () => {
      await createModule(buildPrismaMock({ type: ReturnRequestType.COMPLAINT }));
      await service.create(COMPLAINT_DTO as any, OWNER_ID);
      expect(emailService.sendReturnConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'COMPLAINT' }),
      );
    });

    it('sends confirmation to the authenticated user account email, not dto.email', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(emailService.sendReturnConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ to: USER_ACCOUNT_EMAIL }),
      );
    });

    it('includes the request ID in the confirmation', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(emailService.sendReturnConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'return-id-001' }),
      );
    });

    it('includes the order number in the confirmation', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(emailService.sendReturnConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ orderNumber: 'ORD-2026-001' }),
      );
    });

    it('never delivers to the caller-supplied dto.email — prevents phishing via store sending domain', async () => {
      await createModule();
      const attackerEmail = 'victim@third-party.example.com';

      await service.create({ ...WITHDRAWAL_DTO, email: attackerEmail } as any, OWNER_ID);

      const confirmationCall = (emailService.sendReturnConfirmation as jest.Mock).mock.calls[0][0];
      expect(confirmationCall.to).not.toBe(attackerEmail);
      expect(confirmationCall.to).toBe(USER_ACCOUNT_EMAIL);
    });
  });

  describe('admin notification email', () => {
    it('calls sendReturnAdminNotification for WITHDRAWAL with type=WITHDRAWAL', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(emailService.sendReturnAdminNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'WITHDRAWAL' }),
      );
    });

    it('calls sendReturnAdminNotification for COMPLAINT with type=COMPLAINT', async () => {
      await createModule(buildPrismaMock({ type: ReturnRequestType.COMPLAINT }));
      await service.create(COMPLAINT_DTO as any, OWNER_ID);
      expect(emailService.sendReturnAdminNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'COMPLAINT' }),
      );
    });

    it('sends admin notification to the configured admin email', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(emailService.sendReturnAdminNotification).toHaveBeenCalledWith(
        expect.objectContaining({ to: ADMIN_EMAIL }),
      );
    });

    it('includes deliveryDate in the admin notification for WITHDRAWAL', async () => {
      await createModule();
      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);
      expect(emailService.sendReturnAdminNotification).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryDate: WITHDRAWAL_DTO.deliveryDate }),
      );
    });

    it('includes requestedResolution in admin notification for COMPLAINT', async () => {
      await createModule(buildPrismaMock({ type: ReturnRequestType.COMPLAINT, requestedResolution: 'REFUND' } as any));
      await service.create(COMPLAINT_DTO as any, OWNER_ID);
      expect(emailService.sendReturnAdminNotification).toHaveBeenCalledWith(
        expect.objectContaining({ requestedResolution: 'REFUND' }),
      );
    });
  });

  describe('email resilience', () => {
    it('still returns { id, orderNumber } even if both emails fail', async () => {
      await createModule();
      emailService.sendReturnConfirmation.mockRejectedValue(new Error('Resend down'));
      emailService.sendReturnAdminNotification.mockRejectedValue(new Error('Resend down'));

      const result = await service.create(WITHDRAWAL_DTO as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });
  });

  // ── seal guard (Art. 38 pkt 5 UoK) ──────────────────────────────────────

  describe('seal guard', () => {
    it('throws BadRequestException for WITHDRAWAL when sealedOnReturn is false', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO, sealedOnReturn: false };

      await expect(service.create(dto as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for WITHDRAWAL when sealedOnReturn is absent', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO } as any;
      delete dto.sealedOnReturn;

      await expect(service.create(dto, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('proceeds for WITHDRAWAL when sealedOnReturn is true', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO, sealedOnReturn: true };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('does not block COMPLAINT regardless of sealedOnReturn value', async () => {
      await createModule(buildPrismaMock({ type: ReturnRequestType.COMPLAINT }));
      const dto = { ...COMPLAINT_DTO, sealedOnReturn: false };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('persists sealedOnReturn=true when provided', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO, sealedOnReturn: true };

      await service.create(dto as any, OWNER_ID);

      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sealedOnReturn: true }),
        }),
      );
    });

    it('persists sealedOnReturn=null when absent on a COMPLAINT', async () => {
      await createModule(buildPrismaMock({ type: ReturnRequestType.COMPLAINT }));

      await service.create(COMPLAINT_DTO as any, OWNER_ID);

      expect(prisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sealedOnReturn: null }),
        }),
      );
    });
  });

  // ── 14-day withdrawal window guard (Art. 27 UoK) ─────────────────────────

  describe('14-day withdrawal window guard', () => {
    it('throws BadRequestException for WITHDRAWAL when deliveryDate is absent', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO } as any;
      delete dto.deliveryDate;

      await expect(service.create(dto, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for WITHDRAWAL when deliveryDate is 16 days ago (window expired)', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(16) };

      await expect(service.create(dto as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('allows WITHDRAWAL when deliveryDate is exactly 15 days ago (boundary: day 15 still valid, Art. 27 off-by-one fix)', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(15) };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('blocks a WITHDRAWAL with a backdated deliveryDate of 20 days ago', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(20) };

      await expect(service.create(dto as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('allows WITHDRAWAL when deliveryDate is 5 days ago (within the 14-day window)', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(5) };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('allows WITHDRAWAL when deliveryDate is today (0 days ago)', async () => {
      await createModule();
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(0) };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('does not apply the 14-day check for COMPLAINT type', async () => {
      await createModule(buildPrismaMock({ type: ReturnRequestType.COMPLAINT }));
      const dto = { ...COMPLAINT_DTO, deliveryDate: daysAgo(30) };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    // Regression guard for the calendar-day fix (Art. 27 UoK).
    // Old code: windowEnd = deliveryDate + 14 * 24h = 2026-01-15T00:00:00Z (UTC midnight).
    // New code: windowEnd = 2026-01-15 at 23:59:59.999 local time.
    // Date.now pinned to 2026-01-15T00:01:00Z: old code REJECTS, new code ALLOWS.
    it('allows WITHDRAWAL submitted just after the old millisecond cutoff but still within the 14th calendar day', async () => {
      await createModule();
      const deliveryDate = '2026-01-01';
      const oneMinuteAfterOldWindowEnd = new Date('2026-01-15T00:01:00.000Z').getTime();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(oneMinuteAfterOldWindowEnd);

      const dto = { ...WITHDRAWAL_DTO, deliveryDate };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
      dateSpy.mockRestore();
    });

    it('rejects WITHDRAWAL submitted well past the end of the 15th calendar day after delivery (Art. 27 +15 fix)', async () => {
      await createModule();
      const deliveryDate = '2026-01-01';
      // 2026-01-17T12:00:00Z is safely after end of Jan 16 in UTC through UTC+2 (Poland)
      const dayAfterDeadline = new Date('2026-01-17T12:00:00.000Z').getTime();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(dayAfterDeadline);

      const dto = { ...WITHDRAWAL_DTO, deliveryDate };

      await expect(service.create(dto as any, OWNER_ID)).rejects.toThrow(BadRequestException);
      dateSpy.mockRestore();
    });
  });

  // ── deliveryDate anti-backdating guard ──────────────────────────────────────
  // When shipment.deliveredAt is recorded in the DB, the server uses it as the
  // authoritative delivery date instead of the client-supplied dto.deliveryDate.
  // An attacker with an expired order cannot reopen the 14-day window by passing
  // a recent deliveryDate, and cannot pass a date that predates actual delivery.

  describe('deliveryDate anti-backdating guard', () => {
    it('rejects WITHDRAWAL when dto.deliveryDate predates shipment.deliveredAt', async () => {
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'DELIVERED',
        shipment: { deliveredAt: new Date(daysAgo(5)) },
      });
      await createModule(mock);
      // submitting a date 10 days before the actual delivery
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(10) };

      await expect(service.create(dto as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('rejects WITHDRAWAL when attacker passes dto.deliveryDate=today but shipment.deliveredAt was 20 days ago', async () => {
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'DELIVERED',
        shipment: { deliveredAt: new Date(daysAgo(20)) },
      });
      await createModule(mock);
      // attacker sends today's date hoping to extend the 14-day window
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(0) };

      await expect(service.create(dto as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('uses shipment.deliveredAt (not dto.deliveryDate) when computing the 14-day window', async () => {
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'DELIVERED',
        shipment: { deliveredAt: new Date(daysAgo(5)) },
      });
      await createModule(mock);
      // dto.deliveryDate matches or is after actual delivery — passes backdating check
      // window computed from deliveredAt (5 days ago) + 15 = 10 days remaining → OK
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(5) };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('allows when dto.deliveryDate is after shipment.deliveredAt (e.g. customer reports later than carrier)', async () => {
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'DELIVERED',
        shipment: { deliveredAt: new Date(daysAgo(5)) },
      });
      await createModule(mock);
      // dto.deliveryDate is 3 days ago — later than actual delivery, no backdating issue
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(3) };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('falls back to dto.deliveryDate when no shipment.deliveredAt is recorded', async () => {
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'SHIPPED',
        shipment: null,
      });
      await createModule(mock);
      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(5) };

      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });
  });

  describe('ownership guard', () => {
    it('throws NotFoundException when the order number does not exist', async () => {
      await createModule(buildPrismaMock({}, null));

      await expect(service.create(WITHDRAWAL_DTO as any, OWNER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the order belongs to a different user', async () => {
      await createModule(buildPrismaMock({}, { userId: 'different-user-id', status: 'SHIPPED' }));

      await expect(service.create(WITHDRAWAL_DTO as any, OWNER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('proceeds when the authenticated user owns the order', async () => {
      await createModule(buildPrismaMock({}, { userId: OWNER_ID, status: 'SHIPPED' }));

      const result = await service.create(WITHDRAWAL_DTO as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });
  });

  // ── duplicate return guard (GDPR Art. 5(1)(c) data minimisation) ────────
  describe('duplicate return guard', () => {
    it('throws ConflictException when an active (PENDING) return request already exists for the order', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findFirst.mockResolvedValue({ id: 'existing-return' });
      await createModule(mock);

      await expect(service.create(WITHDRAWAL_DTO as any, OWNER_ID)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when an IN_REVIEW return request already exists', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findFirst.mockResolvedValue({ id: 'existing-in-review' });
      await createModule(mock);

      await expect(service.create(COMPLAINT_DTO as any, OWNER_ID)).rejects.toThrow(ConflictException);
    });

    it('does not call returnRequest.create when ConflictException is thrown', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findFirst.mockResolvedValue({ id: 'existing-return' });
      await createModule(mock);

      await service.create(WITHDRAWAL_DTO as any, OWNER_ID).catch(() => undefined);

      expect(mock.returnRequest.create).not.toHaveBeenCalled();
    });

    it('proceeds when no active return request exists (findFirst returns null)', async () => {
      await createModule();

      const result = await service.create(WITHDRAWAL_DTO as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('proceeds when only a REJECTED return exists for the order (terminal status)', async () => {
      const mock = buildPrismaMock();
      // findFirst with notIn REJECTED/COMPLETED returns null — rejected is excluded from the guard
      mock.returnRequest.findFirst.mockResolvedValue(null);
      await createModule(mock);

      const result = await service.create(WITHDRAWAL_DTO as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('queries findFirst with notIn REJECTED and COMPLETED to skip terminal statuses', async () => {
      const mock = buildPrismaMock();
      await createModule(mock);

      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);

      expect(mock.returnRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { notIn: ['REJECTED', 'COMPLETED'] },
          }),
        }),
      );
    });

    it('queries findFirst scoped to the resolved orderId — not a cross-order check', async () => {
      const mock = buildPrismaMock();
      await createModule(mock);

      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);

      expect(mock.returnRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orderId: 'order-uuid-1' }),
        }),
      );
    });
  });

  // ── status allowlist guard ───────────────────────────────────────────

  describe('status allowlist guard', () => {
    it('throws BadRequestException when order status is CANCELLED', async () => {
      await createModule(buildPrismaMock({}, { id: 'order-uuid-1', userId: OWNER_ID, status: 'CANCELLED' }));

      await expect(service.create(COMPLAINT_DTO as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order status is PENDING_PAYMENT', async () => {
      await createModule(buildPrismaMock({}, { id: 'order-uuid-1', userId: OWNER_ID, status: 'PENDING_PAYMENT' }));

      await expect(service.create(COMPLAINT_DTO as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order status is FRAUD_REVIEW', async () => {
      await createModule(buildPrismaMock({}, { id: 'order-uuid-1', userId: OWNER_ID, status: 'FRAUD_REVIEW' }));

      await expect(service.create(COMPLAINT_DTO as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order status is REFUNDED', async () => {
      await createModule(buildPrismaMock({}, { id: 'order-uuid-1', userId: OWNER_ID, status: 'REFUNDED' }));

      await expect(service.create(COMPLAINT_DTO as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('allows COMPLAINT when order status is SHIPPED', async () => {
      await createModule(buildPrismaMock({ type: 'COMPLAINT' }, { id: 'order-uuid-1', userId: OWNER_ID, status: 'SHIPPED' }));

      const result = await service.create(COMPLAINT_DTO as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('allows COMPLAINT when order status is DELIVERED', async () => {
      await createModule(buildPrismaMock({ type: 'COMPLAINT' }, { id: 'order-uuid-1', userId: OWNER_ID, status: 'DELIVERED' }));

      const result = await service.create(COMPLAINT_DTO as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('allows COMPLAINT when order status is PAID', async () => {
      await createModule(buildPrismaMock({ type: 'COMPLAINT' }, { id: 'order-uuid-1', userId: OWNER_ID, status: 'PAID' }));

      const result = await service.create(COMPLAINT_DTO as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('allows WITHDRAWAL when order status is PROCESSING', async () => {
      await createModule(buildPrismaMock({}, { id: 'order-uuid-1', userId: OWNER_ID, status: 'PROCESSING' }));

      const result = await service.create(WITHDRAWAL_DTO as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('does not create the return request record for a CANCELLED order', async () => {
      const mock = buildPrismaMock({}, { id: 'order-uuid-1', userId: OWNER_ID, status: 'CANCELLED' });
      await createModule(mock);

      await expect(service.create(COMPLAINT_DTO as any, OWNER_ID)).rejects.toThrow(BadRequestException);
      expect(mock.returnRequest.create).not.toHaveBeenCalled();
    });

    it('does not fire emails for a CANCELLED order', async () => {
      await createModule(buildPrismaMock({}, { id: 'order-uuid-1', userId: OWNER_ID, status: 'CANCELLED' }));

      await expect(service.create(COMPLAINT_DTO as any, OWNER_ID)).rejects.toThrow(BadRequestException);
      expect(emailService.sendReturnConfirmation).not.toHaveBeenCalled();
      expect(emailService.sendReturnAdminNotification).not.toHaveBeenCalled();
    });
  });

  // ── approve() ────────────────────────────────────────────────────────

  describe('approve()', () => {
    it('throws NotFoundException when the return request does not exist', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(null);
      await createModule(mock);

      await expect(service.approve('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when already APPROVED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'APPROVED' }));
      await createModule(mock);

      await expect(service.approve('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when already COMPLETED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'COMPLETED' }));
      await createModule(mock);

      await expect(service.approve('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when already REJECTED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'REJECTED' }));
      await createModule(mock);

      await expect(service.approve('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('updates status to APPROVED and persists adminNote', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'PENDING' }));
      await createModule(mock);

      await service.approve('return-id-001', 'Przyjęto');

      expect(mock.returnRequest.update).toHaveBeenCalledWith({
        where: { id: 'return-id-001' },
        data: { status: 'APPROVED', adminNote: 'Przyjęto' },
      });
    });

    it('sends return_status_update email with newStatus=APPROVED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'PENDING' }));
      await createModule(mock);

      await service.approve('return-id-001');

      expect(emailService.sendReturnStatusUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ newStatus: 'APPROVED', to: USER_ACCOUNT_EMAIL }),
      );
    });

    it('resolves even if the status email throws', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'PENDING' }));
      await createModule(mock);
      emailService.sendReturnStatusUpdate.mockRejectedValue(new Error('Resend down'));

      await expect(service.approve('return-id-001')).resolves.toBeUndefined();
    });
  });

  // ── reject() ─────────────────────────────────────────────────────────

  describe('reject()', () => {
    it('throws NotFoundException when the return request does not exist', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(null);
      await createModule(mock);

      await expect(service.reject('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when already REJECTED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'REJECTED' }));
      await createModule(mock);

      await expect(service.reject('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when already COMPLETED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'COMPLETED' }));
      await createModule(mock);

      await expect(service.reject('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('updates status to REJECTED and persists adminNote', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'IN_REVIEW' }));
      await createModule(mock);

      await service.reject('return-id-001', 'Poza terminem');

      expect(mock.returnRequest.update).toHaveBeenCalledWith({
        where: { id: 'return-id-001' },
        data: { status: 'REJECTED', adminNote: 'Poza terminem' },
      });
    });

    it('sends return_status_update email with newStatus=REJECTED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'PENDING' }));
      await createModule(mock);

      await service.reject('return-id-001');

      expect(emailService.sendReturnStatusUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ newStatus: 'REJECTED', to: USER_ACCOUNT_EMAIL }),
      );
    });

    it('resolves even if the status email throws', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'PENDING' }));
      await createModule(mock);
      emailService.sendReturnStatusUpdate.mockRejectedValue(new Error('Resend down'));

      await expect(service.reject('return-id-001')).resolves.toBeUndefined();
    });
  });

  // ── markRefunded() ───────────────────────────────────────────────────

  describe('markRefunded()', () => {
    it('throws NotFoundException when the return request does not exist', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(null);
      await createModule(mock);

      await expect(service.markRefunded('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when status is PENDING (not APPROVED)', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'PENDING' }));
      await createModule(mock);

      await expect(service.markRefunded('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is REJECTED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'REJECTED' }));
      await createModule(mock);

      await expect(service.markRefunded('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when already COMPLETED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'COMPLETED' }));
      await createModule(mock);

      await expect(service.markRefunded('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('updates status to COMPLETED when APPROVED and tracking number is present', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', returnTrackingNumber: 'INP-TRACK-001' }),
      );
      await createModule(mock);

      await service.markRefunded('return-id-001', 'Przelew zrealizowany 2026-05-28');

      expect(mock.returnRequest.update).toHaveBeenCalledWith({
        where: { id: 'return-id-001' },
        data: { status: 'COMPLETED', adminNote: 'Przelew zrealizowany 2026-05-28' },
      });
    });

    it('sends return_status_update email with newStatus=COMPLETED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', returnTrackingNumber: 'INP-TRACK-001' }),
      );
      await createModule(mock);

      await service.markRefunded('return-id-001');

      expect(emailService.sendReturnStatusUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ newStatus: 'COMPLETED', to: USER_ACCOUNT_EMAIL }),
      );
    });

    it('resolves even if the status email throws', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', returnTrackingNumber: 'INP-TRACK-001' }),
      );
      await createModule(mock);
      emailService.sendReturnStatusUpdate.mockRejectedValue(new Error('Resend down'));

      await expect(service.markRefunded('return-id-001')).resolves.toBeUndefined();
    });

    // ── Stripe refund integration ─────────────────────────────────────────────
    // Guards the fix: markRefunded() must issue the Stripe refund + stock restore
    // before flipping the return request status to COMPLETED.

    it('throws BadRequestException when orderId is null (legacy row without FK)', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', orderId: null }),
      );
      await createModule(mock);

      await expect(service.markRefunded('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('calls paymentsService.refundPayment with orderId and RETURN_APPROVAL actor', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', returnTrackingNumber: 'INP-TRACK-001' }),
      );
      await createModule(mock);

      await service.markRefunded('return-id-001');

      expect(paymentsService.refundPayment).toHaveBeenCalledWith('order-uuid-1', 'RETURN_APPROVAL');
    });

    it('updates return status to COMPLETED after refundPayment succeeds', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', returnTrackingNumber: 'INP-TRACK-001' }),
      );
      await createModule(mock);

      await service.markRefunded('return-id-001');

      expect(mock.returnRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('does not update return status when refundPayment throws — leaves it APPROVED for retry', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', returnTrackingNumber: 'INP-TRACK-001' }),
      );
      await createModule(mock);
      (paymentsService.refundPayment as jest.Mock).mockRejectedValue(new Error('Stripe API error'));

      await expect(service.markRefunded('return-id-001')).rejects.toThrow('Stripe API error');
      expect(mock.returnRequest.update).not.toHaveBeenCalled();
    });

    it('calls refundPayment before updating the DB — ordering is intentional', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', returnTrackingNumber: 'INP-TRACK-001' }),
      );
      await createModule(mock);

      const callOrder: string[] = [];
      (paymentsService.refundPayment as jest.Mock).mockImplementation(async () => {
        callOrder.push('refundPayment');
      });
      mock.returnRequest.update.mockImplementation(async () => {
        callOrder.push('statusUpdate');
        return {};
      });

      await service.markRefunded('return-id-001');

      expect(callOrder).toEqual(['refundPayment', 'statusUpdate']);
    });

    // ── return receipt gate (Art. 32 UoK anti-fraud) ──────────────────────────
    // Invariant: a fraud ring can file WITHDRAWAL returns and immediately receive
    // Stripe refunds upon admin approval without ever returning goods. The fix
    // blocks markRefunded() for WITHDRAWAL type until a tracking number is recorded,
    // proving the customer shipped the item back (or the admin verified receipt).

    it('throws BadRequestException for WITHDRAWAL with no returnTrackingNumber', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', type: 'WITHDRAWAL', returnTrackingNumber: null }),
      );
      await createModule(mock);

      await expect(service.markRefunded('return-id-001')).rejects.toThrow(BadRequestException);
    });

    it('does not call refundPayment when WITHDRAWAL tracking number is missing', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', type: 'WITHDRAWAL', returnTrackingNumber: null }),
      );
      await createModule(mock);

      await service.markRefunded('return-id-001').catch(() => undefined);

      expect(paymentsService.refundPayment).not.toHaveBeenCalled();
    });

    it('proceeds for WITHDRAWAL when returnTrackingNumber is set', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', type: 'WITHDRAWAL', returnTrackingNumber: 'DHL-123456' }),
      );
      await createModule(mock);

      await service.markRefunded('return-id-001');

      expect(paymentsService.refundPayment).toHaveBeenCalledWith('order-uuid-1', 'RETURN_APPROVAL');
    });

    it('does NOT require a tracking number for COMPLAINT type (carrier pickup, no inbound parcel)', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED', type: 'COMPLAINT', returnTrackingNumber: null }),
      );
      await createModule(mock);

      await service.markRefunded('return-id-001');

      expect(paymentsService.refundPayment).toHaveBeenCalledWith('order-uuid-1', 'RETURN_APPROVAL');
    });
  });

  // ── recordReturnTracking() ────────────────────────────────────────────────

  describe('recordReturnTracking()', () => {
    it('throws NotFoundException when the return request does not exist', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(null);
      await createModule(mock);

      await expect(service.recordReturnTracking('nonexistent-id', 'INP-001')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the return is already COMPLETED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'COMPLETED' }));
      await createModule(mock);

      await expect(service.recordReturnTracking('return-id-001', 'INP-001')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the return is already REJECTED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'REJECTED' }));
      await createModule(mock);

      await expect(service.recordReturnTracking('return-id-001', 'INP-001')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('persists the trimmed tracking number on an APPROVED return request', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'APPROVED' }));
      await createModule(mock);

      await service.recordReturnTracking('return-id-001', '  INP-TRACK-999  ');

      expect(mock.returnRequest.update).toHaveBeenCalledWith({
        where: { id: 'return-id-001' },
        data: { returnTrackingNumber: 'INP-TRACK-999' },
      });
    });

    it('persists tracking on a PENDING return (admin may record before formal approval)', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'PENDING' }));
      await createModule(mock);

      await service.recordReturnTracking('return-id-001', 'DHL-99887766');

      expect(mock.returnRequest.update).toHaveBeenCalledWith({
        where: { id: 'return-id-001' },
        data: { returnTrackingNumber: 'DHL-99887766' },
      });
    });

    it('does not call refundPayment — recording tracking is not the refund trigger', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(buildReturnRecord({ status: 'APPROVED' }));
      await createModule(mock);

      await service.recordReturnTracking('return-id-001', 'INP-001');

      expect(paymentsService.refundPayment).not.toHaveBeenCalled();
    });
  });

  // ── IBAN encryption (GDPR Art. 32) ───────────────────────────────────────────

  describe('IBAN at-rest encryption', () => {
    const SAMPLE_IBAN = 'PL61109010140000071219812874';
    const dtoWithIban = { ...WITHDRAWAL_DTO, bankAccount: SAMPLE_IBAN };

    it('stores an encrypted value — not the plaintext IBAN — when key is set', async () => {
      await createModuleWithIbanKey(TEST_IBAN_KEY);

      await service.create(dtoWithIban as any, OWNER_ID);

      const createCall = (prisma.returnRequest.create as jest.Mock).mock.calls[0][0];
      const stored = createCall.data.bankAccount as string;
      expect(stored).not.toBe(SAMPLE_IBAN);
      expect(stored).toMatch(/^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/);
    });

    it('encrypted value decrypts back to the original IBAN', async () => {
      await createModuleWithIbanKey(TEST_IBAN_KEY);

      await service.create(dtoWithIban as any, OWNER_ID);

      const createCall = (prisma.returnRequest.create as jest.Mock).mock.calls[0][0];
      const stored = createCall.data.bankAccount as string;
      expect(decryptIban(stored, TEST_IBAN_KEY)).toBe(
        SAMPLE_IBAN.trim().toUpperCase(),
      );
    });

    it('sends plaintext IBAN to the admin notification email, not the ciphertext', async () => {
      await createModuleWithIbanKey(TEST_IBAN_KEY);

      await service.create(dtoWithIban as any, OWNER_ID);

      const adminCall = (emailService.sendReturnAdminNotification as jest.Mock).mock.calls[0][0];
      expect(adminCall.bankAccount).toBe(SAMPLE_IBAN.trim().toUpperCase());
    });

    it('produces a different ciphertext on each call (random IV)', async () => {
      await createModuleWithIbanKey(TEST_IBAN_KEY);

      await service.create(dtoWithIban as any, OWNER_ID);
      await service.create(dtoWithIban as any, OWNER_ID);

      const calls = (prisma.returnRequest.create as jest.Mock).mock.calls;
      const firstStored = calls[0][0].data.bankAccount as string;
      const secondStored = calls[1][0].data.bankAccount as string;
      expect(firstStored).not.toBe(secondStored);
    });

    it('stores null when bankAccount is absent (no encryption attempt)', async () => {
      await createModuleWithIbanKey(TEST_IBAN_KEY);

      await service.create(WITHDRAWAL_DTO as any, OWNER_ID);

      const createCall = (prisma.returnRequest.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.bankAccount).toBeNull();
    });

    it('falls back to plaintext storage when IBAN_ENCRYPTION_KEY is not set', async () => {
      await createModuleWithIbanKey('');

      await service.create(dtoWithIban as any, OWNER_ID);

      const createCall = (prisma.returnRequest.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.bankAccount).toBe(SAMPLE_IBAN.trim().toUpperCase());
    });

    it('falls back to plaintext when key is present but not 64 hex chars (misconfiguration)', async () => {
      await createModuleWithIbanKey('tooshort');

      await service.create(dtoWithIban as any, OWNER_ID);

      const createCall = (prisma.returnRequest.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.bankAccount).toBe(SAMPLE_IBAN.trim().toUpperCase());
    });
  });

  // ── replacement delivery resets the 14-day withdrawal clock ─────────────
  // Art. 27 UoK / Directive 2011/83/EU Art. 14(1): when a replacement is delivered,
  // the withdrawal window restarts from replacementDeliveredAt, not the original shipment.

  describe('replacement delivery resets the 14-day withdrawal clock (Art. 27 / Directive 2011/83/EU Art. 14(1))', () => {
    it('allows withdrawal when original delivery is expired but replacementDeliveredAt is within the 14-day window', async () => {
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'DELIVERED',
        shipment: { deliveredAt: new Date(daysAgo(20)) },
      });
      await createModule(mock);
      // Prime the first findFirst (prior-replacement query) with a recent replacementDeliveredAt;
      // the second findFirst (duplicate check) falls back to the default mockResolvedValue(null).
      prisma.returnRequest.findFirst.mockResolvedValueOnce({
        replacementDeliveredAt: new Date(daysAgo(3)),
      });

      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(3) };
      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });

    it('rejects when replacementDeliveredAt is also outside the 14-day window', async () => {
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'DELIVERED',
        shipment: { deliveredAt: new Date(daysAgo(30)) },
      });
      await createModule(mock);
      prisma.returnRequest.findFirst.mockResolvedValueOnce({
        replacementDeliveredAt: new Date(daysAgo(20)),
      });

      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(20) };
      await expect(service.create(dto as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('rejects when dto.deliveryDate predates replacementDeliveredAt', async () => {
      // Replacement arrived 3 days ago; client claims delivery was 5 days ago — impossible.
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'DELIVERED',
        shipment: { deliveredAt: new Date(daysAgo(10)) },
      });
      await createModule(mock);
      prisma.returnRequest.findFirst.mockResolvedValueOnce({
        replacementDeliveredAt: new Date(daysAgo(3)),
      });

      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(5) };
      await expect(service.create(dto as any, OWNER_ID)).rejects.toThrow(BadRequestException);
    });

    it('uses replacementDeliveredAt as authoritative date (not original shipment) when both are present', async () => {
      // dto.deliveryDate = 3 days ago (after original 6d-ago delivery — no backdating issue).
      // dbDeliveryDate = replacementDeliveredAt = 3 days ago → window end = 12 days from now.
      const mock = buildPrismaMock({}, {
        id: 'order-uuid-1',
        userId: OWNER_ID,
        status: 'DELIVERED',
        shipment: { deliveredAt: new Date(daysAgo(6)) },
      });
      await createModule(mock);
      prisma.returnRequest.findFirst.mockResolvedValueOnce({
        replacementDeliveredAt: new Date(daysAgo(3)),
      });

      const dto = { ...WITHDRAWAL_DTO, deliveryDate: daysAgo(3) };
      const result = await service.create(dto as any, OWNER_ID);

      expect(result).toEqual({ id: 'return-id-001', orderNumber: 'ORD-2026-001' });
    });
  });

  // ── setReplacementDeliveredAt() ─────────────────────────────────────────────
  // Admin records the date the replacement unit was delivered to the customer,
  // which resets the Art. 27 withdrawal clock for any subsequent return request.

  describe('setReplacementDeliveredAt()', () => {
    it('throws NotFoundException when the return request does not exist', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(null);
      await createModule(mock);

      await expect(
        service.setReplacementDeliveredAt('nonexistent-id', new Date()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when request is REJECTED', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'REJECTED' }),
      );
      await createModule(mock);

      await expect(
        service.setReplacementDeliveredAt('return-id-001', new Date()),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores replacementDeliveredAt on an APPROVED return request', async () => {
      const deliveredAt = new Date(daysAgo(2));
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'APPROVED' }),
      );
      await createModule(mock);

      await service.setReplacementDeliveredAt('return-id-001', deliveredAt);

      expect(mock.returnRequest.update).toHaveBeenCalledWith({
        where: { id: 'return-id-001' },
        data: { replacementDeliveredAt: deliveredAt },
      });
    });

    it('stores replacementDeliveredAt on a PENDING return request', async () => {
      const deliveredAt = new Date(daysAgo(1));
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(
        buildReturnRecord({ status: 'PENDING' }),
      );
      await createModule(mock);

      await service.setReplacementDeliveredAt('return-id-001', deliveredAt);

      expect(mock.returnRequest.update).toHaveBeenCalledWith({
        where: { id: 'return-id-001' },
        data: { replacementDeliveredAt: deliveredAt },
      });
    });

    it('does not call update when the request does not exist', async () => {
      const mock = buildPrismaMock();
      mock.returnRequest.findUnique.mockResolvedValue(null);
      await createModule(mock);

      await service.setReplacementDeliveredAt('nonexistent-id', new Date()).catch(() => undefined);

      expect(mock.returnRequest.update).not.toHaveBeenCalled();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeClient } from '../../payments/stripe.client';

const mockUser = {
  id: 'user-1',
  email: 'jan@example.com',
  firstName: 'Jan',
  lastName: 'Kowalski',
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let mockStripe: { listDisputesByPaymentIntent: jest.Mock };

  beforeEach(async () => {
    mockStripe = { listDisputesByPaymentIntent: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            address: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
            },
            order: {
              updateMany: jest.fn(),
              findMany: jest.fn(),
            },
            payment: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            review: {
              findMany: jest.fn(),
            },
            wishlistItem: {
              findMany: jest.fn(),
            },
            returnRequest: {
              findMany: jest.fn(),
              updateMany: jest.fn(),
            },
            consentLog: {
              create: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        { provide: StripeClient, useValue: mockStripe },
      ],
    }).compile();

    service = module.get(UsersService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── exportData — GDPR Art. 20 ──────────────────────────────────────────

  describe('exportData', () => {
    const fullUser = {
      id: 'user-1',
      email: 'jan@example.com',
      passwordHash: 'bcrypt-hash',
      googleId: 'google-123',
      firstName: 'Jan',
      lastName: 'Kowalski',
      phone: null,
      nip: null,
      role: 'CUSTOMER',
      isEmailVerified: true,
      pendingEmail: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      addresses: [{ id: 'addr-1', city: 'Warszawa' }],
    };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(fullUser);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.review.findMany.mockResolvedValue([]);
      prisma.wishlistItem.findMany.mockResolvedValue([]);
      prisma.returnRequest.findMany.mockResolvedValue([]);
    });

    it('strips passwordHash and googleId from the profile', async () => {
      const result = await service.exportData('user-1', 'jan@example.com');

      expect(result.profile).not.toHaveProperty('passwordHash');
      expect(result.profile).not.toHaveProperty('googleId');
    });

    it('includes addresses nested in the profile', async () => {
      const result = await service.exportData('user-1', 'jan@example.com');

      expect((result.profile as any).addresses).toHaveLength(1);
      expect((result.profile as any).addresses[0]).toMatchObject({ id: 'addr-1' });
    });

    it('queries return requests by email, not userId', async () => {
      await service.exportData('user-1', 'jan@example.com');

      expect(prisma.returnRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'jan@example.com' } }),
      );
    });

    it('queries orders by userId', async () => {
      await service.exportData('user-1', 'jan@example.com');

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });

    it('returns all five collections and a valid ISO exportedAt timestamp', async () => {
      prisma.order.findMany.mockResolvedValue([{ orderNumber: 'ORD-001', status: 'PAID', items: [] }]);
      prisma.review.findMany.mockResolvedValue([{ rating: 5, title: 'Great', product: { name: 'Oud', slug: 'oud' } }]);
      prisma.wishlistItem.findMany.mockResolvedValue([{ addedAt: new Date(), notifyOnRestock: false, product: { name: 'Rose', slug: 'rose' } }]);
      prisma.returnRequest.findMany.mockResolvedValue([{ orderNumber: 'ORD-001', type: 'WITHDRAWAL', status: 'PENDING' }]);

      const result = await service.exportData('user-1', 'jan@example.com');

      expect(result.orders).toHaveLength(1);
      expect(result.reviews).toHaveLength(1);
      expect(result.wishlist).toHaveLength(1);
      expect(result.returnRequests).toHaveLength(1);
      expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns empty collections when user has no associated data', async () => {
      const result = await service.exportData('user-1', 'jan@example.com');

      expect(result.orders).toEqual([]);
      expect(result.reviews).toEqual([]);
      expect(result.wishlist).toEqual([]);
      expect(result.returnRequests).toEqual([]);
    });
  });

  // ─── deleteAccount ──────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    beforeEach(() => {
      // New: findUnique is called before the transaction to get the email
      // for matching ReturnRequest records (no FK to User by design).
      prisma.user.findUnique.mockResolvedValue({ email: 'jan@example.com' });
      prisma.$transaction.mockResolvedValue([{ count: 2 }, { count: 1 }, mockUser]);
      prisma.order.updateMany.mockReturnValue({});
      prisma.returnRequest.updateMany.mockReturnValue({});
      prisma.user.delete.mockReturnValue({});
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteAccount('ghost-id')).rejects.toThrow(NotFoundException);
    });

    it('does not call $transaction when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteAccount('ghost-id')).rejects.toThrow(NotFoundException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('runs order anonymisation, returnRequest scrubbing, and user delete in a single transaction', async () => {
      await service.deleteAccount('user-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Transaction now has three operations: order.updateMany, returnRequest.updateMany, user.delete
      const [ops] = prisma.$transaction.mock.calls[0];
      expect(ops).toHaveLength(3);
    });

    it('anonymises order snapshot PII with GDPR-compliant placeholder values', async () => {
      await service.deleteAccount('user-1');

      const [[call]] = prisma.order.updateMany.mock.calls;
      expect(call).toMatchObject({
        where: { userId: 'user-1' },
        data: expect.objectContaining({
          snapshotFirstName:  '[usunięto]',
          snapshotLastName:   '[usunięto]',
          snapshotPhone:      '',
          snapshotNip:        null,
          snapshotStreet:     '[usunięto]',
          snapshotCity:       '[usunięto]',
          snapshotPostalCode: '[usunięto]',
        }),
      });
      // snapshotEmail must be an unguessable UUID-suffixed value, never the static sentinel
      expect(call.data.snapshotEmail).toMatch(/^deleted\+[0-9a-f-]{36}@deleted\.invalid$/);
      expect(call.data.snapshotEmail).not.toBe('deleted@deleted');
    });

    // ── GDPR Art. 17 — address PII erasure (snapshotStreet/City/PostalCode) ──
    // These three fields were previously omitted from the erasure payload,
    // leaving a full street address in the order row after an Art. 17 request.
    // Combined with postalCode + city they uniquely identify a natural person.

    describe('address PII erasure', () => {
      it('erases snapshotStreet with the GDPR placeholder string', async () => {
        await service.deleteAccount('user-1');

        const [[call]] = prisma.order.updateMany.mock.calls;
        expect(call.data.snapshotStreet).toBe('[usunięto]');
      });

      it('erases snapshotCity with the GDPR placeholder string', async () => {
        await service.deleteAccount('user-1');

        const [[call]] = prisma.order.updateMany.mock.calls;
        expect(call.data.snapshotCity).toBe('[usunięto]');
      });

      it('erases snapshotPostalCode with the GDPR placeholder string', async () => {
        await service.deleteAccount('user-1');

        const [[call]] = prisma.order.updateMany.mock.calls;
        expect(call.data.snapshotPostalCode).toBe('[usunięto]');
      });

      it('erases all three address fields in the same updateMany call — no partial erasure', async () => {
        await service.deleteAccount('user-1');

        const [[call]] = prisma.order.updateMany.mock.calls;
        expect(call.data).toMatchObject({
          snapshotStreet:     '[usunięto]',
          snapshotCity:       '[usunięto]',
          snapshotPostalCode: '[usunięto]',
        });
      });
    });

    it('generates a unique snapshotEmail sentinel on each deleteAccount call — prevents order enumeration', async () => {
      const sentinels: string[] = [];

      for (let i = 0; i < 3; i++) {
        jest.clearAllMocks();
        prisma.user.findUnique.mockResolvedValue({ email: `user${i}@example.com` });
        prisma.payment.findMany.mockResolvedValue([]);
        prisma.$transaction.mockResolvedValue(undefined);
        prisma.order.updateMany.mockReturnValue({});
        prisma.returnRequest.updateMany.mockReturnValue({});
        prisma.user.delete.mockReturnValue({});

        await service.deleteAccount(`user-id-${i}`);

        const [[call]] = prisma.order.updateMany.mock.calls;
        sentinels.push(call.data.snapshotEmail);
      }

      expect(new Set(sentinels).size).toBe(3);
    });

    // ── GDPR Art. 17 — ReturnRequest PII scrubbing ───────────────────────────
    // ReturnRequest has no FK to User (by design, so returns survive account
    // deletion). PII must be scrubbed by matching on email, which is the only
    // persistent link after the user row is deleted.

    it('scrubs ReturnRequest PII using the user email as the match key', async () => {
      await service.deleteAccount('user-1');

      expect(prisma.returnRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'jan@example.com' },
          data: expect.objectContaining({
            firstName:   '[usunięto]',
            lastName:    '[usunięto]',
            email:       'deleted@deleted',
            phone:       null,
            bankAccount: null,
          }),
        }),
      );
    });

    it('nullifies phone and bankAccount (IBAN) in ReturnRequest — not empty string', async () => {
      await service.deleteAccount('user-1');

      const callArg = prisma.returnRequest.updateMany.mock.calls[0][0];
      expect(callArg.data.phone).toBeNull();
      expect(callArg.data.bankAccount).toBeNull();
    });

    it('hard-deletes the user row with the correct id', async () => {
      await service.deleteAccount('user-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('resolves without returning a value', async () => {
      const result = await service.deleteAccount('user-1');

      expect(result).toBeUndefined();
    });

    // ── GDPR Art. 17(3)(b) — open-dispute guard ─────────────────────────────
    // Erasure must be blocked while a chargeback is open because the anonymised
    // PII (name, address, delivery evidence) cannot be submitted to Stripe.

    describe('dispute guard', () => {
      it('throws ConflictException when a payment has a needs_response dispute', async () => {
        prisma.payment.findMany.mockResolvedValue([{ stripePaymentIntentId: 'pi_1' }]);
        mockStripe.listDisputesByPaymentIntent.mockResolvedValue([{ status: 'needs_response' }]);

        await expect(service.deleteAccount('user-1')).rejects.toThrow(ConflictException);
      });

      it('does not run the anonymisation transaction when a dispute blocks erasure', async () => {
        prisma.payment.findMany.mockResolvedValue([{ stripePaymentIntentId: 'pi_1' }]);
        mockStripe.listDisputesByPaymentIntent.mockResolvedValue([{ status: 'needs_response' }]);

        await expect(service.deleteAccount('user-1')).rejects.toThrow(ConflictException);

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('proceeds when a dispute exists but its status is not needs_response', async () => {
        prisma.payment.findMany.mockResolvedValue([{ stripePaymentIntentId: 'pi_1' }]);
        mockStripe.listDisputesByPaymentIntent.mockResolvedValue([{ status: 'under_review' }]);

        await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();
      });

      it('proceeds without calling Stripe when the user has no payments', async () => {
        prisma.payment.findMany.mockResolvedValue([]);

        await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();

        expect(mockStripe.listDisputesByPaymentIntent).not.toHaveBeenCalled();
      });

      it('proceeds when disputes list is empty for the payment intent', async () => {
        prisma.payment.findMany.mockResolvedValue([{ stripePaymentIntentId: 'pi_1' }]);
        mockStripe.listDisputesByPaymentIntent.mockResolvedValue([]);

        await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();
      });

      it('skips payments where stripePaymentIntentId is null without calling Stripe', async () => {
        prisma.payment.findMany.mockResolvedValue([{ stripePaymentIntentId: null }]);

        await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();

        expect(mockStripe.listDisputesByPaymentIntent).not.toHaveBeenCalled();
      });

      it('throws ConflictException when a later payment in the list has an open dispute', async () => {
        prisma.payment.findMany.mockResolvedValue([
          { stripePaymentIntentId: 'pi_1' },
          { stripePaymentIntentId: 'pi_2' },
        ]);
        mockStripe.listDisputesByPaymentIntent
          .mockResolvedValueOnce([])                             // pi_1: no disputes
          .mockResolvedValueOnce([{ status: 'needs_response' }]); // pi_2: open dispute

        await expect(service.deleteAccount('user-1')).rejects.toThrow(ConflictException);
      });
    });
  });

  // ─── deleteAddress — ownership guard + atomic default re-promotion ──────
  // delete + re-promotion used to be findFirst → delete → findFirst → update as
  // four unguarded sequential statements — a concurrent updateAddress promoting a
  // different address could be silently overwritten. Fixed via a transaction
  // wrapping the delete plus a single $executeRaw UPDATE, guarded by NOT EXISTS so
  // it's a no-op if some other request already set a default in the meantime.

  describe('deleteAddress', () => {
    const buildDeleteTx = () => ({
      address: { delete: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    });

    it('throws NotFoundException when address does not belong to the user', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.deleteAddress('user-1', 'addr-99')).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deletes the address inside a transaction', async () => {
      const addr = { id: 'addr-1', userId: 'user-1', isDefault: false };
      prisma.address.findFirst.mockResolvedValue(addr);
      const tx = buildDeleteTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.deleteAddress('user-1', 'addr-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.address.delete).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
    });

    it('skips the re-promotion UPDATE when the deleted address was not the default', async () => {
      const addr = { id: 'addr-1', userId: 'user-1', isDefault: false };
      prisma.address.findFirst.mockResolvedValue(addr);
      const tx = buildDeleteTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.deleteAddress('user-1', 'addr-1');

      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('runs a single atomic re-promotion UPDATE for the user when the deleted address was default', async () => {
      const addr = { id: 'addr-1', userId: 'user-1', isDefault: true };
      prisma.address.findFirst.mockResolvedValue(addr);
      const tx = buildDeleteTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.deleteAddress('user-1', 'addr-1');

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      // Tagged template literals are called as (templateStrings, ...values).
      const interpolated = tx.$executeRaw.mock.calls[0].slice(1);
      expect(interpolated).toEqual(['user-1', 'user-1', 'user-1']);
    });

    it('runs the delete and the re-promotion UPDATE inside the same transaction', async () => {
      const addr = { id: 'addr-1', userId: 'user-1', isDefault: true };
      prisma.address.findFirst.mockResolvedValue(addr);
      const tx = buildDeleteTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.deleteAddress('user-1', 'addr-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.address.delete).toHaveBeenCalledTimes(1);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('never calls the old findFirst-then-update re-promotion pair', async () => {
      const addr = { id: 'addr-1', userId: 'user-1', isDefault: true };
      prisma.address.findFirst.mockResolvedValue(addr); // ownership check only
      const tx = buildDeleteTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.deleteAddress('user-1', 'addr-1');

      expect(prisma.address.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.address.update).not.toHaveBeenCalled();
    });
  });

  // ─── createAddress / updateAddress — atomic default-flag promotion ─────
  // Demote-then-promote as two separate Prisma calls is not atomic: concurrent
  // requests promoting different addresses could interleave and leave two (or
  // zero) addresses isDefault=true. Fixed via a single $executeRaw UPDATE
  // inside a $transaction, backed by the addresses_one_default_per_user
  // partial unique index (migration 20260619120000).

  describe('createAddress', () => {
    const validDto = {
      firstName: 'Jan',
      lastName: 'Kowalski',
      street: 'Długa 1',
      city: 'Poznań',
      postalCode: '60-001',
      country: 'PL',
      phone: '+48111222333',
    };

    const buildAddressTx = () => ({
      address: {
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    });

    it('creates a non-default address directly, without a transaction', async () => {
      const data = { ...validDto, isDefault: false };
      prisma.address.create.mockResolvedValue({ id: 'addr-1', userId: 'user-1', ...data });

      const result = await service.createAddress('user-1', data);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.address.create).toHaveBeenCalledWith({
        data: { ...data, user: { connect: { id: 'user-1' } } },
      });
      expect(result).toMatchObject({ id: 'addr-1' });
    });

    it('never inserts the new row as isDefault=true directly — INSERT is forced to false', async () => {
      // Regression guard: a single-row INSERT with isDefault=true would collide
      // immediately with the partial unique index whenever another default
      // address already exists for this user (multi-row UPDATEs get Postgres's
      // end-of-statement deferred uniqueness check; a lone INSERT does not).
      const data = { ...validDto, isDefault: true };
      const tx = buildAddressTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      tx.address.create.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: false });
      tx.address.findUniqueOrThrow.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: true });

      await service.createAddress('user-1', data);

      expect(tx.address.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isDefault: false }),
      });
    });

    it('promotes the new address and demotes all others in a single atomic statement', async () => {
      const data = { ...validDto, isDefault: true };
      const tx = buildAddressTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      tx.address.create.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: false });
      tx.address.findUniqueOrThrow.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: true });

      const result = await service.createAddress('user-1', data);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      // Tagged template literals are called as (templateStrings, ...values).
      const interpolated = tx.$executeRaw.mock.calls[0].slice(1);
      expect(interpolated).toEqual(['addr-2', 'user-1']);
      expect(tx.address.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'addr-2' } });
      expect(result).toMatchObject({ id: 'addr-2', isDefault: true });
    });

    it('never calls the old demote-then-promote updateMany — only the atomic UPDATE is used', async () => {
      const data = { ...validDto, isDefault: true };
      const tx = buildAddressTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      tx.address.create.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: false });
      tx.address.findUniqueOrThrow.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: true });

      await service.createAddress('user-1', data);

      expect(prisma.address.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('updateAddress', () => {
    const buildAddressTx = () => ({
      address: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    });

    it('throws NotFoundException when the address does not belong to the user', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAddress('user-1', 'addr-1', { city: 'Kraków' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates fields directly without a transaction when isDefault is not set', async () => {
      prisma.address.findFirst.mockResolvedValue({ id: 'addr-1', userId: 'user-1', isDefault: false });
      prisma.address.update.mockResolvedValue({ id: 'addr-1', city: 'Kraków' });

      const result = await service.updateAddress('user-1', 'addr-1', { city: 'Kraków' });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
        data: { city: 'Kraków' },
      });
      expect(result).toEqual({ id: 'addr-1', city: 'Kraków' });
    });

    it('atomically promotes the target address and demotes all others when isDefault: true', async () => {
      prisma.address.findFirst.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: false });
      const tx = buildAddressTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      tx.address.findUniqueOrThrow.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: true });

      const result = await service.updateAddress('user-1', 'addr-2', { isDefault: true });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const interpolated = tx.$executeRaw.mock.calls[0].slice(1);
      expect(interpolated).toEqual(['addr-2', 'user-1']);
      expect(tx.address.update).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'addr-2', userId: 'user-1', isDefault: true });
    });

    it('updates other fields after the atomic flip, stripping isDefault from the second update', async () => {
      prisma.address.findFirst.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: false });
      const tx = buildAddressTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      tx.address.update.mockResolvedValue({ id: 'addr-2', isDefault: true, city: 'Gdańsk' });
      tx.address.findUniqueOrThrow.mockResolvedValue({ id: 'addr-2', isDefault: true, city: 'Gdańsk' });

      await service.updateAddress('user-1', 'addr-2', { isDefault: true, city: 'Gdańsk' });

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.address.update).toHaveBeenCalledWith({
        where: { id: 'addr-2' },
        data: { city: 'Gdańsk' },
      });
      const updateCallData = tx.address.update.mock.calls[0][0].data;
      expect(updateCallData).not.toHaveProperty('isDefault');
    });

    it('never calls the old demote-then-promote updateMany — only the atomic UPDATE is used', async () => {
      prisma.address.findFirst.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: false });
      const tx = buildAddressTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      tx.address.findUniqueOrThrow.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: true });

      await service.updateAddress('user-1', 'addr-2', { isDefault: true });

      expect(prisma.address.updateMany).not.toHaveBeenCalled();
    });

    it('targets only the requested address id per call, so sequential promotions never leave two defaults', async () => {
      // Each call's atomic UPDATE sets isDefault = (id = thisAddressId) for the
      // whole user in one statement — there is no separate demote step that a
      // second concurrent request could interleave with.
      prisma.address.findFirst.mockResolvedValueOnce({ id: 'addr-2', userId: 'user-1', isDefault: false });
      const tx1 = buildAddressTx();
      tx1.address.findUniqueOrThrow.mockResolvedValue({ id: 'addr-2', userId: 'user-1', isDefault: true });
      prisma.$transaction.mockImplementationOnce((fn: any) => fn(tx1));
      await service.updateAddress('user-1', 'addr-2', { isDefault: true });

      prisma.address.findFirst.mockResolvedValueOnce({ id: 'addr-3', userId: 'user-1', isDefault: false });
      const tx2 = buildAddressTx();
      tx2.address.findUniqueOrThrow.mockResolvedValue({ id: 'addr-3', userId: 'user-1', isDefault: true });
      prisma.$transaction.mockImplementationOnce((fn: any) => fn(tx2));
      await service.updateAddress('user-1', 'addr-3', { isDefault: true });

      expect(tx1.$executeRaw.mock.calls[0].slice(1)).toEqual(['addr-2', 'user-1']);
      expect(tx2.$executeRaw.mock.calls[0].slice(1)).toEqual(['addr-3', 'user-1']);
    });
  });

  // ─── update — marketingConsentAt timestamp (GDPR Art. 7(1) proof of consent) ──

  describe('update', () => {
    it('sets marketingConsentAt when marketingConsent: true is included in the payload', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1', marketingConsent: true });

      await service.update('user-1', { marketingConsent: true });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { marketingConsent: true, marketingConsentAt: expect.any(Date) },
      });
    });

    it('sets marketingConsentAt when marketingConsent: false is included in the payload', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1', marketingConsent: false });

      await service.update('user-1', { marketingConsent: false });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { marketingConsent: false, marketingConsentAt: expect.any(Date) },
      });
    });

    it('does not set marketingConsentAt when marketingConsent is absent from the payload', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1', firstName: 'Jan' });

      await service.update('user-1', { firstName: 'Jan' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstName: 'Jan' },
      });
    });
  });

  describe('recordConsent', () => {
    it('updates analyticsConsent and analyticsConsentAt for the given user', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1', analyticsConsent: true });

      await service.recordConsent('user-1', true);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          analyticsConsent: true,
          analyticsConsentAt: expect.any(Date),
        },
      });
    });

    it('stores analyticsConsent: false when user rejects non-essential cookies', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1', analyticsConsent: false });

      await service.recordConsent('user-1', false);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ analyticsConsent: false }),
        }),
      );
    });
  });

  describe('recordAnonymousConsent', () => {
    const CONSENT_UUID = 'a1b2c3d4-0000-0000-0000-000000000099';

    it('creates a ConsentLog entry with the provided consent UUID and analytics: true', async () => {
      prisma.consentLog.create.mockResolvedValue({ id: 'log-1' });

      await service.recordAnonymousConsent(CONSENT_UUID, true);

      expect(prisma.consentLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ consentId: CONSENT_UUID, analytics: true }),
        }),
      );
    });

    it('creates a ConsentLog entry with analytics: false when visitor rejects', async () => {
      prisma.consentLog.create.mockResolvedValue({ id: 'log-2' });

      await service.recordAnonymousConsent(CONSENT_UUID, false);

      expect(prisma.consentLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ consentId: CONSENT_UUID, analytics: false }),
        }),
      );
    });

    it('sets expiresAt approximately 5 years in the future', async () => {
      prisma.consentLog.create.mockResolvedValue({ id: 'log-3' });

      await service.recordAnonymousConsent(CONSENT_UUID, true);

      const { expiresAt } = prisma.consentLog.create.mock.calls[0][0].data as { expiresAt: Date };
      // setFullYear adds 5 calendar years (may include leap days) — allow ±2 days tolerance
      const now = Date.now();
      const fiveYearsMinMs = 5 * 365 * 24 * 60 * 60 * 1000 - 2 * 86400 * 1000;
      const fiveYearsMaxMs = 5 * 366 * 24 * 60 * 60 * 1000 + 2 * 86400 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(now + fiveYearsMinMs);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(now + fiveYearsMaxMs);
    });
  });
});


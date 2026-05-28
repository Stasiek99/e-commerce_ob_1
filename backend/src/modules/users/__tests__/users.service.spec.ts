import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from '../users.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockUser = {
  id: 'user-1',
  email: 'jan@example.com',
  firstName: 'Jan',
  lastName: 'Kowalski',
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
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
            review: {
              findMany: jest.fn(),
            },
            wishlistItem: {
              findMany: jest.fn(),
            },
            returnRequest: {
              findMany: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
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
    it('runs order anonymisation and user hard-delete in a single transaction', async () => {
      prisma.$transaction.mockResolvedValue([{ count: 2 }, mockUser]);

      await service.deleteAccount('user-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Verify the two Prisma calls that were passed to the transaction
      const [ops] = prisma.$transaction.mock.calls[0];
      expect(ops).toHaveLength(2);
    });

    it('anonymises order snapshot PII with GDPR-compliant placeholder values', async () => {
      prisma.$transaction.mockResolvedValue([{ count: 1 }, mockUser]);
      prisma.order.updateMany.mockReturnValue({});
      prisma.user.delete.mockReturnValue({});

      await service.deleteAccount('user-1');

      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: expect.objectContaining({
            snapshotFirstName: '[usunięto]',
            snapshotLastName: '[usunięto]',
            snapshotEmail: 'deleted@deleted',
            snapshotPhone: '',
            snapshotNip: null,
          }),
        }),
      );
    });

    it('hard-deletes the user row with the correct id', async () => {
      prisma.$transaction.mockResolvedValue([{ count: 0 }, mockUser]);
      prisma.order.updateMany.mockReturnValue({});
      prisma.user.delete.mockReturnValue({});

      await service.deleteAccount('user-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('resolves without returning a value', async () => {
      prisma.$transaction.mockResolvedValue([{ count: 0 }, mockUser]);

      const result = await service.deleteAccount('user-1');

      expect(result).toBeUndefined();
    });
  });

  // ─── deleteAddress — ownership guard ────────────────────────────────────

  describe('deleteAddress', () => {
    it('throws NotFoundException when address does not belong to the user', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.deleteAddress('user-1', 'addr-99')).rejects.toThrow(NotFoundException);
    });

    it('deletes only when the address belongs to the requesting user', async () => {
      const addr = { id: 'addr-1', userId: 'user-1' };
      prisma.address.findFirst.mockResolvedValue(addr);
      prisma.address.delete.mockResolvedValue(addr);

      await service.deleteAddress('user-1', 'addr-1');

      expect(prisma.address.delete).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
    });
  });
});

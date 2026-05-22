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

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from '../categories.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: any;

  const mockCategory = { id: 'cat-1', name: 'Perfumy', slug: 'perfumy', parentId: null };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: PrismaService,
          useValue: {
            category: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            product: {
              count: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(CategoriesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── remove — pre-checks against FK violation ─────────────────────────────
  // Invariant: remove() must check for assigned products and child categories
  // before calling prisma.category.delete. Without the pre-check Postgres
  // throws a FK violation (P2003) which NestJS surfaces as a 500, not a 409.

  describe('remove — FK pre-check', () => {
    it('throws NotFoundException when category does not exist', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.remove('cat-missing')).rejects.toThrow(NotFoundException);
    });

    it('does not call product.count or delete when category is not found', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await service.remove('cat-missing').catch(() => undefined);

      expect(prisma.product.count).not.toHaveBeenCalled();
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when category has 1 assigned product', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(1);
      prisma.category.count.mockResolvedValue(0);

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
    });

    it('includes the product count in the ConflictException message', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(3);
      prisma.category.count.mockResolvedValue(0);

      await expect(service.remove('cat-1')).rejects.toThrow('3');
    });

    it('throws ConflictException when category has multiple assigned products', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(7);
      prisma.category.count.mockResolvedValue(0);

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when category has 1 child category', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(1);

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
    });

    it('includes the child count in the ConflictException message', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(2);

      await expect(service.remove('cat-1')).rejects.toThrow('2');
    });

    it('product check fires before child check when both are non-zero', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(2);
      prisma.category.count.mockResolvedValue(3);

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('does not call delete when products are assigned', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(1);
      prisma.category.count.mockResolvedValue(0);

      await service.remove('cat-1').catch(() => undefined);

      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('does not call delete when child categories exist', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(1);

      await service.remove('cat-1').catch(() => undefined);

      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('calls delete when category has no products and no children (happy path)', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(0);
      prisma.category.delete.mockResolvedValue(mockCategory);

      const result = await service.remove('cat-1');

      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'cat-1' } });
      expect(result).toEqual(mockCategory);
    });

    it('scopes product.count to the target category id', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(0);
      prisma.category.delete.mockResolvedValue(mockCategory);

      await service.remove('cat-1');

      expect(prisma.product.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { categoryId: 'cat-1' } }),
      );
    });

    it('scopes category.count child check to the target category id as parentId', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(0);
      prisma.category.delete.mockResolvedValue(mockCategory);

      await service.remove('cat-1');

      expect(prisma.category.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parentId: 'cat-1' } }),
      );
    });

    it('runs product.count and category.count in parallel (both called per remove)', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(0);
      prisma.category.delete.mockResolvedValue(mockCategory);

      await service.remove('cat-1');

      expect(prisma.product.count).toHaveBeenCalledTimes(1);
      expect(prisma.category.count).toHaveBeenCalledTimes(1);
    });
  });
});

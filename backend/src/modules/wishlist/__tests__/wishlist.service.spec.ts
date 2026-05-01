import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WishlistService } from '../wishlist.service';
import { PrismaService } from '../../prisma/prisma.service';

const makeProduct = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 'product-1',
  name: 'Test Perfume',
  slug: 'test-perfume',
  brand: 'Maison',
  images: [{ url: 'https://cdn.example.com/img.jpg' }],
  variants: [
    { id: 'var-1', label: '50ml', priceInCents: 9900, stock: 10 },
  ],
  ...overrides,
});

const makeWishlistRow = (productOverrides = {}, notifyOnRestock = false) => ({
  product: makeProduct(productOverrides),
  notifyOnRestock,
});

describe('WishlistService', () => {
  let service: WishlistService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistService,
        {
          provide: PrismaService,
          useValue: {
            wishlistItem: {
              findMany: jest.fn(),
              upsert: jest.fn(),
              deleteMany: jest.fn(),
              updateMany: jest.fn(),
              createMany: jest.fn(),
            },
            product: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(WishlistService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getItems ────────────────────────────────────────────────────────────

  describe('getItems', () => {
    it('returns mapped items with notifyOnRestock flag', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        makeWishlistRow({}, true),
        makeWishlistRow({ id: 'product-2', name: 'Body Wash', slug: 'body-wash' }, false),
      ]);

      const result = await service.getItems('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'product-1',
        name: 'Test Perfume',
        notifyOnRestock: true,
      });
      expect(result[1].notifyOnRestock).toBe(false);
    });

    it('queries with take:200 and orders by addedAt desc', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);

      await service.getItems('user-1');

      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 200,
          orderBy: { addedAt: 'desc' },
        }),
      );
    });

    it('filters images to primary only', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);

      await service.getItems('user-1');

      const call = prisma.wishlistItem.findMany.mock.calls[0][0];
      expect(call.include.product.include.images.where).toEqual({ isPrimary: true });
      expect(call.include.product.include.images.take).toBe(1);
    });

    it('returns empty array when user has no wishlist items', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);

      const result = await service.getItems('user-1');

      expect(result).toEqual([]);
    });

    it('includes only active variants ordered by price asc', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);

      await service.getItems('user-1');

      const call = prisma.wishlistItem.findMany.mock.calls[0][0];
      expect(call.include.product.include.variants.where).toEqual({ isActive: true });
      expect(call.include.product.include.variants.orderBy).toEqual({ priceInCents: 'asc' });
    });

    it('maps images to { url } shape only', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([makeWishlistRow()]);

      const [item] = await service.getItems('user-1');

      expect(item.images).toEqual([{ url: 'https://cdn.example.com/img.jpg' }]);
      expect(Object.keys(item.images[0])).toEqual(['url']);
    });
  });

  // ─── addItem ─────────────────────────────────────────────────────────────

  describe('addItem', () => {
    it('throws NotFoundException when product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.addItem('user-1', 'product-999')).rejects.toThrow(NotFoundException);
    });

    it('upserts the wishlist item when product exists', async () => {
      prisma.product.findUnique.mockResolvedValue(makeProduct());
      prisma.wishlistItem.upsert.mockResolvedValue({});

      await service.addItem('user-1', 'product-1');

      expect(prisma.wishlistItem.upsert).toHaveBeenCalledWith({
        where: { userId_productId: { userId: 'user-1', productId: 'product-1' } },
        create: { userId: 'user-1', productId: 'product-1' },
        update: {},
      });
    });

    it('is idempotent — upsert with empty update does not throw on duplicate', async () => {
      prisma.product.findUnique.mockResolvedValue(makeProduct());
      prisma.wishlistItem.upsert.mockResolvedValue({});

      await service.addItem('user-1', 'product-1');
      await service.addItem('user-1', 'product-1');

      expect(prisma.wishlistItem.upsert).toHaveBeenCalledTimes(2);
    });
  });

  // ─── removeItem ──────────────────────────────────────────────────────────

  describe('removeItem', () => {
    it('calls deleteMany with correct userId + productId filter', async () => {
      prisma.wishlistItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeItem('user-1', 'product-1');

      expect(prisma.wishlistItem.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', productId: 'product-1' },
      });
    });

    it('does not throw when item does not exist (deleteMany is idempotent)', async () => {
      prisma.wishlistItem.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeItem('user-1', 'product-999')).resolves.not.toThrow();
    });
  });

  // ─── setNotify ───────────────────────────────────────────────────────────

  describe('setNotify', () => {
    it('enables notify flag', async () => {
      prisma.wishlistItem.updateMany.mockResolvedValue({ count: 1 });

      await service.setNotify('user-1', 'product-1', true);

      expect(prisma.wishlistItem.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', productId: 'product-1' },
        data: { notifyOnRestock: true },
      });
    });

    it('disables notify flag', async () => {
      prisma.wishlistItem.updateMany.mockResolvedValue({ count: 1 });

      await service.setNotify('user-1', 'product-1', false);

      expect(prisma.wishlistItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { notifyOnRestock: false } }),
      );
    });

    it('does not throw when item does not exist (updateMany is a no-op)', async () => {
      prisma.wishlistItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.setNotify('user-1', 'nonexistent', true)).resolves.not.toThrow();
    });
  });

  // ─── mergeGuestItems ─────────────────────────────────────────────────────

  describe('mergeGuestItems', () => {
    it('does nothing when productIds array is empty', async () => {
      await service.mergeGuestItems('user-1', []);

      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.wishlistItem.createMany).not.toHaveBeenCalled();
    });

    it('does nothing when none of the provided products are active', async () => {
      prisma.product.findMany.mockResolvedValue([]);

      await service.mergeGuestItems('user-1', ['product-inactive']);

      expect(prisma.wishlistItem.createMany).not.toHaveBeenCalled();
    });

    it('filters to only active products before inserting', async () => {
      prisma.product.findMany.mockResolvedValue([{ id: 'product-1' }]);
      prisma.wishlistItem.createMany.mockResolvedValue({ count: 1 });

      await service.mergeGuestItems('user-1', ['product-1', 'product-deleted']);

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['product-1', 'product-deleted'] }, isActive: true },
        select: { id: true },
      });
    });

    it('bulk-inserts with skipDuplicates', async () => {
      prisma.product.findMany.mockResolvedValue([{ id: 'product-1' }, { id: 'product-2' }]);
      prisma.wishlistItem.createMany.mockResolvedValue({ count: 2 });

      await service.mergeGuestItems('user-1', ['product-1', 'product-2']);

      expect(prisma.wishlistItem.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'user-1', productId: 'product-1' },
          { userId: 'user-1', productId: 'product-2' },
        ],
        skipDuplicates: true,
      });
    });

    it('handles 100-item merge without errors (boundary)', async () => {
      const ids = Array.from({ length: 100 }, (_, i) => `product-${i}`);
      prisma.product.findMany.mockResolvedValue(ids.map((id) => ({ id })));
      prisma.wishlistItem.createMany.mockResolvedValue({ count: 100 });

      await expect(service.mergeGuestItems('user-1', ids)).resolves.not.toThrow();

      expect(prisma.wishlistItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([{ userId: 'user-1', productId: 'product-0' }]) }),
      );
    });
  });
});

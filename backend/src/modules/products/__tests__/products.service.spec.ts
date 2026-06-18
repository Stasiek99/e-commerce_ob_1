import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { StorageService } from '../../storage/storage.service';
import { ConfigService } from '@nestjs/config';

// Prevent real Redis connections spawned in onModuleInit
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    incr: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  })),
);

const PRODUCT_ID = 'prod-uuid-1';
const CATEGORY_ID = 'cat-uuid-1';

const mockProduct = {
  id: PRODUCT_ID,
  name: 'Rose Oud',
  slug: 'rose-oud',
  description: null,
  shortDescription: null,
  brand: 'TestBrand',
  status: 'ACTIVE',
  estimatedRestockDate: null,
  isActive: true,
  isFeatured: false,
  scentFamily: null,
  notes: [],
  pyramidTop: null,
  pyramidHeart: null,
  pyramidBase: null,
  gender: null,
  catalogNumber: null,
  line: null,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  reviewCount: 0,
  avgRating: null,
  sdsUrl: null,
  allergens: null,
  ingredients: null,
  warnings: null,
  paoMonths: null,
  variants: [],
  images: [],
  category: { id: CATEGORY_ID, name: 'Perfumes', slug: 'perfumes' },
};

const makeP2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`slug`)', {
    code: 'P2002',
    clientVersion: '6.0.0',
    meta: { target: ['slug'] },
  });

describe('ProductsService — slug P2002 conflict handling', () => {
  let service: ProductsService;

  const mockPrisma = {
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    productVariant: { updateMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    productVariantPriceHistory: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    wishlistItem: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const mockRedis = {
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    incr: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    publish: jest.fn().mockResolvedValue(0),
  };

  const mockSseSubscriber = {
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: { queueOrderConfirmation: jest.fn(), sendBackInStock: jest.fn().mockResolvedValue(undefined) } },
        { provide: StorageService, useValue: { delete: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('redis://localhost:6379') },
        },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: 'STOCK_SSE_REDIS_SUBSCRIBER', useValue: mockSseSubscriber },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    jest.clearAllMocks();
    mockRedis.incr.mockResolvedValue(1);
  });

  // --- create() ---

  describe('create()', () => {
    const createData = { name: 'Rose Oud', slug: 'rose-oud', categoryId: CATEGORY_ID };

    it('throws ConflictException when Prisma raises P2002 on slug', async () => {
      mockPrisma.product.create.mockRejectedValue(makeP2002());

      await expect(service.create(createData)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException with message "Slug already in use" for P2002', async () => {
      mockPrisma.product.create.mockRejectedValue(makeP2002());

      await expect(service.create(createData)).rejects.toThrow('Slug already in use');
    });

    it('re-throws non-P2002 Prisma errors without wrapping', async () => {
      const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.0.0',
      });
      mockPrisma.product.create.mockRejectedValue(p2025);

      await expect(service.create(createData)).rejects.toThrow(p2025);
    });

    it('re-throws plain errors without wrapping', async () => {
      const dbError = new Error('Connection lost');
      mockPrisma.product.create.mockRejectedValue(dbError);

      await expect(service.create(createData)).rejects.toThrow('Connection lost');
    });

    it('returns the created product when slug is unique', async () => {
      mockPrisma.product.create.mockResolvedValue(mockProduct);

      const result = await service.create(createData);

      expect(result).toMatchObject({ id: PRODUCT_ID, slug: 'rose-oud' });
      expect(mockPrisma.product.create).toHaveBeenCalledTimes(1);
    });
  });

  // --- update() ---

  describe('update()', () => {
    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(service.update(PRODUCT_ID, { slug: 'new-slug' })).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when Prisma raises P2002 on slug update', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ id: PRODUCT_ID });
      mockPrisma.product.update.mockRejectedValue(makeP2002());

      await expect(service.update(PRODUCT_ID, { slug: 'taken-slug' })).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException with message "Slug already in use" on P2002 update', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ id: PRODUCT_ID });
      mockPrisma.product.update.mockRejectedValue(makeP2002());

      await expect(service.update(PRODUCT_ID, { slug: 'taken-slug' })).rejects.toThrow('Slug already in use');
    });

    it('re-throws non-P2002 errors without wrapping on update', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ id: PRODUCT_ID });
      const dbError = new Error('Database connection lost');
      mockPrisma.product.update.mockRejectedValue(dbError);

      await expect(service.update(PRODUCT_ID, { slug: 'new-slug' })).rejects.toThrow('Database connection lost');
    });

    it('returns the updated product when slug is unique', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ id: PRODUCT_ID });
      const updated = { ...mockProduct, slug: 'new-slug' };
      mockPrisma.product.update.mockResolvedValue(updated);

      const result = await service.update(PRODUCT_ID, { slug: 'new-slug' });

      expect(result).toMatchObject({ id: PRODUCT_ID, slug: 'new-slug' });
      expect(mockPrisma.product.update).toHaveBeenCalledTimes(1);
    });
  });

  // --- notifyStockChange() / notifyStockChangesByDelta() ---
  // FIX: real stock mutations from orders/payments (checkout decrements,
  // cancellation/payment-failure/dispute restores) previously never published
  // to the stock:updates SSE channel or triggered the back-in-stock notifier —
  // only the admin manual stock-edit endpoint did. These two methods are now
  // the single choke point every mutation site outside this service must call.

  const VARIANT_ID = 'pv-uuid-1';

  describe('notifyStockChange()', () => {
    it('publishes the new stock to the stock:updates Redis channel', () => {
      service.notifyStockChange({
        variantId: VARIANT_ID,
        productId: PRODUCT_ID,
        variantLabel: '100ml',
        previousStock: 5,
        newStock: 3,
      });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'stock:updates',
        JSON.stringify({ id: VARIANT_ID, stock: 3 }),
      );
    });

    it('fires the back-in-stock notifier when stock crosses 0 -> >0', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        { id: 'wi-1', user: { email: 'fan@example.com', firstName: 'Ola' }, product: { name: 'Rose Oud', slug: 'rose-oud' } },
      ]);

      service.notifyStockChange({
        variantId: VARIANT_ID,
        productId: PRODUCT_ID,
        variantLabel: '100ml',
        previousStock: 0,
        newStock: 5,
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ productId: PRODUCT_ID, notifyOnRestock: true }) }),
      );
    });

    it('does not fire the back-in-stock notifier when stock was already > 0', async () => {
      service.notifyStockChange({
        variantId: VARIANT_ID,
        productId: PRODUCT_ID,
        variantLabel: '100ml',
        previousStock: 2,
        newStock: 5,
      });
      await Promise.resolve();

      expect(mockPrisma.wishlistItem.findMany).not.toHaveBeenCalled();
    });

    it('does not fire the back-in-stock notifier when stock is still 0', async () => {
      service.notifyStockChange({
        variantId: VARIANT_ID,
        productId: PRODUCT_ID,
        variantLabel: '100ml',
        previousStock: 0,
        newStock: 0,
      });
      await Promise.resolve();

      expect(mockPrisma.wishlistItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('notifyStockChangesByDelta()', () => {
    it('is a no-op when given an empty deltas array', async () => {
      await service.notifyStockChangesByDelta([]);

      expect(mockPrisma.productVariant.findMany).not.toHaveBeenCalled();
      expect(mockRedis.publish).not.toHaveBeenCalled();
    });

    it('publishes the caller-supplied newStock directly, without re-reading stock from the DB', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml' },
      ]);

      // Caller captured newStock=8 itself, inside its own transaction, after a +3 restore.
      await service.notifyStockChangesByDelta([{ variantId: VARIANT_ID, delta: 3, newStock: 8 }]);

      // No `stock` in the select — the only DB round-trip left is to resolve productId/label,
      // which are static and unaffected by concurrent stock mutations.
      expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith({
        where: { id: { in: [VARIANT_ID] } },
        select: { id: true, productId: true, label: true },
      });
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'stock:updates',
        JSON.stringify({ id: VARIANT_ID, stock: 8 }),
      );
    });

    // Regression test for the fix: a post-commit re-read can't tell this batch's own
    // before-state apart from a concurrent batch's committed effect on the same variant.
    it('derives previousStock from the caller-supplied newStock/delta, not from the variant row returned by findMany', async () => {
      // findMany intentionally returns no `stock` field at all (only productId/label) —
      // if the implementation tried to fall back to a DB-read stock value, this would
      // surface as `undefined` in the published payload instead of the expected 4.
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml' },
      ]);

      await service.notifyStockChangesByDelta([{ variantId: VARIANT_ID, delta: 4, newStock: 4 }]);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'stock:updates',
        JSON.stringify({ id: VARIANT_ID, stock: 4 }),
      );
    });

    it('fires the back-in-stock notifier when the caller-supplied before/after crosses 0 -> >0', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml' },
      ]);
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        { id: 'wi-1', user: { email: 'fan@example.com', firstName: 'Ola' }, product: { name: 'Rose Oud', slug: 'rose-oud' } },
      ]);

      // newStock=4, delta=+4 -> previousStock=0
      await service.notifyStockChangesByDelta([{ variantId: VARIANT_ID, delta: 4, newStock: 4 }]);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ productId: PRODUCT_ID }) }),
      );
    });

    it('does not fire the back-in-stock notifier when the caller-supplied before-state was already > 0', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml' },
      ]);

      // newStock=10, delta=+4 -> previousStock=6 (already in stock before this restore)
      await service.notifyStockChangesByDelta([{ variantId: VARIANT_ID, delta: 4, newStock: 10 }]);
      await Promise.resolve();

      expect(mockPrisma.wishlistItem.findMany).not.toHaveBeenCalled();
    });

    it('handles multiple variants independently in a single call', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: 'pv-a', productId: PRODUCT_ID, label: '50ml' },
        { id: 'pv-b', productId: PRODUCT_ID, label: '100ml' },
      ]);

      // pv-a: decremented by 2 down to 0 (checkout). pv-b: restored by 5 up to 10.
      await service.notifyStockChangesByDelta([
        { variantId: 'pv-a', delta: -2, newStock: 0 },
        { variantId: 'pv-b', delta: 5, newStock: 10 },
      ]);

      expect(mockRedis.publish).toHaveBeenCalledWith('stock:updates', JSON.stringify({ id: 'pv-a', stock: 0 }));
      expect(mockRedis.publish).toHaveBeenCalledWith('stock:updates', JSON.stringify({ id: 'pv-b', stock: 10 }));
    });

    it('aggregates multiple deltas for the same variant within one batch into a single notification', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml' },
      ]);

      // Two order items restoring the same variant within one transaction: +2 then +3,
      // ending at newStock=10 -> the variant started this batch at 5 (10 - (2+3)).
      await service.notifyStockChangesByDelta([
        { variantId: VARIANT_ID, delta: 2, newStock: 7 },
        { variantId: VARIANT_ID, delta: 3, newStock: 10 },
      ]);

      expect(mockRedis.publish).toHaveBeenCalledTimes(1);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'stock:updates',
        JSON.stringify({ id: VARIANT_ID, stock: 10 }),
      );
    });
  });

  describe('updateVariantStock()', () => {
    // updateVariantStock() reads the current stock via `tx.$queryRaw` (SELECT ... FOR
    // UPDATE) inside `prisma.$transaction`, then writes via `tx.productVariant.update`
    // — not the bare findUnique + update a separate-read TOCTOU race would use.
    const mockTx = {
      $queryRaw: jest.fn(),
      productVariant: { update: jest.fn() },
    };

    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockTx));
    });

    it('throws NotFoundException when the variant does not exist', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(service.updateVariantStock(VARIANT_ID, { set: 10 })).rejects.toThrow(NotFoundException);
    });

    it('publishes the new stock after a manual set', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ stock: 5, productId: PRODUCT_ID, label: '100ml' }]);
      mockTx.productVariant.update.mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 12 });

      await service.updateVariantStock(VARIANT_ID, { set: 12 });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'stock:updates',
        JSON.stringify({ id: VARIANT_ID, stock: 12 }),
      );
    });

    it('fires the back-in-stock notifier when an adjustment brings stock from 0 to positive', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ stock: 0, productId: PRODUCT_ID, label: '100ml' }]);
      mockTx.productVariant.update.mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 6 });
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        { id: 'wi-1', user: { email: 'fan@example.com', firstName: 'Ola' }, product: { name: 'Rose Oud', slug: 'rose-oud' } },
      ]);

      await service.updateVariantStock(VARIANT_ID, { adjustment: 6 });
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ productId: PRODUCT_ID }) }),
      );
    });

    // Race-condition regression: a separate findUnique + update would compute newStock
    // from a pre-read snapshot, silently losing a concurrent adjustment that committed
    // in between. The locked read inside $transaction must be the value applied here.
    it('computes the new stock from the value read inside the locked transaction, not a stale pre-read', async () => {
      // Simulates the row a concurrent transaction already adjusted by the time this
      // transaction's SELECT ... FOR UPDATE acquires the lock and reads it.
      mockTx.$queryRaw.mockResolvedValue([{ stock: 8, productId: PRODUCT_ID, label: '100ml' }]);
      mockTx.productVariant.update.mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 12 });

      await service.updateVariantStock(VARIANT_ID, { adjustment: 4 });

      expect(mockTx.productVariant.update).toHaveBeenCalledWith({
        where: { id: VARIANT_ID },
        data: { stock: 12 },
      });
    });

    it('reports the locked pre-update stock as previousStock, not a separately re-read value', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ stock: 0, productId: PRODUCT_ID, label: '100ml' }]);
      mockTx.productVariant.update.mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 6 });

      const notifySpy = jest.spyOn(service, 'notifyStockChange');

      await service.updateVariantStock(VARIANT_ID, { adjustment: 6 });

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ previousStock: 0, newStock: 6 }),
      );
    });
  });

  // --- category filter — recursive descendant resolution ---
  // FIX: the category filter previously only descended one level of
  // `children`, silently dropping products assigned to grandchild (or
  // deeper) categories. resolveCategorySlugs() now walks the full
  // categories.parentId tree via a recursive CTE, at any depth.

  describe('category filter — recursive descendant resolution', () => {
    const productForFacets = { scentFamily: 'woody', gender: 'MALE' };

    it('findAll() filters by every descendant slug returned by the recursive lookup, not just direct children', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { slug: 'perfumy' },
        { slug: 'perfumy-meskie' },
        { slug: 'perfumy-meskie-nisza' },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
      mockPrisma.product.count.mockResolvedValue(1);

      await service.findAll({ category: 'perfumy' });

      const callArg = mockPrisma.product.findMany.mock.calls[0][0];
      expect(callArg.where.category).toEqual({
        slug: { in: ['perfumy', 'perfumy-meskie', 'perfumy-meskie-nisza'] },
      });
      expect(mockPrisma.$queryRaw.mock.calls[0][1]).toBe('perfumy');
    });

    it('findAll() omits the category filter entirely when the slug cannot be resolved', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(0);

      await service.findAll({ category: 'unknown-slug' });

      const callArg = mockPrisma.product.findMany.mock.calls[0][0];
      expect(callArg.where.category).toBeUndefined();
    });

    it('getFacets() includes grandchild-category products when computing available facets', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { slug: 'perfumy' },
        { slug: 'perfumy-meskie' },
        { slug: 'perfumy-meskie-nisza' },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([productForFacets]);

      await service.getFacets({ category: 'perfumy' });

      const callArg = mockPrisma.product.findMany.mock.calls[0][0];
      expect(callArg.where.category).toEqual({
        slug: { in: ['perfumy', 'perfumy-meskie', 'perfumy-meskie-nisza'] },
      });
    });
  });
});

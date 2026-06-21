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
    productVariantPriceHistory: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]), create: jest.fn() },
    productImage: { findUnique: jest.fn(), findFirst: jest.fn(), delete: jest.fn(), update: jest.fn() },
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
        { provide: StorageService, useValue: { delete: jest.fn(), deleteFile: jest.fn().mockResolvedValue(undefined) } },
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

    // Regression test: a future caller that builds its deltas array out of
    // transaction-commit order (e.g. via Promise.all instead of a sequential
    // for loop) must not silently mis-derive previousStock — it should fail loudly.
    it('throws when multiple deltas for the same variant are out of transaction-commit order', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml' },
      ]);

      // Second entry implies a previousStock of 9-3=6, but the first entry ended
      // at newStock=7 — inconsistent, since both deltas apply to the same variant.
      await expect(
        service.notifyStockChangesByDelta([
          { variantId: VARIANT_ID, delta: 2, newStock: 7 },
          { variantId: VARIANT_ID, delta: 3, newStock: 9 },
        ]),
      ).rejects.toThrow(/out of transaction-commit order/);

      expect(mockRedis.publish).not.toHaveBeenCalled();
    });

    it('does not throw when multiple deltas for the same variant are in transaction-commit order', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml' },
      ]);

      await expect(
        service.notifyStockChangesByDelta([
          { variantId: VARIANT_ID, delta: 2, newStock: 7 },
          { variantId: VARIANT_ID, delta: 3, newStock: 10 },
        ]),
      ).resolves.toBeUndefined();

      expect(mockRedis.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateVariant()', () => {
    // FIX: the general variant editor (PATCH /products/:id/variants/:variantId)
    // mutates `stock` via UpdateVariantDto but, unlike updateVariantStock(), never
    // called notifyStockChange — wishlisted customers and the live SSE stock badge
    // never heard about a stock change made through this endpoint.
    const mockTx = {
      $queryRaw: jest.fn(),
      productVariant: { update: jest.fn() },
    };

    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockTx));
    });

    it('throws NotFoundException when stock is part of the update and the variant does not exist', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(service.updateVariant(VARIANT_ID, { stock: 10 })).rejects.toThrow(NotFoundException);
    });

    it('publishes the new stock and reports the locked pre-update value as previousStock', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ stock: 5 }]);
      mockTx.productVariant.update.mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 12 });

      const notifySpy = jest.spyOn(service, 'notifyStockChange');

      await service.updateVariant(VARIANT_ID, { stock: 12 });

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ variantId: VARIANT_ID, productId: PRODUCT_ID, previousStock: 5, newStock: 12 }),
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'stock:updates',
        JSON.stringify({ id: VARIANT_ID, stock: 12 }),
      );
    });

    it('fires the back-in-stock notifier when the edit brings stock from 0 to positive', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ stock: 0 }]);
      mockTx.productVariant.update.mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 6 });
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        { id: 'wi-1', user: { email: 'fan@example.com', firstName: 'Ola' }, product: { name: 'Rose Oud', slug: 'rose-oud' } },
      ]);

      await service.updateVariant(VARIANT_ID, { stock: 6 });
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ productId: PRODUCT_ID }) }),
      );
    });

    it('does not read stock or publish a notification when the edit does not touch stock', async () => {
      mockTx.productVariant.update.mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID, label: 'New label', stock: 5 });

      await service.updateVariant(VARIANT_ID, { label: 'New label' });

      expect(mockTx.$queryRaw).not.toHaveBeenCalled();
      expect(mockRedis.publish).not.toHaveBeenCalled();
    });

    it('still creates a price history row when priceInCents changes alongside stock', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ stock: 5 }]);
      mockTx.productVariant.update.mockResolvedValue({ id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 8, priceInCents: 9900 });

      await service.updateVariant(VARIANT_ID, { stock: 8, priceInCents: 9900 });

      expect(mockPrisma.productVariantPriceHistory.create).toHaveBeenCalledWith({
        data: { variantId: VARIANT_ID, priceInCents: 9900 },
      });
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

  // --- removeImage() ---
  // FIX: deleting the current primary image used to leave the product with
  // zero isPrimary rows — cart/wishlist/review/email reads that hard-filter
  // on isPrimary: true would then render no image at all, even though other
  // images still existed. removeImage() now promotes the next image by
  // sortOrder to isPrimary inside the same transaction as the delete.

  describe('removeImage()', () => {
    const IMAGE_ID = 'img-uuid-1';
    const OTHER_IMAGE_ID = 'img-uuid-2';

    const mockTx = {
      productImage: { delete: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };

    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockTx));
    });

    it('throws NotFoundException when the image does not exist', async () => {
      mockPrisma.productImage.findUnique.mockResolvedValue(null);

      await expect(service.removeImage(IMAGE_ID)).rejects.toThrow(NotFoundException);
    });

    it('promotes the next image by sortOrder to primary when the deleted image was primary', async () => {
      mockPrisma.productImage.findUnique.mockResolvedValue({
        id: IMAGE_ID,
        productId: PRODUCT_ID,
        storagePath: 'products/img1.jpg',
        isPrimary: true,
        sortOrder: 0,
      });
      mockTx.productImage.findFirst.mockResolvedValue({ id: OTHER_IMAGE_ID, sortOrder: 1, isPrimary: false });

      await service.removeImage(IMAGE_ID);

      expect(mockTx.productImage.delete).toHaveBeenCalledWith({ where: { id: IMAGE_ID } });
      expect(mockTx.productImage.findFirst).toHaveBeenCalledWith({
        where: { productId: PRODUCT_ID },
        orderBy: { sortOrder: 'asc' },
      });
      expect(mockTx.productImage.update).toHaveBeenCalledWith({
        where: { id: OTHER_IMAGE_ID },
        data: { isPrimary: true },
      });
    });

    it('does not touch other images when the deleted image was not primary', async () => {
      mockPrisma.productImage.findUnique.mockResolvedValue({
        id: IMAGE_ID,
        productId: PRODUCT_ID,
        storagePath: 'products/img2.jpg',
        isPrimary: false,
        sortOrder: 1,
      });

      await service.removeImage(IMAGE_ID);

      expect(mockTx.productImage.delete).toHaveBeenCalledWith({ where: { id: IMAGE_ID } });
      expect(mockTx.productImage.findFirst).not.toHaveBeenCalled();
      expect(mockTx.productImage.update).not.toHaveBeenCalled();
    });

    it('does not promote anything when the deleted primary image was the last one', async () => {
      mockPrisma.productImage.findUnique.mockResolvedValue({
        id: IMAGE_ID,
        productId: PRODUCT_ID,
        storagePath: 'products/img1.jpg',
        isPrimary: true,
        sortOrder: 0,
      });
      mockTx.productImage.findFirst.mockResolvedValue(null);

      await service.removeImage(IMAGE_ID);

      expect(mockTx.productImage.update).not.toHaveBeenCalled();
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

  describe('attachOmnibusData()', () => {
    // FIX: AdminJS edits ProductVariant directly with no cross-field check, so a
    // compareAtPriceInCents that doesn't actually exceed priceInCents (swapped values,
    // or stale after a later price hike) must never be displayed as a real discount.
    const baseVariant = { id: VARIANT_ID, priceInCents: 15000 };

    it('suppresses compareAtPriceInCents and lowestPrice30dInCents when compareAtPriceInCents is below priceInCents', async () => {
      mockPrisma.productVariantPriceHistory.findMany.mockResolvedValue([{ variantId: VARIANT_ID }]);
      mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([
        { variantId: VARIANT_ID, _min: { priceInCents: 12000 } },
      ]);

      const [result] = await service.attachOmnibusData([
        { variants: [{ ...baseVariant, compareAtPriceInCents: 12000 }] } as any,
      ]);

      expect(result.variants[0].compareAtPriceInCents).toBeNull();
      expect((result.variants[0] as any).lowestPrice30dInCents).toBeNull();
    });

    it('suppresses promo fields when compareAtPriceInCents equals priceInCents', async () => {
      mockPrisma.productVariantPriceHistory.findMany.mockResolvedValue([{ variantId: VARIANT_ID }]);
      mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([
        { variantId: VARIANT_ID, _min: { priceInCents: 15000 } },
      ]);

      const [result] = await service.attachOmnibusData([
        { variants: [{ ...baseVariant, compareAtPriceInCents: 15000 }] } as any,
      ]);

      expect(result.variants[0].compareAtPriceInCents).toBeNull();
    });

    it('keeps compareAtPriceInCents and lowestPrice30dInCents when the promo is genuinely lower and history is verified', async () => {
      mockPrisma.productVariantPriceHistory.findMany.mockResolvedValue([{ variantId: VARIANT_ID }]);
      mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([
        { variantId: VARIANT_ID, _min: { priceInCents: 12000 } },
      ]);

      const [result] = await service.attachOmnibusData([
        { variants: [{ ...baseVariant, compareAtPriceInCents: 18000 }] } as any,
      ]);

      expect(result.variants[0].compareAtPriceInCents).toBe(18000);
      expect((result.variants[0] as any).lowestPrice30dInCents).toBe(12000);
    });

    it('suppresses promo fields when price history has not yet accumulated 30 days, even with a valid compareAtPriceInCents', async () => {
      mockPrisma.productVariantPriceHistory.findMany.mockResolvedValue([]);

      const [result] = await service.attachOmnibusData([
        { variants: [{ ...baseVariant, compareAtPriceInCents: 18000 }] } as any,
      ]);

      expect(result.variants[0].compareAtPriceInCents).toBeNull();
      expect(mockPrisma.productVariantPriceHistory.groupBy).not.toHaveBeenCalled();
    });
  });

  // --- suggest() — cache key must embed product_cache_v ---
  // FIX: suggest() was the one cached read path that didn't embed the product
  // cache version, so admin edits never invalidated stale autocomplete results.

  describe('suggest() — cache version key', () => {
    const baseProduct = { id: 'p1', name: 'Chanel No 5', slug: 'chanel-no-5', images: [], variants: [] };

    it('embeds the current product_cache_v in the cache lookup and write key', async () => {
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'product_cache_v' ? '3' : null),
      );
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'p1' }]);
      mockPrisma.product.findMany.mockResolvedValue([baseProduct]);

      await service.suggest('chanel');

      expect(mockRedis.get).toHaveBeenCalledWith('suggest:v3:chanel');
      expect(mockRedis.setex).toHaveBeenCalledWith('suggest:v3:chanel', 600, expect.any(String));
    });

    it('returns the cached result without querying the DB on a version-matched hit', async () => {
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'product_cache_v' ? '2' : key === 'suggest:v2:chanel' ? JSON.stringify([baseProduct]) : null),
      );

      const result = await service.suggest('chanel');

      expect(result).toEqual([baseProduct]);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('misses a cache entry written under a stale version after invalidateProductCaches bumps it', async () => {
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'product_cache_v' ? '1' : null),
      );
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'p1' }]);
      mockPrisma.product.findMany.mockResolvedValue([baseProduct]);
      await service.suggest('chanel');
      expect(mockRedis.get).toHaveBeenCalledWith('suggest:v1:chanel');

      jest.clearAllMocks();
      // Simulates invalidateProductCaches() incrementing product_cache_v after a product edit.
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'product_cache_v' ? '2' : null),
      );
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'p1' }]);
      mockPrisma.product.findMany.mockResolvedValue([baseProduct]);
      await service.suggest('chanel');

      expect(mockRedis.get).toHaveBeenCalledWith('suggest:v2:chanel');
      expect(mockRedis.get).not.toHaveBeenCalledWith('suggest:v1:chanel');
    });

    it('lowercases the search term in the cache key', async () => {
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'product_cache_v' ? '0' : null),
      );
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await service.suggest('CHANEL');

      expect(mockRedis.get).toHaveBeenCalledWith('suggest:v0:chanel');
    });
  });

  // --- findAll() — perfume category curated Millesime/Luxury interleaving ---
  // FIX: the interleaving block was gated on the plural 'perfumes', which never
  // matches the real seeded slug 'perfume' — execution always fell through to
  // plain sortOrder ordering. Regression-guards the real slug and the 5-5
  // chunk pattern itself, which no prior test exercised.

  describe('findAll() — perfume category curated Millesime/Luxury interleaving', () => {
    const slimRow = (id: string, line: string) => ({ id, line, category: { slug: 'perfume' } });
    const fullRow = (id: string) => ({ id, variants: [], avgRating: null });

    it('interleaves Millesime/Luxury in 5-5 chunks for the real "perfume" slug', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ slug: 'perfume' }]); // resolveCategorySlugs

      const millesime = Array.from({ length: 7 }, (_, i) => slimRow(`m${i + 1}`, 'Millesime'));
      const luxury = Array.from({ length: 7 }, (_, i) => slimRow(`l${i + 1}`, 'Luxury'));
      mockPrisma.product.findMany.mockResolvedValueOnce([...millesime, ...luxury]); // slim query
      mockPrisma.product.findMany.mockResolvedValueOnce(
        [...millesime, ...luxury].map((p) => fullRow(p.id)),
      ); // full page query

      const result = await service.findAll({ category: 'perfume' });

      expect(result.data.map((p: any) => p.id)).toEqual([
        'm1', 'm2', 'm3', 'm4', 'm5', 'l1', 'l2', 'l3', 'l4', 'l5', 'm6', 'm7', 'l6', 'l7',
      ]);
      expect(result.meta.total).toBe(14);
    });

    it('does not apply curated interleaving when a filter (e.g. brand) is active', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ slug: 'perfume' }]); // resolveCategorySlugs
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(0);

      await service.findAll({ category: 'perfume', brand: 'Chanel' });

      // Plain path queries once with skip/take, unlike the interleaving path's two-pass slim+full query.
      expect(mockPrisma.product.findMany).toHaveBeenCalledTimes(1);
      const callArg = mockPrisma.product.findMany.mock.calls[0][0];
      expect(callArg.select).not.toEqual({ id: true, line: true, category: { select: { slug: true } } });
    });
  });
});

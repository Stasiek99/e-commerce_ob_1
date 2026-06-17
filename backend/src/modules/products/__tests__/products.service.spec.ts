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
      create: jest.fn(),
      update: jest.fn(),
    },
    productVariant: { updateMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    wishlistItem: { findMany: jest.fn().mockResolvedValue([]) },
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

    it('derives previousStock from the current stock minus the known delta and publishes newStock', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 8 },
      ]);

      // A restore of +3 landed on a variant now sitting at 8 -> it was at 5 before.
      await service.notifyStockChangesByDelta([{ variantId: VARIANT_ID, delta: 3 }]);

      expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith({
        where: { id: { in: [VARIANT_ID] } },
        select: { id: true, productId: true, label: true, stock: true },
      });
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'stock:updates',
        JSON.stringify({ id: VARIANT_ID, stock: 8 }),
      );
    });

    it('fires the back-in-stock notifier when the delta restores stock from 0', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 4 },
      ]);
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        { id: 'wi-1', user: { email: 'fan@example.com', firstName: 'Ola' }, product: { name: 'Rose Oud', slug: 'rose-oud' } },
      ]);

      // Variant is now at 4, restore delta was +4 -> previousStock = 0.
      await service.notifyStockChangesByDelta([{ variantId: VARIANT_ID, delta: 4 }]);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ productId: PRODUCT_ID }) }),
      );
    });

    it('handles multiple variants independently in a single call', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: 'pv-a', productId: PRODUCT_ID, label: '50ml', stock: 0 },
        { id: 'pv-b', productId: PRODUCT_ID, label: '100ml', stock: 10 },
      ]);

      // pv-a: decremented by 2 down to 0 (checkout). pv-b: restored by 5 up to 10.
      await service.notifyStockChangesByDelta([
        { variantId: 'pv-a', delta: -2 },
        { variantId: 'pv-b', delta: 5 },
      ]);

      expect(mockRedis.publish).toHaveBeenCalledWith('stock:updates', JSON.stringify({ id: 'pv-a', stock: 0 }));
      expect(mockRedis.publish).toHaveBeenCalledWith('stock:updates', JSON.stringify({ id: 'pv-b', stock: 10 }));
    });
  });

  describe('updateVariantStock()', () => {
    it('throws NotFoundException when the variant does not exist', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.updateVariantStock(VARIANT_ID, { set: 10 })).rejects.toThrow(NotFoundException);
    });

    it('publishes the new stock after a manual set', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 5,
      });
      mockPrisma.productVariant.update.mockResolvedValue({ id: VARIANT_ID, stock: 12 });

      await service.updateVariantStock(VARIANT_ID, { set: 12 });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'stock:updates',
        JSON.stringify({ id: VARIANT_ID, stock: 12 }),
      );
    });

    it('fires the back-in-stock notifier when an adjustment brings stock from 0 to positive', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: VARIANT_ID, productId: PRODUCT_ID, label: '100ml', stock: 0,
      });
      mockPrisma.productVariant.update.mockResolvedValue({ id: VARIANT_ID, stock: 6 });
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
  });
});

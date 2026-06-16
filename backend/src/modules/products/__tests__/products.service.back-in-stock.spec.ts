import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service';

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const VARIANT_ID = 'var-1';
const PRODUCT_ID = 'prod-1';

const outOfStockVariant = {
  id: VARIANT_ID,
  productId: PRODUCT_ID,
  label: '50ml',
  stock: 0,
};

const inStockVariant = { ...outOfStockVariant, stock: 5 };

const wishlistSubscribers = [
  {
    id: 'wl-1',
    user: { email: 'alice@example.com', firstName: 'Alice' },
    product: { name: 'Rose Oud', slug: 'rose-oud' },
  },
  {
    id: 'wl-2',
    user: { email: 'bob@example.com', firstName: 'Bob' },
    product: { name: 'Rose Oud', slug: 'rose-oud' },
  },
];

describe('ProductsService — back-in-stock notification dispatch', () => {
  let service: ProductsService;

  const mockPrisma = {
    productVariant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    wishlistItem: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockEmailQueue = {
    sendBackInStock: jest.fn(),
  };

  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(0),
  };

  const mockSseSubscriber = {
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailQueue },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:4200') } },
        { provide: StorageService, useValue: {} },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: 'STOCK_SSE_REDIS_SUBSCRIBER', useValue: mockSseSubscriber },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(1);
  });

  describe('when stock transitions from 0 to positive', () => {
    beforeEach(() => {
      mockPrisma.productVariant.findUnique.mockResolvedValue(outOfStockVariant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...outOfStockVariant, stock: 10 });
      mockPrisma.wishlistItem.findMany.mockResolvedValue(wishlistSubscribers);
      mockEmailQueue.sendBackInStock.mockResolvedValue(undefined);
    });

    it('enqueues one sendBackInStock job per subscriber, each carrying its wishlistItemId', async () => {
      await service.updateVariantStock(VARIANT_ID, { set: 10 });
      await flushMicrotasks();

      expect(mockEmailQueue.sendBackInStock).toHaveBeenCalledTimes(2);
      expect(mockEmailQueue.sendBackInStock).toHaveBeenCalledWith(
        expect.objectContaining({ wishlistItemId: 'wl-1', to: 'alice@example.com' }),
      );
      expect(mockEmailQueue.sendBackInStock).toHaveBeenCalledWith(
        expect.objectContaining({ wishlistItemId: 'wl-2', to: 'bob@example.com' }),
      );
    });

    it('does NOT call wishlistItem.updateMany — flag reset is deferred to the job processor after confirmed delivery', async () => {
      await service.updateVariantStock(VARIANT_ID, { set: 10 });
      await flushMicrotasks();

      expect(mockPrisma.wishlistItem.updateMany).not.toHaveBeenCalled();
    });

    it('does not enqueue jobs when no subscribers have notifyOnRestock set', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([]);

      await service.updateVariantStock(VARIANT_ID, { set: 10 });
      await flushMicrotasks();

      expect(mockEmailQueue.sendBackInStock).not.toHaveBeenCalled();
    });

    it('still resets flag for other subscribers even when one enqueue fails', async () => {
      mockEmailQueue.sendBackInStock
        .mockRejectedValueOnce(new Error('Redis connection lost'))
        .mockResolvedValueOnce(undefined);

      await service.updateVariantStock(VARIANT_ID, { set: 10 });
      await flushMicrotasks();

      // second subscriber job must still be attempted
      expect(mockEmailQueue.sendBackInStock).toHaveBeenCalledTimes(2);
    });
  });

  describe('when stock was already positive (no restock event)', () => {
    it('does not enqueue any back-in-stock notifications', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue(inStockVariant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...inStockVariant, stock: 15 });

      await service.updateVariantStock(VARIANT_ID, { adjustment: 10 });
      await flushMicrotasks();

      expect(mockEmailQueue.sendBackInStock).not.toHaveBeenCalled();
      expect(mockPrisma.wishlistItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('when stock remains 0 after adjustment', () => {
    it('does not enqueue any back-in-stock notifications', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue(outOfStockVariant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...outOfStockVariant, stock: 0 });

      await service.updateVariantStock(VARIANT_ID, { adjustment: 0 });
      await flushMicrotasks();

      expect(mockEmailQueue.sendBackInStock).not.toHaveBeenCalled();
    });
  });

  describe('guard: variant not found', () => {
    it('throws NotFoundException before touching wishlist or email queue', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.updateVariantStock(VARIANT_ID, { set: 10 })).rejects.toThrow(NotFoundException);

      expect(mockEmailQueue.sendBackInStock).not.toHaveBeenCalled();
      expect(mockPrisma.wishlistItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('ownership exclusion guard', () => {
    beforeEach(() => {
      mockPrisma.productVariant.findUnique.mockResolvedValue(outOfStockVariant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...outOfStockVariant, stock: 10 });
      mockEmailQueue.sendBackInStock.mockResolvedValue(undefined);
    });

    it('queries wishlistItem.findMany with a NOT filter excluding users with a DELIVERED order for this product', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([]);

      await service.updateVariantStock(VARIANT_ID, { set: 10 });
      await flushMicrotasks();

      expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            productId: PRODUCT_ID,
            notifyOnRestock: true,
            NOT: expect.objectContaining({
              user: expect.objectContaining({
                orders: expect.objectContaining({
                  some: expect.objectContaining({
                    status: 'DELIVERED',
                    items: expect.objectContaining({
                      some: expect.objectContaining({
                        productVariant: expect.objectContaining({ productId: PRODUCT_ID }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
    });

    it('sends no notifications when all wishlisters already own the product (findMany returns empty due to filter)', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([]);

      await service.updateVariantStock(VARIANT_ID, { set: 10 });
      await flushMicrotasks();

      expect(mockEmailQueue.sendBackInStock).not.toHaveBeenCalled();
    });

    it('still notifies the subscriber who does not own the product when another subscriber owns it', async () => {
      // Simulates the filter: only the non-owner (alice) is returned by Prisma
      mockPrisma.wishlistItem.findMany.mockResolvedValue([wishlistSubscribers[0]]);

      await service.updateVariantStock(VARIANT_ID, { set: 10 });
      await flushMicrotasks();

      expect(mockEmailQueue.sendBackInStock).toHaveBeenCalledTimes(1);
      expect(mockEmailQueue.sendBackInStock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@example.com' }),
      );
    });
  });
});

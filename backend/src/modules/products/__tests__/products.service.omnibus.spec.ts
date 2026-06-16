import { Test } from '@nestjs/testing';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service';

const PRODUCT_ID = 'prod-1';
const CATEGORY_ID = 'cat-1';
const VARIANT_ID = 'var-1';

const makeProduct = (variantOverrides: Record<string, unknown> = {}) => ({
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
  images: [],
  category: { id: CATEGORY_ID, name: 'Perfumes', slug: 'perfumes' },
  variants: [
    {
      id: VARIANT_ID,
      priceInCents: 8000,
      compareAtPriceInCents: 10000,
      ...variantOverrides,
    },
  ],
});

describe('ProductsService — EU Omnibus 30-day lowest price', () => {
  let service: ProductsService;

  const mockPrisma = {
    product: { findFirst: jest.fn() },
    productVariantPriceHistory: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
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
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:4200') } },
        { provide: StorageService, useValue: {} },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: 'STOCK_SSE_REDIS_SUBSCRIBER', useValue: mockSseSubscriber },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();
  });

  it('suppresses the promotional price when no price history predates the 30-day window', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct());
    // No history row recorded at or before the 30-day window start —
    // simulates a seed/bulk-imported variant that never went through
    // updateVariant().
    mockPrisma.productVariantPriceHistory.findMany.mockResolvedValue([]);

    const result = await service.findBySlug('rose-oud');
    const variant = result.variants[0] as unknown as { compareAtPriceInCents: number | null; lowestPrice30dInCents: number | null };

    expect(variant.compareAtPriceInCents).toBeNull();
    expect(variant.lowestPrice30dInCents).toBeNull();
    expect(mockPrisma.productVariantPriceHistory.groupBy).not.toHaveBeenCalled();
  });

  it('shows the verified 30-day minimum once history spans the full window', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct());
    mockPrisma.productVariantPriceHistory.findMany.mockResolvedValue([{ variantId: VARIANT_ID }]);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([
      { variantId: VARIANT_ID, _min: { priceInCents: 7500 } },
    ]);

    const result = await service.findBySlug('rose-oud');
    const variant = result.variants[0] as unknown as { compareAtPriceInCents: number | null; lowestPrice30dInCents: number | null };

    expect(variant.compareAtPriceInCents).toBe(10000);
    expect(variant.lowestPrice30dInCents).toBe(7500);
  });

  it('does not query history at all when no variant has a promotional price', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct({ compareAtPriceInCents: null }));

    const result = await service.findBySlug('rose-oud');
    const variant = result.variants[0] as unknown as { compareAtPriceInCents: number | null; lowestPrice30dInCents: number | null };

    expect(variant.compareAtPriceInCents).toBeNull();
    expect(variant.lowestPrice30dInCents).toBeNull();
    expect(mockPrisma.productVariantPriceHistory.findMany).not.toHaveBeenCalled();
  });

  it('queries history rows recorded at or before the 30-day window start to verify eligibility', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct());
    mockPrisma.productVariantPriceHistory.findMany.mockResolvedValue([{ variantId: VARIANT_ID }]);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([
      { variantId: VARIANT_ID, _min: { priceInCents: 7500 } },
    ]);

    await service.findBySlug('rose-oud');

    const callArgs = mockPrisma.productVariantPriceHistory.findMany.mock.calls[0][0];
    const expectedThirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(callArgs.where.variantId.in).toEqual([VARIANT_ID]);
    expect(Math.abs(callArgs.where.recordedAt.lte.getTime() - expectedThirtyDaysAgo)).toBeLessThan(5000);
  });
});

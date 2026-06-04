import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { StorageService } from '../../storage/storage.service';

const makeVariant = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'var-1',
  label: '50ml',
  priceInCents: 9900,
  compareAtPriceInCents: null,
  stock: 10,
  isActive: true,
  ...overrides,
});

const makeProduct = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'product-1',
  name: 'Test Perfume',
  slug: 'test-perfume',
  brand: 'Maison',
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
  avgRating: null,
  reviewCount: 0,
  shortDescription: null,
  description: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  category: { id: 'cat-1', name: 'Perfumes', slug: 'perfumes' },
  images: [{ url: 'https://cdn.example.com/img.jpg', altText: null, isPrimary: true, sortOrder: 0 }],
  variants: [makeVariant()],
  ...overrides,
});

// attachOmnibusData always adds lowestPrice30dInCents to every variant.
// For non-promotional variants it falls back to priceInCents.
const enrich = (products: ReturnType<typeof makeProduct>[]) =>
  products.map(p => ({
    ...p,
    variants: (p.variants as ReturnType<typeof makeVariant>[]).map(v => ({
      ...v,
      lowestPrice30dInCents: v.priceInCents,
    })),
  }));

const mockPrisma = {
  product: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  productVariant: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  orderItem: {
    count: jest.fn(),
  },
  productVariantPriceHistory: {
    create: jest.fn(),
    groupBy: jest.fn(),
  },
  productImage: {
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  category: { findUnique: jest.fn() },
  wishlistItem: { findMany: jest.fn(), updateMany: jest.fn() },
  $queryRaw: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
  incr: jest.fn(),
  scanStream: jest.fn(),
  pipeline: jest.fn(),
};

const mockEmailService = { sendBackInStock: jest.fn() };
const mockConfigService = { get: jest.fn() };
const mockStorageService = { deleteFile: jest.fn().mockResolvedValue(undefined) };

// ─── findRelated ──────────────────────────────────────────────────────────────

describe('ProductsService — findRelated', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.scanStream.mockReturnValue({ on: jest.fn() });
    mockRedis.pipeline.mockReturnValue({ del: jest.fn(), exec: jest.fn().mockResolvedValue(null) });
    // No promotional variants by default → price-history groupBy never fires
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  describe('cache hit', () => {
    it('returns the cached result without querying the database', async () => {
      const cached = [makeProduct()];
      const serialized = JSON.stringify(cached);
      mockRedis.get.mockResolvedValue(serialized);

      const result = await service.findRelated('test-perfume');

      // JSON round-trip converts Date → string; compare against parsed form
      expect(result).toEqual(JSON.parse(serialized));
      expect(mockPrisma.product.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('product not found', () => {
    it('returns an empty array when the current product does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue(null);

      const result = await service.findRelated('nonexistent-slug');

      expect(result).toEqual([]);
      expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('queries active products in the same category, excluding the current product', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      mockPrisma.product.findMany.mockResolvedValue([makeProduct({ id: 'related-1' })]);

      await service.findRelated('test-perfume');

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            categoryId: 'cat-1',
            id: { not: 'current-id' },
          }),
        }),
      );
    });

    it('returns related products enriched with lowestPrice30dInCents', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      const related = [makeProduct({ id: 'rel-1' }), makeProduct({ id: 'rel-2' })];
      mockPrisma.product.findMany.mockResolvedValue(related);

      const result = await service.findRelated('test-perfume');

      expect(result).toEqual(enrich(related));
    });

    it('applies the default limit of 6 when none is specified', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.findRelated('test-perfume');

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 6 }),
      );
    });

    it('respects a custom limit when provided', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.findRelated('test-perfume', 4);

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 4 }),
      );
    });

    it('orders results with featured products first, then by sortOrder', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.findRelated('test-perfume');

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
        }),
      );
    });

    it('caches the enriched result in Redis with a 300s TTL', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      const related = [makeProduct()];
      mockPrisma.product.findMany.mockResolvedValue(related);

      await service.findRelated('test-perfume');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'related:v0:test-perfume:6',
        300,
        JSON.stringify(enrich(related)),
      );
    });

    it('uses the slug and limit as part of the cache key', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.findRelated('my-fragrance', 3);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'related:v0:my-fragrance:3',
        300,
        expect.any(String),
      );
    });
  });

  describe('Redis resilience', () => {
    it('falls back to the database when Redis.get throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis ECONNREFUSED'));
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      const related = [makeProduct()];
      mockPrisma.product.findMany.mockResolvedValue(related);

      const result = await service.findRelated('test-perfume');

      expect(result).toEqual(enrich(related));
    });

    it('still returns DB results when Redis.setex throws', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockRejectedValue(new Error('Redis write error'));
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      const related = [makeProduct()];
      mockPrisma.product.findMany.mockResolvedValue(related);

      const result = await service.findRelated('test-perfume');

      expect(result).toEqual(enrich(related));
    });
  });
});

// ─── createVariant ────────────────────────────────────────────────────────────

describe('ProductsService — createVariant', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.incr.mockResolvedValue(1);
    mockRedis.scanStream.mockReturnValue({ on: jest.fn() });
    mockRedis.pipeline.mockReturnValue({ del: jest.fn(), exec: jest.fn().mockResolvedValue(null) });
  });

  afterEach(() => jest.clearAllMocks());

  it('creates the variant with the supplied data', async () => {
    const created = makeVariant({ id: 'new-var', priceInCents: 7900 });
    mockPrisma.productVariant.create.mockResolvedValue(created);
    mockPrisma.productVariantPriceHistory.create.mockResolvedValue({});

    await service.createVariant('product-1', {
      sku: 'SKU-001',
      label: '50ml',
      priceInCents: 7900,
    });

    expect(mockPrisma.productVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sku: 'SKU-001', label: '50ml', priceInCents: 7900 }),
      }),
    );
  });

  it('records an initial price history entry after creating the variant', async () => {
    const created = makeVariant({ id: 'new-var', priceInCents: 7900 });
    mockPrisma.productVariant.create.mockResolvedValue(created);
    mockPrisma.productVariantPriceHistory.create.mockResolvedValue({});

    await service.createVariant('product-1', {
      sku: 'SKU-001',
      label: '50ml',
      priceInCents: 7900,
    });

    expect(mockPrisma.productVariantPriceHistory.create).toHaveBeenCalledWith({
      data: { variantId: 'new-var', priceInCents: 7900 },
    });
  });

  it('returns the created variant', async () => {
    const created = makeVariant({ id: 'new-var', priceInCents: 7900 });
    mockPrisma.productVariant.create.mockResolvedValue(created);
    mockPrisma.productVariantPriceHistory.create.mockResolvedValue({});

    const result = await service.createVariant('product-1', {
      sku: 'SKU-001',
      label: '50ml',
      priceInCents: 7900,
    });

    expect(result).toEqual(created);
  });
});

// ─── updateVariant ────────────────────────────────────────────────────────────

describe('ProductsService — updateVariant', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.incr.mockResolvedValue(1);
    mockRedis.scanStream.mockReturnValue({ on: jest.fn() });
    mockRedis.pipeline.mockReturnValue({ del: jest.fn(), exec: jest.fn().mockResolvedValue(null) });
  });

  afterEach(() => jest.clearAllMocks());

  it('records a price history entry when priceInCents changes', async () => {
    const updated = makeVariant({ id: 'var-1', priceInCents: 6500 });
    mockPrisma.productVariant.update.mockResolvedValue(updated);
    mockPrisma.productVariantPriceHistory.create.mockResolvedValue({});

    await service.updateVariant('var-1', { priceInCents: 6500 });

    expect(mockPrisma.productVariantPriceHistory.create).toHaveBeenCalledWith({
      data: { variantId: 'var-1', priceInCents: 6500 },
    });
  });

  it('does NOT record a price history entry when priceInCents is absent from the update', async () => {
    const updated = makeVariant({ id: 'var-1', stock: 20 });
    mockPrisma.productVariant.update.mockResolvedValue(updated);

    await service.updateVariant('var-1', { stock: 20 });

    expect(mockPrisma.productVariantPriceHistory.create).not.toHaveBeenCalled();
  });

  it('returns the updated variant', async () => {
    const updated = makeVariant({ id: 'var-1', priceInCents: 6500 });
    mockPrisma.productVariant.update.mockResolvedValue(updated);
    mockPrisma.productVariantPriceHistory.create.mockResolvedValue({});

    const result = await service.updateVariant('var-1', { priceInCents: 6500 });

    expect(result).toEqual(updated);
  });
});

// ─── findAll price sorting ────────────────────────────────────────────────────

describe('ProductsService — findAll price sorting', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  const makeNoVariantProduct = (id: string) =>
    makeProduct({ id, slug: id, variants: [] });

  const makePricedProduct = (id: string, priceInCents: number) =>
    makeProduct({ id, slug: id, variants: [makeVariant({ priceInCents })] });

  it('price_desc: places products with no active variants last, not first', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      makeNoVariantProduct('no-variants'),
      makePricedProduct('cheap', 5000),
      makePricedProduct('expensive', 20000),
    ]);

    const result = await service.findAll({ sortBy: 'price_desc' });

    const ids = (result.data as Array<{ id: string }>).map(p => p.id);
    expect(ids[0]).toBe('expensive');
    expect(ids[1]).toBe('cheap');
    expect(ids[2]).toBe('no-variants');
  });

  it('price_asc: places products with no active variants last', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      makeNoVariantProduct('no-variants'),
      makePricedProduct('cheap', 5000),
      makePricedProduct('expensive', 20000),
    ]);

    const result = await service.findAll({ sortBy: 'price_asc' });

    const ids = (result.data as Array<{ id: string }>).map(p => p.id);
    expect(ids[0]).toBe('cheap');
    expect(ids[1]).toBe('expensive');
    expect(ids[2]).toBe('no-variants');
  });

  it('price_desc: correctly orders multiple priced products', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      makePricedProduct('mid', 10000),
      makePricedProduct('cheap', 5000),
      makePricedProduct('expensive', 20000),
    ]);

    const result = await service.findAll({ sortBy: 'price_desc' });

    const ids = (result.data as Array<{ id: string }>).map(p => p.id);
    expect(ids).toEqual(['expensive', 'mid', 'cheap']);
  });
});

// ─── cache version invalidation ──────────────────────────────────────────────

describe('ProductsService — cache version invalidation', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);
    // updateVariantStock: variant already in-stock so no back-in-stock path fires
    const stockedVariant = makeVariant({ id: 'v1', stock: 10 });
    mockPrisma.productVariant.findUnique.mockResolvedValue(stockedVariant);
    mockPrisma.productVariant.update.mockResolvedValue({ ...stockedVariant, stock: 15 });
  });

  afterEach(() => jest.clearAllMocks());

  it('increments product_cache_v on cache invalidation (updateVariantStock)', async () => {
    await service.updateVariantStock('v1', { set: 15 });

    expect(mockRedis.incr).toHaveBeenCalledWith('product_cache_v');
    expect(mockRedis.incr).toHaveBeenCalledTimes(1);
  });

  it('never calls scanStream on cache invalidation', async () => {
    await service.updateVariantStock('v1', { set: 15 });

    expect(mockRedis.scanStream).not.toHaveBeenCalled();
  });

  it('uses the current version in the findAll cache key', async () => {
    mockRedis.get
      .mockResolvedValueOnce('5')  // product_cache_v lookup
      .mockResolvedValueOnce(null); // cache miss for the search key
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);

    await service.findAll({});

    // Key must contain v5 — not v0 or unversioned
    const setexCall = mockRedis.setex.mock.calls[0];
    expect(setexCall[0]).toMatch(/^search:v5:/);
  });

  it('uses the current version in the findRelated cache key', async () => {
    mockRedis.get
      .mockResolvedValueOnce('3')  // product_cache_v lookup
      .mockResolvedValueOnce(null); // cache miss
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p1', categoryId: 'cat-1' });
    mockPrisma.product.findMany.mockResolvedValue([]);

    await service.findRelated('my-slug');

    const setexCall = mockRedis.setex.mock.calls[0];
    expect(setexCall[0]).toBe('related:v3:my-slug:6');
  });
});

// ─── EU Omnibus compliance ────────────────────────────────────────────────────

describe('ProductsService — EU Omnibus compliance (lowestPrice30dInCents)', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
  });

  afterEach(() => jest.clearAllMocks());

  it('attaches the 30-day minimum price from history when a promotional price is active', async () => {
    const promoProduct = makeProduct({
      variants: [makeVariant({ id: 'var-promo', priceInCents: 8000, compareAtPriceInCents: 12000 })],
    });
    mockPrisma.product.findFirst.mockResolvedValue(promoProduct);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([
      { variantId: 'var-promo', _min: { priceInCents: 7500 } },
    ]);

    const result = await service.findBySlug('test-perfume') as any;

    expect(result.variants[0].lowestPrice30dInCents).toBe(7500);
  });

  it('uses the minimum across multiple history entries, not the most recent', async () => {
    const promoProduct = makeProduct({
      variants: [makeVariant({ id: 'var-promo', priceInCents: 8000, compareAtPriceInCents: 12000 })],
    });
    mockPrisma.product.findFirst.mockResolvedValue(promoProduct);
    // groupBy _min already gives us the minimum; verify the service passes it through
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([
      { variantId: 'var-promo', _min: { priceInCents: 6000 } },
    ]);

    const result = await service.findBySlug('test-perfume') as any;

    expect(result.variants[0].lowestPrice30dInCents).toBe(6000);
  });

  it('falls back to priceInCents when no price history exists for a promotional variant', async () => {
    const promoProduct = makeProduct({
      variants: [makeVariant({ id: 'var-promo', priceInCents: 8000, compareAtPriceInCents: 12000 })],
    });
    mockPrisma.product.findFirst.mockResolvedValue(promoProduct);
    // No history records for this variant
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);

    const result = await service.findBySlug('test-perfume') as any;

    expect(result.variants[0].lowestPrice30dInCents).toBe(8000);
  });

  it('does not query price history when no variant has a promotional price', async () => {
    // Default makeProduct has compareAtPriceInCents: null — no promotion active
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct());

    await service.findBySlug('test-perfume');

    expect(mockPrisma.productVariantPriceHistory.groupBy).not.toHaveBeenCalled();
  });

  it('queries price history only for variants that have compareAtPriceInCents set', async () => {
    const mixedProduct = makeProduct({
      variants: [
        makeVariant({ id: 'var-regular', priceInCents: 5000, compareAtPriceInCents: null }),
        makeVariant({ id: 'var-promo', priceInCents: 8000, compareAtPriceInCents: 12000 }),
      ],
    });
    mockPrisma.product.findFirst.mockResolvedValue(mixedProduct);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([
      { variantId: 'var-promo', _min: { priceInCents: 7200 } },
    ]);

    const result = await service.findBySlug('test-perfume') as any;

    expect(mockPrisma.productVariantPriceHistory.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variantId: { in: ['var-promo'] },
        }),
      }),
    );
    // Regular variant gets priceInCents as fallback
    const regular = result.variants.find((v: any) => v.id === 'var-regular');
    expect(regular?.lowestPrice30dInCents).toBe(5000);
    // Promo variant gets 30-day min
    const promo = result.variants.find((v: any) => v.id === 'var-promo');
    expect(promo?.lowestPrice30dInCents).toBe(7200);
  });

  it('queries price history scoped to the last 30 days', async () => {
    const promoProduct = makeProduct({
      variants: [makeVariant({ id: 'var-promo', priceInCents: 8000, compareAtPriceInCents: 12000 })],
    });
    mockPrisma.product.findFirst.mockResolvedValue(promoProduct);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);

    const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 1000);

    await service.findBySlug('test-perfume');

    const call = mockPrisma.productVariantPriceHistory.groupBy.mock.calls[0][0];
    const gte: Date = call.where.recordedAt.gte;
    expect(gte).toBeInstanceOf(Date);
    expect(gte.getTime()).toBeGreaterThan(before.getTime());
  });
});

// ─── findBySlug — isActive DB-level filter ────────────────────────────────────

describe('ProductsService — findBySlug isActive DB-level filter', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  it('throws NotFoundException when the product slug does not exist in the database', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(null);

    await expect(service.findBySlug('ghost-slug')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a deactivated product (Prisma returns null because isActive:true is in the WHERE)', async () => {
    // The key regression: Prisma returns null — not an inactive product object.
    // Before the fix, a deactivated product was fetched then rejected in app code.
    // After the fix, Prisma never returns it because isActive:true is in the query.
    mockPrisma.product.findFirst.mockResolvedValue(null);

    await expect(service.findBySlug('inactive-perfume')).rejects.toThrow(NotFoundException);

    // Verify the WHERE clause passed to Prisma includes isActive: true
    expect(mockPrisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  it('returns enriched product data when the product is active', async () => {
    const activeProduct = makeProduct({ slug: 'active-perfume' });
    mockPrisma.product.findFirst.mockResolvedValue(activeProduct);

    const result = await service.findBySlug('active-perfume');

    expect(result).toMatchObject({ id: 'product-1', slug: 'active-perfume' });
  });

  it('includes isActive:true in the findFirst WHERE clause so deactivation is enforced at DB level', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct());

    await service.findBySlug('test-perfume');

    expect(mockPrisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ slug: 'test-perfume', isActive: true }),
      }),
    );
  });

  it('does not call findUnique — uses findFirst to allow the isActive filter alongside the slug', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct());

    await service.findBySlug('test-perfume');

    expect(mockPrisma.product.findUnique).not.toHaveBeenCalled();
  });
});

// ─── findAll — stable id tiebreaker ───────────────────────────────────────────
// Regression guard: all three findAll query paths must include { id: 'asc' } as
// the final orderBy clause so that products with identical sortOrder + createdAt
// (common after bulk seeding) do not shift between pages on concurrent inserts.

describe('ProductsService — findAll orderBy id tiebreaker', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  it('includes { id: asc } tiebreaker in the default all-products interleaved slim query (path: no category, no featured)', async () => {
    mockPrisma.product.findMany
      .mockResolvedValueOnce([{ id: 'p1', line: null, category: { slug: 'other' } }])
      .mockResolvedValueOnce([]);

    await service.findAll({});

    const slimCall = (mockPrisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(slimCall.orderBy).toContainEqual({ id: 'asc' });
  });

  it('includes { id: asc } tiebreaker in the perfumes-category interleaved slim query (path: category=perfumes, no filters)', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({ slug: 'perfumes', children: [] });
    mockPrisma.product.findMany
      .mockResolvedValueOnce([{ id: 'p1', line: 'Millesime', category: { slug: 'perfumes' } }])
      .mockResolvedValueOnce([]);

    await service.findAll({ category: 'perfumes' });

    const slimCall = (mockPrisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(slimCall.orderBy).toContainEqual({ id: 'asc' });
  });

  it('includes { id: asc } tiebreaker in the paginated fallback query (path: featured=true bypasses interleaving)', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);

    await service.findAll({ featured: true });

    const paginatedCall = (mockPrisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(paginatedCall.orderBy).toContainEqual({ id: 'asc' });
  });

  it('preserves sortOrder asc and createdAt desc as the primary sort keys in the default path', async () => {
    mockPrisma.product.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.findAll({});

    const slimCall = (mockPrisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(slimCall.orderBy[0]).toEqual({ sortOrder: 'asc' });
    expect(slimCall.orderBy[1]).toEqual({ createdAt: 'desc' });
    expect(slimCall.orderBy[2]).toEqual({ id: 'asc' });
  });
});

// ─── updateVariantStock — stock audit log ─────────────────────────────────────

describe('ProductsService — updateVariantStock stock audit log', () => {
  let service: ProductsService;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.incr.mockResolvedValue(1);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('variant not found', () => {
    it('throws NotFoundException before attempting an update when variant does not exist', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.updateVariantStock('missing-var', { set: 5 })).rejects.toThrow(NotFoundException);

      expect(mockPrisma.productVariant.update).not.toHaveBeenCalled();
    });
  });

  describe('audit log with actorId', () => {
    it('logs before/after stock values and actor ID before writing to the database', async () => {
      const variant = makeVariant({ id: 'var-1', stock: 10 });
      mockPrisma.productVariant.findUnique.mockResolvedValue(variant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...variant, stock: 25 });

      await service.updateVariantStock('var-1', { set: 25 }, 'admin-abc');

      expect(logSpy).toHaveBeenCalledWith(
        { variantId: 'var-1', before: 10, after: 25, actor: 'admin-abc' },
        'stock_update',
      );
    });

    it('logs "unknown" as actor when actorId is not provided', async () => {
      const variant = makeVariant({ id: 'var-1', stock: 5 });
      mockPrisma.productVariant.findUnique.mockResolvedValue(variant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...variant, stock: 0 });

      await service.updateVariantStock('var-1', { set: 0 });

      expect(logSpy).toHaveBeenCalledWith(
        { variantId: 'var-1', before: 5, after: 0, actor: 'unknown' },
        'stock_update',
      );
    });

    it('emits the log before the DB update — the log is present even when update throws', async () => {
      const variant = makeVariant({ id: 'var-1', stock: 3 });
      mockPrisma.productVariant.findUnique.mockResolvedValue(variant);
      mockPrisma.productVariant.update.mockRejectedValue(new Error('DB write failed'));

      await expect(
        service.updateVariantStock('var-1', { set: 10 }, 'admin-xyz'),
      ).rejects.toThrow('DB write failed');

      expect(logSpy).toHaveBeenCalledWith(
        { variantId: 'var-1', before: 3, after: 10, actor: 'admin-xyz' },
        'stock_update',
      );
    });
  });

  describe('stock computation', () => {
    it('sets stock to the absolute value from dto.set', async () => {
      const variant = makeVariant({ id: 'var-1', stock: 10 });
      mockPrisma.productVariant.findUnique.mockResolvedValue(variant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...variant, stock: 50 });

      await service.updateVariantStock('var-1', { set: 50 }, 'admin-1');

      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { stock: 50 } }),
      );
    });

    it('applies dto.adjustment as a relative delta on top of current stock', async () => {
      const variant = makeVariant({ id: 'var-1', stock: 10 });
      mockPrisma.productVariant.findUnique.mockResolvedValue(variant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...variant, stock: 15 });

      await service.updateVariantStock('var-1', { adjustment: 5 }, 'admin-1');

      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { stock: 15 } }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ before: 10, after: 15 }),
        'stock_update',
      );
    });

    it('clamps stock to 0 when dto.adjustment would make it negative', async () => {
      const variant = makeVariant({ id: 'var-1', stock: 3 });
      mockPrisma.productVariant.findUnique.mockResolvedValue(variant);
      mockPrisma.productVariant.update.mockResolvedValue({ ...variant, stock: 0 });

      await service.updateVariantStock('var-1', { adjustment: -99 }, 'admin-1');

      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { stock: 0 } }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ before: 3, after: 0 }),
        'stock_update',
      );
    });
  });

  describe('back-in-stock notification', () => {
    it('dispatches back-in-stock emails when stock transitions from 0 to positive', async () => {
      const outOfStock = makeVariant({ id: 'var-1', productId: 'prod-1', stock: 0 });
      mockPrisma.productVariant.findUnique.mockResolvedValue(outOfStock);
      mockPrisma.productVariant.update.mockResolvedValue({ ...outOfStock, stock: 5 });
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        {
          user: { email: 'fan@example.com', firstName: 'Ola' },
          product: { name: 'Cedar Oud', slug: 'cedar-oud' },
        },
      ]);
      mockPrisma.wishlistItem.updateMany.mockResolvedValue({ count: 1 });
      mockEmailService.sendBackInStock.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('https://shop.example.com');

      await service.updateVariantStock('var-1', { set: 5 }, 'admin-1');

      // Allow the fire-and-forget promise to settle
      await new Promise((r) => setImmediate(r));

      expect(mockEmailService.sendBackInStock).toHaveBeenCalledTimes(1);
    });

    it('does not dispatch notifications when stock was already positive', async () => {
      const inStock = makeVariant({ id: 'var-1', stock: 10 });
      mockPrisma.productVariant.findUnique.mockResolvedValue(inStock);
      mockPrisma.productVariant.update.mockResolvedValue({ ...inStock, stock: 20 });

      await service.updateVariantStock('var-1', { set: 20 }, 'admin-1');

      await new Promise((r) => setImmediate(r));

      expect(mockEmailService.sendBackInStock).not.toHaveBeenCalled();
    });
  });
});

// ── removeImage — Supabase Storage cleanup ────────────────────────────────────

describe('ProductsService — removeImage', () => {
  let service: ProductsService;

  const makeImage = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'img-1',
    productId: 'product-1',
    url: 'https://cdn.example.com/product-images/rose.jpg',
    storagePath: 'products/rose.jpg',
    altText: null,
    sortOrder: 0,
    isPrimary: true,
    createdAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();
    mockStorageService.deleteFile.mockResolvedValue(undefined);
  });

  it('throws NotFoundException when image does not exist', async () => {
    mockPrisma.productImage.findUnique.mockResolvedValue(null);

    await expect(service.removeImage('nonexistent-id')).rejects.toThrow(NotFoundException);

    expect(mockStorageService.deleteFile).not.toHaveBeenCalled();
    expect(mockPrisma.productImage.delete).not.toHaveBeenCalled();
  });

  it('calls storageService.deleteFile with the product-images bucket and storagePath before deleting the DB row', async () => {
    const image = makeImage();
    mockPrisma.productImage.findUnique.mockResolvedValue(image);
    mockPrisma.productImage.delete.mockResolvedValue(image);

    await service.removeImage('img-1');

    expect(mockStorageService.deleteFile).toHaveBeenCalledWith(
      'product-images',
      'products/rose.jpg',
    );
    expect(mockPrisma.productImage.delete).toHaveBeenCalledWith({ where: { id: 'img-1' } });
  });

  it('deletes the Supabase file before the DB row (ordering guarantee)', async () => {
    const callOrder: string[] = [];
    const image = makeImage();
    mockPrisma.productImage.findUnique.mockResolvedValue(image);
    mockStorageService.deleteFile.mockImplementation(async () => {
      callOrder.push('storage');
    });
    mockPrisma.productImage.delete.mockImplementation(async () => {
      callOrder.push('db');
      return image;
    });

    await service.removeImage('img-1');

    expect(callOrder).toEqual(['storage', 'db']);
  });

  it('returns the image record after deletion', async () => {
    const image = makeImage();
    mockPrisma.productImage.findUnique.mockResolvedValue(image);
    mockPrisma.productImage.delete.mockResolvedValue(image);

    const result = await service.removeImage('img-1');

    expect(result).toMatchObject({ id: 'img-1', storagePath: 'products/rose.jpg' });
  });

  it('still deletes the DB row even when Supabase deleteFile rejects (warn-and-continue)', async () => {
    const image = makeImage();
    mockPrisma.productImage.findUnique.mockResolvedValue(image);
    mockStorageService.deleteFile.mockRejectedValue(new Error('Supabase timeout'));
    mockPrisma.productImage.delete.mockResolvedValue(image);

    await expect(service.removeImage('img-1')).resolves.not.toThrow();

    expect(mockPrisma.productImage.delete).toHaveBeenCalledWith({ where: { id: 'img-1' } });
  });

  it('skips storageService.deleteFile when storagePath is empty string', async () => {
    const image = makeImage({ storagePath: '' });
    mockPrisma.productImage.findUnique.mockResolvedValue(image);
    mockPrisma.productImage.delete.mockResolvedValue(image);

    await service.removeImage('img-1');

    expect(mockStorageService.deleteFile).not.toHaveBeenCalled();
    expect(mockPrisma.productImage.delete).toHaveBeenCalled();
  });

  it('skips storageService.deleteFile when storagePath is null', async () => {
    const image = makeImage({ storagePath: null });
    mockPrisma.productImage.findUnique.mockResolvedValue(image);
    mockPrisma.productImage.delete.mockResolvedValue(image);

    await service.removeImage('img-1');

    expect(mockStorageService.deleteFile).not.toHaveBeenCalled();
    expect(mockPrisma.productImage.delete).toHaveBeenCalled();
  });
});

// ─── deleteVariant ─────────────────────────────────────────────────────────────

describe('ProductsService — deleteVariant', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.scanStream.mockReturnValue({ on: jest.fn() });
    mockRedis.pipeline.mockReturnValue({ del: jest.fn(), exec: jest.fn().mockResolvedValue(null) });
  });

  afterEach(() => jest.clearAllMocks());

  it('throws ConflictException when variant is referenced by existing order items', async () => {
    mockPrisma.orderItem.count.mockResolvedValue(3);

    await expect(service.deleteVariant('var-1')).rejects.toThrow(ConflictException);
  });

  it('includes the variant ID and order-item count in the ConflictException message', async () => {
    mockPrisma.orderItem.count.mockResolvedValue(5);

    await expect(service.deleteVariant('var-1')).rejects.toThrow(
      'var-1 is referenced by 5 order item(s)',
    );
  });

  it('does not call productVariant.delete when order items exist', async () => {
    mockPrisma.orderItem.count.mockResolvedValue(1);

    await expect(service.deleteVariant('var-1')).rejects.toThrow(ConflictException);

    expect(mockPrisma.productVariant.delete).not.toHaveBeenCalled();
  });

  it('deletes the variant when no order items reference it', async () => {
    mockPrisma.orderItem.count.mockResolvedValue(0);
    mockPrisma.productVariant.delete.mockResolvedValue({ id: 'var-1' });

    await service.deleteVariant('var-1');

    expect(mockPrisma.productVariant.delete).toHaveBeenCalledWith({ where: { id: 'var-1' } });
  });

  it('resolves void on successful deletion', async () => {
    mockPrisma.orderItem.count.mockResolvedValue(0);
    mockPrisma.productVariant.delete.mockResolvedValue({ id: 'var-1' });

    await expect(service.deleteVariant('var-1')).resolves.toBeUndefined();
  });

  it('queries orderItem count scoped to the given variantId', async () => {
    mockPrisma.orderItem.count.mockResolvedValue(0);
    mockPrisma.productVariant.delete.mockResolvedValue({ id: 'var-1' });

    await service.deleteVariant('var-1');

    expect(mockPrisma.orderItem.count).toHaveBeenCalledWith({
      where: { productVariantId: 'var-1' },
    });
  });
});

// ─── avgRating Decimal → number normalization ─────────────────────────────────
// Regression guard: attachOmnibusData must convert Prisma.Decimal avgRating to a
// plain JS number before returning. Without this, JSON.stringify serialises the
// Decimal as a string ("4.65"), breaking frontend .toFixed() and numeric filters.

describe('ProductsService — avgRating Decimal normalization', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  it('converts Prisma.Decimal avgRating to a plain JS number', async () => {
    const productWithDecimal = makeProduct({ avgRating: new Prisma.Decimal('4.65') });
    mockPrisma.product.findFirst.mockResolvedValue(productWithDecimal);

    const result = await service.findBySlug('test-perfume') as any;

    expect(typeof result.avgRating).toBe('number');
    expect(result.avgRating).toBe(4.65);
  });

  it('preserves null when avgRating is null', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct({ avgRating: null }));

    const result = await service.findBySlug('test-perfume') as any;

    expect(result.avgRating).toBeNull();
  });

  it('returns an avgRating that supports toFixed(1) without throwing', async () => {
    const productWithDecimal = makeProduct({ avgRating: new Prisma.Decimal('4.65') });
    mockPrisma.product.findFirst.mockResolvedValue(productWithDecimal);

    const result = await service.findBySlug('test-perfume') as any;

    expect(() => (result.avgRating as number).toFixed(1)).not.toThrow();
    expect((result.avgRating as number).toFixed(1)).toBe('4.7');
  });

  it('stores avgRating as a JSON number in the Redis cache, not a Decimal string', async () => {
    const productWithDecimal = makeProduct({ avgRating: new Prisma.Decimal('4.20') });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
    mockPrisma.product.findMany.mockResolvedValue([productWithDecimal]);

    await service.findRelated('test-perfume');

    const cachedJson: string = mockRedis.setex.mock.calls[0]?.[2];
    expect(cachedJson).toBeDefined();
    const cached = JSON.parse(cachedJson) as Array<{ avgRating: unknown }>;
    expect(typeof cached[0].avgRating).toBe('number');
    expect(cached[0].avgRating).toBe(4.2);
  });
});

// ─── allergen disclosure (EC 1223/2009 Art. 19(1)(f)) ─────────────────────────
// Regression guard: PRODUCT_SELECT must include allergens so that every
// findBySlug response carries the regulated allergen list. Omitting allergens
// from the select would silently return undefined, violating EU cosmetics law.

describe('ProductsService — allergen disclosure in PRODUCT_SELECT', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns allergens array when the product has regulated allergens', async () => {
    const allergens = ['Linalool', 'Limonene', 'Citronellol'];
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct({ allergens }));

    const result = await service.findBySlug('test-perfume') as any;

    expect(result.allergens).toEqual(['Linalool', 'Limonene', 'Citronellol']);
  });

  it('returns an empty allergens array for products with no regulated allergens', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct({ allergens: [] }));

    const result = await service.findBySlug('test-perfume') as any;

    expect(result.allergens).toEqual([]);
  });

  it('includes allergens in the select object passed to Prisma so the field is never silently absent', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(makeProduct({ allergens: ['Linalool'] }));

    await service.findBySlug('test-perfume');

    expect(mockPrisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ allergens: true }),
      }),
    );
  });

  it('returns allergens alongside ingredients and paoMonths in a single response', async () => {
    const product = makeProduct({
      allergens: ['Eugenol'],
      ingredients: 'Alcohol Denat., Aqua, Eugenol',
      paoMonths: 36,
    });
    mockPrisma.product.findFirst.mockResolvedValue(product);

    const result = await service.findBySlug('test-perfume') as any;

    expect(result.allergens).toEqual(['Eugenol']);
    expect(result.ingredients).toBe('Alcohol Denat., Aqua, Eugenol');
    expect(result.paoMonths).toBe(36);
  });
});

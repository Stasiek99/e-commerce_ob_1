import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';

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
  scanStream: jest.fn(),
  pipeline: jest.fn(),
};

const mockEmailService = { sendBackInStock: jest.fn() };
const mockConfigService = { get: jest.fn() };

// ─── findRelated ──────────────────────────────────────────────────────────────

describe('ProductsService — findRelated', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.setex.mockResolvedValue('OK');
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
        'related:test-perfume:6',
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
        'related:my-fragrance:3',
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
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

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
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

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

// ─── EU Omnibus compliance ────────────────────────────────────────────────────

describe('ProductsService — EU Omnibus compliance (lowestPrice30dInCents)', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ProductsService);
    jest.clearAllMocks();

    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
  });

  afterEach(() => jest.clearAllMocks());

  it('attaches the 30-day minimum price from history when a promotional price is active', async () => {
    const promoProduct = makeProduct({
      variants: [makeVariant({ id: 'var-promo', priceInCents: 8000, compareAtPriceInCents: 12000 })],
    });
    mockPrisma.product.findUnique.mockResolvedValue(promoProduct);
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
    mockPrisma.product.findUnique.mockResolvedValue(promoProduct);
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
    mockPrisma.product.findUnique.mockResolvedValue(promoProduct);
    // No history records for this variant
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);

    const result = await service.findBySlug('test-perfume') as any;

    expect(result.variants[0].lowestPrice30dInCents).toBe(8000);
  });

  it('does not query price history when no variant has a promotional price', async () => {
    // Default makeProduct has compareAtPriceInCents: null — no promotion active
    mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

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
    mockPrisma.product.findUnique.mockResolvedValue(mixedProduct);
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
    mockPrisma.product.findUnique.mockResolvedValue(promoProduct);
    mockPrisma.productVariantPriceHistory.groupBy.mockResolvedValue([]);

    const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 1000);

    await service.findBySlug('test-perfume');

    const call = mockPrisma.productVariantPriceHistory.groupBy.mock.calls[0][0];
    const gte: Date = call.where.recordedAt.gte;
    expect(gte).toBeInstanceOf(Date);
    expect(gte.getTime()).toBeGreaterThan(before.getTime());
  });
});

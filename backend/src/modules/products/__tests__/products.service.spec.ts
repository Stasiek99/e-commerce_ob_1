import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';

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
  variants: [{ id: 'var-1', label: '50ml', priceInCents: 9900, stock: 10, isActive: true }],
  ...overrides,
});

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
    update: jest.fn(),
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
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Cache hit ────────────────────────────────────────────────────────────

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

  // ─── Product not found ────────────────────────────────────────────────────

  describe('product not found', () => {
    it('returns an empty array when the current product does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue(null);

      const result = await service.findRelated('nonexistent-slug');

      expect(result).toEqual([]);
      expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Happy path ───────────────────────────────────────────────────────────

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

    it('returns the list of related products', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      const related = [makeProduct({ id: 'rel-1' }), makeProduct({ id: 'rel-2' })];
      mockPrisma.product.findMany.mockResolvedValue(related);

      const result = await service.findRelated('test-perfume');

      expect(result).toEqual(related);
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

    it('caches the result in Redis with a 300s TTL', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      const related = [makeProduct()];
      mockPrisma.product.findMany.mockResolvedValue(related);

      await service.findRelated('test-perfume');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'related:test-perfume:6',
        300,
        JSON.stringify(related),
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

  // ─── Redis resilience ─────────────────────────────────────────────────────

  describe('Redis resilience', () => {
    it('falls back to the database when Redis.get throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis ECONNREFUSED'));
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      const related = [makeProduct()];
      mockPrisma.product.findMany.mockResolvedValue(related);

      const result = await service.findRelated('test-perfume');

      expect(result).toEqual(related);
    });

    it('still returns DB results when Redis.setex throws', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockRejectedValue(new Error('Redis write error'));
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'current-id', categoryId: 'cat-1' });
      const related = [makeProduct()];
      mockPrisma.product.findMany.mockResolvedValue(related);

      const result = await service.findRelated('test-perfume');

      expect(result).toEqual(related);
    });
  });
});

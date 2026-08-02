import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Covers the fragrance finder's server side. The scoring itself is computed in
 * SQL, so these tests pin the parts that live in TypeScript and that a wrong
 * change would break silently: input normalization, the cache key, and — most
 * importantly — that gender/category/exclude are pushed INTO the ranked query
 * rather than applied to its already-LIMITed output.
 */
describe('ProductsService — fragrance finder', () => {
  let service: ProductsService;

  const mockPrisma = {
    product: { findMany: jest.fn().mockResolvedValue([]) },
    productVariantPriceHistory: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    wishlistItem: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  const mockRedis = {
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(0),
  };

  // $queryRaw is called two different ways in this service: `matchByNotes` builds
  // a Prisma.Sql object and calls it as a function, while `getFinderNotes` uses
  // the tagged-template form. The mock therefore sees either one Sql argument or
  // (TemplateStringsArray, ...values), and these helpers normalize both.
  const lastCall = (): unknown[] => mockPrisma.$queryRaw.mock.calls.at(-1) ?? [];

  const lastSql = (): string => {
    const [first] = lastCall();
    if (!first) return '';
    const sqlObject = first as { strings?: string[]; sql?: string };
    if (typeof sqlObject.sql === 'string') return sqlObject.sql;
    return Array.isArray(first) ? first.join('?') : (sqlObject.strings ?? []).join('?');
  };

  const lastValues = (): unknown[] => {
    const call = lastCall();
    const [first, ...rest] = call;
    // Tagged template: the first argument is the raw strings array itself.
    if (Array.isArray(first)) return rest;
    return (first as { values?: unknown[] })?.values ?? [];
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailQueueService, useValue: { sendBackInStock: jest.fn() } },
        { provide: StorageService, useValue: { deleteFile: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: 'STOCK_SSE_REDIS_SUBSCRIBER', useValue: { on: jest.fn(), subscribe: jest.fn(), quit: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  describe('matchByNotes() — input handling', () => {
    it('returns empty without touching the DB when no usable note is given', async () => {
      const result = await service.matchByNotes({ notes: ['', '   '] });

      expect(result).toEqual({ data: [], meta: { total: 0, limit: 12 } });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('normalizes raw display notes to the stored keys, so a product page can pass its own notes verbatim', async () => {
      await service.matchByNotes({ notes: ['Drzewo sandałowe', 'Jaśmin'] });

      expect(lastValues()).toEqual(
        expect.arrayContaining([expect.arrayContaining(['drzewo sandalowe', 'jasmin'])]),
      );
    });

    it('deduplicates notes that normalize to the same key', async () => {
      await service.matchByNotes({ notes: ['Wanilia', 'wanilia', '  WANILIA  '] });

      const wanted = lastValues().find((v) => Array.isArray(v)) as string[];
      expect(wanted).toEqual(['wanilia']);
    });

    it('caps limit at 48 so a crafted request cannot ask for the whole catalog', async () => {
      const result = await service.matchByNotes({ notes: ['wanilia'], limit: 500 });
      expect(result.meta.limit).toBe(48);
    });
  });

  describe('matchByNotes() — filters must be inside the ranked query', () => {
    // Regression: gender/category were originally applied by the Prisma hydration
    // step, i.e. AFTER the SQL LIMIT. "wanilia + dyfuzory" then returned nothing,
    // because the top-scoring perfumes consumed the whole limit before any
    // diffuser could be considered.
    it('pushes the gender filter into the SQL, not the hydration query', async () => {
      await service.matchByNotes({ notes: ['wanilia'], gender: ['Kobieta'] });

      expect(lastSql()).toContain('p.gender = ANY(');
      expect(lastValues()).toEqual(expect.arrayContaining([['Kobieta']]));
    });

    it('pushes the category filter into the SQL via the resolved slug set', async () => {
      // resolveCategorySlugs() runs its own $queryRaw first; it must resolve to a
      // non-empty set for the filter to be emitted.
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ slug: 'diffusers' }])
        .mockResolvedValueOnce([]);

      await service.matchByNotes({ notes: ['wanilia'], category: 'diffusers' });

      expect(lastSql()).toContain('c.slug = ANY(');
    });

    it('excludes the current product inside the SQL so it cannot occupy the top slot', async () => {
      await service.matchByNotes({ notes: ['wanilia'], exclude: 'product-1' });

      expect(lastSql()).toContain('p.id <>');
      expect(lastValues()).toEqual(expect.arrayContaining(['product-1']));
    });

    it('emits no filter clause when none was requested', async () => {
      await service.matchByNotes({ notes: ['wanilia'] });

      const sql = lastSql();
      expect(sql).not.toContain('p.gender = ANY(');
      expect(sql).not.toContain('c.slug = ANY(');
      expect(sql).not.toContain('p.id <>');
    });
  });

  describe('matchByNotes() — caching', () => {
    it('varies the cache key by every input that changes the result', async () => {
      const keys: string[] = [];
      mockRedis.get.mockImplementation((key: string) => {
        if (key !== 'product_cache_v') keys.push(key);
        return Promise.resolve(null);
      });

      await service.matchByNotes({ notes: ['wanilia'] });
      await service.matchByNotes({ notes: ['wanilia'], gender: ['Kobieta'] });
      await service.matchByNotes({ notes: ['wanilia'], exclude: 'p1' });
      await service.matchByNotes({ notes: ['wanilia'], limit: 5 });

      expect(new Set(keys).size).toBe(4);
    });

    it('treats note order as insignificant, so the same selection shares one cache entry', async () => {
      const keys: string[] = [];
      mockRedis.get.mockImplementation((key: string) => {
        if (key !== 'product_cache_v') keys.push(key);
        return Promise.resolve(null);
      });

      await service.matchByNotes({ notes: ['wanilia', 'jasmin'] });
      await service.matchByNotes({ notes: ['jasmin', 'wanilia'] });

      expect(new Set(keys).size).toBe(1);
    });
  });

  describe('getFinderNotes()', () => {
    it('maps rows to {key,label,count} with count coerced from bigint', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { key: 'wanilia', label: 'Wanilia', count: BigInt(79) },
        { key: 'jasmin', label: 'Jaśmin', count: BigInt(86) },
      ]);

      const notes = await service.getFinderNotes();

      expect(notes).toEqual([
        { key: 'wanilia', label: 'Wanilia', count: 79 },
        { key: 'jasmin', label: 'Jaśmin', count: 86 },
      ]);
      expect(typeof notes[0].count).toBe('number');
    });

    it('clamps the requested size to a sane range', async () => {
      await service.getFinderNotes(9999);
      expect(lastValues()).toEqual(expect.arrayContaining([60]));

      await service.getFinderNotes(0);
      expect(lastValues()).toEqual(expect.arrayContaining([1]));
    });

    it('serves a cached vocabulary without querying', async () => {
      const cached = [{ key: 'wanilia', label: 'Wanilia', count: 79 }];
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'product_cache_v' ? '0' : JSON.stringify(cached)),
      );

      const notes = await service.getFinderNotes();

      expect(notes).toEqual(cached);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});

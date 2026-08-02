import { createHash } from 'crypto';
import { ConflictException, Inject, Injectable, Logger, MessageEvent, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, Subscription, filter } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { StorageService } from '../storage/storage.service';
import { OrderStatus, Prisma, ProductStatus } from '@prisma/client';
import {
  FUZZY_MIN_TOKEN_LENGTH,
  ParsedSearchQuery,
  normalizeSearchText,
  parseSearchQuery,
} from './search/search-query.util';

// Explicit select — inspiredBy and luxuryReferenceId are intentionally excluded
// from public API responses to avoid leaking the inspiration mapping table.
const PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  shortDescription: true,
  brand: true,
  status: true,
  estimatedRestockDate: true,
  isActive: true,
  isFeatured: true,
  scentFamily: true,
  notes: true,
  pyramidTop: true,
  pyramidHeart: true,
  pyramidBase: true,
  gender: true,
  catalogNumber: true,
  line: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  reviewCount: true,
  avgRating: true,
  sdsUrl: true,
  allergens: true,
  ingredients: true,
  warnings: true,
  paoMonths: true,
  variants: { where: { isActive: true }, orderBy: { priceInCents: 'asc' as const } },
  images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }] },
  category: { select: { id: true, name: true, slug: true } },
};

// Autocomplete dropdown size. Kept small on purpose: the list is rendered inside
// the header and every row costs an image request.
const SUGGEST_LIMIT = 6;

// How many olfactory notes the fragrance finder offers. The catalog holds ~255
// distinct notes; the top 24 cover ~60% of all occurrences, which is the point
// where the picker still fits on a phone screen without scrolling into a wall of
// chips nobody reads.
const FINDER_NOTE_VOCABULARY_SIZE = 24;

export interface FinderNote {
  /** Normalized key — what POST/GET match expects. */
  key: string;
  /** Most common raw spelling, for display ("Jaśmin"). */
  label: string;
  /** Number of products carrying the note; drives the ordering. */
  count: number;
}

// Shape required by ProductsService.notifyStockChange — every site outside this
// service that mutates ProductVariant.stock (orders/payments checkout decrements,
// cancellation/refund/dispute restores) collects these and calls notifyStockChange
// once its transaction has committed.
export interface StockChange {
  variantId: string;
  productId: string;
  variantLabel: string;
  previousStock: number;
  newStock: number;
}

type FindAllQuery = {
  page?: number;
  limit?: number;
  category?: string;
  brand?: string;
  gender?: string[];
  scentFamily?: string[];
  line?: string[];
  volumes?: string[];
  inStock?: boolean;
  sortBy?: 'relevance' | 'price_asc' | 'price_desc';
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  featured?: boolean;
};

@Injectable()
export class ProductsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductsService.name);
  private readonly stockUpdates$ = new Subject<{ id: string; stock: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailQueueService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
    @Inject('STOCK_SSE_REDIS_SUBSCRIBER') private readonly redisSubscriber: IORedis,
  ) {}

  async onModuleInit() {
    // Fire-and-forget: Redis subscription doesn't need to block server startup.
    this.redisSubscriber.subscribe('stock:updates').catch(() => {});
    this.redisSubscriber.on('message', (_channel: string, message: string) => {
      try {
        const update = JSON.parse(message) as { id: string; stock: number };
        this.stockUpdates$.next(update);
      } catch {}
    });

    // AWAITED intentionally — NestJS delays app.listen() until all onModuleInit
    // hooks resolve, so this warm-up completes before the server accepts any
    // HTTP connections. Without it, the first product request pays the cold
    // pgbouncer→Postgres connection cost (~2s on Supabase free tier) on top of
    // the 3–4 sequential DB queries the uncached list path already needs,
    // pushing the total past the 8s TimeoutInterceptor threshold.
    await this.prisma.$queryRaw`SELECT 1`.catch(() => {});
  }

  async onModuleDestroy() {
    this.stockUpdates$.complete();
    await this.redisSubscriber.quit().catch(() => {});
  }

  async findAll(query: FindAllQuery) {
    const version = await this.getCacheVersion();
    const key = this.searchCacheKey(query, version);
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch {}
    const result = await this._executeFindAll(query);
    try {
      await this.redis.setex(key, query.search ? 120 : 300, JSON.stringify(result));
    } catch {}
    return result;
  }

  /**
   * Resolves a category slug plus every descendant slug at any depth, via a
   * recursive walk of categories.parentId — not just one level of children,
   * so browsing a top-level category also surfaces grandchild-category products.
   */
  private async resolveCategorySlugs(slug: string): Promise<string[] | undefined> {
    const cacheKey = `category_slugs:${slug}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as string[];
    } catch {}

    const descendants = await this.prisma.$queryRaw<Array<{ slug: string }>>`
      WITH RECURSIVE descendants AS (
        SELECT id, slug FROM categories WHERE slug = ${slug}
        UNION ALL
        SELECT c.id, c.slug
        FROM categories c
        INNER JOIN descendants d ON c."parentId" = d.id
      )
      SELECT slug FROM descendants
    `;
    const result = descendants.length ? descendants.map((d) => d.slug) : undefined;

    try {
      // Category tree changes rarely; 1h TTL is safe and avoids repeated recursive CTE
      // on every cold cache miss. Invalidated by cache version bump when categories mutate.
      if (result) await this.redis.setex(cacheKey, 3600, JSON.stringify(result));
    } catch {}

    return result;
  }

  private async _executeFindAll(query: FindAllQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const variantWhere: Prisma.ProductVariantWhereInput = { isActive: true };
    if (query.volumes?.length) {
      variantWhere.volume = { in: query.volumes.map((v) => parseInt(v, 10)).filter(Number.isFinite) };
    }
    if (query.inStock) {
      variantWhere.stock = { gt: 0 };
    }
    if (query.minPrice !== undefined) {
      variantWhere.priceInCents = { ...variantWhere.priceInCents as object, gte: query.minPrice };
    }
    if (query.maxPrice !== undefined) {
      variantWhere.priceInCents = { ...variantWhere.priceInCents as object, lte: query.maxPrice };
    }
    const hasVariantFilter =
      query.volumes?.length || query.inStock || query.minPrice !== undefined || query.maxPrice !== undefined;

    const categorySlugs = query.category ? await this.resolveCategorySlugs(query.category) : undefined;

    // Search handled via raw query below — excluded from Prisma where so filters
    // (category, gender, etc.) can be applied on top of the ranked ID set.
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
      ...(categorySlugs && { category: { slug: { in: categorySlugs } } }),
      ...(query.brand && { brand: { equals: query.brand, mode: 'insensitive' } }),
      ...(query.gender?.length && { gender: { in: query.gender } }),
      ...(query.scentFamily?.length && { scentFamily: { in: query.scentFamily } }),
      ...(query.line?.length && { line: { in: query.line } }),
      ...(query.featured !== undefined && { isFeatured: query.featured }),
      ...(hasVariantFilter ? { variants: { some: variantWhere } } : {}),
    };

    // ── Typo- and abbreviation-tolerant search ────────────────────────────────
    // See rankedSearchIds() for the matching and ranking model.
    if (query.search) {
      const parsed = parseSearchQuery(query.search);

      if (!parsed.isUsable) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }

      const ranked = await this.rankedSearchIds(parsed, 500);

      if (!ranked.length) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }

      const rankMap = new Map(ranked.map(r => [r.id, Number(r.rank)]));
      const rankedIds = ranked.map(r => r.id);

      // Apply facet filters on top of the ranked ID set via Prisma
      const products = await this.prisma.product.findMany({
        where: { ...where, id: { in: rankedIds } },
        select: PRODUCT_SELECT,
      });

      const lineOrder = (l: string | null | undefined) =>
        l === 'Millesime' ? 1 : l === 'Luxury' ? 2 : 3;

      products.sort((a, b) => {
        const rankDiff = (rankMap.get(b.id) ?? 0) - (rankMap.get(a.id) ?? 0);
        if (rankDiff !== 0) return rankDiff;
        const sortDiff = a.sortOrder - b.sortOrder;
        if (sortDiff !== 0) return sortDiff;
        return lineOrder(a.line) - lineOrder(b.line);
      });

      const page_data = products.slice(skip, skip + limit);
      const total = products.length;
      return {
        data: await this.attachOmnibusData(page_data),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    if (query.sortBy === 'price_asc' || query.sortBy === 'price_desc') {
      const products = await this.prisma.product.findMany({ where, select: PRODUCT_SELECT });
      // Products with no active variants get a sentinel that places them last in both directions:
      // Infinity → last in ascending order; -Infinity → last in descending order.
      const sentinel = query.sortBy === 'price_asc' ? Infinity : -Infinity;
      const minPrice = (p: (typeof products)[0]) => p.variants[0]?.priceInCents ?? sentinel;
      products.sort((a, b) =>
        query.sortBy === 'price_asc' ? minPrice(a) - minPrice(b) : minPrice(b) - minPrice(a),
      );
      const page_data = products.slice(skip, skip + limit);
      const total = products.length;
      return {
        data: await this.attachOmnibusData(page_data),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    // Curated interleaving for the perfumes parent category:
    // 5 Millesime → 5 Luxury per round. Skipped when any filter is active.
    // Slim query for ordering, full includes only for the current page.
    if (
      query.category === 'perfume' &&
      !query.featured &&
      (!query.sortBy || query.sortBy === 'relevance') &&
      !query.brand && !query.gender?.length && !query.scentFamily?.length &&
      !query.line?.length && !hasVariantFilter && !query.search
    ) {
      const slim = await this.prisma.product.findMany({
        where,
        select: { id: true, line: true, category: { select: { slug: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      });

      type Slim = (typeof slim)[0];
      const millesime: Slim[] = [], luxury: Slim[] = [], other: Slim[] = [];

      for (const p of slim) {
        if (p.line === 'Millesime')                                            millesime.push(p);
        else if (p.line === 'Luxury' || p.category?.slug === 'perfume-luxury') luxury.push(p);
        else                                                                   other.push(p);
      }

      const CHUNK = 5;
      const groups = [millesime, luxury];
      const rounds = Math.max(...groups.map(g => Math.ceil(g.length / CHUNK)), 0);
      const interleaved: Slim[] = [];

      for (let r = 0; r < rounds; r++) {
        for (const g of groups) interleaved.push(...g.slice(r * CHUNK, (r + 1) * CHUNK));
      }
      interleaved.push(...other);

      const pageIds = interleaved.slice(skip, skip + limit).map(p => p.id);
      const products = await this.prisma.product.findMany({
        where: { id: { in: pageIds } },
        select: PRODUCT_SELECT,
      });
      const byId = new Map(products.map(p => [p.id, p]));

      const page_data = pageIds.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => p != null);
      return {
        data: await this.attachOmnibusData(page_data),
        meta: { total: interleaved.length, page, limit, totalPages: Math.ceil(interleaved.length / limit) },
      };
    }

    // Curated interleaving for the default all-products view:
    // 5 Millesime → 5 Luxury → 5 Gels → 5 Diffusers per round.
    // Slim query for ordering, full includes only for the current page.
    if (!query.category && !query.featured && (!query.sortBy || query.sortBy === 'relevance')) {
      const slim = await this.prisma.product.findMany({
        where,
        select: { id: true, line: true, category: { select: { slug: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      });

      type Slim = (typeof slim)[0];
      const millesime: Slim[] = [], luxury: Slim[] = [], gels: Slim[] = [], diffusers: Slim[] = [], other: Slim[] = [];

      for (const p of slim) {
        const slug = p.category?.slug;
        if (slug === 'diffusers')                                              diffusers.push(p);
        else if (slug === 'gels')                                              gels.push(p);
        else if (p.line === 'Millesime')                                       millesime.push(p);
        else if (p.line === 'Luxury' || slug === 'perfume-luxury')             luxury.push(p);
        else                                                                   other.push(p);
      }

      const CHUNK = 5;
      const groups = [millesime, luxury, gels, diffusers];
      const rounds = Math.max(...groups.map(g => Math.ceil(g.length / CHUNK)), 0);
      const interleaved: Slim[] = [];

      for (let r = 0; r < rounds; r++) {
        for (const g of groups) interleaved.push(...g.slice(r * CHUNK, (r + 1) * CHUNK));
      }
      interleaved.push(...other);

      const pageIds = interleaved.slice(skip, skip + limit).map(p => p.id);
      const products = await this.prisma.product.findMany({
        where: { id: { in: pageIds } },
        select: PRODUCT_SELECT,
      });
      const byId = new Map(products.map(p => [p.id, p]));

      const page_data2 = pageIds.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => p != null);
      return {
        data: await this.attachOmnibusData(page_data2),
        meta: { total: interleaved.length, page, limit, totalPages: Math.ceil(interleaved.length / limit) },
      };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: PRODUCT_SELECT,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: await this.attachOmnibusData(products),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getFacets(query: { category?: string }) {
    const version = await this.getCacheVersion();
    const key = `facets:v${version}:${query.category ?? 'all'}`;
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch {}

    const categorySlugs = query.category ? await this.resolveCategorySlugs(query.category) : undefined;

    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
        ...(categorySlugs && { category: { slug: { in: categorySlugs } } }),
      },
      select: { scentFamily: true, gender: true },
    });

    const scentFamilies = [...new Set(
      products.map((p) => p.scentFamily).filter((s): s is string => s != null),
    )].sort();

    const genders = [...new Set(
      products.map((p) => p.gender).filter((g): g is string => g != null),
    )];

    const result = { scentFamilies, genders };
    try {
      await this.redis.setex(key, 600, JSON.stringify(result));
    } catch {}
    return result;
  }

  /**
   * Note vocabulary for the fragrance finder, most common first.
   *
   * Derived from the catalog rather than hardcoded, so it can never drift out of
   * sync with what is actually purchasable. Each entry carries both the
   * normalized key (what the match endpoint expects) and a display label — the
   * most frequently used raw spelling, since `notes` stores capitalized, accented
   * strings as printed on the data sheet ("Jaśmin", not "jasmin").
   *
   * The catalog has ~255 distinct notes with a long tail; showing all of them
   * would be a worse UI than showing none. The default cut keeps the head of the
   * distribution, which covers roughly 60% of all note occurrences.
   */
  async getFinderNotes(limit = FINDER_NOTE_VOCABULARY_SIZE): Promise<FinderNote[]> {
    const take = Math.min(Math.max(limit, 1), 60);
    const version = await this.getCacheVersion();
    const key = `finder_notes:v${version}:${take}`;
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as FinderNote[];
    } catch {}

    const rows = await this.prisma.$queryRaw<Array<{ key: string; label: string; count: bigint }>>`
      SELECT norm AS key,
             (array_agg(raw ORDER BY c DESC, raw ASC))[1] AS label,
             SUM(c) AS count
      FROM (
        SELECT normalize_search_text(n) AS norm, btrim(n) AS raw, COUNT(*) AS c
        FROM products p, unnest(p.notes) AS n
        WHERE p."isActive" = true
          AND p."status" IN ('ACTIVE', 'OUT_OF_STOCK')
          AND normalize_search_text(n) <> ''
        GROUP BY 1, 2
      ) t
      GROUP BY norm
      ORDER BY count DESC, norm ASC
      LIMIT ${take}
    `;

    const result: FinderNote[] = rows.map((r) => ({
      key: r.key,
      label: r.label,
      count: Number(r.count),
    }));

    try {
      await this.redis.setex(key, 3600, JSON.stringify(result));
    } catch {}
    return result;
  }

  /**
   * Ranks products by how well their olfactory pyramid covers the notes the
   * shopper picked.
   *
   * Scoring is recall-dominant: `recall * 100 + precision * 20`, where recall is
   * the share of WANTED notes the product covers and precision is the share of
   * the PRODUCT's notes that were wanted. Recall decides the ordering — a shopper
   * who picks "wanilia + tonka" wants both, and a product carrying both must beat
   * one carrying only vanilla. Precision is the tie-break that stops a 20-note
   * pyramid from outranking a focused one purely by surface area.
   *
   * The `&&` overlap prefilter runs against the GIN-indexed `notesNormalized`
   * column, so the scored candidate set is only products sharing at least one
   * selected note — never the whole catalog.
   */
  async matchByNotes(query: {
    notes: string[];
    gender?: string[];
    category?: string;
    exclude?: string;
    limit?: number;
  }): Promise<{ data: unknown[]; meta: { total: number; limit: number } }> {
    // Normalized with the SAME normalizer that built `notesNormalized`, so the
    // endpoint accepts either the keys handed out by /products/finder/notes or
    // raw display strings straight off a product ("Drzewo sandałowe"). The
    // product page relies on the latter to ask for "more like this".
    const wanted = [...new Set(query.notes.map(normalizeSearchText).filter(Boolean))];
    const limit = Math.min(query.limit ?? 12, 48);

    if (!wanted.length) return { data: [], meta: { total: 0, limit } };

    const version = await this.getCacheVersion();
    const key = `finder_match:v${version}:${createHash('sha256')
      .update(JSON.stringify({ w: [...wanted].sort(), g: query.gender?.slice().sort(), c: query.category, x: query.exclude, limit }))
      .digest('hex')
      .slice(0, 16)}`;
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch {}

    const categorySlugs = query.category ? await this.resolveCategorySlugs(query.category) : undefined;

    // Gender and category are filtered INSIDE the ranking query, not afterwards.
    // Filtering a LIMITed result set would silently return fewer rows than asked
    // for — or none at all, as "wanilia + dyfuzory" did, because every diffuser
    // sat below the globally top-scoring perfumes that the LIMIT had already
    // taken.
    const filters: Prisma.Sql[] = [];
    if (query.gender?.length) {
      filters.push(Prisma.sql`AND p.gender = ANY(${query.gender}::text[])`);
    }
    if (categorySlugs?.length) {
      filters.push(Prisma.sql`AND c.slug = ANY(${categorySlugs}::text[])`);
    }
    if (query.exclude) {
      // Excluded before the LIMIT — the product being viewed is by definition a
      // perfect note match for itself and would otherwise take the top slot.
      filters.push(Prisma.sql`AND p.id <> ${query.exclude}`);
    }

    // Repeated rather than aliased because Postgres cannot reference a
    // SELECT-list alias from a sibling expression. The candidate set is already
    // narrowed by the GIN overlap prefilter, so this evaluates over a handful of
    // rows, not the catalog. Only the SIZE of the intersection is needed here —
    // the human-readable matched notes are derived after hydration, from each
    // product's own `notes`, so the shopper sees "Drzewo sandałowe" and not the
    // normalized key.
    const matchCount = Prisma.sql`
      cardinality(ARRAY(SELECT unnest(p."notesNormalized") INTERSECT SELECT unnest(${wanted}::text[])))::float`;

    const ranked = await this.prisma.$queryRaw<Array<{ id: string; score: number }>>(Prisma.sql`
      SELECT id, score FROM (
        SELECT p.id,
               (
                 ${matchCount} / ${wanted.length}::float * 100
                 + ${matchCount} / NULLIF(cardinality(p."notesNormalized"), 0)::float * 20
               ) AS score
        FROM products p
        JOIN categories c ON c.id = p."categoryId"
        WHERE p."isActive" = true
          AND p."status" IN ('ACTIVE', 'OUT_OF_STOCK')
          AND p."notesNormalized" && ${wanted}::text[]
          ${filters.length ? Prisma.join(filters, ' ') : Prisma.empty}
      ) scored
      WHERE score IS NOT NULL
      ORDER BY score DESC, id ASC
      LIMIT ${limit}
    `);

    if (!ranked.length) return { data: [], meta: { total: 0, limit } };

    const ids = ranked.map((r) => r.id);
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: PRODUCT_SELECT,
    });

    const order = new Map(ids.map((id, i) => [id, i]));
    products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const enriched = await this.attachOmnibusData(products);
    const wantedSet = new Set(wanted);

    // matchedNotes drives the "wspólne nuty" line in the result card — showing
    // WHY a product was suggested is what makes the picker trustworthy.
    //
    // Derived from the product's own `notes` rather than from the SQL
    // intersection, so the shopper sees the display spelling ("Drzewo sandałowe")
    // instead of the normalized key ("drzewo sandalowe"). Deduplicated because a
    // note can legitimately appear twice in one pyramid (heart and base).
    const data = enriched.map((product) => {
      const seen = new Set<string>();
      const matchedNotes: string[] = [];
      for (const note of (product as { notes?: string[] }).notes ?? []) {
        const key = normalizeSearchText(note);
        if (!wantedSet.has(key) || seen.has(key)) continue;
        seen.add(key);
        matchedNotes.push(note.trim());
      }
      return { ...product, matchedNotes };
    });

    const result = { data, meta: { total: data.length, limit } };
    try {
      await this.redis.setex(key, 600, JSON.stringify(result));
    } catch {}
    return result;
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException('Product not found');
    const [enriched] = await this.attachOmnibusData([product]);
    return enriched;
  }

  async create(data: {
    name: string;
    slug: string;
    categoryId: string;
    description?: string;
    shortDescription?: string;
    brand?: string;
    status?: ProductStatus;
    estimatedRestockDate?: string;
    isActive?: boolean;
    isFeatured?: boolean;
    inspiredBy?: string;
    scentFamily?: string;
    notes?: string[];
    pyramidTop?: string;
    pyramidHeart?: string;
    pyramidBase?: string;
    gender?: string;
    sortOrder?: number;
  }) {
    const { categoryId, ...rest } = data;
    try {
      const product = await this.prisma.product.create({
        data: { ...rest, category: { connect: { id: categoryId } } },
        select: PRODUCT_SELECT,
      });
      this.invalidateProductCaches();
      return product;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Slug already in use');
      }
      throw err;
    }
  }

  async update(id: string, data: {
    name?: string;
    slug?: string;
    categoryId?: string;
    description?: string;
    shortDescription?: string;
    brand?: string;
    status?: ProductStatus;
    estimatedRestockDate?: string;
    isActive?: boolean;
    isFeatured?: boolean;
    inspiredBy?: string;
    scentFamily?: string;
    notes?: string[];
    pyramidTop?: string;
    pyramidHeart?: string;
    pyramidBase?: string;
    gender?: string;
    sortOrder?: number;
  }) {
    await this.ensureExists(id);
    const { categoryId, ...rest } = data;
    const prismaData: Prisma.ProductUpdateInput = { ...rest };
    if (categoryId) {
      prismaData.category = { connect: { id: categoryId } };
    }
    try {
      const product = await this.prisma.product.update({ where: { id }, data: prismaData, select: PRODUCT_SELECT });
      this.invalidateProductCaches();
      return product;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Slug already in use');
      }
      throw err;
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const product = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { isActive: false },
      });
      await tx.productVariant.updateMany({
        where: { productId: id },
        data: { isActive: false },
      });
      return updated;
    });
    this.invalidateProductCaches();
    return product;
  }

  async createVariant(productId: string, data: {
    sku: string;
    label: string;
    priceInCents: number;
    volume?: number;
    weight?: number;
    compareAtPriceInCents?: number;
    stock?: number;
    isActive?: boolean;
  }) {
    const variant = await this.prisma.productVariant.create({
      data: { ...data, product: { connect: { id: productId } } },
    });
    await this.prisma.productVariantPriceHistory.create({
      data: { variantId: variant.id, priceInCents: variant.priceInCents },
    });
    return variant;
  }

  async updateVariant(variantId: string, data: {
    sku?: string;
    label?: string;
    priceInCents?: number;
    volume?: number;
    weight?: number;
    compareAtPriceInCents?: number;
    stock?: number;
    isActive?: boolean;
  }) {
    const { variant, previousStock } = await this.prisma.$transaction(async (tx) => {
      let previousStock: number | undefined;
      if (data.stock !== undefined) {
        // Same FOR UPDATE pattern as updateVariantStock — holds the row lock so the
        // before-value reported to notifyStockChange can't be clobbered by a concurrent
        // mutation landing between this read and the write below.
        const rows = await tx.$queryRaw<Array<{ stock: number }>>`
          SELECT stock FROM "product_variants" WHERE id = ${variantId} FOR UPDATE
        `;
        const current = rows[0];
        if (!current) throw new NotFoundException('Variant not found');
        previousStock = current.stock;
      }
      const variant = await tx.productVariant.update({ where: { id: variantId }, data });
      return { variant, previousStock };
    });

    if (data.priceInCents !== undefined) {
      await this.prisma.productVariantPriceHistory.create({
        data: { variantId: variant.id, priceInCents: variant.priceInCents },
      });
    }

    if (previousStock !== undefined) {
      this.notifyStockChange({
        variantId: variant.id,
        productId: variant.productId,
        variantLabel: variant.label,
        previousStock,
        newStock: variant.stock,
      });
    }

    return variant;
  }

  async deleteVariant(variantId: string): Promise<void> {
    const orderItemCount = await this.prisma.orderItem.count({
      where: { productVariantId: variantId },
    });
    if (orderItemCount > 0) {
      throw new ConflictException(
        `Variant ${variantId} is referenced by ${orderItemCount} order item(s) and cannot be deleted`,
      );
    }
    const cartItemCount = await this.prisma.cartItem.count({
      where: { productVariantId: variantId },
    });
    if (cartItemCount > 0) {
      throw new ConflictException(
        `Variant ${variantId} is in ${cartItemCount} active cart(s) — soft-deactivate instead of deleting`,
      );
    }
    await this.prisma.productVariant.delete({ where: { id: variantId } });
  }

  async updateVariantStock(variantId: string, dto: { set?: number; adjustment?: number }, actorId?: string) {
    const { updated, previousStock } = await this.prisma.$transaction(async (tx) => {
      // SELECT ... FOR UPDATE holds the row lock for this transaction's lifetime, so a
      // concurrent adjustment call blocks here and reads the post-commit stock — closing
      // the TOCTOU window a separate findUnique + update left open (two concurrent reads
      // of the same stale stock, both clobbering each other's write).
      const rows = await tx.$queryRaw<Array<{ stock: number; productId: string; label: string }>>`
        SELECT stock, "productId", label FROM "product_variants" WHERE id = ${variantId} FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new NotFoundException('Variant not found');

      const newStock = dto.set !== undefined
        ? dto.set
        : Math.max(0, current.stock + (dto.adjustment ?? 0));

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: newStock },
      });

      return { updated, previousStock: current.stock };
    });

    this.logger.log({ variantId, before: previousStock, after: updated.stock, actor: actorId ?? 'unknown' }, 'stock_update');

    this.notifyStockChange({
      variantId,
      productId: updated.productId,
      variantLabel: updated.label,
      previousStock,
      newStock: updated.stock,
    });
    this.invalidateProductCaches();
    return updated;
  }

  /**
   * Single choke point for every ProductVariant.stock mutation, in this service
   * or any other (orders/payments checkout decrements, cancellation/refund/
   * dispute restores). Publishes the live-stock SSE update and, when stock
   * crosses 0 → >0, fires the back-in-stock notifier. Call this once a stock
   * mutation has committed — never from inside an open transaction, since the
   * write could still roll back.
   */
  notifyStockChange(change: StockChange): void {
    const { variantId, productId, variantLabel, previousStock, newStock } = change;
    if (previousStock === 0 && newStock > 0) {
      this.dispatchBackInStockNotifications(productId, variantLabel).catch((err) => this.logger.warn('Back-in-stock notification failed', err));
    }
    this.redis.publish('stock:updates', JSON.stringify({ id: variantId, stock: newStock })).catch(() => {});
  }

  /**
   * Same choke point as notifyStockChange, for callers that only know the net
   * change applied inside a transaction (e.g. `{ stock: { increment: qty } }`)
   * rather than the before/after values directly. `newStock` must be captured
   * by the caller from within its own transaction (e.g. the row returned by
   * `tx.productVariant.update()`, or a `SELECT` issued right after an
   * `updateMany`) — never re-read here after commit, since a concurrent
   * delta batch for the same variant may have already committed its own
   * change in between, making a post-commit read indistinguishable from
   * this batch's own effect.
   *
   * When a batch carries more than one delta for the same variant, entries
   * must be in transaction-commit order — aggregation below verifies this
   * rather than assuming it silently.
   */
  async notifyStockChangesByDelta(deltas: Array<{ variantId: string; delta: number; newStock: number }>): Promise<void> {
    if (!deltas.length) return;

    // A single batch can carry more than one delta for the same variant (e.g.
    // two order items pointing at the same variant) — aggregate so each variant
    // fires exactly one notification with its net before/after stock for this batch.
    const aggregated = new Map<string, { delta: number; newStock: number }>();
    for (const { variantId, delta, newStock } of deltas) {
      const existing = aggregated.get(variantId);
      if (existing) {
        // This entry's own previousStock (newStock - delta) must equal the prior
        // entry's newStock — true only if entries for this variant are in
        // transaction-commit order. Every current caller satisfies this by
        // construction (sequential for loops), but nothing in the signature
        // enforces it — a future caller built around Promise.all could violate
        // it and silently mis-derive previousStock below. Fail loudly instead.
        const impliedPreviousStock = newStock - delta;
        if (impliedPreviousStock !== existing.newStock) {
          throw new Error(
            `notifyStockChangesByDelta: deltas for variant ${variantId} are out of transaction-commit order ` +
              `(this entry implies previous stock ${impliedPreviousStock}, but the prior entry in this batch ended at ${existing.newStock})`,
          );
        }
      }
      aggregated.set(variantId, {
        delta: (existing?.delta ?? 0) + delta,
        newStock, // later entries reflect the cumulative post-update value for this variant
      });
    }

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: [...aggregated.keys()] } },
      select: { id: true, productId: true, label: true },
    });
    for (const variant of variants) {
      const agg = aggregated.get(variant.id);
      if (!agg) continue;
      this.notifyStockChange({
        variantId: variant.id,
        productId: variant.productId,
        variantLabel: variant.label,
        previousStock: agg.newStock - agg.delta,
        newStock: agg.newStock,
      });
    }
  }

  private async dispatchBackInStockNotifications(productId: string, variantLabel: string): Promise<void> {
    const wishlistItems = await this.prisma.wishlistItem.findMany({
      where: {
        productId,
        notifyOnRestock: true,
        NOT: {
          user: {
            orders: {
              some: {
                status: OrderStatus.DELIVERED,
                items: { some: { productVariant: { productId } } },
              },
            },
          },
        },
      },
      include: {
        user: { select: { email: true, firstName: true } },
        product: { select: { name: true, slug: true } },
      },
    });

    if (!wishlistItems.length) return;

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');

    // Enqueue first — the processor resets notifyOnRestock after confirmed delivery.
    // Resetting the flag here (before enqueue) would silently discard all notifications
    // on a crash or Redis failure between the updateMany and queue.add.
    await Promise.allSettled(
      wishlistItems.map((item) =>
        this.emailService
          .sendBackInStock({
            to: item.user.email,
            firstName: item.user.firstName ?? '',
            productName: item.product.name,
            variantLabel,
            productUrl: `${frontendUrl}/products/${item.product.slug}`,
            wishlistItemId: item.id,
          })
          .catch((err) => this.logger.error(`Back-in-stock enqueue failed for ${item.user.email}: ${err.message}`)),
      ),
    );

    this.logger.log(`Back-in-stock: notified ${wishlistItems.length} user(s) for product ${productId}`);
  }

  async addImage(productId: string, url: string, storagePath: string, altText?: string) {
    const count = await this.prisma.productImage.count({ where: { productId } });
    return this.prisma.productImage.create({
      data: {
        productId,
        url,
        storagePath,
        altText,
        isPrimary: count === 0,
        sortOrder: count,
      },
    });
  }

  async removeImage(imageId: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Image not found');
    if (image.storagePath) {
      await this.storageService.deleteFile('product-images', image.storagePath)
        .catch((err) => this.logger.warn(`Supabase delete failed: ${image.storagePath}`, err));
    }

    // Re-promotion runs in the same transaction as the delete to avoid a race
    // with a concurrent addImage() landing in the gap and leaving two primaries
    // (or, worse, zero) for this product.
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });
      if (image.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { productId: image.productId },
          orderBy: { sortOrder: 'asc' },
        });
        if (next) {
          await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      }
    });

    return image;
  }

  /**
   * Shared matcher for `findAll({ search })` and `suggest()` — returns product ids
   * ordered by relevance, most relevant first.
   *
   * Matching runs against `products."searchText"`, a normalized haystack kept in
   * sync by a DB trigger (see the 20260801120000_product_search_text migration).
   * Because both sides of every comparison are normalized the same way, this is
   * case-, accent- and punctuation-insensitive by construction: "lancome" finds
   * "Lancôme", "d&g" and "DG" both find "Dolce & Gabbana".
   *
   * Recall model — every token must match, in any order:
   *   - substring hit  `"searchText" LIKE '%dolce%'`   (index: gin_trgm_ops)
   *   - trigram hit    `'dolcce' <% "searchText"`      (index: gin_trgm_ops)
   * The trigram fallback is applied only to tokens of at least
   * FUZZY_MIN_TOKEN_LENGTH characters — word similarity on a 2–3 character token
   * matches almost the whole catalog.
   *
   * If the AND pass finds nothing, a second pass runs the same predicates with OR
   * plus a coverage floor: at least half the tokens (rounded up) must still match.
   * That keeps "tom frod" useful — "tom" alone carries it — while stopping a query
   * like "zapach do samochodu" from returning every product whose text happens to
   * contain the two-letter token "do". Without the floor the relaxed pass degrades
   * into "return the catalog", which is worse for the shopper than an honest miss.
   *
   * Ranking is a weighted sum: field-level phrase hits (catalog number > alias >
   * brand > reference name > inspiredBy > product name) dominate, token coverage
   * breaks ties between partial matches, and trigram word similarity provides a
   * final continuous tie-break so near-misses order sensibly among themselves.
   */
  private async rankedSearchIds(
    parsed: ParsedSearchQuery,
    take: number,
  ): Promise<Array<{ id: string; rank: number }>> {
    const { phrase, rawPhrase, tokens } = parsed;

    const tokenPredicate = (token: string) =>
      token.length >= FUZZY_MIN_TOKEN_LENGTH
        ? Prisma.sql`(p."searchText" LIKE ${`%${token}%`} OR ${token} <% p."searchText")`
        : Prisma.sql`(p."searchText" LIKE ${`%${token}%`})`;

    const predicates = tokens.map(tokenPredicate);

    // Every token contributes an equal coverage bonus, so a row matching 3 of 4
    // tokens always outranks one matching 2 — this is what orders the OR pass.
    const coverage = Prisma.join(
      tokens.map((token) => Prisma.sql`CASE WHEN p."searchText" LIKE ${`%${token}%`} THEN 8 ELSE 0 END`),
      ' + ',
    );

    const rank = Prisma.sql`CAST(
      CASE WHEN normalize_search_text(p."catalogNumber") = ${phrase}                      THEN 140 ELSE 0 END
    + CASE WHEN normalize_search_text(p."catalogNumber") LIKE ${`${phrase}%`}             THEN  70 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM unnest(lr.aliases) alias
         WHERE normalize_search_text(alias) IN (${phrase}, ${rawPhrase})
      )                                                                                   THEN 100 ELSE 0 END
    + CASE WHEN normalize_search_text(lr.brand)     LIKE ${`%${phrase}%`}                 THEN  55 ELSE 0 END
    + CASE WHEN normalize_search_text(lr.name)      LIKE ${`%${phrase}%`}                 THEN  45 ELSE 0 END
    + CASE WHEN normalize_search_text(p."inspiredBy") LIKE ${`%${phrase}%`}               THEN  35 ELSE 0 END
    + CASE WHEN normalize_search_text(p.name)       LIKE ${`${phrase}%`}                  THEN  30 ELSE 0 END
    + CASE WHEN normalize_search_text(p.name)       LIKE ${`%${phrase}%`}                 THEN  20 ELSE 0 END
    + CASE WHEN p."searchText" LIKE ${`%${phrase}%`}                                      THEN  12 ELSE 0 END
    + ${coverage}
    + ROUND(30 * word_similarity(${phrase}, p."searchText"))
    AS INTEGER)`;

    const run = (match: Prisma.Sql) =>
      this.prisma.$queryRaw<Array<{ id: string; rank: number }>>(Prisma.sql`
        SELECT p.id, ${rank} AS rank
        FROM products p
        LEFT JOIN luxury_references lr ON lr.id = p."luxuryReferenceId"
        WHERE p."isActive" = true
          AND p."status" != 'DISCONTINUED'
          AND (${match})
        ORDER BY rank DESC, p."sortOrder" ASC, p.id ASC
        LIMIT ${take}
      `);

    const strict = await run(Prisma.join(predicates, ' AND '));
    if (strict.length || tokens.length < 2) {
      return strict.map((row) => ({ id: row.id, rank: Number(row.rank) }));
    }

    // Counts tokens matched by EITHER predicate branch, so a purely fuzzy hit
    // ("dolcce") still counts toward the floor even though it contributes no
    // substring coverage to the rank.
    const matchedTokenCount = Prisma.join(
      predicates.map((predicate) => Prisma.sql`CASE WHEN ${predicate} THEN 1 ELSE 0 END`),
      ' + ',
    );
    const minMatchedTokens = Math.ceil(tokens.length / 2);

    // The OR stays in front of the floor on purpose: it is the index-driven part
    // the planner can turn into bitmap scans, while the arithmetic floor is a
    // post-filter over that candidate set.
    const relaxed = await run(Prisma.sql`
      (${Prisma.join(predicates, ' OR ')})
      AND (${matchedTokenCount}) >= ${minMatchedTokens}
    `);
    return relaxed.map((row) => ({ id: row.id, rank: Number(row.rank) }));
  }

  async suggest(q: string): Promise<SuggestResult[]> {
    const parsed = parseSearchQuery(q);
    if (!parsed.isUsable) return [];

    const version = await this.getCacheVersion();
    // Keyed on the normalized+expanded phrase rather than the raw input, so
    // "D&G", "d & g" and "dg" all share one cache entry.
    const cacheKey = `suggest:v${version}:${parsed.phrase}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as SuggestResult[];
    } catch {}

    const rows = await this.rankedSearchIds(parsed, SUGGEST_LIMIT);

    if (!rows.length) return [];

    const ids = rows.map(r => r.id);
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        slug: true,
        catalogNumber: true,
        category: { select: { name: true } },
        images: {
          orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
          take: 1,
          select: { url: true },
        },
        variants: {
          where: { isActive: true },
          orderBy: { priceInCents: 'asc' as const },
          take: 1,
          select: { priceInCents: true, label: true },
        },
      },
    });

    const byId = new Map(products.map(p => [p.id, p]));
    const results = ids
      .map(id => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null);

    try {
      await this.redis.setex(cacheKey, 600, JSON.stringify(results));
    } catch {}

    return results;
  }

  private searchCacheKey(query: FindAllQuery, version: string): string {
    const params = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
      .join('&');
    return `search:v${version}:${createHash('sha256').update(params).digest('hex').slice(0, 16)}`;
  }

  createStockStream(variantIds: string[]): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const idSet = new Set(variantIds);
      const seen = new Map<string, number>();
      let innerSub: Subscription | null = null;

      // Fetch current snapshot first, then subscribe to push updates.
      // Ordering: snapshot before Subject subscription avoids emitting stale
      // pre-snapshot state; any updates missed during the query are tolerable
      // (the client reconnects on idle timeout or page reload).
      this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, stock: true },
      }).then((rows) => {
        if (subscriber.closed) return;
        for (const r of rows) seen.set(r.id, r.stock);
        subscriber.next({ data: rows } as MessageEvent);

        innerSub = this.stockUpdates$.pipe(
          filter((u) => idSet.has(u.id)),
        ).subscribe({
          next: (u) => {
            if (seen.get(u.id) !== u.stock) {
              seen.set(u.id, u.stock);
              subscriber.next({ data: [u] } as MessageEvent);
            }
          },
          error: (err) => subscriber.error(err),
        });
      }).catch((err) => subscriber.error(err));

      return () => { innerSub?.unsubscribe(); };
    });
  }

  async findRelated(slug: string, limit = 6) {
    const version = await this.getCacheVersion();
    const cacheKey = `related:v${version}:${slug}:${limit}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}

    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true, categoryId: true },
    });
    if (!product) return [];

    const raw = await this.prisma.product.findMany({
      where: { isActive: true, status: { in: ['ACTIVE', 'OUT_OF_STOCK'] }, categoryId: product.categoryId, id: { not: product.id } },
      select: PRODUCT_SELECT,
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
      take: limit,
    });

    const related = await this.attachOmnibusData(raw);

    try {
      await this.redis.setex(cacheKey, 300, JSON.stringify(related));
    } catch {}

    return related;
  }

  // EU Omnibus Directive (2019/2161) Art. 6a — compute the lowest price charged
  // in the preceding 30 days for variants that have an active promotional price.
  // A variant only qualifies for the promo display once its price history
  // actually spans the full 30-day window (i.e. has a row recorded at or before
  // the window start) — otherwise the "lowest price in 30 days" claim can't be
  // backed by real data (e.g. seed/bulk-imported variants with no history),
  // and showing the current promotional price as the verified minimum would be
  // misleading under UOKiK guidance. Such variants have their promo fields
  // suppressed until 30 days of history accumulate.
  async attachOmnibusData<T extends {
    avgRating?: Prisma.Decimal | number | null;
    variants: Array<{ id: string; priceInCents: number; compareAtPriceInCents?: number | null }>;
  }>(products: T[]): Promise<T[]> {
    const promoVariantIds = products.flatMap(p =>
      p.variants.filter(v => v.compareAtPriceInCents != null).map(v => v.id),
    );

    const minMap = new Map<string, number>();
    const verifiedVariantIds = new Set<string>();
    if (promoVariantIds.length) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Find which variants actually have 30-day-old history first — only those
      // are eligible for a displayed "lowest price" promo. Skip the min-price
      // scan entirely when nothing qualifies, instead of always paying for both
      // queries.
      const earliestRows = await this.prisma.productVariantPriceHistory.findMany({
        where: { variantId: { in: promoVariantIds }, recordedAt: { lte: thirtyDaysAgo } },
        select: { variantId: true },
        distinct: ['variantId'],
      });
      for (const r of earliestRows) verifiedVariantIds.add(r.variantId);

      if (verifiedVariantIds.size) {
        const allMins = await this.prisma.productVariantPriceHistory.groupBy({
          by: ['variantId'],
          where: { variantId: { in: [...verifiedVariantIds] }, recordedAt: { gte: thirtyDaysAgo } },
          _min: { priceInCents: true },
        });
        for (const m of allMins) {
          if (m._min.priceInCents != null) {
            minMap.set(m.variantId, m._min.priceInCents);
          }
        }
      }
    }

    return products.map(p => ({
      ...p,
      avgRating: p.avgRating != null ? Number(p.avgRating) : null,
      variants: p.variants.map(v => {
        // compareAtPriceInCents must actually be a higher "was" price — guards against
        // AdminJS data-entry mistakes (swapped values, stale value after a price hike)
        // reaching the storefront as a fake discount (Omnibus directive compliance).
        const isValidPromo = v.compareAtPriceInCents != null && v.compareAtPriceInCents > v.priceInCents;
        const hasVerifiedHistory = isValidPromo && verifiedVariantIds.has(v.id);
        return {
          ...v,
          compareAtPriceInCents: hasVerifiedHistory ? v.compareAtPriceInCents : null,
          lowestPrice30dInCents: hasVerifiedHistory ? (minMap.get(v.id) ?? v.priceInCents) : null,
        };
      }),
    })) as unknown as T[];
  }

  private invalidateProductCaches(): void {
    // Increment a monotonic version counter instead of scanning all keys.
    // All cache keys embed the current version, so a stale version means a
    // guaranteed cache miss — no scanStream, no race conditions.
    this.redis.incr('product_cache_v').catch(() => undefined);
  }

  private async getCacheVersion(): Promise<string> {
    try {
      return (await this.redis.get('product_cache_v')) ?? '0';
    } catch {
      return '0';
    }
  }

  private async ensureExists(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }
}

export interface SuggestResult {
  id: string;
  name: string;
  slug: string;
  catalogNumber: string | null;
  category: { name: string };
  images: Array<{ url: string }>;
  variants: Array<{ priceInCents: number; label: string }>;
}

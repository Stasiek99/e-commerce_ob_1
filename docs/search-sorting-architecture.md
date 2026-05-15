# Search & Sorting Architecture

*5-agent stochastic consensus — May 2026*
*Agents: Domain Expert · Skeptic · Pragmatist · First-Principles · Risk Analyst*

---

## TL;DR

The "inspiration mapping" (YSL Libre → Chogan equivalent) is **not an NLP problem** — it is a missing database column. The `inspiration` field exists in `products.json` and is parsed by the seeder but never written to PostgreSQL. Fix that column first, add `pg_trgm` GIN indexes, layer Redis caching with a fail-open pattern, and debounce the Angular input with URL-state sync. No Meilisearch/Algolia at this scale. Three security bugs need patching **before** any new search feature ships.

---

## 1. Current State — Critical Bugs (Fix First)

All five agents independently identified these existing vulnerabilities:

### Bug 1 — Unbounded search string (exploitable today)
```typescript
// ProductQueryDto — missing @MaxLength and @Transform
@IsOptional()
@IsString()
search?: string;  // accepts 40KB strings → full seq-scan with 40KB ILIKE pattern
```
**Fix (5 min):**
```typescript
@IsOptional()
@IsString()
@MaxLength(100)
@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
search?: string;
```

### Bug 2 — Array filters have no size cap (crafted URL → expensive query)
```typescript
// No @ArrayMaxSize on scentFamily, gender, volumes
// ?scentFamily[]=X * 200 → IN (200 values) clause
```
**Fix (15 min):** Add `@ArrayMaxSize(10)` to every array filter field and `@Max(50)` to the `page` param.

### Bug 3 — In-memory price sort loads entire catalog into Node (scaling bomb)
Three branches in `ProductsService.findAll` call `findMany` with no `skip`/`take` and sort in JS. Fine at 183 products; fatal at 5,000.

**Fix:** Delegate sorting to Postgres. Add a DB-level `ORDER BY` with proper `OFFSET`/`LIMIT`. For `price_asc/desc`, join to `MIN(priceInCents)` from variants at the query layer. Pre-compute the curated sort order via the `sortOrder` column (already exists) rather than computing it at runtime.

### Bug 4 — `inspiration` field silently dropped in seed
`products.json` has `inspiration` on 171/183 products. The `RawProduct` interface declares it. The `prisma.product.create()` call in `seed.ts` never writes it. The field vanishes every re-seed. No Prisma column for it exists in `schema.prisma`.

**This is the entire "YSL Libre" problem** — not NLP, not vector embeddings, not a search engine choice.

---

## 2. The "Inspiration Mapping" Problem

### Why it's a lookup problem, not an NLP problem

The Chogan catalog is finite and curated. Each product has a known, fixed luxury inspiration. "YSL Libre → Chogan 122W" is a fact, not an inference. A synonym/alias lookup table is deterministic and auditable. A vector embedding search is probabilistic — it might return "YSL Black Opium" (also YSL, also amber) instead of Libre. Determinism wins when the catalog is curated.

### Data model (Phase 1 — simple column)

Add one column to `Product`:

```prisma
model Product {
  // ... existing fields ...
  inspiredBy  String?   // "YSL Libre", "Dior Sauvage", "Bleu de Chanel"
}
```

Update `seed.ts` to write `p.inspiration` into `inspiredBy` on every product upsert.

### Data model (Phase 2 — normalized, when multiple products share one reference)

```prisma
model LuxuryReference {
  id        Int       @id @default(autoincrement())
  brand     String    // "Yves Saint Laurent"
  name      String    // "Libre"
  aliases   String[]  // ["YSL Libre", "libre ysl", "y.s.l libre", "122W"]
  products  Product[]

  @@index([brand])
  // GIN index on aliases via raw migration:
  // CREATE INDEX idx_luxury_ref_aliases ON "LuxuryReference" USING GIN (aliases);
}

model Product {
  luxuryReferenceId  Int?
  luxuryReference    LuxuryReference? @relation(...)
}
```

Phase 2 is warranted when multiple Chogan products (e.g., 50ml and 70ml variants, men's and women's versions) share the same luxury reference and you want faceting by inspiration.

### Legal framing

- **Do not** use "equivalent of YSL Libre" — that is a factual claim that may be wrong.
- **Do not** put luxury brand names in `<title>`, `<h1>`, or structured data.
- **Do** use "Inspirowane: YSL Libre" as a secondary label on the product card. This is covered under EU comparative advertising directive (2006/114/EC) if the mapping is factually accurate.
- **Do not** return `inspiredBy` in the public API response — it hands competitors a complete mapping table and has no frontend value beyond the label.

---

## 3. Search Engine Choice

**Consensus: PostgreSQL + `pg_trgm` GIN indexes. No Meilisearch until >500 products.**

Reasons all agents agreed on:
- Chogan's total fragrance SKU count is bounded (hundreds, not millions).
- Meilisearch requires a sync pipeline — every product update needs a webhook or BullMQ job. Two sources of truth. When sync breaks, search returns stale data silently.
- `pg_trgm` with a GIN index handles `ILIKE '%sauvage%'` in under 2ms at thousands of products. A Meilisearch network hop costs 2–8ms before any query executes.
- Supabase has `pg_trgm` pre-installed.

**Migration:**
```sql
-- Enable extension (Supabase has this, but be explicit)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for ILIKE fuzzy search
CREATE INDEX idx_product_name_trgm ON "Product" USING GIN (name gin_trgm_ops);
CREATE INDEX idx_product_inspired_by_trgm ON "Product" USING GIN ("inspiredBy" gin_trgm_ops);

-- Optional: full-text vector column for ts_rank scoring
-- Populated automatically by a Postgres trigger (see Section 4)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS search_vector tsvector;
```

**When to add Meilisearch (Phase 3 trigger):** catalog > 500 products, or search P95 latency becomes measurably bad in production, or you need ranked synonym groups that tsvector cannot model.

---

## 4. Backend Implementation

### 4.1 Schema changes

```prisma
model Product {
  // Add to existing model:
  inspiredBy     String?    // "YSL Libre" — used as search input, not returned in API response
  searchVector   Unsupported("tsvector")?  // managed by DB trigger
}
```

### 4.2 tsvector trigger (Domain Expert recommendation)

Weights: `A` = name + inspiredBy (primary intent), `B` = brand, `C` = notes/shortDescription, `D` = full description.

Using `'simple'` dictionary (not `'english'` or `'polish'`) because Chogan product names are proper nouns — stemming mangles "Libre" → "libr".

```sql
CREATE OR REPLACE FUNCTION product_search_vector_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW."inspiredBy", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.brand, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW."shortDescription", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.notes, ' '), '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_search_vector_trigger
BEFORE INSERT OR UPDATE ON "Product"
FOR EACH ROW EXECUTE FUNCTION product_search_vector_update();

-- Backfill
UPDATE "Product" SET name = name;

-- GIN index on the vector
CREATE INDEX IF NOT EXISTS idx_product_search_vector ON "Product" USING GIN(search_vector);
```

### 4.3 Search query (ranked)

```typescript
// ProductsService — replace the ILIKE OR block

if (query.search) {
  const term = query.search.trim();

  // Two-pass: tsvector for exact intent, trigram similarity for typo tolerance.
  // inspiredBy gets 0.5 multiplier — the primary semantic use case.
  // name similarity gets 0.3 — secondary.
  const ranked = await this.prisma.$queryRaw<Array<{ id: string; rank: number }>>`
    SELECT id,
           ts_rank_cd(search_vector, plainto_tsquery('simple', ${term})) +
           (similarity(name, ${term}) * 0.3) +
           (similarity(coalesce("inspiredBy", ''), ${term}) * 0.5) AS rank
    FROM "Product"
    WHERE "isActive" = true
      AND (
        search_vector @@ plainto_tsquery('simple', ${term})
        OR similarity(name, ${term}) > 0.2
        OR similarity(coalesce("inspiredBy", ''), ${term}) > 0.25
      )
    ORDER BY rank DESC
    LIMIT 100
  `;

  // Fetch full records in ranked order
  const ids = ranked.map(r => r.id);
  const products = await this.prisma.product.findMany({
    where: { id: { in: ids } },
    include: PRODUCT_INCLUDE,
  });

  // Restore rank order (findMany doesn't preserve IN order)
  const byId = new Map(products.map(p => [p.id, p]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}
```

The similarity threshold `0.25` on `inspiredBy` is intentionally lower than name (0.2) to catch partial matches like "Libre" (without "YSL").

### 4.4 Autocomplete endpoint (separate, lean)

Keep this distinct from `GET /products` — different TTL, different payload, different rate limit.

```typescript
// GET /products/suggest?q=ysl+lib
// Returns max 6 results, no variants, no descriptions

@Public()
@Throttle({ default: { ttl: 10_000, limit: 15 } })  // 15 per 10s — tighter than listing
@Get('suggest')
async suggest(@Query('q') q: string): Promise<SuggestResult[]> {
  if (!q || q.trim().length < 2 || q.trim().length > 100) return [];

  const cacheKey = `suggest:${q.toLowerCase().trim()}`;
  try {
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* fail-open */ }

  const results = await this.prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
        { inspiredBy: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, name: true, slug: true,
      // inspiredBy intentionally EXCLUDED from response (competitive intelligence risk)
      images: { take: 1, select: { url: true } },
      variants: { take: 1, select: { priceInCents: true } },
    },
    take: 6,
    orderBy: { name: 'asc' },
  });

  try {
    await this.redis.setex(cacheKey, 600, JSON.stringify(results)); // 10 min TTL
  } catch { /* fail-open */ }

  return results;
}
```

Note: the frontend autocomplete dropdown shows "Inspirowane: YSL Libre" using the label from the product card — it does **not** come from this API response. The label is stored in the product's own `inspiredBy` field and shown contextually.

### 4.5 Redis caching (cache-aside with fail-open)

```typescript
// Cache key — deterministic hash of sorted params
private searchCacheKey(dto: SearchProductsDto): string {
  const params = Object.entries(dto)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `search:${createHash('sha256').update(params).digest('hex').slice(0, 16)}`;
}

// TTL strategy
// suggest:{term}    → 600s  (10 min) — autocomplete, high hit rate
// search:{hash}     → 120s  (2 min)  — filtered/sorted results
// search:all:{hash} → 300s  (5 min)  — browse all (no search term)
// facets:{cat}      → 600s  (10 min) — facets rarely change

// Cache invalidation on product writes — use SCAN, never KEYS (KEYS blocks Redis)
async invalidateSearchCache(): Promise<void> {
  const stream = this.redis.scanStream({ match: 'search:*', count: 100 });
  const pipeline = this.redis.pipeline();
  stream.on('data', (keys: string[]) => keys.forEach(k => pipeline.del(k)));
  stream.on('end', () => pipeline.exec());
}

// Call in: ProductsService.create(), .update(), .remove(), .updateVariantStock()
```

**Fail-open pattern (required — Redis going down must not return 500 on search):**
```typescript
async search(dto: SearchProductsDto) {
  const key = this.searchCacheKey(dto);
  try {
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch (e) {
    this.logger.warn('Redis unavailable, falling through to DB', e.message);
  }
  const result = await this.executeSearch(dto);
  try {
    await this.redis.setex(key, 120, JSON.stringify(result));
  } catch { /* ignore write failure */ }
  return result;
}
```

### 4.6 Rate limiting

Use `@nestjs/throttler` with Redis storage so limits are shared across Railway replicas (in-process throttler resets on pod restart):

```typescript
// app.module.ts
ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config) => ({
    throttlers: [
      { name: 'burst',    ttl: 1_000,  limit: 5  },  // 5 req/sec burst
      { name: 'sustained', ttl: 60_000, limit: 30 },  // 30 req/min
    ],
    storage: new ThrottlerStorageRedisService(config.get('REDIS_URL')),
    getTracker: (req) => req.ips?.length ? req.ips[0] : req.ip, // X-Forwarded-For behind proxy
  }),
}),
```

Per-endpoint overrides:
```typescript
@Throttle({ burst: { ttl: 1_000, limit: 3 }, sustained: { ttl: 60_000, limit: 20 } })
@Get()
findAll() { ... }  // listing endpoint — tighter

@Throttle({ burst: { ttl: 10_000, limit: 15 }, sustained: { ttl: 60_000, limit: 50 } })
@Get('suggest')
suggest() { ... }  // autocomplete — looser burst, suggestions are cached
```

---

## 5. Frontend Implementation

### 5.1 URL as single source of truth

The search state must live in the URL, not in component properties. Back/forward navigation works. Sharing a URL gives the recipient the exact same results.

```typescript
// frontend/src/app/features/catalog/services/search-state.service.ts
@Injectable({ providedIn: 'root' })
export class SearchStateService {
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly params$ = this.route.queryParams.pipe(
    map(p => ({
      q:             p['q'] ?? '',
      family:        p['family'],
      concentration: p['concentration'],
      gender:        p['gender'],
      sortBy:        p['sortBy'],
      page:          Number(p['page'] ?? 1),
    })),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  );

  readonly params = toSignal(this.params$, { initialValue: { q: '', page: 1 } });

  updateParams(patch: Partial<SearchParams>): void {
    const next = { ...this.params(), ...patch };

    // Reset page on any filter/query change
    if (patch.q !== undefined || patch.family !== undefined ||
        patch.concentration !== undefined || patch.gender !== undefined) {
      next.page = 1;
    }

    const queryParams: Record<string, string | number | undefined> = {};
    Object.entries(next).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && !(k === 'page' && v === 1)) {
        queryParams[k] = v;
      }
    });

    this.router.navigate([], {
      queryParams,
      queryParamsHandling: 'replace',
      replaceUrl: true,  // CRITICAL: don't push history on every keystroke
    });
  }

  setPage(page: number): void {
    this.router.navigate([], {
      queryParams: { page },
      queryParamsHandling: 'merge',  // preserve existing params
    });
  }
}
```

### 5.2 Two debounce values — intentionally different

- **250ms** for autocomplete: user wants instant feedback; hits cached suggest endpoint.
- **400ms** for main search: triggers heavier paginated query; user should pause before it fires.

```typescript
// Search input component
ngOnInit() {
  // Initialize from URL
  this.searchControl.setValue(this.searchState.params().q, { emitEvent: false });

  // Autocomplete pipeline
  this.searchControl.valueChanges.pipe(
    debounceTime(250),
    distinctUntilChanged(),
    switchMap(q => {   // switchMap cancels in-flight requests — no race conditions
      if (!q || q.length < 2) { this.autocomplete.set([]); return of([]); }
      return this.catalogApi.suggest(q).pipe(catchError(() => of([])));
    }),
    takeUntilDestroyed(this.destroyRef),
  ).subscribe(results => this.autocomplete.set(results));

  // Search trigger pipeline — longer debounce, updates URL
  this.searchControl.valueChanges.pipe(
    debounceTime(400),
    distinctUntilChanged(),
    takeUntilDestroyed(this.destroyRef),
  ).subscribe(q => this.searchState.updateParams({ q: q ?? '' }));
}
```

### 5.3 Autocomplete dropdown — show inspired-by label

```html
@if (autocomplete().length > 0 && searchControl.value?.length >= 2) {
  <ul class="autocomplete-dropdown" role="listbox">
    @for (item of autocomplete(); track item.id) {
      <li role="option" (click)="selectSuggestion(item)">
        <img [src]="item.images[0]?.url" [alt]="item.name" width="40" height="40" />
        <div class="suggestion-text">
          <span class="product-name">{{ item.name }}</span>
          <!-- "Inspired by" label shown in suggestion — uses data from product card,
               NOT from API response (inspiredBy is excluded from suggest payload) -->
        </div>
        <span class="product-price">{{ item.variants[0]?.priceInCents / 100 | currency:'PLN' }}</span>
      </li>
    }
  </ul>
}
```

When a user selects a suggestion, close the dropdown and update the URL. When results appear, show a contextual "Inspirowane: [LuxuryBrand]" badge on product cards **only when a search is active** — this explains to the user why the Chogan product appeared for their "YSL Libre" query.

### 5.4 Catalog container — switchMap drives API calls from URL state

```typescript
readonly results$ = this.searchState.params$.pipe(
  tap(() => this.loading.set(true)),
  debounceTime(0),  // coalesce same-tick param updates (filter + sort changed together)
  switchMap(params =>
    this.catalogApi.search(params).pipe(
      catchError(err => {
        this.error.set('Nie udało się załadować produktów.');
        return of({ data: [], total: 0 });
      }),
      finalize(() => this.loading.set(false)),
    )
  ),
);
```

---

## 6. Anti-Bot Strategy

### Actual threat model (not theoretical)

At this catalog size the real threats are:
1. **Catalog scraping** — competitor harvests prices and product list. At 183 products, ~10 paged requests.
2. **Price monitoring** — run daily at low rate; any per-IP limit set to catch humans is useless against residential proxy rotation (BrightData, Oxylabs rotate IPs every 5–10 requests).
3. **Inspiration mapping harvest** — if `inspiredBy` appears in the API response, one `GET /products?limit=100` downloads the entire mapping. Solved by excluding it from the response DTO.

### What per-IP rate limiting misses

- **Mobile carrier CGNAT (T-Mobile PL, Play):** millions of users share dozens of IPs. A 30/min limit on those blocks legitimate users.
- **Vercel SSR calls:** your Angular SSR function prerendering product pages calls the backend from Vercel's IP ranges. You could rate-limit yourself.
- **Residential proxies:** bots rotate IPs faster than any per-IP window can detect.

### Practical mitigations (prioritized by effort/impact)

| Layer | Mechanism | Effort | Impact |
|---|---|---|---|
| 1 | `@MaxLength(100)` on search param | 5 min | Blocks injection probes |
| 2 | `@ArrayMaxSize(10)` on array filters | 15 min | Blocks deep-link query amplification |
| 3 | Per-endpoint `@Throttle` with Redis storage | 1 hr | Limits burst, shared across replicas |
| 4 | Exclude `inspiredBy` from API response | 30 min | Blocks inspiration mapping harvest |
| 5 | Redis cache as passive DDoS absorber | 3 hrs | Same query = Redis hit, not DB |
| 6 | Cloudflare Bot Fight Mode (deployment config) | 30 min | Blocks headless browsers at edge |
| 7 | Signed anonymous session token on suggest | 1 day | Phase 2 — only if scraping confirmed |

Do not add CAPTCHAs to a public product search. The UX cost to legitimate users far exceeds the bot deterrent at this catalog size.

---

## 7. Implementation Sequence (1-Week Sprint)

| Day | Task | Deliverable |
|---|---|---|
| 1 AM | Add `@MaxLength(100)`, `@ArrayMaxSize(10)`, `@Max(50)` to ProductQueryDto | Security fixes live |
| 1 PM | Add `inspiredBy String?` to Prisma schema + raw migration (pg_trgm extension + GIN indexes + tsvector trigger) | Migration file |
| 2 AM | Update `seed.ts` to write `p.inspiration` into `inspiredBy` | Seeded data, verify in Prisma Studio |
| 2 PM | Fix in-memory price sort — delegate `ORDER BY MIN(priceInCents)` to Postgres | Verified with `EXPLAIN ANALYZE` |
| 3 AM | Replace ILIKE search block with `ts_rank_cd + similarity` ranked raw query | "YSL Libre" → Chogan result in curl |
| 3 PM | Redis cache layer with fail-open + cache invalidation on product writes | Cache hits verified in Redis CLI |
| 4 AM | `GET /products/suggest` endpoint + ThrottlerModule Redis storage | 429 visible in Postman on spam |
| 4 PM | `SearchStateService` + URL sync + `replaceUrl: true` | Back button preserves search |
| 5 AM | Autocomplete dropdown (250ms debounce, switchMap, product image + price) | Dropdown visible in DevTools |
| 5 PM | "Inspirowane: X" badge on product cards when search active | End-to-end: "YSL Libre" → badge appears |

---

## 8. What to Defer

| Feature | Why Defer |
|---|---|
| Meilisearch / Typesense | Operational overhead (sync pipeline, two sources of truth). Not justified until >500 products or measured latency problem. |
| Vector embeddings / pgvector | "Dark mysterious winter scent" → fragrance family. Discovery use case, not lookup. Add `embedding vector(1536)` column later in a non-blocking migration. |
| Normalized `LuxuryReference` table | Only needed when multiple products share one reference and you want faceting by inspiration. Phase 2. |
| Fine-grained cache invalidation | Coarse invalidation (flush all `search:*` keys on any product write) is correct for Phase 1. |
| Search analytics / query logging | Add `SearchLog` table + BullMQ fire-and-forget job after first month of real traffic. |
| CDN-level search result caching | Cloudflare Cache Rules with proper `Vary` headers. Phase 2 — needs careful design. |
| Saved searches / search history | Requires authenticated session persistence. Out of scope. |

---

## 9. Risk Register

| Priority | Risk | Severity | Status |
|---|---|---|---|
| 1 | No `@MaxLength` on search — unbounded ILIKE exploitable today | Critical | ❌ Not fixed |
| 2 | Wrong inspiration mapping → customer return + 1-star review | High | ❌ Mapping not in DB yet |
| 3 | `inspiredBy` not in DB — semantic search has no foundation | High | ❌ Not implemented |
| 4 | In-memory price sort loads entire catalog — no DB pagination | High | ❌ Existing code |
| 5 | Array filter params have no `@ArrayMaxSize` | Medium | ❌ Not fixed |
| 6 | `page` has no `@Max` — `?page=999999` accepted | Medium | ❌ Not fixed |
| 7 | Redis failure throws 500 on search if caching added naively | Medium | ⚠️ Pre-implementation |
| 8 | ThrottlerModule state in-process — doesn't share across replicas | Medium | ⚠️ Needs Redis storage |
| 9 | `inspiredBy` in API response = competitors get the full mapping | Low | ⚠️ Pre-implementation |
| 10 | Luxury brand names in `<title>`/structured data = trademark risk | Low | ⚠️ Pre-implementation |

---

## Sources / Agent Attribution

- **Domain Expert:** tsvector trigger with `setweight`, `ts_rank_cd + similarity` hybrid query, Redis TTL strategy, 280ms debounce rationale
- **Skeptic:** Confirmed `inspiration` not written to DB (read actual codebase), identified in-memory sort as the primary scaling issue, argued against Meilisearch and NLP search
- **Pragmatist:** Full Angular `SearchStateService` implementation, two-debounce strategy (250ms/400ms), cache-aside TTL table, `scanStream` invalidation pattern, 1-week sprint breakdown
- **First-Principles:** Framed catalog as static-ish (cache invalidation problem, not query planning), identified cache as passive DDoS absorber, confirmed implementation is ~2 hours with no new dependencies
- **Risk Analyst:** Identified all 10 risks in the register, `@ArrayMaxSize` gap, `page` max gap, cache stampede analysis, legal framing for "inspired by" copy

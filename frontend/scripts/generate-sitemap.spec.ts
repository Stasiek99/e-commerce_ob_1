/**
 * Tests for the two key algorithms added in
 * "build(sitemap): paginate products and co-generate prerender-routes.txt".
 *
 * generate-sitemap.mjs is a self-executing ESM script and cannot be directly
 * imported in a CommonJS Jest transform without --experimental-vm-modules.
 * The functions below are exact mirrors of their counterparts in the script —
 * any change to the script logic must be reflected here too.
 */

// ── flattenCategories ────────────────────────────────────────────────────────
// Mirrors generate-sitemap.mjs:flattenCategories

type Category = { slug?: string; children?: Category[] };

function flattenCategories(categories: Category[] | undefined | null): Category[] {
  const all: Category[] = [];
  for (const cat of categories ?? []) {
    if (cat?.slug) all.push(cat);
    if (cat?.children?.length) all.push(...flattenCategories(cat.children));
  }
  return all;
}

describe('flattenCategories()', () => {
  it('returns empty array for null / undefined input', () => {
    expect(flattenCategories(null)).toEqual([]);
    expect(flattenCategories(undefined)).toEqual([]);
    expect(flattenCategories([])).toEqual([]);
  });

  it('includes top-level categories that have a slug', () => {
    const result = flattenCategories([{ slug: 'perfumy' }, { slug: 'domy' }]);
    expect(result.map(c => c.slug)).toEqual(['perfumy', 'domy']);
  });

  it('skips categories without a slug', () => {
    const result = flattenCategories([{}, { slug: 'perfumy' }, {}]);
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('perfumy');
  });

  it('recurses one level deep into children', () => {
    const result = flattenCategories([
      {
        slug: 'parent',
        children: [{ slug: 'child-1' }, { slug: 'child-2' }],
      },
    ]);
    expect(result.map(c => c.slug)).toEqual(['parent', 'child-1', 'child-2']);
  });

  it('recurses two levels deep (sub-subcategories)', () => {
    const result = flattenCategories([
      {
        slug: 'l1',
        children: [
          {
            slug: 'l2',
            children: [{ slug: 'l3' }],
          },
        ],
      },
    ]);
    expect(result.map(c => c.slug)).toEqual(['l1', 'l2', 'l3']);
  });

  it('handles a child without a slug while still traversing its own children', () => {
    const result = flattenCategories([
      {
        children: [{ slug: 'grandchild' }],
      },
    ]);
    // Parent has no slug → not included; grandchild has slug → included
    expect(result.map(c => c.slug)).toEqual(['grandchild']);
  });

  it('handles mixed tree with slugged and un-slugged nodes at multiple levels', () => {
    const input: Category[] = [
      { slug: 'root-a', children: [{ slug: 'child-a' }, {}] },
      { children: [{ slug: 'orphan-child' }] },
      { slug: 'root-b' },
    ];
    const result = flattenCategories(input);
    expect(result.map(c => c.slug)).toEqual(['root-a', 'child-a', 'orphan-child', 'root-b']);
  });
});

// ── fetchAllProducts pagination ───────────────────────────────────────────────
// Mirrors the pagination behaviour in generate-sitemap.mjs:fetchAllProducts.
// Uses a helper that accepts an injected fetcher to keep this pure and testable.

const PAGE_LIMIT = 100;

async function paginatedFetch(
  fetcher: (page: number) => Promise<{ data: { slug: string }[]; meta: { totalPages: number } } | null>,
): Promise<{ slug: string }[]> {
  const all: { slug: string }[] = [];
  let page = 1;

  while (true) {
    const payload = await fetcher(page);
    if (!payload) break;

    const items = Array.isArray(payload.data) ? payload.data : [];
    all.push(...items);

    const totalPages = payload.meta?.totalPages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  return all;
}

describe('fetchAllProducts() — pagination', () => {
  it('returns all items from a single page', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce({
      data: [{ slug: 'prod-1' }, { slug: 'prod-2' }],
      meta: { totalPages: 1 },
    });

    const result = await paginatedFetch(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.map(p => p.slug)).toEqual(['prod-1', 'prod-2']);
  });

  it('fetches subsequent pages until totalPages is exhausted', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: PAGE_LIMIT }, (_, i) => ({ slug: `prod-${i + 1}` })),
        meta: { totalPages: 3 },
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: PAGE_LIMIT }, (_, i) => ({ slug: `prod-${PAGE_LIMIT + i + 1}` })),
        meta: { totalPages: 3 },
      })
      .mockResolvedValueOnce({
        data: [{ slug: 'prod-201' }],
        meta: { totalPages: 3 },
      });

    const result = await paginatedFetch(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(PAGE_LIMIT * 2 + 1);
    expect(result[0].slug).toBe('prod-1');
    expect(result[result.length - 1].slug).toBe('prod-201');
  });

  it('stops immediately when the fetcher returns null (network error)', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(null);

    const result = await paginatedFetch(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('does not fetch a fourth page when totalPages is 3', async () => {
    const page = (n: number) => ({
      data: [{ slug: `prod-p${n}` }],
      meta: { totalPages: 3 },
    });
    const fetcher = jest.fn()
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(2))
      .mockResolvedValueOnce(page(3));

    await paginatedFetch(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

// ── prerender-routes.txt content ─────────────────────────────────────────────
// Verifies the set of routes written to prerender-routes.txt is a superset
// of the static routes and includes product + category slugs.
//
// Fix: /products is intentionally absent from STATIC_PRERENDER_ROUTES.
// It must be SSR-rendered on-demand so prices/stock are always fresh.
// Including it would bake a stale CDN snapshot at build time (EU Omnibus risk).

const STATIC_PRERENDER = [
  '/',
  '/legal/terms',
  '/legal/privacy',
  '/legal/withdrawal',
];

function buildPrerenderRoutes(
  products: { slug?: string }[],
  categories: { slug?: string }[],
): string[] {
  return [
    ...STATIC_PRERENDER,
    ...products.filter(p => p?.slug).map(p => `/products/${p.slug}`),
    ...categories.filter(c => c?.slug).map(c => `/category/${c.slug}`),
  ];
}

describe('prerender-routes.txt generation', () => {
  it('always includes the 4 static routes', () => {
    const routes = buildPrerenderRoutes([], []);
    for (const r of STATIC_PRERENDER) {
      expect(routes).toContain(r);
    }
    expect(routes.filter(r => !r.includes(':'))).toHaveLength(4);
  });

  it('does NOT include /products as a static prerender route — catalog must hit SSR for fresh prices', () => {
    const routes = buildPrerenderRoutes([], []);
    expect(routes).not.toContain('/products');
  });

  it('does NOT include /cart — disallowed by robots.txt and has no SEO value', () => {
    const routes = buildPrerenderRoutes([], []);
    expect(routes).not.toContain('/cart');
  });

  it('maps product slugs to /products/:slug', () => {
    const routes = buildPrerenderRoutes(
      [{ slug: 'chanel-no5' }, { slug: 'santal-33' }],
      [],
    );
    expect(routes).toContain('/products/chanel-no5');
    expect(routes).toContain('/products/santal-33');
  });

  it('maps category slugs to /category/:slug', () => {
    const routes = buildPrerenderRoutes([], [{ slug: 'perfumy' }, { slug: 'niszowe' }]);
    expect(routes).toContain('/category/perfumy');
    expect(routes).toContain('/category/niszowe');
  });

  it('skips products and categories without a slug', () => {
    const routes = buildPrerenderRoutes(
      [{ slug: 'good-prod' }, {}],
      [{}, { slug: 'good-cat' }],
    );
    expect(routes.filter(r => r.startsWith('/products/'))).toEqual(['/products/good-prod']);
    expect(routes.filter(r => r.startsWith('/category/'))).toEqual(['/category/good-cat']);
  });

  it('total route count equals static + products + categories', () => {
    const products = [{ slug: 'p1' }, { slug: 'p2' }];
    const categories = [{ slug: 'c1' }];
    const routes = buildPrerenderRoutes(products, categories);
    expect(routes).toHaveLength(STATIC_PRERENDER.length + products.length + categories.length);
  });
});

// ── fetchJson retry-with-backoff ─────────────────────────────────────────────
// Mirrors generate-sitemap.mjs:fetchJson. The real function calls the global
// `fetch` directly; here the per-attempt fetch and the sleep are injected so
// the retry/backoff behaviour can be tested without real network or timers.

const FETCH_MAX_ATTEMPTS = 3;
const FETCH_RETRY_BASE_MS = 1000;

async function fetchJsonWithRetry(
  attemptFetch: (attempt: number) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>,
  sleep: (ms: number) => Promise<void>,
  attempt = 1,
): Promise<unknown> {
  try {
    const res = await attemptFetch(attempt);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch {
    if (attempt < FETCH_MAX_ATTEMPTS) {
      await sleep(FETCH_RETRY_BASE_MS * 2 ** (attempt - 1));
      return fetchJsonWithRetry(attemptFetch, sleep, attempt + 1);
    }
    return null;
  }
}

describe('fetchJson() — retry with backoff', () => {
  it('returns parsed JSON on the first successful attempt without retrying', async () => {
    const attemptFetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: ['ok'] }) });
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await fetchJsonWithRetry(attemptFetch, sleep);

    expect(result).toEqual({ data: ['ok'] });
    expect(attemptFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries after a network error and succeeds on the second attempt', async () => {
    const attemptFetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ['ok'] }) });
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await fetchJsonWithRetry(attemptFetch, sleep);

    expect(result).toEqual({ data: ['ok'] });
    expect(attemptFetch).toHaveBeenCalledTimes(2);
  });

  it('retries after a non-2xx HTTP response and succeeds once the backend recovers', async () => {
    const attemptFetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => null })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ['ok'] }) });
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await fetchJsonWithRetry(attemptFetch, sleep);

    expect(result).toEqual({ data: ['ok'] });
    expect(attemptFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null after exhausting all attempts when the backend never recovers', async () => {
    const attemptFetch = jest.fn().mockRejectedValue(new Error('fetch failed'));
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await fetchJsonWithRetry(attemptFetch, sleep);

    expect(result).toBeNull();
    expect(attemptFetch).toHaveBeenCalledTimes(FETCH_MAX_ATTEMPTS);
  });

  it('backs off with exponentially increasing delay between attempts', async () => {
    const attemptFetch = jest.fn().mockRejectedValue(new Error('fetch failed'));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await fetchJsonWithRetry(attemptFetch, sleep);

    expect(sleep).toHaveBeenNthCalledWith(1, FETCH_RETRY_BASE_MS);
    expect(sleep).toHaveBeenNthCalledWith(2, FETCH_RETRY_BASE_MS * 2);
  });
});

// ── minimum prerender route gate ─────────────────────────────────────────────
// Mirrors the MIN_PRERENDER_ROUTES guard in generate-sitemap.mjs:main. Fails
// the build instead of silently shipping a sitemap with only static routes
// when every backend fetch failed — but only when SITEMAP_BACKEND_URL was
// explicitly set (production builds). CI/local builds use the localhost
// default with no backend running by design, so they must keep degrading
// gracefully instead of failing — see ci.yml's `Build frontend` step, which
// never starts the backend in the build-and-test job.

const MIN_PRERENDER_ROUTES = STATIC_PRERENDER.length + 1;

function shouldAbortBuild(prerenderRoutes: string[], enforceMinRoutes: boolean): boolean {
  return enforceMinRoutes && prerenderRoutes.length < MIN_PRERENDER_ROUTES;
}

describe('minimum prerender route gate', () => {
  it('aborts the build when only the static routes resolved AND a backend URL was explicitly configured', () => {
    const routes = buildPrerenderRoutes([], []);
    expect(shouldAbortBuild(routes, true)).toBe(true);
  });

  it('does not abort when only the static routes resolved but no backend URL was configured (CI/local default)', () => {
    const routes = buildPrerenderRoutes([], []);
    expect(shouldAbortBuild(routes, false)).toBe(false);
  });

  it('proceeds when at least one product route resolved', () => {
    const routes = buildPrerenderRoutes([{ slug: 'chanel-no5' }], []);
    expect(shouldAbortBuild(routes, true)).toBe(false);
  });

  it('proceeds when at least one category route resolved', () => {
    const routes = buildPrerenderRoutes([], [{ slug: 'perfumy' }]);
    expect(shouldAbortBuild(routes, true)).toBe(false);
  });

  it('proceeds when products and categories both resolved with many routes', () => {
    const routes = buildPrerenderRoutes(
      [{ slug: 'p1' }, { slug: 'p2' }],
      [{ slug: 'c1' }, { slug: 'c2' }],
    );
    expect(shouldAbortBuild(routes, true)).toBe(false);
  });
});

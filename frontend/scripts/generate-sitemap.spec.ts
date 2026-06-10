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

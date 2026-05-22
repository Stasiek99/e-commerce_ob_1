#!/usr/bin/env node
/**
 * Build-time sitemap.xml + prerender-routes.txt generator.
 *
 * Fetches product and category slugs from the backend API and writes:
 *   - src/sitemap.xml         — submitted to Google Search Console
 *   - prerender-routes.txt    — Angular static prerender target list
 *
 * Runs automatically as a `prebuild` hook. On fetch failure the script
 * degrades gracefully: it still emits the static routes so production
 * builds never hard-fail because the backend is temporarily down.
 *
 * Environment overrides:
 *   SITEMAP_BACKEND_URL  default: http://localhost:3000/api
 *   SITEMAP_SITE_URL     default: https://fragrance-store.pl
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITEMAP_PATH = resolve(__dirname, '../src/sitemap.xml');
const PRERENDER_PATH = resolve(__dirname, '../prerender-routes.txt');
const BACKEND_URL = (process.env.SITEMAP_BACKEND_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const SITE_URL = (process.env.SITEMAP_SITE_URL || 'https://fragrance-store.pl').replace(/\/$/, '');
const FETCH_TIMEOUT_MS = 8000;
const PAGE_LIMIT = 100; // backend's per-page cap

const STATIC_ROUTES = [
  { path: '', priority: '1.0', changefreq: 'weekly' },
  { path: '/products', priority: '0.9', changefreq: 'daily' },
  { path: '/legal/terms', priority: '0.3', changefreq: 'yearly' },
  { path: '/legal/privacy', priority: '0.3', changefreq: 'yearly' },
  { path: '/legal/withdrawal', priority: '0.3', changefreq: 'yearly' },
];

const STATIC_PRERENDER_ROUTES = [
  '/',
  '/products',
  '/cart',
  '/legal/terms',
  '/legal/privacy',
  '/legal/withdrawal',
];

async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[sitemap] WARN: could not fetch ${url} — HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[sitemap] WARN: could not fetch ${url} — ${err.message}`);
    return null;
  }
}

/** Paginates through all products, respecting the backend's 100-item cap. */
async function fetchAllProducts() {
  const all = [];
  let page = 1;

  while (true) {
    const payload = await fetchJson(`${BACKEND_URL}/products?page=${page}&limit=${PAGE_LIMIT}`);
    if (!payload) break;

    const items = Array.isArray(payload.data) ? payload.data
      : Array.isArray(payload) ? payload
      : [];
    all.push(...items);

    const totalPages = payload.meta?.totalPages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  return all;
}

/** Recursively flattens a category tree (up to 3 levels). */
function flattenCategories(categories) {
  const all = [];
  for (const cat of categories ?? []) {
    if (cat?.slug) all.push(cat);
    if (cat?.children?.length) all.push(...flattenCategories(cat.children));
  }
  return all;
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry({ loc, lastmod, priority, changefreq }) {
  const lines = [
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod && `    <lastmod>${lastmod}</lastmod>`,
    changefreq && `    <changefreq>${changefreq}</changefreq>`,
    priority && `    <priority>${priority}</priority>`,
  ].filter(Boolean);
  return `  <url>\n${lines.join('\n')}\n  </url>`;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const [products, categoriesPayload] = await Promise.all([
    fetchAllProducts(),
    fetchJson(`${BACKEND_URL}/categories`),
  ]);

  const categories = flattenCategories(
    Array.isArray(categoriesPayload) ? categoriesPayload
      : Array.isArray(categoriesPayload?.data) ? categoriesPayload.data
      : [],
  );

  // ── sitemap.xml ──────────────────────────────────────────────────
  const entries = [];

  for (const route of STATIC_ROUTES) {
    entries.push(urlEntry({
      loc: `${SITE_URL}${route.path}`,
      lastmod: today,
      priority: route.priority,
      changefreq: route.changefreq,
    }));
  }

  for (const product of products) {
    if (!product?.slug) continue;
    entries.push(urlEntry({
      loc: `${SITE_URL}/products/${product.slug}`,
      lastmod: toIsoDate(product.updatedAt),
      priority: '0.8',
      changefreq: 'weekly',
    }));
  }

  for (const category of categories) {
    if (!category?.slug) continue;
    entries.push(urlEntry({
      loc: `${SITE_URL}/category/${category.slug}`,
      lastmod: today,
      priority: '0.7',
      changefreq: 'weekly',
    }));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${entries.join('\n')}
</urlset>
`;

  writeFileSync(SITEMAP_PATH, xml, 'utf8');
  console.log(`[sitemap] wrote ${SITEMAP_PATH}`);
  console.log(`[sitemap] ${STATIC_ROUTES.length} static + ${products.length} products + ${categories.length} categories = ${entries.length} urls`);

  // ── prerender-routes.txt ─────────────────────────────────────────
  const prerenderRoutes = [
    ...STATIC_PRERENDER_ROUTES,
    ...products.filter(p => p?.slug).map(p => `/products/${p.slug}`),
    ...categories.filter(c => c?.slug).map(c => `/category/${c.slug}`),
  ];

  writeFileSync(PRERENDER_PATH, prerenderRoutes.join('\n') + '\n', 'utf8');
  console.log(`[sitemap] wrote ${PRERENDER_PATH} (${prerenderRoutes.length} routes to prerender)`);
}

main().catch((err) => {
  console.error('[sitemap] generation failed:', err);
  process.exit(1);
});

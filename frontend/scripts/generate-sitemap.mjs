#!/usr/bin/env node
/**
 * Build-time sitemap.xml + prerender-routes.txt generator.
 *
 * Fetches product and category slugs from the backend API and writes:
 *   - src/sitemap.xml         — submitted to Google Search Console
 *   - prerender-routes.txt    — Angular static prerender target list
 *
 * Runs automatically as a `prebuild` hook. Backend fetches are retried
 * with backoff; if they still fail, the build fails rather than silently
 * shipping a sitemap/prerender list with only the static routes.
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
// Only enforce the minimum-route gate when a backend target was explicitly
// configured (Vercel production builds set this). Local/CI builds fall back
// to localhost with no backend running by design, so they keep degrading
// gracefully instead of failing.
const ENFORCE_MIN_ROUTES = Boolean(process.env.SITEMAP_BACKEND_URL);
const BACKEND_URL = (process.env.SITEMAP_BACKEND_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const SITE_URL = (process.env.SITEMAP_SITE_URL || 'https://fragrance-store.pl').replace(/\/$/, '');
const FETCH_TIMEOUT_MS = 8000;
const PAGE_LIMIT = 100; // backend's per-page cap
const FETCH_MAX_ATTEMPTS = 3;
const FETCH_RETRY_BASE_MS = 1000;

const STATIC_ROUTES = [
  { path: '', priority: '1.0', changefreq: 'weekly' },
  { path: '/products', priority: '0.9', changefreq: 'daily' },
  { path: '/legal/terms', priority: '0.3', changefreq: 'yearly' },
  { path: '/legal/privacy', priority: '0.3', changefreq: 'yearly' },
  { path: '/legal/withdrawal', priority: '0.3', changefreq: 'yearly' },
];

const STATIC_PRERENDER_ROUTES = [
  '/',
  '/legal/terms',
  '/legal/privacy',
  '/legal/withdrawal',
];

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (attempt < FETCH_MAX_ATTEMPTS) {
      const delayMs = FETCH_RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(`[sitemap] WARN: fetch ${url} failed (attempt ${attempt}/${FETCH_MAX_ATTEMPTS}) — ${err.message}. Retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchJson(url, attempt + 1);
    }
    console.warn(`[sitemap] WARN: could not fetch ${url} after ${FETCH_MAX_ATTEMPTS} attempts — ${err.message}`);
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

  // Anything at or below the static-only count means every backend fetch
  // failed (products and categories both came back empty). When a real
  // backend was configured (production builds), fail the build instead of
  // silently shipping a near-empty prerender list.
  const MIN_PRERENDER_ROUTES = STATIC_PRERENDER_ROUTES.length + 1;
  if (prerenderRoutes.length < MIN_PRERENDER_ROUTES) {
    const message = `only ${prerenderRoutes.length} prerender route(s) resolved (minimum ${MIN_PRERENDER_ROUTES}) — backend fetch likely failed.`;
    if (ENFORCE_MIN_ROUTES) {
      console.error(`[sitemap] FATAL: ${message} Aborting build.`);
      process.exit(1);
    }
    console.warn(`[sitemap] WARN: ${message} SITEMAP_BACKEND_URL not set — continuing with static routes only.`);
  }

  writeFileSync(PRERENDER_PATH, prerenderRoutes.join('\n') + '\n', 'utf8');
  console.log(`[sitemap] wrote ${PRERENDER_PATH} (${prerenderRoutes.length} routes to prerender)`);
}

main().catch((err) => {
  console.error('[sitemap] generation failed:', err);
  process.exit(1);
});

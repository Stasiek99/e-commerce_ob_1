#!/usr/bin/env node
/**
 * Build-time sitemap.xml generator.
 *
 * Fetches product and category slugs from the backend API and writes
 * src/sitemap.xml. The file is picked up by the Angular build as a
 * static asset and served at /sitemap.xml.
 *
 * Runs automatically as a `prebuild` hook. On fetch failure the script
 * degrades gracefully: it still writes a sitemap containing only the
 * static routes so production builds never hard-fail because the
 * backend happened to be down.
 *
 * Environment overrides:
 *   SITEMAP_BACKEND_URL  default: http://localhost:3000/api
 *   SITEMAP_SITE_URL     default: https://fragrance-store.pl
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../src/sitemap.xml');
const BACKEND_URL = (process.env.SITEMAP_BACKEND_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const SITE_URL = (process.env.SITEMAP_SITE_URL || 'https://fragrance-store.pl').replace(/\/$/, '');
const FETCH_TIMEOUT_MS = 5000;

const STATIC_ROUTES = [
  { path: '', priority: '1.0', changefreq: 'weekly' },
  { path: '/products', priority: '0.9', changefreq: 'daily' },
  { path: '/legal/terms', priority: '0.3', changefreq: 'yearly' },
  { path: '/legal/privacy', priority: '0.3', changefreq: 'yearly' },
  { path: '/legal/withdrawal', priority: '0.3', changefreq: 'yearly' },
];

async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[sitemap] WARN: could not fetch ${url} — ${err.message}`);
    return null;
  }
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
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

function extractArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const [productsPayload, categoriesPayload] = await Promise.all([
    fetchJson(`${BACKEND_URL}/products?limit=1000`),
    fetchJson(`${BACKEND_URL}/categories`),
  ]);

  const products = extractArray(productsPayload);
  const categories = extractArray(categoriesPayload);

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

  writeFileSync(OUTPUT_PATH, xml, 'utf8');

  console.log(`[sitemap] wrote ${OUTPUT_PATH}`);
  console.log(
    `[sitemap] ${STATIC_ROUTES.length} static + ${products.length} products + ${categories.length} categories = ${entries.length} urls`,
  );
}

main().catch((err) => {
  console.error('[sitemap] generation failed:', err);
  process.exit(1);
});

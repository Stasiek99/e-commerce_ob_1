/**
 * Regression guard for SEO-sensitive static files.
 *
 * Invariants:
 *   1. robots.txt exists with correct Disallow rules so Googlebot never crawls
 *      /cart, /checkout, /account, or /auth.
 *   2. /cart is absent from prerender-routes.txt — an empty-cart prerendered
 *      page wastes crawl budget and could expose SSR personalisation publicly.
 *   3. angular.json wires robots.txt into the assets array so it lands at the
 *      site root in every production build.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC_DIR = __dirname;
const FRONTEND_DIR = join(SRC_DIR, '..');

const robotsTxt = readFileSync(join(SRC_DIR, 'robots.txt'), 'utf8');
const prerenderRoutes = readFileSync(join(FRONTEND_DIR, 'prerender-routes.txt'), 'utf8');
const angularJson = JSON.parse(readFileSync(join(FRONTEND_DIR, 'angular.json'), 'utf8'));

// ---------------------------------------------------------------------------
// robots.txt content
// ---------------------------------------------------------------------------

describe('robots.txt — crawler disallow rules', () => {
  it('disallows /checkout/ to prevent indexing of checkout flow pages', () => {
    expect(robotsTxt).toContain('Disallow: /checkout/');
  });

  it('disallows /account/ to prevent indexing of protected account pages', () => {
    expect(robotsTxt).toContain('Disallow: /account/');
  });

  it('disallows /auth/ to prevent indexing of OAuth callback and login pages', () => {
    expect(robotsTxt).toContain('Disallow: /auth/');
  });

  it('disallows /cart so an empty-cart page is never indexed or cached publicly', () => {
    expect(robotsTxt).toContain('Disallow: /cart');
  });

  it('explicitly allows / so the crawl-budget Allow/Disallow resolution is unambiguous', () => {
    expect(robotsTxt).toContain('Allow: /');
  });

  it('includes a Sitemap directive so crawlers discover sitemap.xml', () => {
    expect(robotsTxt).toMatch(/^Sitemap:\s+https?:\/\//m);
  });

  it('applies rules to all user-agents via the wildcard directive', () => {
    expect(robotsTxt).toContain('User-agent: *');
  });
});

// ---------------------------------------------------------------------------
// prerender-routes.txt — /cart must not be prerendered
// ---------------------------------------------------------------------------

describe('prerender-routes.txt — /cart must be absent', () => {
  const routes = prerenderRoutes
    .split('\n')
    .map(r => r.trim())
    .filter(Boolean);

  it('does not contain /cart — a prerendered empty-cart page has no SEO value', () => {
    expect(routes).not.toContain('/cart');
  });

  it('still contains the home route /', () => {
    expect(routes).toContain('/');
  });
});

// ---------------------------------------------------------------------------
// angular.json — robots.txt must be in the assets array
// ---------------------------------------------------------------------------

describe('angular.json — robots.txt wired as a build asset', () => {
  const assets: unknown[] =
    angularJson?.projects?.frontend?.architect?.build?.options?.assets ?? [];

  it('includes src/robots.txt so it is copied to the output directory on every build', () => {
    const hasEntry = assets.some(
      (a) => a === 'src/robots.txt' || (typeof a === 'object' && (a as { glob?: string }).glob === 'robots.txt'),
    );
    expect(hasEntry).toBe(true);
  });
});

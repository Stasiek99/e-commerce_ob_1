/**
 * Tests for the inject-sentry-dsn.mjs prebuild script.
 *
 * inject-sentry-dsn.mjs is a self-executing ESM script; Jest cannot import it
 * directly without --experimental-vm-modules. The substitution function below
 * is a mirror of the regex used in the script — any change to the script must
 * be reflected here.
 *
 * Invariants:
 *   1. environment.prod.ts must not contain a real Sentry DSN in source so the
 *      key is never baked into git history.
 *   2. The substitution replaces exactly the sentryDsn value and nothing else.
 *   3. package.json prebuild script chains inject-sentry-dsn.mjs before the
 *      sitemap generator so the DSN is injected before ng build reads the file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SCRIPTS_DIR = __dirname;
const FRONTEND_DIR = join(SCRIPTS_DIR, '..');
const SRC_DIR = join(FRONTEND_DIR, 'src');

// ── Mirror of inject-sentry-dsn.mjs substitution logic ───────────────────────

function injectDsn(fileContent: string, dsn: string): string {
  return fileContent.replace(
    /sentryDsn:\s*'[^']*'/,
    `sentryDsn: '${dsn}'`,
  );
}

// ── Substitution logic ────────────────────────────────────────────────────────

describe('inject-sentry-dsn — substitution logic', () => {
  const template = `export const environment = {
  production: true,
  sentryDsn: '',
  sentryTracesSampleRate: 0.1,
};`;

  it('replaces an empty DSN with the provided value', () => {
    const dsn = 'https://abc123@o0.ingest.sentry.io/1';
    const result = injectDsn(template, dsn);

    expect(result).toContain(`sentryDsn: '${dsn}'`);
  });

  it('replaces an existing DSN with a new value', () => {
    const withOldDsn = template.replace("sentryDsn: ''", "sentryDsn: 'https://old@sentry.io/1'");
    const newDsn = 'https://new@sentry.io/2';
    const result = injectDsn(withOldDsn, newDsn);

    expect(result).toContain(`sentryDsn: '${newDsn}'`);
    expect(result).not.toContain('old');
  });

  it('leaves the rest of the environment object unchanged', () => {
    const result = injectDsn(template, 'https://x@sentry.io/1');

    expect(result).toContain('production: true');
    expect(result).toContain('sentryTracesSampleRate: 0.1');
  });

  it('is a no-op when sentryDsn pattern is absent (warns in real script, does not throw here)', () => {
    const noMatch = 'export const environment = { production: true };';
    const result = injectDsn(noMatch, 'https://x@sentry.io/1');

    expect(result).toBe(noMatch);
  });

  it('sets an empty string when called with an empty DSN', () => {
    const withDsn = template.replace("sentryDsn: ''", "sentryDsn: 'https://old@sentry.io/1'");
    const result = injectDsn(withDsn, '');

    expect(result).toContain("sentryDsn: ''");
  });
});

// ── environment.prod.ts — must not contain a hardcoded DSN ───────────────────

describe('environment.prod.ts — no hardcoded Sentry DSN in source', () => {
  const envProd = readFileSync(
    join(SRC_DIR, 'environments', 'environment.prod.ts'),
    'utf8',
  );

  it('sentryDsn is an empty string — not a real DSN key', () => {
    // A real Sentry DSN contains an ingest hostname.
    // This guards against accidentally re-committing a live key.
    expect(envProd).not.toMatch(/sentryDsn:\s*'https?:\/\/[^@]+@[^']+'/);
  });

  it('sentryDsn field is present so the substitution pattern can match at build time', () => {
    expect(envProd).toMatch(/sentryDsn:\s*'/);
  });
});

// ── package.json — prebuild must chain inject-sentry-dsn.mjs ─────────────────

describe('package.json — prebuild chains inject-sentry-dsn.mjs', () => {
  const pkg = JSON.parse(
    readFileSync(join(FRONTEND_DIR, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };

  it('prebuild script exists', () => {
    expect(pkg.scripts?.['prebuild']).toBeDefined();
  });

  it('prebuild script calls inject-sentry-dsn.mjs so the DSN is set before ng build reads the file', () => {
    expect(pkg.scripts?.['prebuild']).toContain('inject-sentry-dsn.mjs');
  });

  it('inject-sentry-dsn.mjs runs before generate-sitemap.mjs in the prebuild chain', () => {
    const prebuild = pkg.scripts?.['prebuild'] ?? '';
    const injectIdx = prebuild.indexOf('inject-sentry-dsn.mjs');
    const sitemapIdx = prebuild.indexOf('generate-sitemap.mjs');

    expect(injectIdx).toBeGreaterThan(-1);
    expect(sitemapIdx).toBeGreaterThan(-1);
    expect(injectIdx).toBeLessThan(sitemapIdx);
  });
});

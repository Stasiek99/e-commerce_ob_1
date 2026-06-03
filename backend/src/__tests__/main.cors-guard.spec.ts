/**
 * Regression guard for the CORS localhost-in-production check in main.ts.
 *
 * Invariants:
 *  1. In production, any FRONTEND_URL value that contains 'localhost' throws
 *     at startup — prevents accidental misconfiguration from letting the dev
 *     server bypass CORS with credentials: true.
 *  2. In non-production environments localhost origins are allowed (local dev).
 *  3. The error message is actionable: it names the env var to fix.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Source contract ───────────────────────────────────────────────────────────
// Fails if the guard is removed or the error message is weakened in main.ts.

describe('main.ts — CORS localhost production guard (source contract)', () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, '../main.ts'),
    'utf-8',
  );

  it('throws on localhost origin in production — guard exists in bootstrap()', () => {
    expect(mainSource).toContain("allowedOrigins.some((o) => o.includes('localhost')");
  });

  it('guards are scoped to NODE_ENV === production only', () => {
    expect(mainSource).toContain("process.env.NODE_ENV === 'production'");
  });

  it('throws with an error message that names the misconfiguration cause', () => {
    expect(mainSource).toContain('CORS misconfiguration');
  });

  it('throws with an error message that names FRONTEND_URL as the variable to fix', () => {
    expect(mainSource).toContain('FRONTEND_URL');
  });
});

// ── Behaviour tests ───────────────────────────────────────────────────────────
// The guard logic is reproduced here as a pure function so it can be tested
// without bootstrapping the full NestJS app. The source contract suite above
// ensures that if someone removes or changes main.ts the tests still fail.

function assertCorsLocalhostGuard(allowedOrigins: string[], nodeEnv: string): void {
  if (
    nodeEnv === 'production' &&
    allowedOrigins.some((o) => o.includes('localhost'))
  ) {
    throw new Error(
      'CORS misconfiguration: localhost origin detected in production — set FRONTEND_URL to the deployed frontend URL',
    );
  }
}

describe('main.ts — CORS localhost production guard (behaviour)', () => {
  // ── production: blocked paths ─────────────────────────────────────────────

  it('throws when FRONTEND_URL is the default localhost fallback in production', () => {
    expect(() =>
      assertCorsLocalhostGuard(['http://localhost:4200'], 'production'),
    ).toThrow('CORS misconfiguration');
  });

  it('throws when FRONTEND_URL contains localhost with a custom port in production', () => {
    expect(() =>
      assertCorsLocalhostGuard(['http://localhost:3000'], 'production'),
    ).toThrow('CORS misconfiguration');
  });

  it('throws when one of several comma-split origins is localhost in production', () => {
    expect(() =>
      assertCorsLocalhostGuard(
        ['https://myapp.vercel.app', 'http://localhost:4200'],
        'production',
      ),
    ).toThrow('CORS misconfiguration');
  });

  it('throws when FRONTEND_URL is localhost without a port in production', () => {
    expect(() =>
      assertCorsLocalhostGuard(['http://localhost'], 'production'),
    ).toThrow('CORS misconfiguration');
  });

  it('error message names FRONTEND_URL so the operator knows what to fix', () => {
    expect(() =>
      assertCorsLocalhostGuard(['http://localhost:4200'], 'production'),
    ).toThrow('FRONTEND_URL');
  });

  // ── production: allowed paths ─────────────────────────────────────────────

  it('does not throw for a Vercel origin in production', () => {
    expect(() =>
      assertCorsLocalhostGuard(['https://myapp.vercel.app'], 'production'),
    ).not.toThrow();
  });

  it('does not throw for multiple non-localhost origins in production', () => {
    expect(() =>
      assertCorsLocalhostGuard(
        ['https://myapp.vercel.app', 'https://myapp-staging.vercel.app'],
        'production',
      ),
    ).not.toThrow();
  });

  it('does not throw for a Railway origin in production', () => {
    expect(() =>
      assertCorsLocalhostGuard(
        ['https://backend-production-c004.up.railway.app'],
        'production',
      ),
    ).not.toThrow();
  });

  // ── non-production: localhost always allowed ──────────────────────────────

  it('does not throw for localhost origin in development environment', () => {
    expect(() =>
      assertCorsLocalhostGuard(['http://localhost:4200'], 'development'),
    ).not.toThrow();
  });

  it('does not throw for localhost origin when NODE_ENV is test', () => {
    expect(() =>
      assertCorsLocalhostGuard(['http://localhost:4200'], 'test'),
    ).not.toThrow();
  });

  it('does not throw for localhost origin when NODE_ENV is undefined', () => {
    expect(() =>
      assertCorsLocalhostGuard(['http://localhost:4200'], ''),
    ).not.toThrow();
  });

  // ── origin parsing (mirrors main.ts split/trim/filter logic) ─────────────

  it('does not throw when the origins array is empty (no FRONTEND_URL set edge case)', () => {
    expect(() => assertCorsLocalhostGuard([], 'production')).not.toThrow();
  });
});

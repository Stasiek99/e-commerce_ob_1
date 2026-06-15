/**
 * Regression guard for the Pino logger redact configuration.
 *
 * Invariant: every field listed here must be in PINO_REDACT_PATHS so that
 * plaintext passwords, tax IDs, and bank account numbers never appear in
 * Railway logs. Removing any path from the constant will cause these tests
 * to fail, making the omission visible before the code ships.
 *
 * GDPR Art. 32 / PCI-DSS concern: Railway logs are stored and searchable.
 */
import { PINO_REDACT_PATHS, PINO_SERIALIZERS } from '../logger-redact-paths';

describe('PINO_REDACT_PATHS — all sensitive fields are covered', () => {
  // ── Headers ───────────────────────────────────────────────────────────────

  it('redacts req.headers.authorization (Bearer tokens)', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.authorization');
  });

  it('redacts req.headers.cookie (refresh token httpOnly cookie)', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.cookie');
  });

  // ── Body — authentication ─────────────────────────────────────────────────

  it('redacts req.body.password (POST /auth/login, /auth/register)', () => {
    expect(PINO_REDACT_PATHS).toContain('req.body.password');
  });

  it('redacts req.body.newPassword (POST /auth/reset-password)', () => {
    expect(PINO_REDACT_PATHS).toContain('req.body.newPassword');
  });

  it('redacts req.body.confirmPassword (POST /auth/register password confirm)', () => {
    expect(PINO_REDACT_PATHS).toContain('req.body.confirmPassword');
  });

  // ── Body — financial / identity ───────────────────────────────────────────

  it('redacts req.body.nip (B2B tax identifier — personal data under GDPR)', () => {
    expect(PINO_REDACT_PATHS).toContain('req.body.nip');
  });

  it('redacts req.body.bankAccount (IBAN on return/refund requests)', () => {
    expect(PINO_REDACT_PATHS).toContain('req.body.bankAccount');
  });

  // ── Completeness check ────────────────────────────────────────────────────

  it('covers at least 7 sensitive paths (headers + auth body + financial body)', () => {
    expect(PINO_REDACT_PATHS.length).toBeGreaterThanOrEqual(7);
  });
});

describe('PINO_SERIALIZERS.req — query parameters are stripped from logged URLs', () => {
  // ── Blocked path: PII in query string must not appear in the log ──────────

  it('omits query string from URL with a single query param (email leak prevention)', () => {
    const result = PINO_SERIALIZERS.req({
      method: 'GET',
      url: '/orders/track?email=jan.kowalski%40gmail.com&orderNumber=ORD-2026-000001',
    });

    expect(result.url).toBe('/orders/track');
    expect(result.url).not.toContain('email=');
    expect(result.url).not.toContain('orderNumber=');
  });

  it('omits query string from URLs with multiple query params', () => {
    const result = PINO_SERIALIZERS.req({
      method: 'GET',
      url: '/products?category=perfumes&page=2&limit=20',
    });

    expect(result.url).toBe('/products');
  });

  // ── Happy path: path-only URLs are unchanged ──────────────────────────────

  it('preserves the URL path when there is no query string', () => {
    const result = PINO_SERIALIZERS.req({ method: 'GET', url: '/orders/track' });

    expect(result.url).toBe('/orders/track');
  });

  // ── Preserves required fields ─────────────────────────────────────────────

  it('preserves the HTTP method in the serialized output', () => {
    const result = PINO_SERIALIZERS.req({ method: 'POST', url: '/auth/login?foo=bar' });

    expect(result.method).toBe('POST');
  });

  it('preserves the request id when provided', () => {
    const result = PINO_SERIALIZERS.req({ method: 'GET', url: '/health', id: 'req-abc-123' });

    expect(result.id).toBe('req-abc-123');
  });

  it('sets id to undefined when not provided', () => {
    const result = PINO_SERIALIZERS.req({ method: 'GET', url: '/health' });

    expect(result.id).toBeUndefined();
  });
});

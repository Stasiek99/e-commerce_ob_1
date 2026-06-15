/**
 * Regression guard for the SSR security headers middleware.
 *
 * Invariants:
 *  - Content-Security-Policy is set on every response, restricting script/connect/frame sources
 *  - CSP script-src uses a per-request nonce instead of 'unsafe-inline'
 *  - The nonce is stored on res.locals.cspNonce for downstream SSR render use
 *  - frame-ancestors 'none' prevents clickjacking of SSR-rendered pages
 *  - X-Content-Type-Options: nosniff prevents MIME-type sniffing
 *  - Referrer-Policy limits referrer leakage to cross-origin navigations
 *  - next() is always called so the SSR pipeline continues
 */

import { ssrSecurityHeaders, buildCsp, generateNonce } from '../ssr-security-headers';
import type { Request, Response, NextFunction } from 'express';

function makeResMock(): { setHeader: jest.Mock; locals: Record<string, unknown> } {
  return { setHeader: jest.fn(), locals: {} };
}

function makeReq(path = '/'): Pick<Request, 'path'> {
  return { path } as Pick<Request, 'path'>;
}

describe('ssrSecurityHeaders middleware', () => {
  afterEach(() => jest.clearAllMocks());

  // ── Always calls next() ───────────────────────────────────────────────────

  it('always calls next() so the request pipeline continues', () => {
    const res = makeResMock();
    const next: NextFunction = jest.fn();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Per-request nonce ─────────────────────────────────────────────────────

  it('stores a nonce in res.locals.cspNonce for the render handler', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    expect(typeof res.locals['cspNonce']).toBe('string');
    expect((res.locals['cspNonce'] as string).length).toBeGreaterThan(0);
  });

  it('generates a different nonce for each request', () => {
    const res1 = makeResMock();
    const res2 = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res1 as unknown as Response, jest.fn());
    ssrSecurityHeaders(makeReq() as Request, res2 as unknown as Response, jest.fn());

    expect(res1.locals['cspNonce']).not.toBe(res2.locals['cspNonce']);
  });

  it('generateNonce returns a non-empty base64 string', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(nonce.length).toBeGreaterThanOrEqual(20);
  });

  // ── Content-Security-Policy ───────────────────────────────────────────────

  it('sets Content-Security-Policy header on every response', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq('/products/some-slug') as Request, res as unknown as Response, jest.fn());

    expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
  });

  it('CSP default-src restricts to self', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    expect(csp).toContain("default-src 'self'");
  });

  it('CSP script-src uses nonce instead of unsafe-inline', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    const nonce = res.locals['cspNonce'] as string;
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';

    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('buildCsp embeds the provided nonce in script-src and omits unsafe-inline from that directive', () => {
    const nonce = 'test-nonce-abc123';
    const csp = buildCsp(nonce);
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('CSP script-src includes GTM and InPost GeoWidget', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    expect(csp).toContain('https://www.googletagmanager.com');
    expect(csp).toContain('https://geowidget.easypack24.net');
  });

  it('CSP script-src includes Cloudflare Turnstile', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    expect(csp).toContain('https://challenges.cloudflare.com');
  });

  it('CSP connect-src includes the Railway API backend', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    expect(csp).toContain('https://backend-production-c004.up.railway.app');
  });

  it('CSP frame-src includes the DPD pickup widget origin so the iframe loads on checkout', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq('/checkout/summary') as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    const frameSrc = csp.split(';').find((d) => d.trim().startsWith('frame-src')) ?? '';
    expect(frameSrc).toContain('https://api.dpd.cz');
  });

  it('CSP frame-ancestors none prevents this page from being embedded in iframes', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq('/checkout/summary') as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('CSP object-src none blocks Flash / plugin execution', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    expect(csp).toContain("object-src 'none'");
  });

  it('CSP base-uri self prevents base tag hijacking', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    const csp: string = res.setHeader.mock.calls.find(([key]) => key === 'Content-Security-Policy')[1];
    expect(csp).toContain("base-uri 'self'");
  });

  // ── X-Content-Type-Options ────────────────────────────────────────────────

  it('sets X-Content-Type-Options: nosniff to prevent MIME-type sniffing attacks', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  });

  // ── Referrer-Policy ───────────────────────────────────────────────────────

  it('sets Referrer-Policy: strict-origin-when-cross-origin to limit referrer leakage', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq() as Request, res as unknown as Response, jest.fn());

    expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  // ── Applied to all routes ─────────────────────────────────────────────────

  it('sets all three security headers on the home route', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq('/') as Request, res as unknown as Response, jest.fn());

    const keys = res.setHeader.mock.calls.map(([key]) => key);
    expect(keys).toContain('Content-Security-Policy');
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Referrer-Policy');
  });

  it('sets all three security headers on a protected account route', () => {
    const res = makeResMock();

    ssrSecurityHeaders(makeReq('/account/orders') as Request, res as unknown as Response, jest.fn());

    const keys = res.setHeader.mock.calls.map(([key]) => key);
    expect(keys).toContain('Content-Security-Policy');
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Referrer-Policy');
  });
});

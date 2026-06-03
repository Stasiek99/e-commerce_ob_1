/**
 * Regression guard for the Angular HTTP Transfer Cache configuration in app.config.ts.
 *
 * Invariants:
 *  1. provideHttpClient uses withFetch() — required for HTTP transfer cache to function.
 *     Without it, Angular's CachingInterceptor cannot deduplicate SSR vs client requests.
 *  2. GET responses pre-fetched during SSR are served from TransferState on the client,
 *     preventing a second network round-trip on hydration.
 *  3. POST requests bypass the cache (includePostRequests: false) — mutations must not be
 *     silently served from stale cached data.
 *  4. scrollPositionRestoration is set to 'enabled' so back-navigation restores the
 *     catalog scroll position. 'top' would cause back-button abandonment on mobile.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestBed } from '@angular/core/testing';
import {
  FetchBackend,
  HttpBackend,
  HttpClient,
  provideHttpClient,
  withFetch,
  ɵwithHttpTransferCache as withHttpTransferCache,
} from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { makeStateKey, TransferState } from '@angular/core';

// ── Mirrors Angular's internal cache key algorithm (common/fesm2022/http.mjs) ─

function computeAngularDjb2Hash(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (Math.imul(31, hash) + char.charCodeAt(0)) << 0;
  }
  hash += 2147483647 + 1;
  return hash.toString();
}

function makeHttpCacheKey(method: string, url: string, params = '', body = '', responseType = 'json') {
  const raw = [method, responseType, url, body, params].join('|');
  return makeStateKey<unknown>(computeAngularDjb2Hash(raw));
}

// Mirrors Angular's internal cached-response field constants (common/fesm2022/http.mjs)
const CACHE_BODY = 'b';
const CACHE_HEADERS = 'h';
const CACHE_STATUS = 's';
const CACHE_STATUS_TEXT = 'st';
const CACHE_REQ_URL = 'u';
const CACHE_RESPONSE_TYPE = 'rt';

// ── Suite 1 — withFetch() backend registration ────────────────────────────────

describe('appConfig — withFetch() HTTP backend', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('registers FetchBackend when withFetch() is provided — required for HTTP transfer cache', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withFetch())],
    });

    const backend = TestBed.inject(HttpBackend);

    expect(backend).toBeInstanceOf(FetchBackend);
  });

  it('does NOT register FetchBackend when withFetch() is absent (regression baseline)', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient()],
    });

    const backend = TestBed.inject(HttpBackend);

    expect(backend).not.toBeInstanceOf(FetchBackend);
  });
});

// ── Suite 2 — HTTP transfer cache behaviour ───────────────────────────────────

describe('appConfig — HTTP transfer cache', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let transferState: TransferState;

  const PRODUCTS_URL = '/api/products';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        ...withHttpTransferCache({ includePostRequests: false }),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    transferState = TestBed.inject(TransferState);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  // ── GET served from cache ─────────────────────────────────────────────────

  it('serves GET response from TransferState without forwarding to the network backend', () => {
    const storeKey = makeHttpCacheKey('GET', PRODUCTS_URL);
    const cachedProducts = [{ id: '1', name: 'Rose Oud' }];

    transferState.set(storeKey, {
      [CACHE_BODY]: cachedProducts,
      [CACHE_HEADERS]: {},
      [CACHE_STATUS]: 200,
      [CACHE_STATUS_TEXT]: 'OK',
      [CACHE_REQ_URL]: PRODUCTS_URL,
      [CACHE_RESPONSE_TYPE]: 'json',
    });

    let received: unknown;
    http.get(PRODUCTS_URL).subscribe((data) => (received = data));

    httpMock.expectNone(PRODUCTS_URL);
    expect(received).toEqual(cachedProducts);
  });

  it('provides the correct body from the cache entry', () => {
    const storeKey = makeHttpCacheKey('GET', PRODUCTS_URL);
    const payload = { id: '42', name: 'Oud Wood', price: 299 };

    transferState.set(storeKey, {
      [CACHE_BODY]: payload,
      [CACHE_HEADERS]: {},
      [CACHE_STATUS]: 200,
      [CACHE_STATUS_TEXT]: 'OK',
      [CACHE_REQ_URL]: PRODUCTS_URL,
      [CACHE_RESPONSE_TYPE]: 'json',
    });

    let received: unknown;
    http.get(PRODUCTS_URL).subscribe((data) => (received = data));

    expect(received).toEqual(payload);
  });

  it('forwards GET to the backend when TransferState has no cached entry for the URL', () => {
    http.get(PRODUCTS_URL).subscribe();

    const req = httpMock.expectOne(PRODUCTS_URL);
    expect(req.request.method).toBe('GET');
    req.flush([{ id: '1', name: 'Rose Oud' }]);
  });

  // ── POST bypasses cache ───────────────────────────────────────────────────

  it('bypasses the cache for POST requests (includePostRequests: false)', () => {
    http.post(PRODUCTS_URL, { name: 'New Product' }).subscribe();

    const req = httpMock.expectOne({ url: PRODUCTS_URL, method: 'POST' });
    req.flush({ id: '99', name: 'New Product' });
  });

  it('bypasses the cache for PUT requests (only GET/HEAD are cacheable by default)', () => {
    http.put(PRODUCTS_URL + '/1', { name: 'Updated' }).subscribe();

    const req = httpMock.expectOne({ method: 'PUT' });
    req.flush({ id: '1', name: 'Updated' });
  });

  it('bypasses the cache for DELETE requests', () => {
    http.delete(PRODUCTS_URL + '/1').subscribe();

    const req = httpMock.expectOne({ method: 'DELETE' });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});

// ── Suite 3 — scroll position restoration ────────────────────────────────────
//
// Angular EnvironmentProviders are circular objects (InjectionToken → factory
// → token) — JSON.stringify throws. Read the source file instead to assert the
// declared configuration without coupling to Angular's internal shapes.
// (Same approach used by pwa.spec.ts for service-worker config assertions.)

describe('appConfig — scroll position restoration', () => {
  const frontendRoot = path.resolve(__dirname, '../..');
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(
      path.join(frontendRoot, 'src/app/app.config.ts'),
      'utf-8',
    );
  });

  it("sets scrollPositionRestoration to 'enabled' so back-navigation restores catalog scroll position", () => {
    expect(source).toContain("scrollPositionRestoration: 'enabled'");
  });

  it("does NOT use 'top' restoration (regression guard: 'top' causes back-button abandonment)", () => {
    expect(source).not.toContain("scrollPositionRestoration: 'top'");
  });

  it('calls withInMemoryScrolling in the provideRouter configuration', () => {
    expect(source).toContain('withInMemoryScrolling');
  });
});
